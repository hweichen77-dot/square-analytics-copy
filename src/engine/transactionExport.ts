import { format } from 'date-fns'
import type { SalesTransaction } from '../types/models'

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`
}

function totalQty(tx: SalesTransaction): number {
  if (tx.lineItems && tx.lineItems.length > 0) {
    return tx.lineItems.reduce((s, li) => s + (li.qty || 0), 0)
  }
  const matches = tx.itemDescription.match(/(\d+)\s*[xX]\s+/g)
  if (matches && matches.length > 0) {
    return matches.reduce((s, m) => s + (parseInt(m, 10) || 0), 0)
  }
  return 1
}

export function buildTransactionCSV(transactions: SalesTransaction[]): string {
  const header = ['Date', 'Staff', 'Item', 'Qty', 'Net Sales', 'Payment Type', 'Processing Fee']
  const rows = transactions.map(tx => {
    const paymentType = tx.paymentSourceType || tx.paymentMethod || ''
    const fee = tx.processingFee != null ? (tx.processingFee / 100).toFixed(2) : ''
    return [
      format(tx.date, 'yyyy-MM-dd HH:mm'),
      tx.staffName || 'Unknown',
      tx.itemDescription || '',
      totalQty(tx),
      tx.netSales.toFixed(2),
      paymentType,
      fee,
    ]
  })
  return [header, ...rows]
    .map(r => r.map(csvCell).join(','))
    .join('\n')
}

export function exportTransactionsToCSV(transactions: SalesTransaction[]): void {
  const csv = buildTransactionCSV(transactions)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `walleys-transactions-${format(new Date(), 'yyyy-MM-dd')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
