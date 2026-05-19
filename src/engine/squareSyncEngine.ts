import { subDays } from 'date-fns'
import { useAuthStore } from '../store/authStore'
import { refreshAccessToken } from './squareAuth'
import { fetchOrders, fetchCatalogue, fetchInventory, fetchTeamMembers, fetchCustomersByIds } from './squareAPIClient'
import type { SquareOrder, SquareCatalogItem } from './squareAPIClient'
import { upsertTransactions, upsertCatalogueProducts } from '../db/dbUtils'
import type { SalesTransaction, CatalogueProduct } from '../types/models'
import { parseProductItems, splitItemVariation } from '../types/models'

export interface SyncStatus {
  phase: 'idle' | 'orders' | 'catalogue' | 'inventory' | 'done' | 'error'
  message: string
  ordersAdded: number
  productsAdded: number
}

// Module-level in-flight promise shared between auto-sync and manual sync.
// Prevents concurrent syncs that would race on lastSyncDate and duplicate fetches.
let _syncInFlight: Promise<void> | null = null

export function isSyncInFlight(): boolean {
  return _syncInFlight !== null
}

function orderToTransaction(order: SquareOrder, employeeMap: Record<string, string> = {}): Omit<SalesTransaction, 'id'> | null {
  // Prefer closed_at (when the order was finalized) over created_at for accurate date bucketing.
  // Square's own dashboard uses closed_at for daily totals on COMPLETED orders.
  const rawDate = order.closed_at ?? order.created_at
  const date = new Date(rawDate)
  if (isNaN(date.getTime())) return null

  // net_amounts.total_money is the authoritative post-discount, post-tip, post-refund net total.
  // Fall back to total_money (pre-tip gross) only when net_amounts is absent (legacy orders).
  // When return_amounts is present without net_amounts, subtract the refund manually.
  let amountCents: number
  if (order.net_amounts?.total_money?.amount != null) {
    amountCents = order.net_amounts.total_money.amount
  } else if (order.total_money?.amount != null) {
    const gross = order.total_money.amount
    const returned = order.return_amounts?.total_money?.amount ?? 0
    amountCents = gross - returned
  } else {
    amountCents = 0
  }
  const netSales = amountCents / 100

  const lineItems = order.line_items ?? []
  const description = lineItems
    .map(li => {
      const qty = parseInt(li.quantity, 10) || 1
      const varName = (li.variation_name ?? '').trim()
      // Match Swift logic: only append variation if it exists and isn't "Regular"
      const isDefault = !varName || varName.toLowerCase() === 'regular'
      const fullName = isDefault ? li.name : `${li.name} (${varName})`
      return `${qty} x ${fullName}`
    })
    .join(', ')

  const payment = order.tenders?.[0]?.type ?? 'UNKNOWN'

  return {
    transactionID: order.id,
    date,
    netSales,
    staffName: order.employee_id ? (employeeMap[order.employee_id] ?? order.employee_id) : '',
    paymentMethod: payment,
    customerID: order.customer_id ?? undefined,
    itemDescription: description,
    dayOfWeek: date.getDay() + 1,
    hour: date.getHours(),
  }
}

function catalogueToProduct(
  item: SquareCatalogItem,
  categoryMap: Record<string, string>,
): Omit<CatalogueProduct, 'id'>[] {
  const data = item.item_data
  if (!data?.name) return []
  const name = data.name.trim()
  if (!name) return []

  const variations = data.variations ?? []
  // Resolve category name from the category ID → name map
  const category = data.category_id ? (categoryMap[data.category_id] ?? '') : ''
  const common = {
    category,
    taxable: data.is_taxable ?? false,
    enabled: !(data.is_archived ?? false),
    quantity: null as number | null,
    importedAt: new Date(),
  }

  if (variations.length === 0) {
    return [{ ...common, name, itemName: name, variationName: 'Regular', sku: '', price: null, squareItemID: item.id }]
  }

  // One product row per variation; squareItemID stores the variation ID for
  // direct inventory lookup (invMap is keyed by catalog_object_id = variation ID).
  return variations.map(variation => {
    const varData = variation.item_variation_data
    const priceCents = varData?.price_money?.amount
    const variantLabel = varData?.name ?? 'Regular'
    const variationName = variantLabel.toLowerCase() === 'regular' || variations.length === 1
      ? 'Regular'
      : variantLabel
    // Only suffix name if there are multiple variants and the label isn't "Regular"
    const displayName = variationName !== 'Regular' ? `${name} (${variationName})` : name
    const { itemName } = splitItemVariation(displayName)
    return {
      ...common,
      name: displayName,
      itemName,
      variationName,
      sku: varData?.sku ?? '',
      price: priceCents != null ? priceCents / 100 : null,
      squareItemID: variation.id,
    }
  })
}

