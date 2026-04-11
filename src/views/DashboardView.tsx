import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFilteredTransactions, useOverridesMap } from '../db/useTransactions'
import { useDateRangeStore } from '../store/dateRangeStore'
import {
  computeProductStats,
  computeDailyRevenue,
  computeWeeklyRevenue,
  computeMonthlyRevenue,
  computeCategoryRevenue,
} from '../engine/analyticsEngine'
import { StatCard } from '../components/ui/StatCard'
import { EmptyState } from '../components/ui/EmptyState'
import { RevenueChart } from '../components/charts/RevenueChart'
import { CategoryBreakdownChart } from '../components/charts/CategoryBreakdownChart'
import { TopProductsChart } from '../components/charts/TopProductsChart'
import { formatCurrency, formatNumber } from '../utils/format'
import type { DateRange } from '../db/useTransactions'

/** Shift a date range back by its own duration to get the preceding period. */
function previousPeriod(range: DateRange): DateRange {
  const { start, end } = range
  if (!start || !end) return { start: null, end: null }
  const durationMs = end.getTime() - start.getTime()
  return {
    start: new Date(start.getTime() - durationMs - 86_400_000),
    end: new Date(start.getTime() - 86_400_000),
  }
}

function pctChange(current: number, previous: number): { label: string; up: boolean } | null {
  if (previous <= 0) return null
  const pct = ((current - previous) / previous) * 100
  const abs = Math.abs(pct)
  const label = `${abs.toFixed(1)}% vs prev period`
  return { label, up: pct >= 0 }
}

export default function DashboardView() {
  const { range } = useDateRangeStore()
  const transactions = useFilteredTransactions(range)
  const prevRange = useMemo(() => previousPeriod(range), [range])
  const prevTransactions = useFilteredTransactions(prevRange)
  const overrides = useOverridesMap()
  const navigate = useNavigate()

  const stats = useMemo(() => computeProductStats(transactions, overrides), [transactions, overrides])
  const daily = useMemo(() => computeDailyRevenue(transactions), [transactions])
  const weekly = useMemo(() => computeWeeklyRevenue(transactions), [transactions])
  const monthly = useMemo(() => computeMonthlyRevenue(transactions), [transactions])
  const categories = useMemo(() => computeCategoryRevenue(transactions, overrides), [transactions, overrides])

  const totalRevenue = transactions.reduce((s, t) => s + t.netSales, 0)
  const totalTransactions = transactions.length
  const avgTransaction = totalTransactions > 0 ? totalRevenue / totalTransactions : 0
  const uniqueProducts = stats.length

  // Previous period totals (only shown when a specific date range is selected)
  const hasPrevPeriod = prevRange.start !== null
  const prevRevenue = hasPrevPeriod ? prevTransactions.reduce((s, t) => s + t.netSales, 0) : 0
  const prevTxCount = hasPrevPeriod ? prevTransactions.length : 0
  const prevAvg = prevTxCount > 0 ? prevRevenue / prevTxCount : 0
  const prevProducts = hasPrevPeriod
    ? computeProductStats(prevTransactions, overrides).length
    : 0

  const revTrend      = hasPrevPeriod ? pctChange(totalRevenue, prevRevenue) : null
  const txTrend       = hasPrevPeriod ? pctChange(totalTransactions, prevTxCount) : null
  const avgTrend      = hasPrevPeriod ? pctChange(avgTransaction, prevAvg) : null
  const productsTrend = hasPrevPeriod ? pctChange(uniqueProducts, prevProducts) : null

  if (transactions.length === 0) {
    return (
      <EmptyState
        title="No data yet"
        subtitle="Import a Square CSV export or sync directly via Square to see your analytics."
        action={{ label: 'Go to Import', onClick: () => navigate('/import') }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-100">Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Revenue"
          value={formatCurrency(totalRevenue)}
          trend={revTrend?.label}
          trendUp={revTrend?.up}
        />
        <StatCard
          label="Transactions"
          value={formatNumber(totalTransactions)}
          trend={txTrend?.label}
          trendUp={txTrend?.up}
        />
        <StatCard
          label="Avg Transaction"
          value={formatCurrency(avgTransaction)}
          trend={avgTrend?.label}
          trendUp={avgTrend?.up}
        />
        <StatCard
          label="Products Sold"
          value={formatNumber(uniqueProducts)}
          trend={productsTrend?.label}
          trendUp={productsTrend?.up}
        />
      </div>

      <RevenueChart daily={daily} weekly={weekly} monthly={monthly} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CategoryBreakdownChart data={categories} />
        <TopProductsChart products={stats} />
      </div>
    </div>
  )
}
