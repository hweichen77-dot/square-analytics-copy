import * as XLSX from 'xlsx'
import type { AccountantReportData } from './pdfExport'

function sanitize(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
}

export function exportQuickBooksPL(data: AccountantReportData): void {
  const rows: (string | number | null)[][] = []

  rows.push(["Walley's Analytics — Profit & Loss"])
  rows.push([data.dateRange])
  rows.push([])

  rows.push(["INCOME", null])
  rows.push(["  Gross Sales", data.totalRevenue])
  if (data.refundRevenue !== 0) {
    rows.push(["  Refunds / Adjustments", data.refundRevenue])
  }
  rows.push(["Total Income", data.netRevenue])
  rows.push([])

  if (data.totalCOGS !== null) {
    rows.push(["COST OF GOODS SOLD", null])
    rows.push(["  Cost of Goods Sold", data.totalCOGS])
    rows.push(["Total COGS", data.totalCOGS])
    rows.push([])
    rows.push(["GROSS PROFIT", data.grossProfit ?? (data.netRevenue - data.totalCOGS)])
    if (data.grossMarginPct !== null) {
      rows.push(["Gross Margin %", `${data.grossMarginPct.toFixed(1)}%`])
    }
    rows.push([])
  }

  rows.push(["NET INCOME", data.grossProfit ?? data.netRevenue])
  rows.push([])

  rows.push(["PAYMENT BREAKDOWN", "Amount", "% of Revenue", "Transactions"])
  for (const p of data.paymentBreakdown) {
    rows.push([`  ${p.method}`, p.revenue, `${p.pct.toFixed(1)}%`, p.count])
  }
  rows.push([])

  if (data.topProducts.length > 0) {
    const hasCOGS = data.topProducts.some(p => p.totalCost !== null)
    if (hasCOGS) {
      rows.push(["TOP PRODUCTS", "Units Sold", "Revenue", "COGS", "Gross Profit", "Margin %"])
    } else {
      rows.push(["TOP PRODUCTS", "Units Sold", "Revenue"])
    }
    for (const p of data.topProducts) {
      const row: (string | number | null)[] = [sanitize(p.name), p.units, p.revenue]
      if (hasCOGS) {
        row.push(
          p.totalCost ?? null,
          p.grossProfit ?? null,
          p.marginPct !== null ? `${p.marginPct.toFixed(1)}%` : null,
        )
      }
      rows.push(row)
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [
    { wch: 38 },
    { wch: 18 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 12 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Profit & Loss')

  const today = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `walleys-pl-${today}.xlsx`)
}
