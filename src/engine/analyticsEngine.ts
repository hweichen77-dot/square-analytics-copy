import { startOfDay, startOfWeek, startOfMonth, format } from 'date-fns'
import type { SalesTransaction } from '../types/models'
import { parseProductItems } from '../types/models'

function allocateRevenue(tx: SalesTransaction): Map<string, number> {
  const result = new Map<string, number>()
  const items = parseProductItems(tx.itemDescription)
  if (items.length === 0) return result

  if (tx.lineItems && tx.lineItems.length > 0) {
    const totalGross = tx.lineItems.reduce((s, li) => s + li.unitPrice * li.qty, 0)
    if (totalGross > 0) {
      for (const li of tx.lineItems) {
        result.set(li.name, (li.unitPrice * li.qty / totalGross) * tx.netSales)
      }
      return result
    }
  }

  const totalQty = items.reduce((s, i) => s + i.qty, 0)
  const perUnit = tx.netSales / Math.max(totalQty, 1)
  for (const item of items) {
    result.set(item.name, perUnit * item.qty)
  }
  return result
}
import { classifyProduct } from './categoryClassifier'

export interface ProductStats {
  name: string
  category: string
  totalUnitsSold: number
  totalRevenue: number
  avgPrice: number
  firstSoldDate: Date
  lastSoldDate: Date
  monthlySales: Record<string, number>
  dailySales: Record<string, number>
}

export interface DailyRevenue {
  date: Date
  revenue: number
  transactionCount: number
}

export interface CategoryRevenue {
  category: string
  revenue: number
  percentage: number
}

export interface HourDaySales {
  dayOfWeek: number
  hour: number
  count: number
}

export interface StaffStats {
  name: string
  totalSales: number
  transactionCount: number
}

export interface MonthlyComparison {
  month: string
  revenue: number
  transactions: number
  avgTransaction: number
}

export interface ProductTimePoint {
  date: Date
  revenue: number
  units: number
}

export interface ProductTransactionRow {
  date: Date
  qty: number
  unitPrice: number
  total: number
  staffName: string
  paymentMethod: string
}

export type TimeGranularity = 'Daily' | 'Weekly' | 'Monthly'
export type SalesTrend = 'Growing' | 'Stable' | 'Declining'

export function productTrend(stats: ProductStats): SalesTrend {
  const sorted = Object.entries(stats.monthlySales).sort(([a], [b]) => a.localeCompare(b))
  if (sorted.length < 2) return 'Stable'
  const last = sorted.slice(-2).map(([, v]) => v)
  if (last[1] > last[0]) return 'Growing'
  if (last[1] < last[0]) return 'Declining'
  return 'Stable'
}

export function productVelocity(stats: ProductStats): number {
  const spanDays = (Date.now() - stats.firstSoldDate.getTime()) / 86_400_000
  const totalWeeks = Math.max(1, spanDays / 7)
  return (stats.totalUnitsSold / totalWeeks) / 7
}

export function isSlowMover(stats: ProductStats): boolean {
  const daysSinceLast = (Date.now() - stats.lastSoldDate.getTime()) / 86_400_000
  return daysSinceLast > 30
}

const SKIP_ITEM_PATTERN = /^(custom amount|custom amt|custom price|open amount|variable price|modifier|fee|tip|service charge|gift card|discount)$/i

function isAnalyticsItem(name: string): boolean {
  return !SKIP_ITEM_PATTERN.test(name.trim())
}

