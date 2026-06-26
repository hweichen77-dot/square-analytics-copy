import { startOfWeek, addDays, format, startOfDay, isAfter } from 'date-fns'
import type { SalesTransaction } from '../types/models'

export interface ForecastDay {
  date: Date
  dayLabel: string
  dayOfWeek: number
  projectedRevenue: number
  actualRevenue: number | null
}

export interface WeekForecast {
  weekStart: Date
  days: ForecastDay[]
  projectedTotal: number
  actualTotal: number
}

export interface ForecastResult {
  thisWeek: WeekForecast
  nextWeek: WeekForecast
  trendFactor: number
  trendLabel: string
  hasEnoughData: boolean
  weeksOfHistory: number
}

export interface AnomalyDay {
  date: Date
  dayLabel: string
  dayOfWeek: number
  actualRevenue: number
  expectedRevenue: number
  percentDiff: number
  direction: 'above' | 'below'
  severity: 'mild' | 'strong'
}


function computeDailyTotals(txs: SalesTransaction[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const tx of txs) {
    const key = format(startOfDay(tx.date), 'yyyy-MM-dd')
    map.set(key, (map.get(key) ?? 0) + tx.netSales)
  }
  return map
}

function emptyWeek(ws: Date): WeekForecast {
  return {
    weekStart: ws,
    days: Array.from({ length: 7 }, (_, d) => ({
      date: addDays(ws, d),
      dayLabel: format(addDays(ws, d), 'EEE d'),
      dayOfWeek: d + 1,
      projectedRevenue: 0,
      actualRevenue: null,
    })),
    projectedTotal: 0,
    actualTotal: 0,
  }
}


export function computeForecast(transactions: SalesTransaction[]): ForecastResult {
  const today = startOfDay(new Date())
  const thisWeekStart = startOfWeek(today, { weekStartsOn: 0 })
  const nextWeekStart = addDays(thisWeekStart, 7)

  if (transactions.length === 0) {
    return {
      thisWeek: emptyWeek(thisWeekStart),
      nextWeek: emptyWeek(nextWeekStart),
      trendFactor: 1,
      trendLabel: 'No data',
      hasEnoughData: false,
      weeksOfHistory: 0,
    }
  }

  const dailyTotals = computeDailyTotals(transactions)

  const allDateKeys = Array.from(dailyTotals.keys()).sort()
  if (allDateKeys.length === 0) {
    return {
      thisWeek: emptyWeek(thisWeekStart),
      nextWeek: emptyWeek(nextWeekStart),
      trendFactor: 1,
      trendLabel: 'No data',
      hasEnoughData: false,
      weeksOfHistory: 0,
    }
  }

  const earliestDate = new Date(allDateKeys[0])
  const historicalWeeks: { weekStart: Date; revenue: number }[] = []

  let ws = startOfWeek(earliestDate, { weekStartsOn: 0 })
  while (ws < thisWeekStart) {
    let weekRevenue = 0
    for (let d = 0; d < 7; d++) {
      const key = format(addDays(ws, d), 'yyyy-MM-dd')
      weekRevenue += dailyTotals.get(key) ?? 0
    }
    historicalWeeks.push({ weekStart: ws, revenue: weekRevenue })
    ws = addDays(ws, 7)
  }

  const weeksOfHistory = historicalWeeks.length
  if (weeksOfHistory < 2) {
    return {
      thisWeek: emptyWeek(thisWeekStart),
      nextWeek: emptyWeek(nextWeekStart),
      trendFactor: 1,
      trendLabel: 'Not enough data',
      hasEnoughData: false,
      weeksOfHistory,
    }
  }

  const baselineWeeks = historicalWeeks.slice(-Math.min(12, weeksOfHistory))
  const dowSums = new Array(7).fill(0)
  const dowCounts = new Array(7).fill(0)

  for (const hw of baselineWeeks) {
    for (let d = 0; d < 7; d++) {
      const key = format(addDays(hw.weekStart, d), 'yyyy-MM-dd')
      const rev = dailyTotals.get(key) ?? 0
      dowSums[d] += rev
      dowCounts[d]++
    }
  }

  const dowBaseline = dowSums.map((sum, i) => (dowCounts[i] > 0 ? sum / dowCounts[i] : 0))

  let trendFactor = 1.0
  if (weeksOfHistory >= 8) {
    const last4Avg = historicalWeeks.slice(-4).reduce((s, w) => s + w.revenue, 0) / 4
    const prev4 = historicalWeeks.slice(-8, -4)
    const prev4Avg = prev4.reduce((s, w) => s + w.revenue, 0) / 4
    if (prev4Avg > 0) {
      trendFactor = Math.max(0.5, Math.min(2.0, last4Avg / prev4Avg))
    }
  }

  const trendPct = (trendFactor - 1) * 100
  const trendLabel =
    trendPct > 1.5 ? `+${trendPct.toFixed(1)}% growth trend` :
    trendPct < -1.5 ? `${trendPct.toFixed(1)}% decline trend` :
    'Stable trend'

  const thisWeekDays: ForecastDay[] = []
  let thisActual = 0
  let thisProjected = 0

  for (let d = 0; d < 7; d++) {
    const date = addDays(thisWeekStart, d)
    const key = format(date, 'yyyy-MM-dd')
    const projected = dowBaseline[d] * trendFactor
    const isFuture = isAfter(date, today)
    const actual = isFuture ? null : (dailyTotals.get(key) ?? 0)

    thisWeekDays.push({ date, dayLabel: format(date, 'EEE d'), dayOfWeek: d + 1, projectedRevenue: projected, actualRevenue: actual })

    if (actual !== null) {
      thisActual += actual
      thisProjected += actual
    } else {
      thisProjected += projected
    }
  }

  const nextWeekDays: ForecastDay[] = []
  let nextProjected = 0

  for (let d = 0; d < 7; d++) {
    const date = addDays(nextWeekStart, d)
    const projected = dowBaseline[d] * trendFactor
    nextWeekDays.push({ date, dayLabel: format(date, 'EEE d'), dayOfWeek: d + 1, projectedRevenue: projected, actualRevenue: null })
    nextProjected += projected
  }

  return {
    thisWeek: { weekStart: thisWeekStart, days: thisWeekDays, projectedTotal: thisProjected, actualTotal: thisActual },
    nextWeek: { weekStart: nextWeekStart, days: nextWeekDays, projectedTotal: nextProjected, actualTotal: 0 },
    trendFactor,
    trendLabel,
    hasEnoughData: true,
    weeksOfHistory,
  }
}


