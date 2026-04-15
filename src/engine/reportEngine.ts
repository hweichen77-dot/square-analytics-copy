import { format, parseISO, startOfWeek, addDays } from 'date-fns'
import type { SalesTransaction, OpexEntry, ProductCostData } from '../types/models'
import { effectiveUnitCost } from '../types/models'
import {
  computeProductStats,
  computeRevenueByGranularity,
  computeMonthlyComparison,
} from './analyticsEngine'
import type { ProductStats, DailyRevenue, MonthlyComparison, TimeGranularity } from './analyticsEngine'
import { DAY_NAMES } from '../utils/format'

export type ReportType =
  | 'revenue'
  | 'top-products'
  | 'customer-behavior'
  | 'transaction-log'
  | 'seasonal'
  | 'monthly-detail'
  | 'cash'

export const REPORT_META: Record<ReportType, { label: string; icon: string; description: string }> = {
  revenue: {
    label: 'Revenue Summary',
    icon: '💵',
    description: 'Total revenue, transactions, and averages broken down by day, week, or month.',
  },
  'top-products': {
    label: 'Top Products',
    icon: '🏆',
    description: 'Ranked products by revenue and units sold with category breakdown.',
  },
  'customer-behavior': {
    label: 'Customer Behavior',
    icon: '🧠',
    description: 'Payment methods, peak trading hours, and busiest days of the week.',
  },
  'transaction-log': {
    label: 'Transaction Log',
    icon: '📋',
    description: 'Full filterable transaction history with search by item, amount, and payment type.',
  },
  seasonal: {
    label: 'Seasonal Performance',
    icon: '📅',
    description: 'Month-by-month revenue comparison to spot seasonal trends.',
  },
  'monthly-detail': {
    label: 'Monthly Report',
    icon: '🗓',
    description: 'Deep per-month breakdown: revenue, top product, MoM growth, and daily detail.',
  },
  cash: {
    label: 'Cash Report',
    icon: '💴',
    description: 'Cash-only transactions: revenue, %, peak hours, day-of-week, and full cash log.',
  },
}

// ─── Revenue ──────────────────────────────────────────────────────────────────

export interface RevenueReport {
  type: 'revenue'
  totalRevenue: number
  transactions: number
  avgTransaction: number
  topPeriod: { label: string; revenue: number } | null
  timeSeries: DailyRevenue[]
  granularity: TimeGranularity
}

export function buildRevenueReport(
  transactions: SalesTransaction[],
  granularity: TimeGranularity,
): RevenueReport {
  const totalRevenue = transactions.reduce((s, t) => s + t.netSales, 0)
  const count = transactions.length
  const timeSeries = computeRevenueByGranularity(transactions, granularity)
  const topEntry = timeSeries.length > 0
    ? timeSeries.reduce((best, d) => (d.revenue > best.revenue ? d : best))
    : null
  const fmt = granularity === 'Monthly' ? 'MMMM yyyy' : 'MMM d, yyyy'

  return {
    type: 'revenue',
    totalRevenue,
    transactions: count,
    avgTransaction: count > 0 ? totalRevenue / count : 0,
    topPeriod: topEntry ? { label: format(topEntry.date, fmt), revenue: topEntry.revenue } : null,
    timeSeries,
    granularity,
  }
}

// ─── Top Products ─────────────────────────────────────────────────────────────

export interface TopProductsReport {
  type: 'top-products'
  byRevenue: ProductStats[]
  byUnits: ProductStats[]
  totalRevenue: number
  totalUnits: number
}

export function buildTopProductsReport(
  transactions: SalesTransaction[],
  overrides: Record<string, string>,
  topN = 20,
): TopProductsReport {
  const stats = computeProductStats(transactions, overrides)
  const totalRevenue = stats.reduce((s, p) => s + p.totalRevenue, 0)
  const totalUnits = stats.reduce((s, p) => s + p.totalUnitsSold, 0)
  return {
    type: 'top-products',
    byRevenue: stats.slice(0, topN),
    byUnits: [...stats].sort((a, b) => b.totalUnitsSold - a.totalUnitsSold).slice(0, topN),
    totalRevenue,
    totalUnits,
  }
}

// ─── Customer Behavior ────────────────────────────────────────────────────────

