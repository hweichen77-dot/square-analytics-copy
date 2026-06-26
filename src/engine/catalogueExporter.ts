
import * as XLSX from 'xlsx'
import type { CatalogueProduct } from '../types/models'

export interface ExportOptions {
  locationName?: string
  taxName?: string
  taxPercent?: number
}

function bool(v: boolean): string {
  return v ? 'Y' : 'N'
}

export function exportCatalogueToXLSX(
  products: CatalogueProduct[],
  options: ExportOptions = {},
): void {
  const location   = options.locationName ?? "Walley's"
  const taxName    = options.taxName ?? 'Sales'
  const taxPct     = options.taxPercent ?? 9
  const taxHeader  = `Tax - ${taxName} (${taxPct}%)`
  const enabledCol = `Enabled [${location}]`
  const curQtyCol  = `Current Quantity [${location}]`
  const newQtyCol  = `New Quantity [${location}]`

  const headers = [
    'Token',
    'Item Name',
    'Variation Name',
    'SKU',
    'Description',
    'GTIN',
    'Categories',
    'Reporting Category',
    taxHeader,
    enabledCol,
    curQtyCol,
    newQtyCol,
    'Default Unit Cost',
    'Archived',
  ]

  const rows: (string | number)[][] = products.map(p => {
    return [
      p.squareItemID ?? '',
      p.itemName || p.name,
      p.variationName || 'Regular',
      p.sku ?? '',
      '',
      '',
      p.category ?? '',
      p.category ?? '',
      bool(p.taxable),
      bool(p.enabled),
      p.quantity ?? '',
      p.quantity ?? '',
      '',
      bool(!p.enabled),
    ]
  })

  const worksheetData = [headers, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(worksheetData)

  ws['!cols'] = [
    { wch: 28 },
    { wch: 32 },
    { wch: 16 },
    { wch: 16 },
    { wch: 24 },
    { wch: 14 },
    { wch: 28 },
    { wch: 28 },
    { wch: 18 },
    { wch: 16 },
    { wch: 20 },
    { wch: 18 },
    { wch: 18 },
    { wch: 10 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Item Library')

  const today = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `walleys-catalogue-${today}.xlsx`)
}
