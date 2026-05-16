const BASE = 'https://connect.squareup.com/v2'

function authHeaders(token: string): HeadersInit {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Square-Version': '2023-10-18',
  }
}

export interface SquareLocation {
  id: string
  name: string
}

export interface SquareOrderLineItem {
  name: string
  quantity: string
  variation_name?: string
  base_price_money?: { amount: number; currency: string }
  gross_sales_money?: { amount: number; currency: string }
  total_discount_money?: { amount: number; currency: string }
  total_tax_money?: { amount: number; currency: string }
}

export interface SquareOrder {
  id: string
  created_at: string
  // closed_at is when the order was actually completed — prefer over created_at for date bucketing
  closed_at?: string
  tenders?: { type: string; amount_money?: { amount: number } }[]
  line_items?: SquareOrderLineItem[]
  // net_amounts reflects post-discount, post-refund, post-tip totals — use this first
  net_amounts?: { total_money: { amount: number } }
  // total_money is the order total before tips; present on older API responses
  total_money?: { amount: number }
  // return_amounts is present when refunds have been applied to this order
  return_amounts?: { total_money: { amount: number } }
  employee_id?: string
}

export interface SquareCatalogItem {
  id: string
  type: string
  item_data?: {
    name: string
    variations?: {
      id: string
      item_variation_data?: {
        name: string
        price_money?: { amount: number; currency: string }
        sku?: string
        item_id?: string
      }
    }[]
    category_id?: string
    is_taxable?: boolean
    is_archived?: boolean
  }
  // Present when type === 'CATEGORY'
  category_data?: {
    name: string
  }
}

export interface SquareInventoryCount {
  catalog_object_id: string
  quantity: string
}

export async function fetchLocations(token: string): Promise<SquareLocation[]> {
  const res = await fetch(`${BASE}/locations`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(`fetchLocations failed: ${res.status}`)
  const data = await res.json() as { locations: SquareLocation[] }
  return data.locations ?? []
}

export async function fetchOrders(
  token: string,
  locationID: string,
  startDate: Date,
  endDate: Date,
): Promise<SquareOrder[]> {
  const orders: SquareOrder[] = []
  let cursor: string | undefined

  do {
    const body: Record<string, unknown> = {
      location_ids: [locationID],
      query: {
        filter: {
          date_time_filter: {
            closed_at: {
              start_at: startDate.toISOString(),
              end_at: endDate.toISOString(),
            },
          },
          state_filter: { states: ['COMPLETED'] },
        },
        sort: { sort_field: 'CLOSED_AT', sort_order: 'ASC' },
      },
      limit: 500,
    }
    if (cursor) body.cursor = cursor

    const res = await fetch(`${BASE}/orders/search`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`fetchOrders failed: ${res.status}`)
    const data = await res.json() as { orders?: SquareOrder[]; cursor?: string }
    orders.push(...(data.orders ?? []))
    cursor = data.cursor
  } while (cursor)

  return orders
}

// Fetches both ITEM and CATEGORY objects so category names can be resolved.
export async function fetchCatalogue(token: string): Promise<SquareCatalogItem[]> {
  const items: SquareCatalogItem[] = []
  let cursor: string | undefined

  do {
    const url = new URL(`${BASE}/catalog/list`)
    url.searchParams.set('types', 'ITEM,CATEGORY')
    if (cursor) url.searchParams.set('cursor', cursor)

    const res = await fetch(url.toString(), { headers: authHeaders(token) })
    if (!res.ok) throw new Error(`fetchCatalogue failed: ${res.status}`)
    const data = await res.json() as { objects?: SquareCatalogItem[]; cursor?: string }
    items.push(...(data.objects ?? []))
    cursor = data.cursor
  } while (cursor)

  return items
}

export async function fetchInventory(token: string, locationID: string): Promise<SquareInventoryCount[]> {
  const counts: SquareInventoryCount[] = []
  let cursor: string | undefined

  do {
    const body: Record<string, unknown> = {
      location_ids: [locationID],
      limit: 1000,
    }
    if (cursor) body.cursor = cursor

    const res = await fetch(`${BASE}/inventory/counts/batch-retrieve`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`fetchInventory failed: ${res.status}`)
    const data = await res.json() as { counts?: SquareInventoryCount[]; cursor?: string }
    counts.push(...(data.counts ?? []))
    cursor = data.cursor
  } while (cursor)

  return counts
}