export function computeProductStats(
  transactions: SalesTransaction[],
  overrides: Record<string, string> = {},
): ProductStats[] {
  const statsMap = new Map<string, ProductStats>()

  for (const tx of transactions) {
    const items = parseProductItems(tx.itemDescription).filter(i => isAnalyticsItem(i.name))
    const revenueMap = allocateRevenue(tx)
    const monthKey = format(tx.date, 'yyyy-MM')
    const dayKey = format(tx.date, 'yyyy-MM-dd')

    for (const item of items) {
      const existing = statsMap.get(item.name)
      const itemRevenue = revenueMap.get(item.name) ?? 0
      if (existing) {
        existing.totalUnitsSold += item.qty
        existing.totalRevenue += itemRevenue
        existing.avgPrice = existing.totalRevenue / existing.totalUnitsSold
        if (tx.date < existing.firstSoldDate) existing.firstSoldDate = tx.date
        if (tx.date > existing.lastSoldDate) existing.lastSoldDate = tx.date
        existing.monthlySales[monthKey] = (existing.monthlySales[monthKey] ?? 0) + item.qty
        existing.dailySales[dayKey] = (existing.dailySales[dayKey] ?? 0) + item.qty
      } else {
        statsMap.set(item.name, {
          name: item.name,
          category: classifyProduct(item.name, overrides),
          totalUnitsSold: item.qty,
          totalRevenue: itemRevenue,
          avgPrice: item.qty > 0 ? itemRevenue / item.qty : 0,
          firstSoldDate: tx.date,
          lastSoldDate: tx.date,
          monthlySales: { [monthKey]: item.qty },
          dailySales: { [dayKey]: item.qty },
        })
      }
    }
  }

  return Array.from(statsMap.values()).sort((a, b) => b.totalRevenue - a.totalRevenue)
}

