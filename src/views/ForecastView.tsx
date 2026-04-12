import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { useAllTransactions } from '../db/useTransactions'
import { computeForecast } from '../engine/forecastEngine'
import { computeProductStats } from '../engine/analyticsEngine'
import { EmptyState } from '../components/ui/EmptyState'
import { formatCurrency } from '../utils/format'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'

function TrendBadge({ label }: { label: string }) {
  const up = label.startsWith('+')
  const down = label.startsWith('-') && !label.startsWith('-0')
  const base = 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium'
  const cls = up ? `${base} bg-emerald-500/15 text-emerald-400` :
               down ? `${base} bg-red-500/15 text-red-400` :
               `${base} bg-slate-800 text-slate-400`
  return <span className={cls}>{label}</span>
}

export default function ForecastView() {
  const transactions = useAllTransactions()
  const navigate = useNavigate()
  const forecast = useMemo(() => computeForecast(transactions), [transactions])

  if (transactions.length === 0) {
    return (
      <EmptyState
        title="No data to forecast"
        subtitle="Import transactions first to generate sales forecasts."
        action={{ label: 'Go to Import', onClick: () => navigate('/import') }}
      />
    )
  }

  if (!forecast.hasEnoughData) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-bold text-slate-100">Sales Forecast</h1>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5 text-sm text-amber-300">
          <p className="font-semibold">Not enough history to forecast</p>
          <p className="mt-1">Need at least 2 complete weeks of data. You have {forecast.weeksOfHistory} week{forecast.weeksOfHistory === 1 ? '' : 's'}.</p>
        </div>
      </div>
    )
  }

  const { thisWeek, nextWeek, trendLabel } = forecast

  // Forecast accuracy: compare projected vs actual for elapsed days this week
  const accuracyData = useMemo(() => {
    const elapsedDays = thisWeek.days.filter(d => d.actualRevenue !== null)
    if (elapsedDays.length === 0) return null
    const totalProjected = elapsedDays.reduce((s, d) => s + d.projectedRevenue, 0)
    const totalActual = elapsedDays.reduce((s, d) => s + (d.actualRevenue ?? 0), 0)
    const accuracyPct = totalProjected > 0 ? Math.min(200, (totalActual / totalProjected) * 100) : 0
    const diff = totalActual - totalProjected
    return { accuracyPct, diff, elapsedDays: elapsedDays.length, totalActual, totalProjected }
  }, [thisWeek])

  // Top 5 products by velocity (avg daily revenue)
  const topProducts = useMemo(() => {
    const stats = computeProductStats(transactions)
    return stats.slice(0, 5)
  }, [transactions])

  // Progress through this week
  const daysWithData = thisWeek.days.filter(d => d.actualRevenue !== null).length
  const progressPct = daysWithData > 0 ? Math.min(100, (thisWeek.actualTotal / thisWeek.projectedTotal) * 100) : 0
  const onTrack = thisWeek.projectedTotal > 0 && thisWeek.actualTotal >= (thisWeek.projectedTotal * (daysWithData / 7) * 0.9)

  // Chart data for this week
  const thisWeekData = thisWeek.days.map(d => ({
    label: d.dayLabel,
    actual: d.actualRevenue ?? undefined,
    projected: d.actualRevenue === null ? d.projectedRevenue : undefined,
    projectedOverlay: d.projectedRevenue,
  }))

  // Chart data for next week
  const nextWeekData = nextWeek.days.map(d => ({
    label: d.dayLabel,
    projected: d.projectedRevenue,
  }))

  const weekLabel = (ws: Date) => `Week of ${format(ws, 'MMM d')}`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-100">Sales Forecast</h1>
        <TrendBadge label={trendLabel} />
      </div>

      {/* On-track banner */}
      {daysWithData > 0 && (
        <div className={`rounded-xl border p-5 ${onTrack ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
          <div className="flex items-start justify-between">
            <div>
              <p className={`text-sm font-semibold ${onTrack ? 'text-emerald-400' : 'text-amber-400'}`}>
                {onTrack ? 'On track this week' : 'Slightly behind this week'}
              </p>
              <p className={`text-xs mt-0.5 ${onTrack ? 'text-emerald-400' : 'text-amber-400'}`}>
                {formatCurrency(thisWeek.actualTotal)} actual · {formatCurrency(thisWeek.projectedTotal)} projected total
              </p>
            </div>
            <div className="text-right">
              <p className={`text-2xl font-bold ${onTrack ? 'text-emerald-400' : 'text-amber-400'}`}>
                {formatCurrency(thisWeek.projectedTotal)}
              </p>
              <p className="text-xs text-slate-500">projected this week</p>
            </div>
          </div>
          <div className="mt-3">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>{daysWithData} of 7 days in</span>
              <span>{progressPct.toFixed(0)}% of projected</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 border border-slate-700">
              <div
                className={`h-2 rounded-full transition-all ${onTrack ? 'bg-emerald-500' : 'bg-amber-400'}`}
                style={{ width: `${Math.min(progressPct, 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* This week chart */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h2 className="font-semibold text-slate-200 mb-1">{weekLabel(thisWeek.weekStart)} — Current Week</h2>
        <p className="text-xs text-slate-500 mb-4">Solid bars = actual revenue. Striped bars = forecast for remaining days.</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={thisWeekData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} width={48} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Bar dataKey="actual" name="Actual" fill="#14B8A6" radius={[3, 3, 0, 0]} />
            <Bar dataKey="projected" name="Forecast" fill="#5eead4" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Next week chart */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-slate-200">{weekLabel(nextWeek.weekStart)} — Forecast</h2>
          <span className="text-sm font-semibold text-teal-400">{formatCurrency(nextWeek.projectedTotal)} projected</span>
        </div>
        <p className="text-xs text-slate-500 mb-4">Based on day-of-week averages from the last {Math.min(12, forecast.weeksOfHistory)} weeks.</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={nextWeekData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} width={48} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Bar dataKey="projected" name="Forecast" radius={[3, 3, 0, 0]}>
              {nextWeekData.map((_, i) => (
                <Cell key={i} fill="#5eead4" />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Accuracy + stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Forecast accuracy card */}
        {accuracyData && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-500 font-medium mb-1">Forecast Accuracy (This Week)</p>
            <p className={`text-3xl font-bold tabular-nums ${accuracyData.accuracyPct >= 90 ? 'text-emerald-400' : accuracyData.accuracyPct >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
              {accuracyData.accuracyPct.toFixed(0)}%
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {accuracyData.elapsedDays} day{accuracyData.elapsedDays !== 1 ? 's' : ''} elapsed ·{' '}
              <span className={accuracyData.diff >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {accuracyData.diff >= 0 ? '+' : ''}{formatCurrency(accuracyData.diff)} vs projected
              </span>
            </p>
          </div>
        )}

        {/* Next week projected */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-500 font-medium mb-1">Next Week Projection</p>
          <p className="text-3xl font-bold tabular-nums text-teal-400">{formatCurrency(nextWeek.projectedTotal)}</p>
          <p className="text-xs text-slate-500 mt-1">
            {format(nextWeek.weekStart, 'MMM d')} – {format(new Date(nextWeek.weekStart.getTime() + 6 * 86_400_000), 'MMM d')}
          </p>
        </div>

        {/* Weeks of data */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-500 font-medium mb-1">History Used</p>
          <p className="text-3xl font-bold tabular-nums text-slate-200">{forecast.weeksOfHistory}</p>
          <p className="text-xs text-slate-500 mt-1">
            complete week{forecast.weeksOfHistory !== 1 ? 's' : ''} · up to 12 used for baseline
          </p>
        </div>
      </div>

      {/* Top 5 products by demand */}
      {topProducts.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700/50">
            <h2 className="font-semibold text-slate-200">Top Products by Demand</h2>
            <p className="text-xs text-slate-500 mt-0.5">Highest-velocity items — expect continued strong demand</p>
          </div>
          <div className="divide-y divide-slate-700/30">
            {topProducts.map((p, i) => {
              const maxRev = topProducts[0].totalRevenue
              const barWidth = maxRev > 0 ? (p.totalRevenue / maxRev) * 100 : 0
              return (
                <div key={p.name} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-700/20 transition-colors">
                  <span className="text-sm font-bold text-slate-600 w-5 shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{p.name}</p>
                    <div className="mt-1 h-1.5 bg-slate-700 rounded-full overflow-hidden w-full">
                      <div className="h-full rounded-full bg-teal-500/60" style={{ width: `${barWidth}%` }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-slate-100">{formatCurrency(p.totalRevenue)}</p>
                    <p className="text-xs text-slate-500">{p.totalUnitsSold} units</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Forecast uses day-of-week averages from up to 12 weeks of history, adjusted by a trend factor computed from the last 8 weeks.
        Based on {forecast.weeksOfHistory} complete week{forecast.weeksOfHistory === 1 ? '' : 's'} of data.
      </p>
    </div>
  )
}
