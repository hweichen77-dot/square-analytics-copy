import { useMemo, useState } from 'react'
import { format, startOfMonth, endOfMonth, subMonths, startOfYear, subQuarters, endOfQuarter, startOfQuarter, eachWeekOfInterval, endOfWeek } from 'date-fns'
import { db } from '../db/database'
import { useLiveQuery } from 'dexie-react-hooks'
import { computeProductStats } from '../engine/analyticsEngine'
import { effectiveUnitCost } from '../types/models'
import { formatCurrency, formatNumber } from '../utils/format'
import { exportAccountantPDF } from '../engine/pdfExport'
import type { AccountantReportData, AccountantProductRow } from '../engine/pdfExport'
import { exportQuickBooksPL } from '../engine/quickbooksExport'
import { useToastStore } from '../store/toastStore'
import { PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'

const PIE_COLORS = ['#14B8A6', '#6366F1', '#F59E0B', '#EF4444', '#8B5CF6', '#10B981', '#F97316']

type QuickRange = 'this-month' | 'last-month' | 'last-quarter' | 'ytd' | 'custom'

function toDateInput(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function fromDateInput(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const QUICK_RANGES: { key: QuickRange; label: string }[] = [
  { key: 'this-month',   label: 'This Month' },
  { key: 'last-month',   label: 'Last Month' },
  { key: 'last-quarter', label: 'Last Quarter' },
  { key: 'ytd',          label: 'Year to Date' },
  { key: 'custom',       label: 'Custom' },
]

function getQuickDates(key: QuickRange): { start: Date; end: Date } | null {
  const now = new Date()
  switch (key) {
    case 'this-month':   return { start: startOfMonth(now), end: endOfMonth(now) }
    case 'last-month':   { const lm = subMonths(now, 1); return { start: startOfMonth(lm), end: endOfMonth(lm) } }
    case 'last-quarter': { const lq = subQuarters(now, 1); return { start: startOfQuarter(lq), end: endOfQuarter(lq) } }
    case 'ytd':          return { start: startOfYear(now), end: now }
    default:             return null
  }
}

function MetricRow({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-2 border-b border-slate-700/50 last:border-0 ${highlight ? 'font-semibold' : ''}`}>
      <span className={`text-sm ${highlight ? 'text-slate-100' : 'text-slate-200'}`}>{label}</span>
      <div className="text-right">
        <span className={`text-sm ${highlight ? 'text-slate-100' : 'text-slate-200'}`}>{value}</span>
        {sub && <p className="text-xs text-slate-200">{sub}</p>}
      </div>
    </div>
  )
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function AccountantReportView() {
  const { show } = useToastStore()
  const [quick, setQuick] = useState<QuickRange>('last-month')
  const [customStart, setCustomStart] = useState(toDateInput(startOfMonth(subMonths(new Date(), 1))))
  const [customEnd, setCustomEnd] = useState(toDateInput(endOfMonth(subMonths(new Date(), 1))))
  const [productSearch, setProductSearch] = useState('')

  const dates = useMemo(() => {
    if (quick !== 'custom') return getQuickDates(quick)!
    return { start: fromDateInput(customStart), end: fromDateInput(customEnd) }
  }, [quick, customStart, customEnd])

  const transactions = useLiveQuery(async () => {
    return db.salesTransactions
      .where('date').between(dates.start, dates.end, true, true)
      .toArray()
  }, [dates.start.getTime(), dates.end.getTime()]) ?? []

  const costData = useLiveQuery(() => db.productCostData.toArray(), []) ?? []

  const productStats = useMemo(() => computeProductStats(transactions), [transactions])

  const costMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of costData) {
      const cost = effectiveUnitCost(c)
      if (cost > 0) map.set(c.productName, cost)
    }
    return map
  }, [costData])

  const report = useMemo((): AccountantReportData => {
    const totalRevenue = transactions.filter(t => t.netSales >= 0).reduce((s, t) => s + t.netSales, 0)
    const refunds = transactions.filter(t => t.netSales < 0)
    const refundRevenue = refunds.reduce((s, t) => s + t.netSales, 0)
    const netRevenue = transactions.reduce((s, t) => s + t.netSales, 0)
    const totalTransactions = transactions.filter(t => t.netSales > 0).length
    const avgTransaction = totalTransactions > 0 ? totalRevenue / totalTransactions : 0

    const paymentMap = new Map<string, { revenue: number; count: number }>()
    for (const tx of transactions.filter(t => t.netSales >= 0)) {
      const m = tx.paymentMethod || 'Unknown'
      const e = paymentMap.get(m) ?? { revenue: 0, count: 0 }
      e.revenue += tx.netSales
      e.count++
      paymentMap.set(m, e)
    }
    const paymentBreakdown = Array.from(paymentMap.entries())
      .map(([method, { revenue, count }]) => ({
        method, revenue, count,
        pct: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)

    const hasCostData = costMap.size > 0
    let totalCOGS: number | null = hasCostData ? 0 : null

    const topProducts: AccountantProductRow[] = productStats.slice(0, 20).map(p => {
      const costPerUnit = costMap.get(p.name) ?? null
      const totalCost = costPerUnit !== null ? costPerUnit * p.totalUnitsSold : null
      const grossProfit = totalCost !== null ? p.totalRevenue - totalCost : null
      const marginPct = grossProfit !== null && p.totalRevenue > 0
        ? (grossProfit / p.totalRevenue) * 100
        : null
      if (hasCostData && totalCost !== null && totalCOGS !== null) totalCOGS += totalCost
      return { name: p.name, revenue: p.totalRevenue, units: p.totalUnitsSold, costPerUnit, totalCost, grossProfit, marginPct }
    })

    const grossProfit = totalCOGS !== null ? netRevenue - totalCOGS : null
    const grossMarginPct = grossProfit !== null && netRevenue > 0
      ? (grossProfit / netRevenue) * 100
      : null

    const dateRange = `${format(dates.start, 'MMM d, yyyy')} — ${format(dates.end, 'MMM d, yyyy')}`

    return {
      dateRange, totalRevenue, totalTransactions, avgTransaction,
      refundRevenue, refundCount: refunds.length, netRevenue,
      totalCOGS, grossProfit, grossMarginPct, paymentBreakdown, topProducts,
    }
  }, [transactions, productStats, costMap, dates])

  function handleExport() {
    if (transactions.length === 0) { show('No transactions in selected period', 'error'); return }
    exportAccountantPDF(report)
    show('PDF downloaded', 'success')
  }

  function handleExportXLSX() {
    if (transactions.length === 0) { show('No transactions in selected period', 'error'); return }
    try {
      exportQuickBooksPL(report)
      show('QuickBooks P&L XLSX downloaded', 'success')
    } catch (e) {
      show(`XLSX export failed: ${(e as Error).message}`, 'error')
    }
  }

  const hasCOGS = report.totalCOGS !== null

  const weeklyRevenue = useMemo(() => {
    if (transactions.length === 0) return []
    const weeks = eachWeekOfInterval({ start: dates.start, end: dates.end }, { weekStartsOn: 1 })
    return weeks.map(weekStart => {
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })
      const rev = transactions
        .filter(t => t.date >= weekStart && t.date <= weekEnd && t.netSales > 0)
        .reduce((s, t) => s + t.netSales, 0)
      return { week: format(weekStart, 'MMM d'), revenue: rev }
    })
  }, [transactions, dates])

  const byDayOfWeek = useMemo(() => {
    const map: Record<number, { rev: number; count: number }> = {}
    for (const t of transactions.filter(t => t.netSales > 0)) {
      const d = t.date.getDay()
      if (!map[d]) map[d] = { rev: 0, count: 0 }
      map[d].rev += t.netSales
      map[d].count++
    }
    return [0,1,2,3,4,5,6].map(d => ({ day: DAY_NAMES[d], revenue: map[d]?.rev ?? 0, transactions: map[d]?.count ?? 0 }))
  }, [transactions])

  const categoryBreakdown = useMemo(() => {
    const map: Record<string, { revenue: number; units: number; count: number }> = {}
    for (const p of productStats) {
      const cat = p.category || 'Uncategorized'
      if (!map[cat]) map[cat] = { revenue: 0, units: 0, count: 0 }
      map[cat].revenue += p.totalRevenue
      map[cat].units += p.totalUnitsSold
      map[cat].count++
    }
    return Object.entries(map)
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [productStats])

  const allProducts = useMemo(() => {
    return productStats.map(p => {
      const costPerUnit = costMap.get(p.name) ?? null
      const totalCost = costPerUnit !== null ? costPerUnit * p.totalUnitsSold : null
      const grossProfit = totalCost !== null ? p.totalRevenue - totalCost : null
      const marginPct = grossProfit !== null && p.totalRevenue > 0 ? (grossProfit / p.totalRevenue) * 100 : null
      return { name: p.name, category: p.category, revenue: p.totalRevenue, units: p.totalUnitsSold, costPerUnit, totalCost, grossProfit, marginPct }
    })
  }, [productStats, costMap])

  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return allProducts
    const q = productSearch.toLowerCase()
    return allProducts.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
  }, [allProducts, productSearch])

  const opexTotal = useLiveQuery(async () => {
    const entries = await db.opexEntries.toArray()
    const startMonth = format(dates.start, 'yyyy-MM')
    const endMonth = format(dates.end, 'yyyy-MM')
    const periodEntries = entries.filter(e => e.month >= startMonth && e.month <= endMonth)
    return periodEntries.reduce((s, e) => s + e.amount, 0)
  }, [dates.start.getTime(), dates.end.getTime()]) ?? 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Accountant Report</h1>
          <p className="text-sm text-slate-200 mt-1">
            One-click PDF summary ready to hand to your accountant — revenue, COGS, margins, and payment breakdown.
          </p>
        </div>
        {transactions.length > 0 && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleExportXLSX}
              className="px-4 py-2.5 bg-slate-700 border border-slate-600 text-slate-200 rounded-xl text-sm font-semibold hover:bg-slate-600 transition-colors"
            >
              QuickBooks XLSX
            </button>
            <button
              onClick={handleExport}
              className="px-5 py-2.5 bg-teal-500 text-slate-950 rounded-xl text-sm font-semibold hover:bg-teal-600 transition-colors"
            >
              Download PDF
            </button>
          </div>
        )}
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 p-5 space-y-4">
        <h2 className="font-semibold text-slate-200">Report Period</h2>
        <div className="flex flex-wrap gap-2">
          {QUICK_RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setQuick(r.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                quick === r.key
                  ? 'bg-teal-500 text-slate-950'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-600'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {quick === 'custom' && (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-200 mb-1">Start</label>
              <input
                type="date"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                className="w-full border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-200 mb-1">End</label>
              <input
                type="date"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                className="w-full border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30"
              />
            </div>
          </div>
        )}

        <div className="text-xs text-slate-200">
          {format(dates.start, 'MMMM d, yyyy')} — {format(dates.end, 'MMMM d, yyyy')}
        </div>
      </div>

      {transactions.length === 0 ? (
        <div className="bg-slate-800/30 border border-slate-700/40 p-8 text-center text-sm text-slate-200">
          No transactions in this period.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-slate-800/30 border border-slate-700/40 p-5">
              <h2 className="font-semibold text-slate-200 mb-3">Revenue Summary</h2>
              <MetricRow label="Gross Revenue" value={formatCurrency(report.totalRevenue)} />
              <MetricRow
                label="Refunds / Adjustments"
                value={`(${formatCurrency(Math.abs(report.refundRevenue))})`}
                sub={`${report.refundCount} refund(s)`}
              />
              <MetricRow label="Net Revenue" value={formatCurrency(report.netRevenue)} highlight />
              <MetricRow
                label="Total Transactions"
                value={formatNumber(report.totalTransactions)}
                sub={`avg ${formatCurrency(report.avgTransaction)}`}
              />
              {hasCOGS && (
                <>
                  <MetricRow label="Cost of Goods Sold" value={formatCurrency(report.totalCOGS!)} />
                  <MetricRow
                    label="Gross Profit"
                    value={formatCurrency(report.grossProfit!)}
                    sub={`${report.grossMarginPct!.toFixed(1)}% margin`}
                    highlight
                  />
                </>
              )}
              {!hasCOGS && (
                <p className="text-xs text-slate-200 mt-3">
                  Import your Square catalog XLSX to include cost of goods and profit margins.
                </p>
              )}
            </div>

            <div className="bg-slate-800/30 border border-slate-700/40 p-5">
              <h2 className="font-semibold text-slate-200 mb-3">Payment Breakdown</h2>
              {report.paymentBreakdown.length > 0 && (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={report.paymentBreakdown}
                      dataKey="revenue"
                      nameKey="method"
                      cx="50%"
                      cy="50%"
                      outerRadius={72}
                      innerRadius={40}
                      paddingAngle={2}
                    >
                      {report.paymentBreakdown.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <ReTooltip
                      formatter={(v: number) => [formatCurrency(v), '']}
                      contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#ffffff', fontWeight: 600 }}
                      itemStyle={{ color: '#ffffff' }}
                    />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      formatter={(v) => <span style={{ color: '#e2e8f0', fontSize: 11 }}>{v}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
              <div className="mt-2 space-y-1">
                {report.paymentBreakdown.map((p, i) => (
                  <div key={p.method} className="flex items-center gap-3 py-1 border-b border-slate-700/40 last:border-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-sm text-slate-100 flex-1">{p.method}</span>
                    <span className="text-xs text-slate-200 w-9 text-right">{p.pct.toFixed(0)}%</span>
                    <span className="text-sm font-medium text-slate-100 w-24 text-right">{formatCurrency(p.revenue)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {hasCOGS && (opexTotal > 0) && (
            <div className="bg-slate-800/30 border border-slate-700/40 p-5">
              <h2 className="font-semibold text-slate-200 mb-3">Profit & Loss Summary</h2>
              <MetricRow label="Net Revenue" value={formatCurrency(report.netRevenue)} />
              <MetricRow label="Cost of Goods Sold" value={`(${formatCurrency(report.totalCOGS!)})`} />
              <MetricRow label="Gross Profit" value={formatCurrency(report.grossProfit!)} sub={`${report.grossMarginPct!.toFixed(1)}% margin`} highlight />
              <MetricRow label="Operating Expenses" value={`(${formatCurrency(opexTotal)})`} />
              <MetricRow
                label="Net Operating Income"
                value={formatCurrency(report.grossProfit! - opexTotal)}
                sub={`${((report.grossProfit! - opexTotal) / report.netRevenue * 100).toFixed(1)}% net margin`}
                highlight
              />
            </div>
          )}

          {weeklyRevenue.length > 1 && (
            <div className="bg-slate-800/30 border border-slate-700/40 p-5">
              <h2 className="font-semibold text-slate-200 mb-4">Weekly Revenue Trend</h2>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={weeklyRevenue} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#cbd5e1' }} />
                  <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: '#cbd5e1' }} />
                  <ReTooltip
                    formatter={(v: number) => [formatCurrency(v), 'Revenue']}
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#ffffff' }}
                    itemStyle={{ color: '#ffffff' }}
                  />
                  <Bar dataKey="revenue" fill="#14b8a6" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="bg-slate-800/30 border border-slate-700/40 p-5">
            <h2 className="font-semibold text-slate-200 mb-4">Revenue by Day of Week</h2>
            <div className="grid grid-cols-7 gap-2">
              {byDayOfWeek.map(d => (
                <div key={d.day} className="text-center">
                  <p className="text-[10px] font-semibold text-slate-200 uppercase mb-1">{d.day}</p>
                  <p className="text-sm font-bold text-slate-100">{formatCurrency(d.revenue)}</p>
                  <p className="text-[10px] text-slate-200">{d.transactions} txns</p>
                </div>
              ))}
            </div>
          </div>

          {categoryBreakdown.length > 0 && (
            <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-700/50">
                <h2 className="font-semibold text-slate-200">Revenue by Category</h2>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-slate-900/60">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-slate-200 font-semibold">Category</th>
                    <th className="px-4 py-2.5 text-right text-slate-200 font-semibold">Products</th>
                    <th className="px-4 py-2.5 text-right text-slate-200 font-semibold">Units</th>
                    <th className="px-4 py-2.5 text-right text-slate-200 font-semibold">Revenue</th>
                    <th className="px-4 py-2.5 text-right text-slate-200 font-semibold">% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryBreakdown.map((c, i) => (
                    <tr key={c.category} className={`border-t border-slate-700/30 hover:bg-slate-700/20 ${i % 2 === 1 ? 'bg-slate-800/40' : ''}`}>
                      <td className="px-4 py-2 text-slate-100 font-medium">{c.category}</td>
                      <td className="px-4 py-2 text-right text-slate-200">{c.count}</td>
                      <td className="px-4 py-2 text-right text-slate-200 font-mono">{c.units.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-slate-100 font-mono font-semibold">{formatCurrency(c.revenue)}</td>
                      <td className="px-4 py-2 text-right text-slate-200">
                        {report.totalRevenue > 0 ? `${(c.revenue / report.totalRevenue * 100).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {allProducts.length > 0 && (
            <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-slate-200">All Products</h2>
                  <p className="text-xs text-slate-200 mt-0.5">{filteredProducts.length} of {allProducts.length} products</p>
                </div>
                <input
                  type="text"
                  placeholder="Search products..."
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  className="border border-slate-600 rounded-lg px-3 py-1.5 text-sm bg-slate-900 text-slate-100 placeholder:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/30 w-52"
                />
              </div>
              <div className="overflow-y-auto max-h-[32rem] overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-900 border-b border-slate-700/50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-slate-200 font-semibold">Product</th>
                      <th className="px-4 py-2.5 text-left text-slate-200 font-semibold">Category</th>
                      <th className="px-4 py-2.5 text-right text-slate-200 font-semibold">Units</th>
                      <th className="px-4 py-2.5 text-right text-slate-200 font-semibold">Revenue</th>
                      {hasCOGS && <th className="px-4 py-2.5 text-right text-slate-200 font-semibold">COGS</th>}
                      {hasCOGS && <th className="px-4 py-2.5 text-right text-slate-200 font-semibold">Gross Profit</th>}
                      {hasCOGS && <th className="px-4 py-2.5 text-right text-slate-200 font-semibold">Margin %</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((p, i) => (
                      <tr key={p.name} className={`border-t border-slate-700/30 hover:bg-slate-700/20 ${i % 2 === 1 ? 'bg-slate-800/40' : ''}`}>
                        <td className="px-4 py-2 text-slate-100 font-medium">{p.name}</td>
                        <td className="px-4 py-2 text-slate-200">{p.category}</td>
                        <td className="px-4 py-2 text-right text-slate-200 font-mono">{p.units.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-slate-100 font-mono font-semibold">{formatCurrency(p.revenue)}</td>
                        {hasCOGS && <td className="px-4 py-2 text-right text-slate-200 font-mono">{p.totalCost !== null ? formatCurrency(p.totalCost) : '—'}</td>}
                        {hasCOGS && <td className="px-4 py-2 text-right font-mono font-semibold">
                          {p.grossProfit !== null ? (
                            <span className={p.grossProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}>{formatCurrency(p.grossProfit)}</span>
                          ) : <span className="text-slate-200">—</span>}
                        </td>}
                        {hasCOGS && <td className="px-4 py-2 text-right font-mono">
                          {p.marginPct !== null
                            ? <span className={p.marginPct >= 40 ? 'text-emerald-400' : p.marginPct >= 20 ? 'text-amber-400' : 'text-red-400'}>{p.marginPct.toFixed(0)}%</span>
                            : <span className="text-slate-200">—</span>}
                        </td>}
                      </tr>
                    ))}
                    {filteredProducts.length === 0 && (
                      <tr><td colSpan={hasCOGS ? 7 : 4} className="px-4 py-6 text-center text-slate-200">No products match.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
