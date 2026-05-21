import { useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { format } from 'date-fns'
import type { DailyRevenue, TimeGranularity } from '../../engine/analyticsEngine'

interface RevenueChartProps {
  daily: DailyRevenue[]
  weekly: DailyRevenue[]
  monthly: DailyRevenue[]
  prevDaily?: DailyRevenue[]
  prevWeekly?: DailyRevenue[]
  prevMonthly?: DailyRevenue[]
}

function shortCurrency(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`
  return `$${value.toFixed(0)}`
}

const GRANULARITIES: TimeGranularity[] = ['Daily', 'Weekly', 'Monthly']

export function RevenueChart({ daily, weekly, monthly, prevDaily, prevWeekly, prevMonthly }: RevenueChartProps) {
  const [granularity, setGranularity] = useState<TimeGranularity>('Daily')
  const [showComparison, setShowComparison] = useState(false)

  const data = granularity === 'Daily' ? daily : granularity === 'Weekly' ? weekly : monthly
  const prevData = granularity === 'Daily' ? prevDaily : granularity === 'Weekly' ? prevWeekly : prevMonthly
  const fmt = granularity === 'Monthly' ? 'MMM yyyy' : 'MMM d'

  const chartData = data.map((d, i) => ({
    date: format(d.date, fmt),
    revenue: Math.round(d.revenue * 100) / 100,
    transactions: d.transactionCount,
    prevRevenue: showComparison && prevData?.[i] != null
      ? Math.round(prevData[i].revenue * 100) / 100
      : undefined,
  }))

  const hasPrev = (prevData?.length ?? 0) > 0

  return (
    <div className="bg-slate-800/30 border border-slate-700/40 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-600 text-slate-200 text-sm tracking-tight">Revenue</h2>
        <div className="flex items-center gap-2">
          {hasPrev && (
            <button
              onClick={() => setShowComparison(v => !v)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer border ${
                showComparison
                  ? 'border-slate-500 text-slate-100 bg-slate-700/40'
                  : 'border-slate-700 text-slate-300 hover:text-slate-400'
              }`}
            >
              vs prev
            </button>
          )}
          <div className="flex gap-0.5">
            {GRANULARITIES.map(g => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer ${
                  granularity === g
                    ? 'bg-teal-500/15 text-teal-400'
                    : 'text-slate-200 hover:text-slate-300 hover:bg-slate-700/50'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="oklch(0.73 0.22 252)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="oklch(0.73 0.22 252)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.23 0.006 55)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#cbd5e1' }} interval="preserveStartEnd" axisLine={{ stroke: 'oklch(0.23 0.006 55)' }} tickLine={false} />
          <YAxis tickFormatter={shortCurrency} tick={{ fontSize: 11, fill: '#cbd5e1' }} width={48} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: 'oklch(0.17 0.007 55)', border: '1px solid oklch(0.26 0.006 55)', borderRadius: '4px', fontSize: '12px' }}
            labelStyle={{ color: '#cbd5e1' }}
            formatter={(v: number, name: string) => [
              `$${v.toFixed(2)}`,
              name === 'prevRevenue' ? 'Prev Period' : 'Revenue',
            ]}
          />
          {showComparison && hasPrev && (
            <Area
              type="monotone"
              dataKey="prevRevenue"
              stroke="#94a3b8"
              fill="none"
              strokeWidth={1}
              strokeDasharray="4 2"
              dot={false}
              strokeOpacity={0.5}
            />
          )}
          <Area type="monotone" dataKey="revenue" stroke="oklch(0.73 0.22 252)" fill="url(#revGradient)" strokeWidth={1.5} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
