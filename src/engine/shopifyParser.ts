import Papa from 'papaparse'
import type { SalesTransaction } from '../types/models'
import type { CSVParseResult } from './csvParser'

function parseDateTime(value: string): Date | null {
  if (!value) return null
  const iso = new Date(value)
  if (!isNaN(iso.getTime())) return iso
  const spaced = value.replace(' ', 'T').replace(/\s([+-]\d{2}:?\d{2})$/, '$1')
  const iso2 = new Date(spaced)
  if (!isNaN(iso2.getTime())) return iso2
  return null
}

function parseCurrency(value: string): number {
  if (!value) return 0
  return parseFloat(value.replace(/[$,]/g, '').trim()) || 0
}


export function isShopifyCSV(headers: string[]): boolean {
  const lower = new Set(headers.map(h => h.toLowerCase().trim()))
  return lower.has('lineitem name') || lower.has('lineitem quantity')
}

export function parseShopifyCSV(content: string): CSVParseResult {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  })

  const rows = result.data
  if (rows.length === 0) return { transactions: [], skipped: 0, schemaError: 'Shopify CSV appears empty.' }

  const orderMap = new Map<string, Record<string, string>[]>()
  for (const row of rows) {
    const key = row['Name']?.trim() || row['Order Number']?.trim() || ''
    if (!key) continue
    if (!orderMap.has(key)) orderMap.set(key, [])
    orderMap.get(key)!.push(row)
  }

  const transactions: Omit<SalesTransaction, 'id'>[] = []
  let skipped = 0

  for (const [orderNum, orderRows] of orderMap) {
    const first = orderRows[0]

    const dateStr = first['Created at'] || first['Paid at'] || first['Processed at'] || ''
    const date = parseDateTime(dateStr)
    if (!date) { skipped++; continue }

    const netSales = parseCurrency(first['Total'] || first['Subtotal'] || '')
    if (netSales <= 0) { skipped++; continue }

    const items = orderRows
      .map(row => {
        const name = (row['Lineitem name'] || '').trim()
        const qty = parseInt(row['Lineitem quantity'] || '1', 10) || 1
        return name ? (qty > 1 ? `${qty} x ${name}` : name) : ''
      })
      .filter(Boolean)
    const itemDescription = items.join(', ')

    const payment = (first['Payment Method'] || first['Payment Gateway'] || 'Card').trim()
    const customerEmail = (first['Email'] || '').trim()
    const customerName = (first['Billing Name'] || first['Customer Name'] || '').trim()

    const tx: Omit<SalesTransaction, 'id'> = {
      transactionID: `shopify_${orderNum}`,
      date,
      netSales,
      staffName: '',
      paymentMethod: payment,
      itemDescription,
      dayOfWeek: date.getDay() + 1,
      hour: date.getHours(),
    }
    if (customerEmail) tx.customerID = customerEmail
    if (customerName) tx.customerName = customerName

    transactions.push(tx)
  }

  return { transactions, skipped, schemaError: null }
}


export function isEtsyCSV(headers: string[]): boolean {
  const lower = new Set(headers.map(h => h.toLowerCase().trim()))
  return (lower.has('sale date') || lower.has('order date')) &&
    (lower.has('order id') || lower.has('order number')) &&
    (lower.has('listing title') || lower.has('item') || lower.has('title'))
}

export function parseEtsyCSV(content: string): CSVParseResult {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  })

  const rows = result.data
  if (rows.length === 0) return { transactions: [], skipped: 0, schemaError: 'Etsy CSV appears empty.' }

  const orderMap = new Map<string, Record<string, string>[]>()
  for (const row of rows) {
    const key = (row['Order ID'] || row['Order Number'] || '').trim()
    if (!key) continue
    if (!orderMap.has(key)) orderMap.set(key, [])
    orderMap.get(key)!.push(row)
  }

  const transactions: Omit<SalesTransaction, 'id'>[] = []
  let skipped = 0

  for (const [orderID, orderRows] of orderMap) {
    const first = orderRows[0]

    const dateStr = first['Sale Date'] || first['Order Date'] || first['Date Paid'] || ''
    const date = parseDateTime(dateStr)
    if (!date) { skipped++; continue }

    const netSales = parseCurrency(
      first['Order Total'] || first['Total'] || first['Grand Total'] || ''
    )
    if (netSales <= 0) { skipped++; continue }

    const items = orderRows
      .map(row => {
        const title = (row['Listing Title'] || row['Item'] || row['Title'] || '').trim()
        const qty = parseInt(row['Quantity'] || '1', 10) || 1
        return title ? (qty > 1 ? `${qty} x ${title}` : title) : ''
      })
      .filter(Boolean)
    const itemDescription = items.join(', ')

    const payment = (first['Payment Type'] || first['Payment Method'] || 'Card').trim()
    const customerName = (first['Buyer Name'] || first['Ship Name'] || '').trim()

    const tx: Omit<SalesTransaction, 'id'> = {
      transactionID: `etsy_${orderID}`,
      date,
      netSales,
      staffName: '',
      paymentMethod: payment,
      itemDescription,
      dayOfWeek: date.getDay() + 1,
      hour: date.getHours(),
    }
    if (customerName) {
      tx.customerID = `etsy_${customerName.toLowerCase().replace(/\s+/g, '_')}`
      tx.customerName = customerName
    }

    transactions.push(tx)
  }

  return { transactions, skipped, schemaError: null }
}