export function computeAnomalies(transactions: SalesTransaction[]): AnomalyDay[] {
  if (transactions.length === 0) return []

  const dailyTotals = computeDailyTotals(transactions)

  const dowEntries: { dateKey: string; revenue: number }[][] = Array.from({ length: 7 }, () => [])
  for (const [dateKey, revenue] of dailyTotals) {
    const dow = new Date(dateKey + 'T00:00:00').getDay()
    dowEntries[dow].push({ dateKey, revenue })
  }

  const dowStats = dowEntries.map(entries => {
    if (entries.length < 3) return { mean: 0, std: 0 }
    const mean = entries.reduce((s, e) => s + e.revenue, 0) / entries.length
    const variance = entries.reduce((s, e) => s + (e.revenue - mean) ** 2, 0) / entries.length
    return { mean, std: Math.sqrt(variance) }
  })

  const anomalies: AnomalyDay[] = []

  for (const [dateKey, revenue] of dailyTotals) {
    const date = new Date(dateKey + 'T00:00:00')
    const dow = date.getDay()
    const { mean, std } = dowStats[dow]
    if (std < 1 || mean < 1) continue

    const zScore = (revenue - mean) / std
    if (Math.abs(zScore) < 2.0) continue

    const percentDiff = ((revenue - mean) / mean) * 100
    anomalies.push({
      date,
      dayLabel: format(date, 'EEE, MMM d yyyy'),
      dayOfWeek: dow + 1,
      actualRevenue: revenue,
      expectedRevenue: mean,
      percentDiff,
      direction: revenue > mean ? 'above' : 'below',
      severity: Math.abs(zScore) >= 2.5 ? 'strong' : 'mild',
    })
  }

  return anomalies.sort((a, b) => b.date.getTime() - a.date.getTime())
}
