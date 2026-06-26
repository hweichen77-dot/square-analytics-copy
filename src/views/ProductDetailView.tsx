import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format, startOfMonth, subMonths } from 'date-fns'
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Line, ComposedChart, Area,
} from 'recharts'
import { useAllTransactions, useOverridesMap } from '../db/useTransactions'
import {
  computeProductStats,
  computeProductTimeSeries,
  computeProductTransactions,
  computeProductDayOfWeek,
  productTrend,
  type TimeGranularity,
  type ProductTimePoint,
  type ProductTransactionRow,
} from '../engine/analyticsEngine'
import { formatCurrency, formatNumber, dayName } from '../utils/format'

const CATEGORY_COLORS: Record<string, string> = {
  'Drinks':        '#3b82f6',
  'Food':          '#22c55e',
  'Ice Cream':     '#06b6d4',
  'Ramen/Hot Food':'#f97316',
  'Merch':         '#a855f7',
}

function categoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? '#94a3b8'
}

function movingAverage(data: ProductTimePoint[]): { date: Date; value: number }[] {
  if (data.length < 3) return []
  return data.slice(2).map((_, i) => ({
    date: data[i + 2].date,
    value: (data[i].revenue + data[i + 1].revenue + data[i + 2].revenue) / 3,
  }))
}