export async function runSquareSync(
  onStatus: (status: SyncStatus) => void,
): Promise<void> {
  if (_syncInFlight) {
    return _syncInFlight
  }
  _syncInFlight = _runSyncImpl(onStatus).finally(() => { _syncInFlight = null })
  return _syncInFlight
}

async function _runSyncImpl(
  onStatus: (status: SyncStatus) => void,
): Promise<void> {
  // Preemptively refresh if expiry is known and within 5 minutes.
  // A value of 0 means expiry is unknown — skip to avoid unnecessary refresh calls.
  const { tokenExpiresAt } = useAuthStore.getState()
  if (tokenExpiresAt != null && tokenExpiresAt > 0 && tokenExpiresAt - Date.now() < 5 * 60 * 1000) {
    await refreshAccessToken()
  }

  const { accessToken, locationID, daysBack, lastSyncDate } = useAuthStore.getState()

  // Resolve employee IDs → display names
  const employeeMap: Record<string, string> = {}
  try {
    const members = await fetchTeamMembers(accessToken)
    for (const m of members) {
      const name = m.display_name ?? [m.given_name, m.family_name].filter(Boolean).join(' ')
      if (name) employeeMap[m.id] = name
    }
  } catch {
    // Team Members API is optional — sync continues without names if it fails
  }

  onStatus({ phase: 'orders', message: 'Fetching orders...', ordersAdded: 0, productsAdded: 0 })

  const endDate = new Date()
  // Incremental: resume from last sync (minus 5 min overlap). Always honour daysBack —
  // if the user increases it, or this is the first sync, start from the daysBack window.
  const daysBackStart = subDays(endDate, daysBack)
  const lastSyncMs = lastSyncDate ? new Date(new Date(lastSyncDate).getTime() - 5 * 60 * 1000) : null
  const startDate = lastSyncMs && lastSyncMs > daysBackStart ? lastSyncMs : daysBackStart
  const orders = await fetchOrders(accessToken, locationID, startDate, endDate)
  const txRows = orders.flatMap(o => {
    const tx = orderToTransaction(o, employeeMap)
    return tx ? [tx] : []
  })

  // Resolve customer IDs → display names (batch-retrieve, best-effort)
  const customerIDsToFetch = [...new Set(txRows.map(t => t.customerID).filter((id): id is string => !!id))]
  const customerMap: Record<string, string> = {}
  try {
    const customers = await fetchCustomersByIds(accessToken, customerIDsToFetch)
    for (const c of customers) {
      const name = [c.given_name, c.family_name].filter(Boolean).join(' ')
      if (name) customerMap[c.id] = name
    }
  } catch {
    // Non-fatal — sync continues without customer names
  }
  for (const tx of txRows) {
    if (tx.customerID && customerMap[tx.customerID]) {
      tx.customerName = customerMap[tx.customerID]
    }
  }

  const ordersAdded = await upsertTransactions(txRows)

  onStatus({ phase: 'catalogue', message: 'Fetching catalogue...', ordersAdded, productsAdded: 0 })
  const catObjects = await fetchCatalogue(accessToken)

  // Build category ID → name map from CATEGORY objects returned alongside ITEMs
  const categoryMap: Record<string, string> = {}
  for (const obj of catObjects) {
    if (obj.type === 'CATEGORY' && obj.category_data?.name) {
      categoryMap[obj.id] = obj.category_data.name
    }
  }

  const productItems = catObjects.filter(obj => obj.type === 'ITEM')
  const products = productItems.flatMap(item => catalogueToProduct(item, categoryMap))
  await upsertCatalogueProducts(products)

  onStatus({ phase: 'inventory', message: 'Fetching inventory...', ordersAdded, productsAdded: products.length })
  const invCounts = await fetchInventory(accessToken, locationID)
  const invMap = new Map(invCounts.map(c => [c.catalog_object_id, parseInt(c.quantity, 10)]))

  // product.squareItemID now holds the Square variation ID, which is the same
  // key that invMap uses (catalog_object_id from the inventory counts endpoint).
  for (const product of products) {
    const qty = invMap.get(product.squareItemID)
    if (qty != null) product.quantity = qty
  }
  await upsertCatalogueProducts(products)

  useAuthStore.getState().setCredentials({
    lastSyncDate: new Date().toISOString(),
    lastSyncCount: ordersAdded,
  })

  onStatus({ phase: 'done', message: 'Sync complete', ordersAdded, productsAdded: products.length })
}

export { parseProductItems }
