export interface SalesTransaction {
  id?: number
  transactionID: string
  date: Date
  netSales: number
  staffName: string
  paymentMethod: string
  itemDescription: string
  dayOfWeek: number
  hour: number
  customerID?: string
  customerName?: string
  // Square financial detail columns (populated when CSV has them)
  grossSales?: number
  discounts?: number
  serviceCharges?: number
  partialRefunds?: number
  totalCollected?: number
  fees?: number        // negative in Square CSV (e.g. -0.27); stored as-is
  netTotal?: number    // totalCollected + fees
}

export const OPEX_CATEGORIES = [
  'Store Equipment',
  'Marketing',
  'Misc',
  'Employee Expenses',
  'Gift Cards',
  'Service Charge',
  'Other',
] as const

export type OpexCategory = typeof OPEX_CATEGORIES[number]

export interface OpexEntry {
  id?: number
  name: string
  category: OpexCategory | string
  amount: number
  month: string   // 'yyyy-MM'
  notes?: string
}

export interface CategoryOverride {
  id?: number
  productName: string
  category: string
}

export interface RestockLog {
  id?: number
  productName: string
  date: Date
  quantity: number
  notes: string
}

export interface ProductCostData {
  id?: number
  productName: string
  unitCost: number
  casePrice: number
  unitsPerCase: number
  lastUpdated: Date
}

export interface StoreEvent {
  id?: number
  name: string
  startDate: Date
  endDate: Date
  eventType: string
  notes: string
}

export interface ProductBundle {
  id?: number
  name: string
  productNames: string[]
  bundlePrice: number
  createdDate: Date
  notes: string
}

export interface CatalogueProduct {
  id?: number
  /** Full composite name: "Item Name (Variation)" — kept for backwards-compat with sales matching */
  name: string
  /** Parent item name — "Ramune Soda" (without variation) */
  itemName: string
  /** Variation label — "Strawberry", "Regular", etc. */
  variationName: string
  sku: string
  price: number | null
  category: string
  taxable: boolean
  enabled: boolean
  quantity: number | null
  importedAt: Date
  squareItemID: string
}

/** Parse any product name into { itemName, variationName } */
export function splitItemVariation(name: string): { itemName: string; variationName: string } {
  const match = name.match(/^(.+)\s+\((.+)\)$/)
  if (match) return { itemName: match[1].trim(), variationName: match[2].trim() }
  return { itemName: name.trim(), variationName: 'Regular' }
}

export interface ProductItem {
  name: string
  qty: number
}

export function parseProductItems(description: string): ProductItem[] {
  if (!description.trim()) return []
  return description.split(',').flatMap(part => {
    const trimmed = part.trim()
    const match = trimmed.match(/^(\d+)\s*x\s+(.+)$/i)
    if (match) return [{ qty: parseInt(match[1], 10), name: match[2].trim() }]
    if (trimmed) return [{ qty: 1, name: trimmed }]
    return []
  })
}

export function splitProducts(description: string): string[] {
  return parseProductItems(description).map(i => i.name)
}

export function effectiveUnitCost(cost: ProductCostData): number {
  if (cost.casePrice > 0 && cost.unitsPerCase > 0) {
    return cost.casePrice / cost.unitsPerCase
  }
  return cost.unitCost
}

export const EVENT_TYPES = [
  'Spirit Week', 'Homecoming', 'Finals', 'Back to School',
  'Holiday', 'Sports Game', 'Custom',
] as const

export function eventColor(type: string): string {
  const map: Record<string, string> = {
    'Spirit Week': 'purple',
    'Homecoming': 'orange',
    'Finals': 'red',
    'Back to School': 'blue',
    'Holiday': 'green',
    'Sports Game': 'teal',
  }
  return map[type] ?? 'gray'
}
