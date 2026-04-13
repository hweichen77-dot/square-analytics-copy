import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { useFilteredTransactions, useOverridesMap } from '../db/useTransactions'
import { useDateRangeStore } from '../store/dateRangeStore'
import {
  computeProductStats,
  computeDailyRevenue,
  computeWeeklyRevenue,
  computeMonthlyRevenue,
  computeCategoryRevenue,
  computeStaffStats,
  isSlowMover,
} from '../engine/analyticsEngine'
import { StatCard } from '../components/ui/StatCard'
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

  const staffStats = useMemo(() => computeStaffStats(transactions), [transactions])

  const insights = useMemo(() => {
    if (!daily.length) return null
    const bestDay = daily.reduce((a, b) => b.revenue > a.revenue ? b : a, daily[0])
    const topProduct = stats[0] ?? null
    const slowProduct = stats.find(s => isSlowMover(s)) ?? null
    const topStaff = staffStats[0] ?? null
    return { bestDay, topProduct, slowProduct, topStaff }
  }, [daily, stats, staffStats])

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
      <div className="flex items-start justify-center pt-16">
        <div className="max-w-sm w-full space-y-6">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Welcome to Walley's Analytics</h1>
            <p className="text-slate-400 mt-1 text-sm">Get started in 3 easy steps.</p>
          </div>
          <div className="space-y-3">
            {([
              {
                step: 1,
                title: 'Export from Square',
                desc: 'Go to Square Dashboard → Reports → Sales Summary → Export as CSV.',
              },
              {
                step: 2,
                title: 'Import your data',
                desc: 'Drop the CSV on the Import page — it processes automatically.',
              },
              {
                step: 3,
                title: "You're all set",
                desc: 'Analytics populate instantly. Come back after each shift.',
              },
            ] as const).map(({ step, title, desc }) => (
              <div key={step} className="flex gap-4 bg-slate-800/60 rounded-lg p-4 border border-slate-700/40">
                <div className="w-7 h-7 rounded-full bg-teal-500/20 border border-teal-500/40 text-teal-400 text-sm font-bold flex items-center justify-center shrink-0">
                  {step}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-200">{title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/import')}
            className="w-full py-2.5 bg-teal-500 hover:bg-teal-400 text-slate-900 font-semibold rounded-lg text-sm transition-colors"
          >
            Go to Import
          </button>
        </div>
      </div>
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

      {insights && (
        <div className="border-l-2 border-teal-500 pl-4 bg-slate-800/40 rounded-r-lg py-3 pr-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-teal-500 mb-2">Quick Insights</p>
          <ul className="space-y-1.5 text-sm">
            <li className="text-slate-400">
              Best day:{' '}
              <span className="text-slate-200">
                {format(insights.bestDay.date, 'EEE, MMM d')} — {formatCurrency(insights.bestDay.revenue)}
              </span>
            </li>
            {insights.topProduct && (
              <li className="text-slate-400">
                Top seller:{' '}
                <span className="text-slate-200">
                  {insights.topProduct.name} ({formatNumber(insights.topProduct.totalUnitsSold)} units,{' '}
                  {formatCurrency(insights.topProduct.totalRevenue)})
                </span>
              </li>
            )}
            {insights.slowProduct && (
              <li className="text-slate-400">
                Slow mover:{' '}
                <span className="text-amber-400">{insights.slowProduct.name}</span>
                {' '}— no sales in {Math.floor((Date.now() - insights.slowProduct.lastSoldDate.getTime()) / 86_400_000)} days
              </li>
            )}
            {insights.topStaff && insights.topStaff.name !== 'Unknown' && (
              <li className="text-slate-400">
                Top staff:{' '}
                <span className="text-slate-200">
                  {insights.topStaff.name} — {formatCurrency(insights.topStaff.totalSales)} across{' '}
                  {formatNumber(insights.topStaff.transactionCount)} transactions
                </span>
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CategoryBreakdownChart data={categories} />
        <TopProductsChart products={stats} />
      </div>
    </div>
  )
}
