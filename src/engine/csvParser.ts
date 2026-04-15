import Papa from 'papaparse'
import type { SalesTransaction } from '../types/models'

function parseDateTime(value: string): Date | null {
  if (!value) return null
  const iso = new Date(value)
  if (!isNaN(iso.getTime())) return iso
  const match = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (match) {
    const [, m, d, y, h, min, sec] = match
    return new Date(+y, +m - 1, +d, +h, +min, +(sec ?? 0))
  }
  return null
}

function parseCurrency(value: string): number {
  if (!value) return 0
  const cleaned = value.replace(/[$,]/g, '').trim()
  return parseFloat(cleaned) || 0
}

function generateFallbackID(row: Record<string, string>, index: number): string {
  return `import-${index}-${Object.values(row).join('-').slice(0, 40)}`
}

function looksLikeCashRef(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  return /[A-Za-z]/.test(v) && /[0-9]/.test(v) && !/\s/.test(v) && v.length >= 4
}

const KNOWN_CARD_BRANDS = /visa|mastercard|master\s*card|amex|american express|discover|jcb|diners|unionpay|eftpos|paywave|interac/i

/**
 * Build a case-insensitive column accessor for a row.
 * Square exports use inconsistent header casing — this normalises lookups.
 */
function makeRowAccessor(row: Record<string, string>) {
  const lower: Record<string, string> = {}
  for (const key of Object.keys(row)) {
    lower[key.toLowerCase().trim()] = row[key]
  }
  return (...keys: string[]): string => {
    for (const k of keys) {
      const v = lower[k.toLowerCase()]
      if (v !== undefined && v !== '') return v
    }
    return ''
  }
}

export interface CSVParseResult {
  transactions: Omit<SalesTransaction, 'id'>[]
  skipped: number
  schemaError: string | null
}

const REQUIRED_COLUMN_GROUPS = [
  {
    name: 'date',
    keys: ['date', 'transaction date', 'created at', 'sale date'],
    label: 'Date / Transaction Date',
  },
  {
    name: 'amount',
    keys: ['net sales', 'net amount', 'total', 'amount', 'sale amount', 'gross sales'],
    label: 'Net Sales / Total',
  },
]

function detectSchemaError(headers: string[]): string | null {
  const lower = headers.map(h => h.toLowerCase().trim())
  for (const group of REQUIRED_COLUMN_GROUPS) {
    if (!group.keys.some(k => lower.includes(k))) {
      return `Missing required column "${group.label}". Is this a Square transaction export?`
    }
  }
  return null
}

export function parseCSVContent(content: string): CSVParseResult {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  })

  const rows = result.data
  const transactions: Omit<SalesTransaction, 'id'>[] = []

  if (rows.length === 0) {
    return { transactions: [], skipped: 0, schemaError: 'File appears empty or has no data rows.' }
  }

  const schemaError = detectSchemaError(result.meta.fields ?? [])
  if (schemaError) {
    return { transactions: [], skipped: 0, schemaError }
  }

  let skipped = 0

  for (let i = 0; i < rows.length; i++) {
    const get = makeRowAccessor(rows[i])

    // Square exports Date and Time as separate columns — combine them for accurate hour tracking
    const dateStr = (() => {
      const d = get('Date', 'Transaction Date', 'Created At', 'Sale Date')
      const t = get('Time')
      if (d && t) return `${d}T${t}`
      return d
    })()

    const netSalesStr = get('Net Sales', 'Net Amount', 'Total', 'Amount', 'Sale Amount', 'Gross Sales')
    // Square column is literally "Staff Name"
    const staff       = get('Staff Name', 'Employee', 'Staff', 'Cashier', 'Team Member',
                            'Served By', 'Sales Person', 'Salesperson', 'Associate', 'Operator', 'Seller')
    const description = get('Description', 'Item Name', 'Items', 'Line Items', 'Item', 'Product')
    const txID        = get('Transaction ID', 'Payment ID', 'Order ID', 'Receipt Number', 'Receipt No')
    const customerID  = get('Customer ID', 'Customer Reference ID')
    const customerName = get('Customer Name', 'Customer')

    // ── Payment method detection ────────────────────────────────────────────
    // Square CSV has dedicated tender columns (dollar amounts):
    //   Cash, Square Gift Card, Other Tender
    // Card transactions have a Card Brand (Visa, MasterCard, etc.).
    // Checking tender amounts is more reliable than heuristics on Card Brand.
    const cashAmount     = parseCurrency(get('Cash'))
    const giftCardAmount = parseCurrency(get('Square Gift Card'))
    const cardBrandVal   = get('Card Brand', 'Card Network', 'Card Type')
    const explicitMethod = get('Payment Method', 'Tender Type', 'Payment Type', 'Payment', 'Tender', 'Method')

    let payment: string
    if (cashAmount > 0) {
      payment = 'Cash'
    } else if (giftCardAmount > 0) {
      payment = 'Square Gift Card'
    } else if (cardBrandVal) {
      if (KNOWN_CARD_BRANDS.test(cardBrandVal)) {
        payment = cardBrandVal
      } else if (/^cash$/i.test(cardBrandVal)) {
        payment = 'Cash'
      } else if (looksLikeCashRef(cardBrandVal)) {
        payment = 'Cash'
      } else {
        payment = explicitMethod || cardBrandVal
      }
    } else {
      payment = explicitMethod
    }

    const date = parseDateTime(dateStr)
    if (!date) { skipped++; continue }

    const netSales = parseCurrency(netSalesStr)

    const tx: Omit<SalesTransaction, 'id'> = {
      transactionID: txID || generateFallbackID(rows[i], i),
      date,
      netSales,
      staffName: staff.trim(),
      paymentMethod: payment.trim(),
      itemDescription: description.trim(),
      dayOfWeek: date.getDay() + 1,
      hour: date.getHours(),
    }

    // Parse Square financial detail columns when present
    const grossSalesRaw     = parseCurrency(get('Gross Sales'))
    const discountsRaw      = parseCurrency(get('Discounts'))
    const serviceChargesRaw = parseCurrency(get('Service Charges'))
    const partialRefundsRaw = parseCurrency(get('Partial Refunds'))
    const totalCollectedRaw = parseCurrency(get('Total Collected'))
    const feesRaw           = parseCurrency(get('Fees'))
    const netTotalRaw       = parseCurrency(get('Net Total'))
    if (grossSalesRaw !== 0 || get('Gross Sales'))     tx.grossSales     = grossSalesRaw
    if (discountsRaw  !== 0 || get('Discounts'))       tx.discounts      = discountsRaw
    if (serviceChargesRaw !== 0 || get('Service Charges')) tx.serviceCharges = serviceChargesRaw
    if (partialRefundsRaw !== 0 || get('Partial Refunds')) tx.partialRefunds = partialRefundsRaw
    if (totalCollectedRaw !== 0 || get('Total Collected')) tx.totalCollected = totalCollectedRaw
    if (feesRaw !== 0 || get('Fees'))                  tx.fees           = feesRaw
    if (netTotalRaw !== 0 || get('Net Total'))         tx.netTotal       = netTotalRaw

    if (customerID) tx.customerID = customerID
    if (customerName) tx.customerName = customerName.trim()
    transactions.push(tx)
  }

  return { transactions, skipped, schemaError: null }
}
