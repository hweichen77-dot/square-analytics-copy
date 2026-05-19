import { parseCSVContent } from './csvParser'
import { parseXLSXCatalogue } from './xlsxParser'
import { parseShopifyCSV, parseEtsyCSV } from './shopifyParser'
import { upsertTransactions, upsertCatalogueProducts, upsertProductCosts } from '../db/dbUtils'
import * as XLSX from 'xlsx'
import { format as fmtDate } from 'date-fns'
import { db } from '../db/database'
import type { OpexEntry, OpexCategory } from '../types/models'

export interface ImportResult {
  added: number
  total: number
  skipped: number
  errors: string[]
}

export async function importCSVTransactions(file: File): Promise<ImportResult> {
  const text = await file.text()
  const { transactions, skipped, schemaError } = parseCSVContent(text)
  if (schemaError) {
    return { added: 0, total: 0, skipped: 0, errors: [schemaError] }
  }
  if (transactions.length === 0) {
    return { added: 0, total: 0, skipped, errors: ['No valid rows found in CSV.'] }
  }
  const added = await upsertTransactions(transactions)
  return { added, total: transactions.length, skipped, errors: [] }
}

export async function importShopifyCSV(file: File): Promise<ImportResult> {
  const text = await file.text()
  const { transactions, skipped, schemaError } = parseShopifyCSV(text)
  if (schemaError) return { added: 0, total: 0, skipped: 0, errors: [schemaError] }
  if (transactions.length === 0) return { added: 0, total: 0, skipped, errors: ['No valid orders found in Shopify CSV.'] }
  const added = await upsertTransactions(transactions)
  return { added, total: transactions.length, skipped, errors: [] }
}

export async function importEtsyCSV(file: File): Promise<ImportResult> {
  const text = await file.text()
  const { transactions, skipped, schemaError } = parseEtsyCSV(text)
  if (schemaError) return { added: 0, total: 0, skipped: 0, errors: [schemaError] }
  if (transactions.length === 0) return { added: 0, total: 0, skipped, errors: ['No valid orders found in Etsy CSV.'] }
  const added = await upsertTransactions(transactions)
  return { added, total: transactions.length, skipped, errors: [] }
}

export async function importXLSXCatalogue(file: File): Promise<ImportResult> {
  const buffer = await file.arrayBuffer()
  const { products, costs } = parseXLSXCatalogue(buffer)
  if (products.length === 0) {
    return { added: 0, total: 0, skipped: 0, errors: ['No valid products found in XLSX. Is this a Square Item Library export?'] }
  }
  await upsertCatalogueProducts(products)
  if (costs.length > 0) {
    await upsertProductCosts(costs)
  }
  return { added: products.length, total: products.length, skipped: 0, errors: [] }
}

function detectOpexCategory(name: string): OpexCategory {
  const n = name.toLowerCase()
  if (/costco|amazon|supply|supplies|clean/.test(n)) return 'Misc'
  if (/handheld|equipment|shelf|shelv|storage|faucet/.test(n)) return 'Store Equipment'
  if (/logo|market|sign|print/.test(n)) return 'Marketing'
  return 'Other'
}

function excelSerialToYearMonth(serial: number): string {
  const date = new Date((serial - 25569) * 86400 * 1000)
  return fmtDate(date, 'yyyy-MM')
}

// Header aliases for OPEX columns — matches case-insensitively
const OPEX_DATE_HEADERS = ['date', 'month', 'period', 'entry date']
const OPEX_AMOUNT_HEADERS = ['amount', 'cost', 'expense', 'total', 'value', 'price']
const OPEX_NAME_HEADERS = ['name', 'description', 'item', 'expense name', 'vendor', 'notes', 'detail']

function findColIndex(headers: string[], aliases: string[]): number {
  const lower = headers.map(h => (h ?? '').toString().toLowerCase().trim())
  for (const alias of aliases) {
    const idx = lower.indexOf(alias)
    if (idx !== -1) return idx
  }
  return -1
}

export async function importOpexXLSX(file: File): Promise<ImportResult> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    return { added: 0, total: 0, skipped: 0, errors: ['No sheets found in XLSX file.'] }
  }
  const sheet = workbook.Sheets[sheetName]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][]

  if (rows.length < 2) {
    return { added: 0, total: 0, skipped: 0, errors: ['XLSX file has no data rows.'] }
  }

  // Detect header row — try row 0 first, then row 1 (some sheets have a title in row 0)
  const headerRow0 = (rows[0] ?? []).map(c => String(c ?? ''))
  const dateIdx0 = findColIndex(headerRow0, OPEX_DATE_HEADERS)
  const amtIdx0 = findColIndex(headerRow0, OPEX_AMOUNT_HEADERS)
  const nameIdx0 = findColIndex(headerRow0, OPEX_NAME_HEADERS)

  let headerRowIdx = 0
  let dateIdx = dateIdx0
  let amtIdx = amtIdx0
  let nameIdx = nameIdx0

  if ((dateIdx < 0 || amtIdx < 0) && rows.length > 1) {
    const headerRow1 = (rows[1] ?? []).map(c => String(c ?? ''))
    const di1 = findColIndex(headerRow1, OPEX_DATE_HEADERS)
    const ai1 = findColIndex(headerRow1, OPEX_AMOUNT_HEADERS)
    const ni1 = findColIndex(headerRow1, OPEX_NAME_HEADERS)
    if (di1 >= 0 && ai1 >= 0) {
      headerRowIdx = 1; dateIdx = di1; amtIdx = ai1; nameIdx = ni1
    }
  }

  if (dateIdx < 0 || amtIdx < 0) {
    return {
      added: 0, total: 0, skipped: 0,
      errors: [
        `Could not find required columns. Need a "Date/Month" column and an "Amount/Cost" column. ` +
        `Found headers: ${(rows[headerRowIdx] ?? []).filter(Boolean).join(', ')}`,
      ],
    }
  }

  const entries: OpexEntry[] = []
  let skipped = 0

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    const rawDate = row[dateIdx]
    const amount = row[amtIdx]
    const rawName = nameIdx >= 0 ? row[nameIdx] : null

    // Date can be Excel serial (number) or a string like "2024-03" or "March 2024"
    let month: string
    if (typeof rawDate === 'number') {
      month = excelSerialToYearMonth(rawDate)
    } else if (typeof rawDate === 'string' && rawDate.trim()) {
      const d = new Date(rawDate.trim())
      if (isNaN(d.getTime())) { skipped++; continue }
      month = fmtDate(d, 'yyyy-MM')
    } else {
      skipped++; continue
    }

    const amt = typeof amount === 'number' ? amount : parseFloat(String(amount ?? ''))
    if (isNaN(amt) || amt <= 0) { skipped++; continue }

    const name = typeof rawName === 'string' ? rawName.trim() : String(rawName ?? '').trim()
    if (!name) { skipped++; continue }

    const category = detectOpexCategory(name)
    entries.push({ name, category, amount: amt, month, notes: '' })
  }

  if (entries.length === 0) {
    return { added: 0, total: 0, skipped, errors: [] }
  }

  // Fetch existing to avoid duplicates (same name + month + amount)
  const existing = await db.opexEntries.toArray()
  const existingSet = new Set(existing.map(e => `${e.name}|${e.month}|${e.amount}`))

  let added = 0
  for (const entry of entries) {
    const key = `${entry.name}|${entry.month}|${entry.amount}`
    if (!existingSet.has(key)) {
      await db.opexEntries.add(entry)
      existingSet.add(key)
      added++
    }
  }

  return { added, total: entries.length, skipped, errors: [] }
}