function formatHour(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}:00 ${hour < 12 ? 'AM' : 'PM'}`
}

type TxSort = 'dateDesc' | 'dateAsc' | 'qtyDesc' | 'totalDesc' | 'staff' | 'payment'

export default function ProductDetailView() {
  const { productName: name } = useParams<{ productName: string }>()
  const productName = decodeURIComponent(name ?? '')
  const transactions = useAllTransactions()
  const overrides = useOverridesMap()
  const navigate = useNavigate()
  const [showAllTx, setShowAllTx] = useState(false)
  const [granularity, setGranularity] = useState<TimeGranularity>('Monthly')
  const [txSort, setTxSort] = useState<TxSort>('dateDesc')

  const stats = useMemo(() => {
    const all = computeProductStats(transactions, overrides)
    return all.find(p => p.name === productName) ?? null
  }, [transactions, overrides, productName])

  const timeSeries = useMemo(() =>
    computeProductTimeSeries(productName, transactions, granularity),
    [productName, transactions, granularity]
  )

  const txRows = useMemo(() =>
    computeProductTransactions(productName, transactions),
    [productName, transactions]
  )

  const dowData = useMemo(() =>
    computeProductDayOfWeek(productName, transactions).map(d => ({
      dayOfWeek: d.dayOfWeek,
      day: dayName(d.dayOfWeek),
      count: d.count,
    })),
    [productName, transactions]
  )

  const peakDayOfWeek = useMemo(() => {
    const best = dowData.reduce((a, b) => b.count > a.count ? b : a, dowData[0])
    return best?.count > 0 ? best.dayOfWeek : null
  }, [dowData])

  const peakHour = useMemo(() => {
    const map = new Map<number, number>()
    for (const tx of transactions) {
      const hour = tx.date.getHours()
      const hasProd = (tx.itemDescription ?? '').includes(productName)
      if (!hasProd) continue
      map.set(hour, (map.get(hour) ?? 0) + 1)
    }
    if (!map.size) return null
    return [...map.entries()].reduce((a, b) => b[1] > a[1] ? b : a)[0]
  }, [transactions, productName])

  const monthOverMonth = useMemo(() => {
    const now = new Date()
    const currentStart = startOfMonth(now)
    const prevStart = startOfMonth(subMonths(now, 1))
    const prevEnd = new Date(currentStart.getTime() - 1)
    const currentRev = txRows.filter(r => r.date >= currentStart).reduce((s, r) => s + r.total, 0)
    const prevRev = txRows.filter(r => r.date >= prevStart && r.date <= prevEnd).reduce((s, r) => s + r.total, 0)
    if (prevRev === 0) return null
    return ((currentRev - prevRev) / prevRev) * 100
  }, [txRows])

  const bestMonth = useMemo(() => {
    if (!stats) return null
    const entries = Object.entries(stats.monthlySales)
    if (!entries.length) return null
    const [key, units] = entries.reduce((a, b) => b[1] > a[1] ? b : a)
    const [year, month] = key.split('-').map(Number)
    const d = new Date(year, month - 1)
    return { label: format(d, 'MMM yyyy'), units }
  }, [stats])

  const sortedTxRows = useMemo((): ProductTransactionRow[] => {
    switch (txSort) {
      case 'dateAsc':  return [...txRows].reverse()
      case 'qtyDesc':  return [...txRows].sort((a, b) => b.qty - a.qty)
      case 'totalDesc':return [...txRows].sort((a, b) => b.total - a.total)
      case 'staff':    return [...txRows].sort((a, b) => a.staffName.localeCompare(b.staffName))
      case 'payment':  return [...txRows].sort((a, b) => a.paymentMethod.localeCompare(b.paymentMethod))
      default:         return txRows
    }
  }, [txRows, txSort])

  const displayedTx = showAllTx ? sortedTxRows : sortedTxRows.slice(0, 100)

  const maData = useMemo(() => movingAverage(timeSeries), [timeSeries])

  const chartData = useMemo(() => {
    const maMap = new Map(maData.map(p => [p.date.getTime(), p.value]))
    return timeSeries.map(p => ({
      date: format(p.date, granularity === 'Monthly' ? 'MMM yyyy' : 'MMM d'),
      revenue: Math.round(p.revenue * 100) / 100,
      units: p.units,
      ma: maMap.has(p.date.getTime()) ? Math.round(maMap.get(p.date.getTime())! * 100) / 100 : null,
    }))
  }, [timeSeries, maData, granularity])

  const trend = stats ? productTrend(stats) : null

  if (!stats) {
    return (
      <div className="py-20 text-center text-slate-200">
        <p>Product not found.</p>
        <button onClick={() => navigate('/inventory')} className="mt-3 text-teal-400 text-sm underline">← Back</button>
      </div>
    )
  }

  const col = categoryColor(stats.category)

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/inventory')} className="text-teal-400 text-sm hover:underline">← Back</button>
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-3xl font-bold text-slate-100">{productName}</h1>
          <span
            className="px-3 py-1 rounded-full text-sm font-medium"
            style={{ background: `${col}22`, color: col, border: `1px solid ${col}44` }}
          >
            {stats.category}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard title="Units Sold" value={formatNumber(stats.totalUnitsSold)} />
          <KpiCard title="Total Revenue" value={formatCurrency(stats.totalRevenue)} />
          <KpiCard title="Avg Price" value={formatCurrency(stats.avgPrice)} />
          {bestMonth && (
            <KpiCard title="Best Month" value={bestMonth.label} sub={`${bestMonth.units} units`} />
          )}
          <MonthOverMonthCard pct={monthOverMonth} />
        </div>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-200">Revenue & Units Over Time</h2>
          <div className="flex gap-1">
            {(['Daily', 'Weekly', 'Monthly'] as const).map(g => (
              <button key={g} onClick={() => setGranularity(g)}
                className={`px-2.5 py-1 text-xs rounded-lg font-medium ${granularity === g ? 'bg-teal-500 text-slate-950' : 'text-slate-200 hover:bg-slate-700'}`}>
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium text-slate-200">Revenue</span>
            <span className="flex items-center gap-1 text-xs text-slate-200">
              <span className="inline-block w-4 h-0.5 bg-teal-400 rounded" />Revenue
            </span>
            {maData.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-slate-200">
                <span className="inline-block w-4 h-0.5 bg-orange-400 rounded" style={{ borderTop: '1.5px dashed' }} />3-period avg
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#14B8A6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#14B8A6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#cbd5e1' }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: '#cbd5e1' }} width={48} tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#ffffff', fontWeight: 600 }}
                formatter={(v: number, n: string) => [n === 'revenue' ? formatCurrency(v) : n === 'ma' ? `${formatCurrency(v)} avg` : v, n === 'revenue' ? 'Revenue' : n === 'ma' ? '3-period avg' : n]}
              />
              <Area type="linear" dataKey="revenue" stroke="#14B8A6" fill="url(#revGrad)" strokeWidth={2} dot={{ r: 3, fill: '#14B8A6', strokeWidth: 0 }} activeDot={{ r: 5 }} />
              {maData.length > 0 && (
                <Line type="linear" dataKey="ma" stroke="#fb923c" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-3 space-y-2">
          <span className="text-xs font-medium text-slate-200">Units Sold</span>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#cbd5e1' }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: '#cbd5e1' }} width={32} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#ffffff', fontWeight: 600 }}
              />
              <Bar dataKey="units" fill="#14B8A6" fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold text-slate-200">Sales Patterns</h2>
        <div className="flex gap-4 items-start">
          <div className="flex-1 bg-slate-800/30 border border-slate-700/40 p-4 space-y-2">
            <span className="text-xs font-medium text-slate-200">Sales by Day of Week</span>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={dowData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#cbd5e1' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#cbd5e1' }} width={28} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" maxBarSize={32} radius={[3, 3, 0, 0]}>
                  {dowData.map(entry => (
                    <Cell key={entry.dayOfWeek}
                      fill={entry.dayOfWeek === peakDayOfWeek ? '#14B8A6' : 'rgba(20,184,166,0.35)'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-slate-800/30 border border-slate-700/40 p-4 space-y-4 w-52 shrink-0">
            <PatternIndicator title="Best Day"
              value={peakDayOfWeek ? dayName(peakDayOfWeek) : 'N/A'} />
            <PatternIndicator title="Peak Hour"
              value={peakHour !== null ? formatHour(peakHour) : 'N/A'} />
            <PatternIndicator title="Trend" value={trend ?? 'N/A'}
              color={trend === 'Growing' ? '#22c55e' : trend === 'Declining' ? '#ef4444' : '#94a3b8'} />
          </div>
        </div>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
          <h2 className="font-semibold text-slate-200">Transaction History</h2>
          <span className="text-xs text-slate-200">{txRows.length} total</span>
        </div>
        {txRows.length === 0 ? (
          <div className="py-12 text-center text-slate-200 text-sm">No transactions found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-200 uppercase text-xs">
                <tr>
                  <SortTh label="Date" field="dateDesc" altField="dateAsc" sort={txSort} onSort={setTxSort} />
                  <th className="px-4 py-2 text-left">Time</th>
                  <SortTh label="Qty" field="qtyDesc" sort={txSort} onSort={setTxSort} right />
                  <th className="px-4 py-2 text-right">Unit Price</th>
                  <SortTh label="Total" field="totalDesc" sort={txSort} onSort={setTxSort} right />
                  <SortTh label="Staff" field="staff" sort={txSort} onSort={setTxSort} />
                  <SortTh label="Payment" field="payment" sort={txSort} onSort={setTxSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/40">
                {displayedTx.map((tx, i) => (
                  <tr key={i} className="hover:bg-slate-700/50">
                    <td className="px-4 py-2 text-slate-200 tabular-nums">{format(tx.date, 'MMM d, yyyy')}</td>
                    <td className="px-4 py-2 text-slate-200 tabular-nums">{format(tx.date, 'h:mm a')}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{tx.qty}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(tx.unitPrice)}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{formatCurrency(tx.total)}</td>
                    <td className="px-4 py-2 text-slate-200">{tx.staffName}</td>
                    <td className="px-4 py-2 text-slate-200">{tx.paymentMethod || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {txRows.length > 100 && (
          <div className="px-4 py-3 border-t border-slate-700/50 text-center">
            <button onClick={() => setShowAllTx(s => !s)} className="text-sm text-teal-400 hover:underline">
              {showAllTx ? 'Show less' : `Show all ${txRows.length} transactions →`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function KpiCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-800/30 border border-slate-700/40 p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-slate-200">
        {title}
      </div>
      <div className="text-lg font-semibold text-slate-100 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-200">{sub}</div>}
    </div>
  )
}

function MonthOverMonthCard({ pct }: { pct: number | null }) {
  return (
    <div className="bg-slate-800/30 border border-slate-700/40 p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-slate-200">
        This vs Last Month
      </div>
      {pct !== null ? (
        <div className={`text-lg font-semibold tabular-nums flex items-center gap-1 ${pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {pct >= 0 ? '↑' : '↓'}{Math.abs(pct).toFixed(0)}%
        </div>
      ) : (
        <div className="text-lg font-semibold text-slate-200">N/A</div>
      )}
    </div>
  )
}

function PatternIndicator({ title, value, color = '#e2e8f0' }: { title: string; value: string; color?: string }) {
  return (
    <div className="flex items-start gap-3">
      <div>
        <div className="text-xs text-slate-200">{title}</div>
        <div className="text-sm font-semibold" style={{ color }}>{value}</div>
      </div>
    </div>
  )
}

function SortTh({ label, field, altField, sort, onSort, right }: {
  label: string; field: TxSort; altField?: TxSort; sort: TxSort; onSort: (s: TxSort) => void; right?: boolean
}) {
  const active = sort === field || sort === altField
  const toggle = () => {
    if (altField && sort === field) onSort(altField)
    else onSort(field)
  }
  return (
    <th
      className={`px-4 py-2 ${right ? 'text-right' : 'text-left'} cursor-pointer select-none hover:text-slate-300 ${active ? 'text-teal-400' : ''}`}
      onClick={toggle}
    >
      {label}{active ? (sort === altField ? ' ↑' : ' ↓') : ''}
    </th>
  )
}
