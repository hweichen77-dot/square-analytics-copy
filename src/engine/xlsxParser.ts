import * as XLSX from 'xlsx'
import type { CatalogueProduct, ProductCostData } from '../types/models'
import { splitItemVariation } from '../types/models'

function colIndex(header: string[]): (keywords: string[]) => number | null {
  return (keywords) => {
    for (const kw of keywords) {
      const idx = header.findIndex(h => h.toLowerCase().trim() === kw)
      if (idx !== -1) return idx
    }
    for (const kw of keywords) {
      const idx = header.findIndex(h => h.toLowerCase().trim().includes(kw))
      if (idx !== -1) return idx
    }
    return null
  }
}

function parsePrice(value: unknown): number | null {
  if (value == null || value === '') return null
  const s = String(value).replace(/[$,]/g, '').trim()
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function parseBool(value: unknown): boolean {
  const v = String(value ?? '').toLowerCase().trim()
  return v === 'y' || v === 'yes' || v === 'true' || v === '1'
}

function parseQuantity(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = parseInt(String(value), 10)
  return isNaN(n) ? null : n
}

export interface XLSXCatalogueResult {
  products: Omit<CatalogueProduct, 'id'>[]
  costs: Omit<ProductCostData, 'id'>[]
}

export function parseXLSXCatalogue(buffer: ArrayBuffer): XLSXCatalogueResult {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) return { products: [], costs: [] }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][]
  if (rows.length < 2) return { products: [], costs: [] }

  const headerRowIdx = rows.findIndex(r => Array.isArray(r) && r.some(c => String(c).trim()))
  if (headerRowIdx === -1) return { products: [], costs: [] }

  const header = (rows[headerRowIdx] as unknown[]).map(c => String(c))
  const col = colIndex(header)

  const nameIdx      = col(['item name', 'name', 'product'])
  if (nameIdx === null) return { products: [], costs: [] }

  const variationIdx = col(['variation name', 'variant name', 'option value 1', 'size'])
  const skuIdx       = col(['sku', 'barcode'])
  const tokenIdx     = col(['token'])
  const priceIdx     = col(['price', 'selling price'])
  const categoryIdx  = col(['categories', 'category', 'reporting category'])
  const taxIdx       = col(['tax'])
  const archivedIdx  = col(['archived'])
  const enabledIdx   = archivedIdx === null ? col(['enabled', 'active', 'sellable']) : null
  const quantityIdx  = col(['current quantity', 'quantity', 'stock', 'on hand'])
  const unitCostIdx  = col(['default unit cost', 'unit cost', 'cost'])

  const products: Omit<CatalogueProduct, 'id'>[] = []
  const costs: Omit<ProductCostData, 'id'>[] = []
  const now = new Date()

  for (const row of rows.slice(headerRowIdx + 1) as unknown[][]) {
    let baseName = String(row[nameIdx] ?? '').trim()
    if (baseName.startsWith('*')) baseName = baseName.slice(1).trim()
    if (!baseName) continue

    const variation = variationIdx !== null ? String(row[variationIdx] ?? '').trim() : ''
    const name = variation ? `${baseName} (${variation})` : baseName

    const enabled: boolean = archivedIdx !== null
      ? !parseBool(row[archivedIdx])
      : enabledIdx !== null
        ? (() => { const v = String(row[enabledIdx] ?? 'true').toLowerCase().trim(); return v !== 'false' && v !== 'no' && v !== '0' && v !== 'disabled' })()
        : true

    const sku    = skuIdx    !== null ? String(row[skuIdx]    ?? '').trim() : ''
    const token  = tokenIdx  !== null ? String(row[tokenIdx]  ?? '').trim() : ''
    const price  = priceIdx  !== null ? parsePrice(row[priceIdx])  : null
    const category = categoryIdx !== null ? String(row[categoryIdx] ?? '').trim() : ''
    const taxable  = taxIdx !== null ? parseBool(row[taxIdx]) : false
    const quantity = quantityIdx !== null ? parseQuantity(row[quantityIdx]) : null
    const unitCost = unitCostIdx !== null ? parsePrice(row[unitCostIdx]) : null

    const { itemName, variationName } = splitItemVariation(name)

    products.push({
      name,
      itemName,
      variationName,
      sku: sku || token,
      price,
      category,
      taxable,
      enabled,
      quantity,
      importedAt: now,
      squareItemID: token,
    })

    if (unitCost !== null && unitCost > 0) {
      costs.push({
        productName: name,
        unitCost,
        casePrice: 0,
        unitsPerCase: 0,
        lastUpdated: now,
      })
    }
  }

  return { products, costs }
}
