import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import type { CategoryRevenue } from '../../engine/analyticsEngine'
import { formatCurrency, formatPercent } from '../../utils/format'

const COLORS = ['#14B8A6', '#F59E0B', '#818CF8', '#EF4444', '#34D399', '#60A5FA', '#F472B6', '#A78BFA']

interface CategoryBreakdownChartProps {
  data: CategoryRevenue[]
}

export function CategoryBreakdownChart({ data }: CategoryBreakdownChartProps) {
  return (
    <div className="bg-slate-800/30 border border-slate-700/40 p-4">
      <h2 className="font-display font-semibold text-slate-200 text-sm mb-4 tracking-tight">Revenue by Category</h2>
      <div className="flex gap-6 items-center">
        <ResponsiveContainer width={180} height={180}>
          <PieChart>
            <Pie data={data} dataKey="revenue" nameKey="category" cx="50%" cy="50%" innerRadius={50} outerRadius={80} strokeWidth={0}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
              labelStyle={{ color: '#ffffff', fontWeight: 600 }}
              itemStyle={{ color: '#ffffff' }}
              formatter={(v: number) => [formatCurrency(v), '']}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex-1 space-y-2 text-sm min-w-0">
          {data.map((cat, i) => (
            <div key={cat.category} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="flex-1 truncate text-slate-200 text-xs">{cat.category}</span>
              <span className="text-slate-200 text-xs">{formatPercent(cat.percentage)}</span>
              <span className="text-slate-200 text-xs font-medium font-mono">{formatCurrency(cat.revenue)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
