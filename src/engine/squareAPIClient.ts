const BASE = 'https://connect.squareup.com/v2'

function isTauri(): boolean {
  return (window as any).__TAURI_INTERNALS__ !== undefined
}

/**
 * All Square API calls go through this function.
 * In Tauri: routed via Rust/reqwest to avoid any webview CORS edge cases.
 * In browser: standard fetch with correct headers.
 */
async function squareRequest(
  token: string,
  method: 'GET' | 'POST',
  url: string,
  body?: unknown,
  _attempt = 0,
): Promise<unknown> {
  try {
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core')
      const text = await invoke<string>('proxy_square_api', {
        accessToken: token,
        method,
        url,
        body: body ? JSON.stringify(body) : null,
      })
      return JSON.parse(text)
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Square-Version': '2023-10-18',
    }
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Square API error ${res.status}: ${text}`)
    }
    return res.json()
  } catch (err) {
    if (_attempt < 3 && String(err).includes('429')) {
      await new Promise(r => setTimeout(r, 1000 * 2 ** _attempt))
      return squareRequest(token, method, url, body, _attempt + 1)
    }
    throw err
  }
}

export interface SquareLocation {
  id: string
  name: string
  address?: { address_line_1?: string; locality?: string }
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
  customer_id?: string
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
  const data = await squareRequest(token, 'GET', `${BASE}/locations`) as { locations?: SquareLocation[] }
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

    const data = await squareRequest(token, 'POST', `${BASE}/orders/search`, body) as {
      orders?: SquareOrder[]
      cursor?: string
    }
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

    const data = await squareRequest(token, 'GET', url.toString()) as {
      objects?: SquareCatalogItem[]
      cursor?: string
    }
    items.push(...(data.objects ?? []))
    cursor = data.cursor
  } while (cursor)

  return items
}

export interface SquareTeamMember {
  id: string
  given_name?: string
  family_name?: string
  display_name?: string
}

export async function fetchTeamMembers(token: string): Promise<SquareTeamMember[]> {
  const members: SquareTeamMember[] = []
  let cursor: string | undefined

  do {
    const body: Record<string, unknown> = { limit: 200 }
    if (cursor) body.cursor = cursor

    const data = await squareRequest(token, 'POST', `${BASE}/team-members/search`, body) as {
      team_members?: SquareTeamMember[]
      cursor?: string
    }
    members.push(...(data.team_members ?? []))
    cursor = data.cursor
  } while (cursor)

  return members
}

export interface SquareCustomer {
  id: string
  given_name?: string
  family_name?: string
  email_address?: string
  phone_number?: string
}

export async function fetchCustomersByIds(token: string, ids: string[]): Promise<SquareCustomer[]> {
  if (ids.length === 0) return []
  const customers: SquareCustomer[] = []
  // Batch-retrieve in chunks of 100 (Square API limit)
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const data = await squareRequest(token, 'POST', `${BASE}/customers/batch-retrieve`, { customer_ids: chunk }) as {
      responses?: { customer?: SquareCustomer; errors?: unknown[] }[]
    }
    for (const r of data.responses ?? []) {
      if (r.customer) customers.push(r.customer)
    }
  }
  return customers
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

    const data = await squareRequest(token, 'POST', `${BASE}/inventory/counts/batch-retrieve`, body) as {
      counts?: SquareInventoryCount[]
      cursor?: string
    }
    counts.push(...(data.counts ?? []))
    cursor = data.cursor
  } while (cursor)

  return counts
}