export interface PaymentMethodStat {
  method: string
  count: number
  revenue: number
  pct: number
}

export interface CustomerBehaviorReport {
  type: 'customer-behavior'
  totalTransactions: number
  totalRevenue: number
  avgTransactionValue: number
  paymentMethods: PaymentMethodStat[]
  peakHours: { hour: number; label: string; count: number }[]
  peakDays: { dayOfWeek: number; label: string; count: number }[]
}

export function buildCustomerBehaviorReport(transactions: SalesTransaction[]): CustomerBehaviorReport {
  const payMap = new Map<string, { count: number; revenue: number }>()
  const hourMap = new Map<number, number>()
  const dayMap = new Map<number, number>()

  for (const tx of transactions) {
    const method = tx.paymentMethod?.trim() || 'Unknown'
    const p = payMap.get(method) ?? { count: 0, revenue: 0 }
    p.count++
    p.revenue += tx.netSales
    payMap.set(method, p)
    hourMap.set(tx.hour, (hourMap.get(tx.hour) ?? 0) + 1)
    dayMap.set(tx.dayOfWeek, (dayMap.get(tx.dayOfWeek) ?? 0) + 1)
  }

  const total = transactions.length
  const totalRevenue = transactions.reduce((s, t) => s + t.netSales, 0)

  const paymentMethods: PaymentMethodStat[] = Array.from(payMap.entries())
    .map(([method, { count, revenue }]) => ({
      method,
      count,
      revenue,
      pct: total > 0 ? (count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)

  const peakHours = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`,
    count: hourMap.get(h) ?? 0,
  }))

  // dayOfWeek: 1=Sun … 7=Sat
  const peakDays = Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i + 1,
    label: DAY_NAMES[i],
    count: dayMap.get(i + 1) ?? 0,
  }))

  return {
    type: 'customer-behavior',
    totalTransactions: total,
    totalRevenue,
    avgTransactionValue: total > 0 ? totalRevenue / total : 0,
    paymentMethods,
    peakHours,
    peakDays,
  }
}

// ─── Transaction Log ──────────────────────────────────────────────────────────

export interface TransactionLogReport {
  type: 'transaction-log'
  transactions: SalesTransaction[]
  totalRevenue: number
  count: number
}

export function buildTransactionLogReport(transactions: SalesTransaction[]): TransactionLogReport {
  const sorted = [...transactions].sort((a, b) => b.date.getTime() - a.date.getTime())
  return {
    type: 'transaction-log',
    transactions: sorted,
    totalRevenue: sorted.reduce((s, t) => s + t.netSales, 0),
    count: sorted.length,
  }
}

// ─── Seasonal ─────────────────────────────────────────────────────────────────

export type SeasonName = 'Spring' | 'Summer' | 'Fall' | 'Winter'

export interface SeasonStats {
  name: SeasonName
  icon: string
  months: string[]           // e.g. ['March','April','May']
  revenue: number
  transactions: number
  avgTransaction: number
  revenueShare: number       // % of total revenue
  topProducts: ProductStats[] // top 5 products for this season
  monthBreakdown: { label: string; revenue: number; transactions: number }[]
}

export interface SeasonalReport {
  type: 'seasonal'
  monthly: MonthlyComparison[]
  bestMonth: MonthlyComparison | null
  worstMonth: MonthlyComparison | null
  totalRevenue: number
  seasons: SeasonStats[]
  bestSeason: SeasonName | null
  worstSeason: SeasonName | null
}

const SEASON_CONFIG: Record<SeasonName, { icon: string; months: number[]; labels: string[] }> = {
  Spring: { icon: '🌸', months: [3, 4, 5],  labels: ['March', 'April', 'May'] },
  Summer: { icon: '☀️', months: [6, 7, 8],  labels: ['June', 'July', 'August'] },
  Fall:   { icon: '🍂', months: [9, 10, 11], labels: ['September', 'October', 'November'] },
  Winter: { icon: '❄️', months: [12, 1, 2], labels: ['December', 'January', 'February'] },
}

function seasonOfMonth(month: number): SeasonName {
  if (month >= 3  && month <= 5)  return 'Spring'
  if (month >= 6  && month <= 8)  return 'Summer'
  if (month >= 9  && month <= 11) return 'Fall'
  return 'Winter'
}

export function buildSeasonalReport(
  transactions: SalesTransaction[],
  overrides: Record<string, string> = {},
): SeasonalReport {
  const monthly = computeMonthlyComparison(transactions)
  const totalRevenue = monthly.reduce((s, m) => s + m.revenue, 0)

  const bestMonth = monthly.length > 0
    ? monthly.reduce((best, m) => (m.revenue > best.revenue ? m : best))
    : null
  const worstMonth = monthly.length > 0
    ? monthly.reduce((worst, m) => (m.revenue < worst.revenue ? m : worst))
    : null

  // Bucket transactions by season
  const seasonTxMap = new Map<SeasonName, SalesTransaction[]>()
  for (const s of Object.keys(SEASON_CONFIG) as SeasonName[]) seasonTxMap.set(s, [])
  for (const tx of transactions) {
    const m = tx.date.getMonth() + 1
    seasonTxMap.get(seasonOfMonth(m))!.push(tx)
  }

  const seasons: SeasonStats[] = (Object.keys(SEASON_CONFIG) as SeasonName[]).map(name => {
    const cfg = SEASON_CONFIG[name]
    const txs = seasonTxMap.get(name)!
    const revenue = txs.reduce((s, t) => s + t.netSales, 0)
    const count = txs.length
    const topProducts = computeProductStats(txs, overrides).slice(0, 5)

    // Month breakdown within this season
    const mbMap = new Map<string, { revenue: number; transactions: number }>()
    for (const tx of txs) {
      const key = format(tx.date, 'yyyy-MM')
      const e = mbMap.get(key) ?? { revenue: 0, transactions: 0 }
      e.revenue += tx.netSales; e.transactions++
      mbMap.set(key, e)
    }
    const monthBreakdown = cfg.months.map((mn, i) => {
      // sum across all years for this month number
      let rev = 0, trx = 0
      for (const [key, val] of mbMap.entries()) {
        if (parseInt(key.split('-')[1], 10) === mn) { rev += val.revenue; trx += val.transactions }
      }
      return { label: cfg.labels[i], revenue: rev, transactions: trx }
    })

    return {
      name,
      icon: cfg.icon,
      months: cfg.labels,
      revenue,
      transactions: count,
      avgTransaction: count > 0 ? revenue / count : 0,
      revenueShare: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
      topProducts,
      monthBreakdown,
    }
  })

  const populated = seasons.filter(s => s.revenue > 0)
  const bestSeason  = populated.length > 0 ? populated.reduce((b, s) => s.revenue > b.revenue ? s : b).name : null
  const worstSeason = populated.length > 0 ? populated.reduce((w, s) => s.revenue < w.revenue ? s : w).name : null

  return { type: 'seasonal', monthly, bestMonth, worstMonth, totalRevenue, seasons, bestSeason, worstSeason }
}

// ─── Monthly Detail ───────────────────────────────────────────────────────────

export interface MonthlyDetailRow {
  month: string           // 'yyyy-MM'
  label: string           // 'January 2025'
  // Income section (from Square CSV columns)
  grossSales: number
  returns: number         // absolute value of refunds
  discounts: number       // discounts & comps (absolute value)
  netSales: number        // grossSales - returns - discounts
  // Payments section
  totalCollected: number
  fees: number            // Square processing fees (positive/absolute)
  netRevenue: number      // totalCollected - fees
  // COGS & Margin
  cogs: number | null
  grossMargin: number | null
  grossMarginPct: number | null
  // OPEX
  opexByCategory: Record<string, number>  // manually entered, keyed by category
  opexSquareExpenses: number              // = fees (auto from CSV)
  opexTotal: number                       // sum of all opex incl. square expenses
  // Net
  netProfit: number | null
  netProfitPct: number | null             // netProfit / netRevenue
  // Whether the CSV had detailed financial columns (grossSales, fees, etc.)
  hasDetailedFinancials: boolean
  // Metadata / legacy
  revenue: number         // = netSales (for backward compat with chart/table)
  transactions: number
  avgTransaction: number
  topProduct: string | null
  topProductRevenue: number
  momGrowth: number | null
  topProducts: ProductStats[]
}

export interface MonthlyDetailReport {
  type: 'monthly-detail'
  rows: MonthlyDetailRow[]
  totalRevenue: number
  totalTransactions: number
  avgMonthlyRevenue: number
  bestMonth: MonthlyDetailRow | null
  worstMonth: MonthlyDetailRow | null
}

export function buildMonthlyDetailReport(
  transactions: SalesTransaction[],
  overrides: Record<string, string>,
  opexEntries: OpexEntry[] = [],
  costData: ProductCostData[] = [],
): MonthlyDetailReport {
  const monthMap = new Map<string, SalesTransaction[]>()
  for (const tx of transactions) {
    const key = format(tx.date, 'yyyy-MM')
    const arr = monthMap.get(key) ?? []
    arr.push(tx)
    monthMap.set(key, arr)
  }

  // Build cost lookup: productName → unit cost
  const costMap = new Map<string, number>()
  for (const c of costData) {
    const cost = effectiveUnitCost(c)
    if (cost > 0) costMap.set(c.productName, cost)
  }
  const hasCostData = costMap.size > 0

  // Group opex entries by month
  const opexByMonth = new Map<string, OpexEntry[]>()
  for (const entry of opexEntries) {
    const arr = opexByMonth.get(entry.month) ?? []
    arr.push(entry)
    opexByMonth.set(entry.month, arr)
  }

  const sorted = Array.from(monthMap.entries()).sort(([a], [b]) => a.localeCompare(b))

  const rows: MonthlyDetailRow[] = sorted.map(([month, txs], idx) => {
    // Check if this batch of transactions has detailed Square financials
    const hasDetailedFinancials = txs.some(t => t.grossSales !== undefined)

    let grossSales: number
    let returns: number
    let discounts: number
    let netSales: number
    let totalCollected: number
    let fees: number
    let netRevenue: number

    if (hasDetailedFinancials) {
      grossSales     = txs.reduce((s, t) => s + (t.grossSales ?? 0), 0)
      returns        = Math.abs(txs.reduce((s, t) => s + (t.partialRefunds ?? 0), 0))
      discounts      = Math.abs(txs.reduce((s, t) => s + (t.discounts ?? 0), 0))
      netSales       = txs.reduce((s, t) => s + t.netSales, 0)
      totalCollected = txs.reduce((s, t) => s + (t.totalCollected ?? t.netSales), 0)
      fees           = Math.abs(txs.reduce((s, t) => s + (t.fees ?? 0), 0))
      netRevenue     = totalCollected - fees
    } else {
      // Fallback: only netSales available (older imports)
      const positiveSales = txs.filter(t => t.netSales >= 0).reduce((s, t) => s + t.netSales, 0)
      const refundTotal   = Math.abs(txs.filter(t => t.netSales < 0).reduce((s, t) => s + t.netSales, 0))
      grossSales     = positiveSales + refundTotal
      returns        = refundTotal
      discounts      = 0
      netSales       = txs.reduce((s, t) => s + t.netSales, 0)
      totalCollected = netSales
      fees           = 0
      netRevenue     = netSales
    }

    // COGS: sum unit cost × units sold for each product
    let cogs: number | null = null
    if (hasCostData) {
      const stats = computeProductStats(txs, overrides)
      cogs = 0
      for (const p of stats) {
        const unitCost = costMap.get(p.name)
        if (unitCost !== undefined) cogs! += unitCost * p.totalUnitsSold
      }
    }

    const grossMargin    = cogs !== null ? netRevenue - cogs : null
    const grossMarginPct = grossMargin !== null && netRevenue > 0
      ? (grossMargin / netRevenue) * 100 : null

    // OPEX: group manual entries by category for this month
    const monthOpex = opexByMonth.get(month) ?? []
    const opexByCategory: Record<string, number> = {}
    for (const entry of monthOpex) {
      opexByCategory[entry.category] = (opexByCategory[entry.category] ?? 0) + entry.amount
    }
    const opexManualTotal = Object.values(opexByCategory).reduce((s, v) => s + v, 0)
    const opexTotal = opexManualTotal + fees  // Square fees count as OPEX too

    // Net profit only computable when we have COGS (full picture)
    const netProfit    = grossMargin !== null ? grossMargin - opexManualTotal : null
    const netProfitPct = netProfit !== null && netRevenue > 0
      ? (netProfit / netRevenue) * 100 : null

    // Product stats (compute once if we haven't already for COGS)
    const productStats = computeProductStats(txs, overrides)
    const top = productStats[0] ?? null

    let momGrowth: number | null = null
    if (idx > 0) {
      const prevNetSales = sorted[idx - 1][1].reduce((s, t) => s + t.netSales, 0)
      if (prevNetSales > 0) momGrowth = ((netSales - prevNetSales) / prevNetSales) * 100
    }

    return {
      month,
      label: format(parseISO(month + '-01'), 'MMMM yyyy'),
      grossSales,
      returns,
      discounts,
      netSales,
      totalCollected,
      fees,
      netRevenue,
      cogs,
      grossMargin,
      grossMarginPct,
      opexByCategory,
      opexSquareExpenses: fees,
      opexTotal,
      netProfit,
      netProfitPct,
      hasDetailedFinancials,
      revenue: netSales,
      transactions: txs.length,
      avgTransaction: txs.length > 0 ? netSales / txs.length : 0,
      topProduct: top?.name ?? null,
      topProductRevenue: top?.totalRevenue ?? 0,
      momGrowth,
      topProducts: productStats.slice(0, 10),
    }
  })

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
  const totalTransactions = rows.reduce((s, r) => s + r.transactions, 0)
  const bestMonth  = rows.length > 0 ? rows.reduce((b, r) => r.revenue > b.revenue ? r : b) : null
  const worstMonth = rows.length > 0 ? rows.reduce((w, r) => r.revenue < w.revenue ? r : w) : null

  return {
    type: 'monthly-detail',
    rows,
    totalRevenue,
    totalTransactions,
    avgMonthlyRevenue: rows.length > 0 ? totalRevenue / rows.length : 0,
    bestMonth,
    worstMonth,
  }
}

// ─── Cash Report ──────────────────────────────────────────────────────────────

function isCash(method: string): boolean {
  const m = method.trim()
  if (!m) return false
  if (m.toLowerCase().includes('cash')) return true
  // Square exports put a random alphanumeric reference (e.g. "A3KX9P2QM") in the
  // card-brand column for cash transactions instead of a card name.
  // Detect this: has both letters and digits, no spaces, no known card brand words.
  const hasLetters = /[A-Za-z]/.test(m)
  const hasDigits  = /[0-9]/.test(m)
  const noSpaces   = !/\s/.test(m)
  const isKnownCard = /visa|mastercard|amex|american.express|discover|jcb|diners|unionpay|eftpos|interac/i.test(m)
  return hasLetters && hasDigits && noSpaces && m.length >= 4 && !isKnownCard
}

export interface CashDayRow {
  date: string
  cashRevenue: number
  cashCount: number
  totalRevenue: number
}

export interface CashWeekRow {
  weekStart: string        // 'yyyy-MM-dd' (Sunday)
  weekLabel: string        // 'Apr 7 – Apr 13, 2025'
  cashRevenue: number
  cashCount: number
  totalRevenue: number
}

export interface CashReport {
  type: 'cash'
  cashRevenue: number
  cashTransactions: number
  totalRevenue: number
  totalTransactions: number
  cashPct: number          // % of transaction count
  cashRevenuePct: number   // % of total revenue
  avgCashTransaction: number
  byDay: CashDayRow[]
  byWeek: CashWeekRow[]
  byDayOfWeek: { dayOfWeek: number; label: string; cashCount: number; cashRevenue: number }[]
  byHour: { hour: number; label: string; cashCount: number; cashRevenue: number }[]
  paymentBreakdown: { method: string; revenue: number; count: number; isCash: boolean }[]
  transactions: SalesTransaction[]
}

export function buildCashReport(transactions: SalesTransaction[]): CashReport {
  const cashTxs = transactions.filter(tx => isCash(tx.paymentMethod?.trim() || ''))

  // Daily
  const dayMap = new Map<string, CashDayRow>()
  for (const tx of transactions) {
    const key = format(tx.date, 'yyyy-MM-dd')
    const row = dayMap.get(key) ?? { date: key, cashRevenue: 0, cashCount: 0, totalRevenue: 0 }
    row.totalRevenue += tx.netSales
    if (isCash(tx.paymentMethod?.trim() || '')) { row.cashRevenue += tx.netSales; row.cashCount++ }
    dayMap.set(key, row)
  }
  const byDay = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date))

  // Weekly
  const weekMap = new Map<string, { weekStart: Date; cashRevenue: number; cashCount: number; totalRevenue: number }>()
  for (const tx of transactions) {
    const ws = startOfWeek(tx.date, { weekStartsOn: 0 })
    const key = format(ws, 'yyyy-MM-dd')
    const row = weekMap.get(key) ?? { weekStart: ws, cashRevenue: 0, cashCount: 0, totalRevenue: 0 }
    row.totalRevenue += tx.netSales
    if (isCash(tx.paymentMethod?.trim() || '')) { row.cashRevenue += tx.netSales; row.cashCount++ }
    weekMap.set(key, row)
  }
  const byWeek: CashWeekRow[] = Array.from(weekMap.values())
    .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
    .map(w => ({
      weekStart: format(w.weekStart, 'yyyy-MM-dd'),
      weekLabel: `${format(w.weekStart, 'MMM d')} – ${format(addDays(w.weekStart, 6), 'MMM d, yyyy')}`,
      cashRevenue: w.cashRevenue,
      cashCount: w.cashCount,
      totalRevenue: w.totalRevenue,
    }))

  // Day of week (1=Sun … 7=Sat)
  const dowMap = new Map<number, { cashCount: number; cashRevenue: number }>()
  for (const tx of cashTxs) {
    const e = dowMap.get(tx.dayOfWeek) ?? { cashCount: 0, cashRevenue: 0 }
    e.cashCount++; e.cashRevenue += tx.netSales
    dowMap.set(tx.dayOfWeek, e)
  }
  const byDayOfWeek = Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i + 1,
    label: DAY_NAMES[i],
    ...(dowMap.get(i + 1) ?? { cashCount: 0, cashRevenue: 0 }),
  }))

  // Hour
  const hourMap = new Map<number, { cashCount: number; cashRevenue: number }>()
  for (const tx of cashTxs) {
    const e = hourMap.get(tx.hour) ?? { cashCount: 0, cashRevenue: 0 }
    e.cashCount++; e.cashRevenue += tx.netSales
    hourMap.set(tx.hour, e)
  }
  const byHour = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`,
    ...(hourMap.get(h) ?? { cashCount: 0, cashRevenue: 0 }),
  }))

  // Payment breakdown
  const payMap = new Map<string, { revenue: number; count: number }>()
  for (const tx of transactions) {
    const method = tx.paymentMethod?.trim() || 'Unknown'
    const e = payMap.get(method) ?? { revenue: 0, count: 0 }
    e.revenue += tx.netSales; e.count++
    payMap.set(method, e)
  }
  const paymentBreakdown = Array.from(payMap.entries())
    .map(([method, { revenue, count }]) => ({ method, revenue, count, isCash: isCash(method) }))
    .sort((a, b) => b.revenue - a.revenue)

  const cashRevenue = cashTxs.reduce((s, t) => s + t.netSales, 0)
  const totalRevenue = transactions.reduce((s, t) => s + t.netSales, 0)

  return {
    type: 'cash',
    cashRevenue,
    cashTransactions: cashTxs.length,
    totalRevenue,
    totalTransactions: transactions.length,
    cashPct: transactions.length > 0 ? (cashTxs.length / transactions.length) * 100 : 0,
    cashRevenuePct: totalRevenue > 0 ? (cashRevenue / totalRevenue) * 100 : 0,
    avgCashTransaction: cashTxs.length > 0 ? cashRevenue / cashTxs.length : 0,
    byDay,
    byWeek,
    byDayOfWeek,
    byHour,
    paymentBreakdown,
    transactions: [...cashTxs].sort((a, b) => b.date.getTime() - a.date.getTime()),
  }
}

// ─── Union ────────────────────────────────────────────────────────────────────

export type AnyReport =
  | RevenueReport
  | TopProductsReport
  | CustomerBehaviorReport
  | TransactionLogReport
  | SeasonalReport
  | MonthlyDetailReport
  | CashReport