export function computeDailyRevenue(transactions: SalesTransaction[]): DailyRevenue[] {
  const map = new Map<string, { revenue: number; count: number; date: Date }>()
  for (const tx of transactions) {
    const key = format(tx.date, 'yyyy-MM-dd')
    const entry = map.get(key) ?? { revenue: 0, count: 0, date: startOfDay(tx.date) }
    entry.revenue += tx.netSales
    entry.count++
    map.set(key, entry)
  }
  return Array.from(map.values())
    .map(e => ({ date: e.date, revenue: e.revenue, transactionCount: e.count }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
}

export function computeWeeklyRevenue(transactions: SalesTransaction[]): DailyRevenue[] {
  const map = new Map<number, { revenue: number; count: number; date: Date }>()
  for (const tx of transactions) {
    const weekStart = startOfWeek(tx.date)
    const key = weekStart.getTime()
    const entry = map.get(key) ?? { revenue: 0, count: 0, date: weekStart }
    entry.revenue += tx.netSales
    entry.count++
    map.set(key, entry)
  }
  return Array.from(map.values())
    .map(e => ({ date: e.date, revenue: e.revenue, transactionCount: e.count }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
}

export function computeMonthlyRevenue(transactions: SalesTransaction[]): DailyRevenue[] {
  const map = new Map<string, { revenue: number; count: number; date: Date }>()
  for (const tx of transactions) {
    const key = format(tx.date, 'yyyy-MM')
    const entry = map.get(key) ?? { revenue: 0, count: 0, date: startOfMonth(tx.date) }
    entry.revenue += tx.netSales
    entry.count++
    map.set(key, entry)
  }
  return Array.from(map.values())
    .map(e => ({ date: e.date, revenue: e.revenue, transactionCount: e.count }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
}

export function computeRevenueByGranularity(
  transactions: SalesTransaction[],
  granularity: TimeGranularity,
): DailyRevenue[] {
  if (granularity === 'Daily') return computeDailyRevenue(transactions)
  if (granularity === 'Weekly') return computeWeeklyRevenue(transactions)
  return computeMonthlyRevenue(transactions)
}

export function computeCategoryRevenue(
  transactions: SalesTransaction[],
  overrides: Record<string, string> = {},
): CategoryRevenue[] {
  const catMap = new Map<string, number>()
  const total = transactions.reduce((s, tx) => s + tx.netSales, 0)

  for (const tx of transactions) {
    const items = parseProductItems(tx.itemDescription)
    const revenueMap = allocateRevenue(tx)
    for (const item of items) {
      const cat = classifyProduct(item.name, overrides)
      catMap.set(cat, (catMap.get(cat) ?? 0) + (revenueMap.get(item.name) ?? 0))
    }
  }

  return Array.from(catMap.entries())
    .map(([category, revenue]) => ({
      category,
      revenue,
      percentage: total > 0 ? (revenue / total) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

export function computeHeatmap(transactions: SalesTransaction[]): HourDaySales[] {
  const map = new Map<string, number>()
  for (const tx of transactions) {
    const key = `${tx.dayOfWeek}-${tx.hour}`
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  const results: HourDaySales[] = []
  for (let dow = 1; dow <= 7; dow++) {
    for (let hour = 0; hour <= 23; hour++) {
      results.push({ dayOfWeek: dow, hour, count: map.get(`${dow}-${hour}`) ?? 0 })
    }
  }
  return results
}

export function computeStaffStats(transactions: SalesTransaction[]): StaffStats[] {
  const map = new Map<string, StaffStats>()
  for (const tx of transactions) {
    const name = tx.staffName.trim() || 'Unknown'
    const existing = map.get(name) ?? { name, totalSales: 0, transactionCount: 0 }
    existing.totalSales += tx.netSales
    existing.transactionCount++
    map.set(name, existing)
  }
  return Array.from(map.values()).sort((a, b) => b.totalSales - a.totalSales)
}

export function computeMonthlyComparison(transactions: SalesTransaction[]): MonthlyComparison[] {
  const map = new Map<string, { revenue: number; count: number }>()
  for (const tx of transactions) {
    const key = format(tx.date, 'yyyy-MM')
    const entry = map.get(key) ?? { revenue: 0, count: 0 }
    entry.revenue += tx.netSales
    entry.count++
    map.set(key, entry)
  }
  return Array.from(map.entries())
    .map(([month, { revenue, count }]) => ({
      month,
      revenue,
      transactions: count,
      avgTransaction: count > 0 ? revenue / count : 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

export function computeProductTimeSeries(
  productName: string,
  transactions: SalesTransaction[],
  granularity: TimeGranularity,
): ProductTimePoint[] {
  const revenueMap = new Map<number, number>()
  const unitsMap = new Map<number, number>()
  const dateMap = new Map<number, Date>()

  for (const tx of transactions) {
    const items = parseProductItems(tx.itemDescription)
    const item = items.find(i => i.name === productName)
    if (!item) continue
    const itemRevenue = allocateRevenue(tx).get(productName) ?? 0

    let bucket: Date
    if (granularity === 'Daily') bucket = startOfDay(tx.date)
    else if (granularity === 'Weekly') bucket = startOfWeek(tx.date)
    else bucket = startOfMonth(tx.date)

    const key = bucket.getTime()
    revenueMap.set(key, (revenueMap.get(key) ?? 0) + itemRevenue)
    unitsMap.set(key, (unitsMap.get(key) ?? 0) + item.qty)
    dateMap.set(key, bucket)
  }

  return Array.from(revenueMap.keys())
    .sort((a, b) => a - b)
    .map(key => ({
      date: dateMap.get(key)!,
      revenue: revenueMap.get(key)!,
      units: unitsMap.get(key)!,
    }))
}

export function computeProductTransactions(
  productName: string,
  transactions: SalesTransaction[],
): ProductTransactionRow[] {
  const rows: ProductTransactionRow[] = []
  for (const tx of transactions) {
    const items = parseProductItems(tx.itemDescription)
    const item = items.find(i => i.name === productName)
    if (!item) continue
    const itemRevenue = allocateRevenue(tx).get(productName) ?? 0
    rows.push({
      date: tx.date,
      qty: item.qty,
      unitPrice: item.qty > 0 ? itemRevenue / item.qty : 0,
      total: itemRevenue,
      staffName: tx.staffName.trim() || 'Unknown',
      paymentMethod: tx.paymentMethod,
    })
  }
  return rows.sort((a, b) => b.date.getTime() - a.date.getTime())
}

export function computeProductDayOfWeek(
  productName: string,
  transactions: SalesTransaction[],
): { dayOfWeek: number; count: number }[] {
  const map = new Map<number, number>()
  for (const tx of transactions) {
    const items = parseProductItems(tx.itemDescription)
    if (!items.some(i => i.name === productName)) continue
    map.set(tx.dayOfWeek, (map.get(tx.dayOfWeek) ?? 0) + 1)
  }
  return Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i + 1,
    count: map.get(i + 1) ?? 0,
  }))
}
