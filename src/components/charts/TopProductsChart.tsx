import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import type { ProductStats } from '../../engine/analyticsEngine'
import { formatCurrency } from '../../utils/format'

const CAT_COLORS: Record<string, string> = {
  'Food':           '#F59E0B',
  'Drinks':         '#14B8A6',
  'Ice Cream':      '#34D399',
  'Ramen/Hot Food': '#F87171',
  'Merch':          '#818CF8',
  'Other':          '#475569',
}

interface TopProductsChartProps {
  products: ProductStats[]
}

export function TopProductsChart({ products }: TopProductsChartProps) {
  const [mode, setMode] = useState<'revenue' | 'units'>('revenue')
  const top10 = products.slice(0, 10)
  const chartData = top10.map(p => ({
    name: p.name.length > 18 ? p.name.slice(0, 16) + '…' : p.name,
    fullName: p.name,
    value: mode === 'revenue' ? p.totalRevenue : p.totalUnitsSold,
    category: p.category,
  }))

  return (
    <div className="bg-slate-800/30 border border-slate-700/40 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-semibold text-slate-200 text-sm tracking-tight">Top Products</h2>
        <div className="flex gap-0.5">
          {(['revenue', 'units'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 text-xs font-medium capitalize transition-colors duration-150 cursor-pointer ${
                mode === m
                  ? 'bg-teal-500/15 text-teal-400'
                  : 'text-slate-200 hover:text-slate-300 hover:bg-slate-700/50'
              }`}
            >
              {m === 'revenue' ? 'By Revenue' : 'By Qty'}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
          <XAxis type="number" tick={{ fontSize: 10, fill: '#cbd5e1' }} axisLine={false} tickLine={false}
            tickFormatter={v => mode === 'revenue' ? `$${v}` : String(v)} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#cbd5e1' }} width={120} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
            labelStyle={{ color: '#ffffff', fontWeight: 600 }}
            itemStyle={{ color: '#ffffff' }}
            formatter={(v: number, _n, props) => [
              mode === 'revenue' ? formatCurrency(v) : `${v} units`,
              props.payload?.fullName ?? '',
            ]}
          />
          <Bar dataKey="value" maxBarSize={16} radius={[0, 3, 3, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={CAT_COLORS[d.category] ?? '#475569'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
