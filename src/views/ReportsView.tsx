import { useState, useMemo, useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { format, subDays, parseISO, isValid } from 'date-fns'
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useAllTransactions, useOverridesMap } from '../db/useTransactions'
import { EmptyState } from '../components/ui/EmptyState'
import { StatCard } from '../components/ui/StatCard'
import { formatCurrency, formatNumber, formatPercent } from '../utils/format'
import {
  buildRevenueReport,
  buildTopProductsReport,
  buildCustomerBehaviorReport,
  buildTransactionLogReport,
  buildSeasonalReport,
  buildMonthlyDetailReport,
  buildCashReport,
  REPORT_META,
} from '../engine/reportEngine'
import type { ReportType, AnyReport } from '../engine/reportEngine'
import type { TimeGranularity } from '../engine/analyticsEngine'
import { exportToPDF, exportToCSV } from '../engine/pdfExport'
import { exportTransactionsToCSV } from '../engine/transactionExport'
import { useNavigate } from 'react-router-dom'


const PIE_COLORS = ['#14B8A6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#f97316', '#84cc16']
const REPORT_TYPES: ReportType[] = ['revenue', 'top-products', 'customer-behavior', 'transaction-log', 'seasonal', 'monthly-detail', 'cash']


function ExportBar({ onPDF, onCSV, loading }: { onPDF: () => void; onCSV: () => void; loading: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onCSV}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-600 rounded-lg text-slate-200 hover:bg-slate-700/50 disabled:opacity-40"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        CSV
      </button>
      <button
        onClick={onPDF}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-teal-500 text-slate-950 rounded-lg hover:bg-teal-600 disabled:opacity-40"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        PDF
      </button>
    </div>
  )
}


function RevenueReportView({ report }: { report: Extract<AnyReport, { type: 'revenue' }> }) {
  const chartData = report.timeSeries.map(d => ({
    date: format(d.date, report.granularity === 'Monthly' ? 'MMM yy' : report.granularity === 'Weekly' ? 'MMM d' : 'M/d'),
    revenue: Math.round(d.revenue * 100) / 100,
    transactions: d.transactionCount,
  }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Revenue"    value={formatCurrency(report.totalRevenue)} />
        <StatCard label="Transactions"     value={formatNumber(report.transactions)} />
        <StatCard label="Avg Transaction"  value={formatCurrency(report.avgTransaction)} />
        <StatCard label="Best Period"      value={report.topPeriod ? formatCurrency(report.topPeriod.revenue) : '—'} sub={report.topPeriod?.label} />
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 p-4">
        <h3 className="font-semibold text-slate-200 mb-4">Revenue over Time</h3>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="rptRevGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#14B8A6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#14B8A6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={48} />
            <Tooltip formatter={(v: number) => [formatCurrency(v), 'Revenue']} />
            <Area type="monotone" dataKey="revenue" stroke="#14B8A6" fill="url(#rptRevGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/50">
          <h3 className="font-semibold text-slate-200">Period Breakdown</h3>
        </div>
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900 border-b border-slate-700/50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-200">Period</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Revenue</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Transactions</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Avg Transaction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40">
              {report.timeSeries.map((d, i) => (
                <tr key={i} className="hover:bg-slate-700/50">
                  <td className="px-4 py-2 text-slate-100">{format(d.date, report.granularity === 'Monthly' ? 'MMMM yyyy' : 'MMM d, yyyy')}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-200">{formatCurrency(d.revenue)}</td>
                  <td className="px-4 py-2 text-right text-slate-200">{formatNumber(d.transactionCount)}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-200">{formatCurrency(d.transactionCount > 0 ? d.revenue / d.transactionCount : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function TopProductsReportView({ report }: { report: Extract<AnyReport, { type: 'top-products' }> }) {
  const [tab, setTab] = useState<'revenue' | 'units'>('revenue')
  const rows = tab === 'revenue' ? report.byRevenue : report.byUnits

  const chartData = rows.slice(0, 10).map(p => ({
    name: p.name.length > 20 ? p.name.slice(0, 19) + '…' : p.name,
    value: tab === 'revenue' ? p.totalRevenue : p.totalUnitsSold,
  }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Revenue"    value={formatCurrency(report.totalRevenue)} />
        <StatCard label="Total Units Sold" value={formatNumber(report.totalUnits)} />
        <StatCard label="Unique Products"  value={formatNumber(report.byRevenue.length)} />
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-200">Top 10 Products</h3>
          <div className="flex gap-1">
            {(['revenue', 'units'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-2.5 py-1 text-xs rounded-lg font-medium ${tab === t ? 'bg-teal-500 text-slate-950' : 'text-slate-200 hover:bg-slate-700'}`}>
                By {t === 'revenue' ? 'Revenue' : 'Units'}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={chartData.length * 30 + 20}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 80, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10 }}
              tickFormatter={v => tab === 'revenue' ? `$${(v / 1000).toFixed(0)}k` : String(v)} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
            <Tooltip formatter={(v: number) => tab === 'revenue' ? formatCurrency(v) : formatNumber(v)} />
            <Bar dataKey="value" fill="#14B8A6" radius={[0, 3, 3, 0]}
              label={{ position: 'right', fontSize: 9, fill: '#64748B',
                formatter: (v: number) => tab === 'revenue' ? formatCurrency(v) : formatNumber(v) }} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
          <h3 className="font-semibold text-slate-200">Full Rankings</h3>
          <div className="flex gap-1">
            {(['revenue', 'units'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-2.5 py-1 text-xs rounded-lg font-medium ${tab === t ? 'bg-teal-500 text-slate-950' : 'text-slate-200 hover:bg-slate-700'}`}>
                By {t === 'revenue' ? 'Revenue' : 'Units'}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900 border-b border-slate-700/50">
              <tr>
                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-200">#</th>
                <th className="px-3 py-2 text-left   text-xs font-semibold text-slate-200">Product</th>
                <th className="px-3 py-2 text-left   text-xs font-semibold text-slate-200">Category</th>
                <th className="px-3 py-2 text-right  text-xs font-semibold text-slate-200">Revenue</th>
                <th className="px-3 py-2 text-right  text-xs font-semibold text-slate-200">Units</th>
                <th className="px-3 py-2 text-right  text-xs font-semibold text-slate-200">Avg Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40">
              {rows.map((p, i) => (
                <tr key={p.name} className="hover:bg-slate-700/50">
                  <td className="px-3 py-2 text-center text-slate-200 text-xs">{i + 1}</td>
                  <td className="px-3 py-2 font-medium text-slate-100 max-w-xs truncate">{p.name}</td>
                  <td className="px-3 py-2 text-slate-200 text-xs">{p.category || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-100">{formatCurrency(p.totalRevenue)}</td>
                  <td className="px-3 py-2 text-right text-slate-100">{formatNumber(p.totalUnitsSold)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-200">{formatCurrency(p.avgPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function CustomerBehaviorReportView({ report }: { report: Extract<AnyReport, { type: 'customer-behavior' }> }) {
  const pieData = report.paymentMethods.map(p => ({ name: p.method, value: p.count }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Transactions" value={formatNumber(report.totalTransactions)} />
        <StatCard label="Total Revenue"      value={formatCurrency(report.totalRevenue)} />
        <StatCard label="Avg Transaction"    value={formatCurrency(report.avgTransactionValue)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800/30 border border-slate-700/40 p-4">
          <h3 className="font-semibold text-slate-200 mb-4">Payment Methods</h3>
          <div className="flex gap-4 items-center">
            <ResponsiveContainer width={170} height={170}>
              <PieChart>
                <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={48} outerRadius={78}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => [formatNumber(v), 'Transactions']} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2 min-w-0">
              {report.paymentMethods.map((p, i) => (
                <div key={p.method} className="flex items-center gap-2 text-sm">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="flex-1 truncate text-slate-100">{p.method}</span>
                  <span className="text-slate-200 text-xs">{formatPercent(p.pct)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-slate-800/30 border border-slate-700/40 p-4">
          <h3 className="font-semibold text-slate-200 mb-4">Busiest Days</h3>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={report.peakDays} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={36} />
              <Tooltip formatter={(v: number) => [formatNumber(v), 'Transactions']} />
              <Bar dataKey="count" fill="#14B8A6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 p-4">
        <h3 className="font-semibold text-slate-200 mb-4">Transactions by Hour</h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={report.peakHours} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={1} />
            <YAxis tick={{ fontSize: 11 }} width={36} />
            <Tooltip formatter={(v: number) => [formatNumber(v), 'Transactions']} />
            <Bar dataKey="count" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/50">
          <h3 className="font-semibold text-slate-200">Payment Method Detail</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-900 border-b border-slate-700/50">
            <tr>
              <th className="px-4 py-2 text-left   text-xs font-semibold text-slate-200">Method</th>
              <th className="px-4 py-2 text-right  text-xs font-semibold text-slate-200">Transactions</th>
              <th className="px-4 py-2 text-right  text-xs font-semibold text-slate-200">Share</th>
              <th className="px-4 py-2 text-right  text-xs font-semibold text-slate-200">Revenue</th>
              <th className="px-4 py-2 text-right  text-xs font-semibold text-slate-200">Avg Transaction</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/40">
            {report.paymentMethods.map(p => (
              <tr key={p.method} className="hover:bg-slate-700/50">
                <td className="px-4 py-2 font-medium text-slate-100">{p.method}</td>
                <td className="px-4 py-2 text-right text-slate-100">{formatNumber(p.count)}</td>
                <td className="px-4 py-2 text-right text-slate-200">{formatPercent(p.pct)}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-100">{formatCurrency(p.revenue)}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-200">
                  {formatCurrency(p.count > 0 ? p.revenue / p.count : 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TransactionLogReportView({ report }: { report: Extract<AnyReport, { type: 'transaction-log' }> }) {
  const [search, setSearch] = useState('')
  const [payFilter, setPayFilter] = useState('All')
  const [minAmount, setMinAmount] = useState('')

  const paymentMethods = useMemo(() => {
    const methods = Array.from(new Set(report.transactions.map(t => t.paymentMethod || 'Unknown')))
    return ['All', ...methods.sort()]
  }, [report.transactions])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const min = parseFloat(minAmount) || 0
    return report.transactions.filter(tx => {
      if (q && !tx.itemDescription.toLowerCase().includes(q) && !tx.staffName.toLowerCase().includes(q)) return false
      if (payFilter !== 'All' && (tx.paymentMethod || 'Unknown') !== payFilter) return false
      if (min > 0 && tx.netSales < min) return false
      return true
    })
  }, [report.transactions, search, payFilter, minAmount])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Transactions"    value={formatNumber(report.count)} sub={filtered.length !== report.count ? `${formatNumber(filtered.length)} shown` : undefined} />
        <StatCard label="Total Revenue"   value={formatCurrency(report.totalRevenue)} />
        <StatCard label="Avg Transaction" value={formatCurrency(report.count > 0 ? report.totalRevenue / report.count : 0)} />
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="text" placeholder="Search items or staff…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
        />
        <select value={payFilter} onChange={e => setPayFilter(e.target.value)}
          className="border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30">
          {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          type="number" placeholder="Min amount $" value={minAmount}
          onChange={e => setMinAmount(e.target.value)}
          className="border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
        />
        <span className="self-center text-sm text-slate-200 ml-auto">{formatNumber(filtered.length)} transactions</span>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="overflow-x-auto max-h-[28rem]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900 border-b border-slate-700/50">
              <tr>
                <th className="px-4 py-2.5 text-left   text-xs font-semibold text-slate-200">Date & Time</th>
                <th className="px-4 py-2.5 text-left   text-xs font-semibold text-slate-200">Items</th>
                <th className="px-4 py-2.5 text-right  text-xs font-semibold text-slate-200">Amount</th>
                <th className="px-4 py-2.5 text-left   text-xs font-semibold text-slate-200">Payment</th>
                <th className="px-4 py-2.5 text-left   text-xs font-semibold text-slate-200">Staff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40">
              {filtered.slice(0, 500).map((tx, i) => (
                <tr key={tx.transactionID ?? i} className="hover:bg-slate-700/50">
                  <td className="px-4 py-2 text-slate-200 whitespace-nowrap text-xs">{format(tx.date, 'MMM d, yyyy h:mm a')}</td>
                  <td className="px-4 py-2 text-slate-200 max-w-xs truncate">{tx.itemDescription}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-200">{formatCurrency(tx.netSales)}</td>
                  <td className="px-4 py-2 text-slate-200 text-xs">{tx.paymentMethod || '—'}</td>
                  <td className="px-4 py-2 text-slate-200 text-xs">{tx.staffName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 500 && (
            <p className="text-center text-xs text-slate-200 py-3">
              Showing first 500 of {formatNumber(filtered.length)} — export CSV for full list
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

const SEASON_COLORS: Record<string, string> = {
  Spring: '#10b981',
  Summer: '#f59e0b',
  Fall:   '#ef4444',
  Winter: '#14B8A6',
}

function SeasonalReportView({ report }: { report: Extract<AnyReport, { type: 'seasonal' }> }) {
  const [activeSeason, setActiveSeason] = useState<string | null>(null)
  const chartData = report.monthly.map(m => ({
    month: format(parseISO(m.month + '-01'), 'MMM yy'),
    revenue: Math.round(m.revenue * 100) / 100,
  }))
  const avgMonthly = report.monthly.length > 0 ? report.totalRevenue / report.monthly.length : 0
  const selectedSeason = report.seasons.find(s => s.name === activeSeason) ?? null

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Revenue" value={formatCurrency(report.totalRevenue)} />
        <StatCard label="Best Season"   value={report.bestSeason ?? '—'} sub={report.seasons.find(s => s.name === report.bestSeason) ? formatCurrency(report.seasons.find(s => s.name === report.bestSeason)!.revenue) : undefined} />
        <StatCard label="Best Month"    value={report.bestMonth ? formatCurrency(report.bestMonth.revenue) : '—'} sub={report.bestMonth?.month} />
        <StatCard label="Monthly Avg"   value={formatCurrency(avgMonthly)} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {report.seasons.map(s => {
          const isActive = activeSeason === s.name
          return (
            <button
              key={s.name}
              onClick={() => setActiveSeason(isActive ? null : s.name)}
              className={`text-left p-4 rounded-xl border transition-all ${isActive ? 'ring-2 ring-offset-slate-900 ring-offset-1' : 'hover:bg-slate-700/50'}`}
              style={{ borderColor: SEASON_COLORS[s.name], background: isActive ? `${SEASON_COLORS[s.name]}10` : undefined, ['--tw-ring-color' as any]: SEASON_COLORS[s.name] }}
            >
              <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-100 mb-2">
                {s.name.slice(0, 2).toUpperCase()}
              </div>
              <p className="font-semibold text-slate-200 text-sm">{s.name}</p>
              <p className="font-mono text-slate-100 mt-1">{formatCurrency(s.revenue)}</p>
              <p className="text-xs text-slate-200 mt-0.5">{s.revenueShare.toFixed(1)}% of total · {formatNumber(s.transactions)} txns</p>
              {s.topProducts[0] && <p className="text-xs text-slate-200 mt-1 truncate">Top: {s.topProducts[0].name}</p>}
            </button>
          )
        })}
      </div>

      {selectedSeason && (
        <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2">
            <span className="text-xs font-bold text-slate-200 bg-slate-700 px-2 py-1 rounded">{selectedSeason.name.slice(0,2).toUpperCase()}</span>
            <h3 className="font-semibold text-slate-200">{selectedSeason.name} — Top Products</h3>
            <span className="text-xs text-slate-200 ml-auto">{selectedSeason.months.join(', ')}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-700/50">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 border-b border-slate-700/50">
                  <tr>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-slate-200">#</th>
                    <th className="px-4 py-2 text-left   text-xs font-semibold text-slate-200">Product</th>
                    <th className="px-4 py-2 text-right  text-xs font-semibold text-slate-200">Revenue</th>
                    <th className="px-4 py-2 text-right  text-xs font-semibold text-slate-200">Units</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/40">
                  {selectedSeason.topProducts.map((p, i) => (
                    <tr key={p.name} className="hover:bg-slate-700/50">
                      <td className="px-4 py-2 text-center text-slate-200 text-xs">{i + 1}</td>
                      <td className="px-4 py-2 font-medium text-slate-200 max-w-xs truncate">{p.name}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-100">{formatCurrency(p.totalRevenue)}</td>
                      <td className="px-4 py-2 text-right text-slate-200">{formatNumber(p.totalUnitsSold)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4">
              <p className="text-xs font-semibold text-slate-200 uppercase mb-3">Monthly Breakdown</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={selectedSeason.monthBreakdown} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={44} />
                  <Tooltip formatter={(v: number) => [formatCurrency(v), 'Revenue']} />
                  <Bar dataKey="revenue" fill={SEASON_COLORS[selectedSeason.name]} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      <div className="bg-slate-800/30 border border-slate-700/40 p-4">
        <h3 className="font-semibold text-slate-200 mb-4">Monthly Revenue</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={48} />
            <Tooltip formatter={(v: number) => [formatCurrency(v), 'Revenue']} />
            <Bar dataKey="revenue" fill="#14B8A6" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/50">
          <h3 className="font-semibold text-slate-200">Month-by-Month Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 border-b border-slate-700/50">
              <tr>
                <th className="px-4 py-2 text-left  text-xs font-semibold text-slate-200">Month</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Revenue</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Transactions</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Avg Transaction</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">vs Avg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40">
              {report.monthly.map(m => {
                const diff = m.revenue - avgMonthly
                return (
                  <tr key={m.month} className="hover:bg-slate-700/50">
                    <td className="px-4 py-2 font-medium text-slate-100">{format(parseISO(m.month + '-01'), 'MMMM yyyy')}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-200">{formatCurrency(m.revenue)}</td>
                    <td className="px-4 py-2 text-right text-slate-200">{formatNumber(m.transactions)}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-200">{formatCurrency(m.avgTransaction)}</td>
                    <td className={`px-4 py-2 text-right font-mono text-xs font-medium ${diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {diff >= 0 ? '+' : ''}{formatCurrency(diff)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MonthlyDetailReportView({
  report,
  overheadEnabled,
  overheadPct,
}: {
  report: Extract<AnyReport, { type: 'monthly-detail' }>
  overheadEnabled: boolean
  overheadPct: number
}) {
  const rows = report.rows
  const hasDetailed = rows.some(r => r.hasDetailedFinancials)
  const hasCogs     = rows.some(r => r.cogs !== null)

  const allOpexCats = Array.from(
    new Set(rows.flatMap(r => Object.keys(r.opexByCategory)))
  )
  const hasOpex = allOpexCats.length > 0 || rows.some(r => r.fees > 0)

  const totGrossSales    = rows.reduce((s, r) => s + r.grossSales, 0)
  const totReturns       = rows.reduce((s, r) => s + r.returns, 0)
  const totDiscounts     = rows.reduce((s, r) => s + r.discounts, 0)
  const totNetSales      = rows.reduce((s, r) => s + r.netSales, 0)
  const totCollected     = rows.reduce((s, r) => s + r.totalCollected, 0)
  const totFees          = rows.reduce((s, r) => s + r.fees, 0)
  const totNetRevenue    = rows.reduce((s, r) => s + r.netRevenue, 0)
  const totCogs          = hasCogs ? rows.reduce((s, r) => s + (r.cogs ?? 0), 0) : null
  const totGrossMargin   = hasCogs ? rows.reduce((s, r) => s + (r.grossMargin ?? 0), 0) : null
  const totGrossMarginPct = (totGrossMargin !== null && totNetSales > 0)
    ? (totGrossMargin / totNetSales) * 100 : null
  const totOpexCats: Record<string, number> = {}
  allOpexCats.forEach(cat => {
    totOpexCats[cat] = rows.reduce((s, r) => s + (r.opexByCategory[cat] ?? 0), 0)
  })
  const totOpexSquare    = totFees
  const totOpexTotal     = rows.reduce((s, r) => s + r.opexTotal, 0)
  const totNetProfit     = rows.some(r => r.netProfit !== null)
    ? rows.reduce((s, r) => s + (r.netProfit ?? 0), 0) : null
  const totNetProfitPct  = (totNetProfit !== null && totNetSales > 0)
    ? (totNetProfit / totNetSales) * 100 : null
  const totOverhead      = (overheadEnabled && totNetProfit !== null)
    ? totNetProfit * (overheadPct / 100) : null
  const totFinalNet      = (totOverhead !== null && totNetProfit !== null)
    ? totNetProfit - totOverhead : null

  const $ = formatCurrency

  const labelCell = 'sticky left-0 z-10 bg-slate-800 px-3 py-2 text-xs text-slate-200 whitespace-nowrap border-r border-slate-700/60 min-w-[180px]'
  const dataCell  = 'px-3 py-2 text-right font-mono text-xs text-slate-100 whitespace-nowrap min-w-[90px]'
  const totalCell = 'px-3 py-2 text-right font-mono text-xs font-semibold text-slate-200 whitespace-nowrap min-w-[90px] border-l border-slate-700'

  const SectionRow = ({ label }: { label: string }) => (
    <tr className="bg-slate-900/70">
      <td className="sticky left-0 z-10 bg-slate-900/70 px-3 py-1.5 border-r border-slate-700/60">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-200">{label}</span>
      </td>
      {rows.map(r => <td key={r.month} className="px-3 py-1.5" />)}
      <td className="px-3 py-1.5 border-l border-slate-700" />
    </tr>
  )

  const DataRow = ({
    label,
    vals,
    total,
    indent = false,
    dim = false,
  }: {
    label: string
    vals: (string | null)[]
    total: string
    indent?: boolean
    dim?: boolean
  }) => (
    <tr className="border-t border-slate-700/20 hover:bg-slate-700/10 transition-colors">
      <td className={`${labelCell} ${indent ? 'pl-6' : ''} ${dim ? 'text-slate-200' : ''}`}>{label}</td>
      {vals.map((v, i) => (
        <td key={i} className={`${dataCell} ${dim ? 'text-slate-200' : ''}`}>{v ?? '—'}</td>
      ))}
      <td className={`${totalCell} ${dim ? 'text-slate-200' : ''}`}>{total}</td>
    </tr>
  )

  const SubtotalRow = ({
    label,
    vals,
    total,
    color = 'teal',
    sub,
    totalSub,
  }: {
    label: string
    vals: (string | null)[]
    total: string
    color?: 'teal' | 'emerald' | 'amber'
    sub?: (string | null)[]
    totalSub?: string
  }) => {
    const bgMap    = { teal: 'bg-teal-500/10',    emerald: 'bg-emerald-500/12', amber: 'bg-amber-500/10'    }
    const textMap  = { teal: 'text-teal-300',     emerald: 'text-emerald-300',  amber: 'text-amber-300'     }
    const valMap   = { teal: 'text-teal-400',     emerald: 'text-emerald-400',  amber: 'text-amber-400'     }
    const bordMap  = { teal: 'border-t-2 border-teal-500/30', emerald: 'border-t-2 border-emerald-500/30', amber: 'border-t-2 border-amber-500/30' }
    return (
      <tr className={`${bgMap[color]} ${bordMap[color]}`}>
        <td className={`sticky left-0 z-10 ${bgMap[color]} px-3 py-2.5 text-xs font-semibold border-r border-slate-700/60 min-w-[180px] ${textMap[color]}`}>
          {label}
        </td>
        {vals.map((v, i) => (
          <td key={i} className={`px-3 py-2.5 text-right font-mono text-xs font-semibold whitespace-nowrap min-w-[90px] ${valMap[color]}`}>
            {v ?? '—'}
            {sub?.[i] && <div className="text-[10px] text-slate-200 font-normal">{sub[i]}</div>}
          </td>
        ))}
        <td className={`px-3 py-2.5 text-right font-mono text-xs font-bold whitespace-nowrap min-w-[90px] border-l border-slate-700 ${valMap[color]}`}>
          {total}
          {totalSub && <div className="text-[10px] text-slate-200 font-normal">{totalSub}</div>}
        </td>
      </tr>
    )
  }

  const chartData = rows.map(r => ({
    month: format(parseISO(r.month + '-01'), 'MMM yy'),
    revenue: Math.round(r.revenue * 100) / 100,
  }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Net Sales"    value={$(report.totalRevenue)} />
        <StatCard label="Total Transactions" value={formatNumber(report.totalTransactions)} />
        <StatCard label="Monthly Avg"        value={$(report.avgMonthlyRevenue)} />
        <StatCard label="Best Month"         value={report.bestMonth ? $(report.bestMonth.revenue) : '—'} sub={report.bestMonth?.label} />
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 p-4">
        <h3 className="font-semibold text-slate-200 mb-4">Monthly Net Sales</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={48} />
            <Tooltip formatter={(v: number) => [$(v), 'Net Sales']} />
            <Bar dataKey="revenue" fill="#14B8A6" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700">
          <h3 className="font-semibold text-slate-200">Month-over-Month Growth</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 border-b border-slate-700/50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-200">Month</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Net Sales</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">vs Prior Month</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Growth %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40">
              {rows.map((r, i) => {
                const prior = i > 0 ? rows[i - 1].netSales : null
                const diff = prior !== null ? r.netSales - prior : null
                const growthPct = prior !== null && prior > 0 ? ((r.netSales - prior) / prior) * 100 : null
                const isPositive = diff !== null && diff >= 0
                return (
                  <tr key={r.month} className="hover:bg-slate-700/50">
                    <td className="px-4 py-2 font-medium text-slate-200">{r.label}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-200">{$(r.netSales)}</td>
                    <td className={`px-4 py-2 text-right font-mono text-xs font-medium ${diff === null ? 'text-slate-200' : isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {diff === null ? '—' : `${isPositive ? '+' : ''}${$(diff)}`}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono text-xs font-medium ${growthPct === null ? 'text-slate-200' : isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {growthPct === null ? '—' : `${isPositive ? '+' : ''}${growthPct.toFixed(1)}%`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {rows.some(r => r.topProducts && r.topProducts.length > 0) && (
        <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700">
            <h3 className="font-semibold text-slate-200">Top Products by Month</h3>
            <p className="text-xs text-slate-200 mt-0.5">Top 5 products per month by revenue</p>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900 border-b border-slate-700/50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-200">Month</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-slate-200">Rank</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-200">Product</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Revenue</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Units</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/40">
                {rows.flatMap(r =>
                  (r.topProducts ?? []).slice(0, 5).map((p, idx) => (
                    <tr key={`${r.month}-${p.name}-${idx}`} className="hover:bg-slate-700/50">
                      {idx === 0 ? (
                        <td className="px-4 py-2 font-medium text-slate-100 align-top" rowSpan={Math.min(5, (r.topProducts ?? []).length)}>
                          {r.label}
                        </td>
                      ) : null}
                      <td className="px-4 py-2 text-center text-slate-200 text-xs">{idx + 1}</td>
                      <td className="px-4 py-2 text-slate-200 max-w-xs truncate">{p.name}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-100">{$(p.totalRevenue)}</td>
                      <td className="px-4 py-2 text-right text-slate-200">{p.totalUnitsSold}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700">
          <h3 className="font-semibold text-slate-200">Income Statement</h3>
          <p className="text-xs text-slate-200 mt-0.5">All months — row labels left, columns right. Scroll horizontally.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-700">
                <th className="sticky left-0 z-20 bg-slate-900 px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-200 border-r border-slate-700/60 min-w-[180px]">
                  Line Item
                </th>
                {rows.map(r => (
                  <th key={r.month} className="px-3 py-2.5 text-right text-[10px] font-semibold text-slate-200 whitespace-nowrap min-w-[90px]">
                    {r.label}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right text-[10px] font-bold text-slate-100 whitespace-nowrap min-w-[90px] border-l border-slate-700">
                  TOTAL
                </th>
              </tr>
            </thead>

            <tbody>
              <SectionRow label="Income" />

              {hasDetailed ? (
                <>
                  <DataRow
                    label="Gross Sales"
                    vals={rows.map(r => $(r.grossSales))}
                    total={$(totGrossSales)}
                    indent
                  />
                  <DataRow
                    label="− Returns"
                    vals={rows.map(r => r.returns > 0 ? `−${$(r.returns)}` : $(0))}
                    total={totReturns > 0 ? `−${$(totReturns)}` : $(0)}
                    indent
                    dim
                  />
                  <DataRow
                    label="− Discounts & Comps"
                    vals={rows.map(r => r.discounts > 0 ? `−${$(r.discounts)}` : $(0))}
                    total={totDiscounts > 0 ? `−${$(totDiscounts)}` : $(0)}
                    indent
                    dim
                  />
                </>
              ) : (
                <DataRow
                  label="Gross Sales"
                  vals={rows.map(r => $(r.grossSales))}
                  total={$(totGrossSales)}
                  indent
                />
              )}

              <SubtotalRow
                label="NET SALES"
                vals={rows.map(r => $(r.netSales))}
                total={$(totNetSales)}
                color="teal"
              />

              {hasDetailed && (
                <>
                  <SectionRow label="Payments" />
                  <DataRow
                    label="Total Collected"
                    vals={rows.map(r => $(r.totalCollected))}
                    total={$(totCollected)}
                    indent
                  />
                  <DataRow
                    label="− Square Fees"
                    vals={rows.map(r => r.fees > 0 ? `−${$(r.fees)}` : $(0))}
                    total={totFees > 0 ? `−${$(totFees)}` : $(0)}
                    indent
                    dim
                  />
                  <SubtotalRow
                    label="NET REVENUE"
                    vals={rows.map(r => $(r.netRevenue))}
                    total={$(totNetRevenue)}
                    color="teal"
                  />
                </>
              )}

              {hasCogs && (
                <>
                  <SectionRow label="Cost of Goods" />
                  <DataRow
                    label="COGS (Food)"
                    vals={rows.map(r => r.cogs !== null ? $(r.cogs) : null)}
                    total={totCogs !== null ? $(totCogs) : '—'}
                    indent
                    dim
                  />
                  <SubtotalRow
                    label="GROSS MARGIN"
                    vals={rows.map(r => r.grossMargin !== null ? $(r.grossMargin) : null)}
                    total={totGrossMargin !== null ? $(totGrossMargin) : '—'}
                    sub={rows.map(r => r.grossMarginPct !== null ? `${r.grossMarginPct.toFixed(1)}%` : null)}
                    totalSub={totGrossMarginPct !== null ? `${totGrossMarginPct.toFixed(1)}%` : undefined}
                    color="teal"
                  />
                </>
              )}

              {hasOpex && (
                <>
                  <SectionRow label="Operating Expenses" />
                  {allOpexCats.map(cat => (
                    <DataRow
                      key={cat}
                      label={`− ${cat}`}
                      vals={rows.map(r => r.opexByCategory[cat] ? $(r.opexByCategory[cat]) : null)}
                      total={totOpexCats[cat] ? $(totOpexCats[cat]) : '—'}
                      indent
                      dim
                    />
                  ))}
                  {rows.some(r => r.fees > 0) && (
                    <DataRow
                      label="− Square Expenses"
                      vals={rows.map(r => r.fees > 0 ? $(r.fees) : null)}
                      total={totOpexSquare > 0 ? $(totOpexSquare) : '—'}
                      indent
                      dim
                    />
                  )}
                  <tr className="border-t border-slate-700/40 bg-slate-900/30">
                    <td className="sticky left-0 z-10 bg-slate-900/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 border-r border-slate-700/60 min-w-[180px]">
                      Total OPEX
                    </td>
                    {rows.map(r => (
                      <td key={r.month} className="px-3 py-2 text-right font-mono text-xs font-semibold text-slate-200 whitespace-nowrap min-w-[90px]">
                        {$(r.opexTotal)}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-slate-100 whitespace-nowrap min-w-[90px] border-l border-slate-700">
                      {$(totOpexTotal)}
                    </td>
                  </tr>
                </>
              )}

              {totNetProfit !== null && (
                <>
                  <SubtotalRow
                    label="NET PROFIT"
                    vals={rows.map(r => r.netProfit !== null ? $(r.netProfit) : null)}
                    total={$(totNetProfit)}
                    sub={rows.map(r => r.netProfitPct !== null ? `${r.netProfitPct.toFixed(1)}%` : null)}
                    totalSub={totNetProfitPct !== null ? `${totNetProfitPct.toFixed(1)}%` : undefined}
                    color="emerald"
                  />

                  {overheadEnabled && totOverhead !== null && (
                    <>
                      <DataRow
                        label={`− ${overheadPct}% Overhead`}
                        vals={rows.map(r => r.netProfit !== null ? `−${$(r.netProfit * overheadPct / 100)}` : null)}
                        total={`−${$(totOverhead)}`}
                        dim
                      />
                      <SubtotalRow
                        label="NET AFTER OVERHEAD"
                        vals={rows.map(r => r.netProfit !== null ? $(r.netProfit * (1 - overheadPct / 100)) : null)}
                        total={$(totFinalNet!)}
                        color="amber"
                      />
                    </>
                  )}
                </>
              )}

              <tr className="border-t-2 border-slate-700 bg-slate-900/50">
                <td className="sticky left-0 z-10 bg-slate-900/50 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-200 border-r border-slate-700/60 min-w-[180px]">
                  Transactions
                </td>
                {rows.map(r => (
                  <td key={r.month} className="px-3 py-2 text-right text-xs text-slate-200 whitespace-nowrap min-w-[90px]">
                    {formatNumber(r.transactions)}
                  </td>
                ))}
                <td className="px-3 py-2 text-right text-xs font-semibold text-slate-200 whitespace-nowrap min-w-[90px] border-l border-slate-700">
                  {formatNumber(rows.reduce((s, r) => s + r.transactions, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function CashReportView({ report }: { report: Extract<AnyReport, { type: 'cash' }> }) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return report.transactions
    return report.transactions.filter(tx =>
      tx.itemDescription.toLowerCase().includes(q) || tx.staffName.toLowerCase().includes(q)
    )
  }, [report.transactions, search])

  const dayChartData = report.byDayOfWeek.map(d => ({ day: d.label.slice(0, 3), count: d.cashCount, revenue: d.cashRevenue }))
  const hourChartData = report.byHour.filter(h => h.cashCount > 0).map(h => ({ hour: h.label, count: h.cashCount }))

  return (
    <div className="space-y-6">
      {report.cashTransactions === 0 && report.totalTransactions > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <p className="font-semibold text-amber-300 mb-1">No cash transactions detected</p>
          <p className="text-sm text-amber-400 mb-3">
            Your data has {report.totalTransactions} transactions but none were recognized as cash.
            The payment methods found in your data are shown below — check which one represents cash
            and let us know so detection can be updated.
          </p>
          <div className="flex flex-wrap gap-2">
            {report.paymentBreakdown.map(p => (
              <span key={p.method} className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-900 font-mono">
                {p.method || '(empty)'} — {p.count} txns
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Cash Revenue"      value={formatCurrency(report.cashRevenue)} sub={`${report.cashRevenuePct.toFixed(1)}% of total`} />
        <StatCard label="Cash Transactions" value={formatNumber(report.cashTransactions)} sub={`${report.cashPct.toFixed(1)}% of total`} />
        <StatCard label="Avg Cash Sale"     value={formatCurrency(report.avgCashTransaction)} />
        <StatCard label="Total Revenue"     value={formatCurrency(report.totalRevenue)} sub={`${formatNumber(report.totalTransactions)} transactions`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800/30 border border-slate-700/40 p-4">
          <h3 className="font-semibold text-slate-200 mb-4">Cash by Day of Week</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={dayChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={36} />
              <Tooltip formatter={(v: number) => [formatNumber(v), 'Cash Transactions']} />
              <Bar dataKey="count" fill="#14B8A6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-800/30 border border-slate-700/40 p-4">
          <h3 className="font-semibold text-slate-200 mb-4">Cash by Hour</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={hourChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
              <XAxis dataKey="hour" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 11 }} width={36} />
              <Tooltip formatter={(v: number) => [formatNumber(v), 'Cash Transactions']} />
              <Bar dataKey="count" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/50">
          <h3 className="font-semibold text-slate-200">Weekly Cash Totals</h3>
        </div>
        <div className="overflow-x-auto max-h-72">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900 border-b border-slate-700/50">
              <tr>
                <th className="px-4 py-2 text-left  text-xs font-semibold text-slate-200">Week</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Cash Revenue</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Cash Txns</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Total Revenue</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Cash %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40">
              {report.byWeek.map(w => (
                <tr key={w.weekStart} className="hover:bg-slate-700/50">
                  <td className="px-4 py-2 text-slate-100 whitespace-nowrap">{w.weekLabel}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-200">{formatCurrency(w.cashRevenue)}</td>
                  <td className="px-4 py-2 text-right text-slate-200">{formatNumber(w.cashCount)}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-200">{formatCurrency(w.totalRevenue)}</td>
                  <td className="px-4 py-2 text-right text-xs text-slate-200">
                    {w.totalRevenue > 0 ? `${((w.cashRevenue / w.totalRevenue) * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/50">
          <h3 className="font-semibold text-slate-200">Payment Method Breakdown</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-900 border-b border-slate-700/50">
            <tr>
              <th className="px-4 py-2 text-left  text-xs font-semibold text-slate-200">Method</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Transactions</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200">Revenue</th>
              <th className="px-4 py-2 text-left  text-xs font-semibold text-slate-200">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/40">
            {report.paymentBreakdown.map(p => (
              <tr key={p.method} className="hover:bg-slate-700/50">
                <td className="px-4 py-2 font-medium text-slate-100">{p.method}</td>
                <td className="px-4 py-2 text-right text-slate-200">{formatNumber(p.count)}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-200">{formatCurrency(p.revenue)}</td>
                <td className="px-4 py-2">
                  {p.isCash
                    ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-emerald-400 font-medium">Cash</span>
                    : <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-200">Card / Other</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
          <h3 className="font-semibold text-slate-200">Cash Transactions</h3>
          <input
            type="text" placeholder="Search…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-slate-600 rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          />
        </div>
        <div className="overflow-x-auto max-h-[28rem]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900 border-b border-slate-700/50">
              <tr>
                <th className="px-4 py-2.5 text-left  text-xs font-semibold text-slate-200">Date & Time</th>
                <th className="px-4 py-2.5 text-left  text-xs font-semibold text-slate-200">Items</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-200">Amount</th>
                <th className="px-4 py-2.5 text-left  text-xs font-semibold text-slate-200">Staff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40">
              {filtered.slice(0, 500).map((tx, i) => (
                <tr key={tx.transactionID ?? i} className="hover:bg-slate-700/50">
                  <td className="px-4 py-2 text-slate-200 whitespace-nowrap text-xs">{format(tx.date, 'MMM d, yyyy h:mm a')}</td>
                  <td className="px-4 py-2 text-slate-200 max-w-xs truncate">{tx.itemDescription}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-200">{formatCurrency(tx.netSales)}</td>
                  <td className="px-4 py-2 text-slate-200 text-xs">{tx.staffName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 500 && (
            <p className="text-center text-xs text-slate-200 py-3">
              Showing first 500 of {formatNumber(filtered.length)} — export CSV for full list
            </p>
          )}
        </div>
      </div>
    </div>
  )
}


export default function ReportsView() {
  const navigate = useNavigate()
  const allTransactions = useAllTransactions()
  const overrides = useOverridesMap()
  const opexEntries  = useLiveQuery(() => db.opexEntries.toArray(), []) ?? []
  const costData     = useLiveQuery(() => db.productCostData.toArray(), []) ?? []

  const [selectedType, setSelectedType] = useState<ReportType>('revenue')
  const [startDate, setStartDate] = useState(() => format(subDays(new Date(), 90), 'yyyy-MM-dd'))
  const [endDate,   setEndDate]   = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [granularity, setGranularity] = useState<TimeGranularity>('Daily')
  const [topN, setTopN] = useState(20)
  const [overheadEnabled, setOverheadEnabled] = useState(false)
  const [overheadPct, setOverheadPct] = useState(30)
  const [report, setReport] = useState<AnyReport | null>(null)
  const [generating, setGenerating] = useState(false)

  const filtered = useMemo(() => {
    const start = startDate ? parseISO(startDate) : null
    const end   = endDate   ? new Date(parseISO(endDate).getTime() + 86_400_000 - 1) : null
    return allTransactions.filter(tx => {
      if (start && isValid(start) && tx.date < start) return false
      if (end   && isValid(end)   && tx.date > end)   return false
      return true
    })
  }, [allTransactions, startDate, endDate])

  const dateRangeLabel = useMemo(() => {
    try {
      return `${format(parseISO(startDate), 'MMM d, yyyy')} – ${format(parseISO(endDate), 'MMM d, yyyy')}`
    } catch {
      return `${startDate} – ${endDate}`
    }
  }, [startDate, endDate])

  const generate = useCallback(() => {
    if (filtered.length === 0) return
    setGenerating(true)
    setReport(null)
    setTimeout(() => {
      try {
        let result: AnyReport
        if      (selectedType === 'revenue')           result = buildRevenueReport(filtered, granularity)
        else if (selectedType === 'top-products')      result = buildTopProductsReport(filtered, overrides, topN)
        else if (selectedType === 'customer-behavior') result = buildCustomerBehaviorReport(filtered)
        else if (selectedType === 'transaction-log')   result = buildTransactionLogReport(filtered)
        else if (selectedType === 'monthly-detail')    result = buildMonthlyDetailReport(filtered, overrides, opexEntries, costData)
        else if (selectedType === 'cash')              result = buildCashReport(filtered)
        else                                           result = buildSeasonalReport(filtered, overrides)
        setReport(result)
      } finally {
        setGenerating(false)
      }
    }, 0)
  }, [filtered, selectedType, granularity, topN, overrides, opexEntries, costData])

  if (allTransactions.length === 0) {
    return (
      <EmptyState
        title="No transaction data"
        subtitle="Import a CSV or sync via Square to generate reports."
        action={{ label: 'Go to Import', onClick: () => navigate('/import') }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-100">Reports</h1>

      <div className="grid grid-cols-4 gap-3">
        {REPORT_TYPES.map(type => {
          const meta = REPORT_META[type]
          const active = selectedType === type
          return (
            <button
              key={type}
              onClick={() => { setSelectedType(type); setReport(null) }}
              className={`text-left p-4 rounded-xl border transition-all ${
                active
                  ? 'border-teal-400 bg-teal-500/10 ring-1 ring-teal-400'
                  : 'border-slate-700 bg-slate-800 hover:border-teal-500/30 hover:bg-slate-700/50'
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold mb-2 ${active ? 'bg-teal-500/15 text-teal-400' : 'bg-slate-700 text-slate-200'}`}>
                {meta.label.slice(0, 2).toUpperCase()}
              </div>
              <p className={`text-sm font-semibold leading-tight ${active ? 'text-teal-400' : 'text-slate-200'}`}>
                {meta.label}
              </p>
              <p className="text-xs text-slate-200 mt-1 leading-snug line-clamp-2">{meta.description}</p>
            </button>
          )
        })}
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 p-4 flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-2">
          <div>
            <label className="block text-xs font-medium text-slate-200 mb-1">From</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
          </div>
          <span className="text-slate-200 mt-5">–</span>
          <div>
            <label className="block text-xs font-medium text-slate-200 mb-1">To</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
          </div>
        </div>

        {selectedType === 'revenue' && (
          <div>
            <label className="block text-xs font-medium text-slate-200 mb-1">Granularity</label>
            <div className="flex gap-1">
              {(['Daily', 'Weekly', 'Monthly'] as TimeGranularity[]).map(g => (
                <button key={g} onClick={() => setGranularity(g)}
                  className={`px-3 py-2 text-xs rounded-lg font-medium border ${
                    granularity === g ? 'bg-teal-500 text-slate-950 border-teal-500' : 'border-slate-600 text-slate-200 hover:bg-slate-700/50'
                  }`}>
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedType === 'top-products' && (
          <div>
            <label className="block text-xs font-medium text-slate-200 mb-1">Show top</label>
            <select value={topN} onChange={e => setTopN(Number(e.target.value))}
              className="border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30">
              {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n} products</option>)}
            </select>
          </div>
        )}

        {selectedType === 'monthly-detail' && (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/8 border border-amber-500/20 rounded-lg">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setOverheadEnabled(v => !v)}
                className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${overheadEnabled ? 'bg-amber-500' : 'bg-slate-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${overheadEnabled ? 'translate-x-4' : ''}`} />
              </div>
              <span className="text-xs font-medium text-amber-300/80">Overhead deduction</span>
            </label>
            {overheadEnabled && (
              <div className="flex items-center gap-1 ml-1">
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={overheadPct}
                  onChange={e => setOverheadPct(Math.min(99, Math.max(1, Number(e.target.value))))}
                  className="w-12 bg-slate-900 border border-amber-500/30 rounded px-1.5 py-0.5 text-xs font-mono text-amber-300 text-center focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                />
                <span className="text-xs text-amber-400/60">%</span>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-slate-200">{formatNumber(filtered.length)} transactions in range</span>
          <button
            onClick={() => exportTransactionsToCSV(filtered)}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-600 rounded-lg text-slate-200 hover:bg-slate-700/50 disabled:opacity-40"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export CSV
          </button>
          <button
            onClick={generate}
            disabled={generating || filtered.length === 0}
            className="px-5 py-2 bg-teal-500 text-slate-950 text-sm font-medium rounded-lg hover:bg-teal-600 disabled:opacity-50 flex items-center gap-2"
          >
            {generating && (
              <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            )}
            {generating ? 'Generating…' : 'Generate Report'}
          </button>
        </div>
      </div>

      {generating && (
        <div className="flex items-center justify-center py-20 text-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-slate-700 border-t-teal-400 rounded-full animate-spin" />
            <span className="text-sm">Building report…</span>
          </div>
        </div>
      )}

      {!generating && report && (
        <>
          <div className="flex items-center justify-between bg-slate-800/30 border border-slate-700/40 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-200">{REPORT_META[report.type].label}</p>
              <p className="text-xs text-slate-200">{dateRangeLabel}</p>
            </div>
            <ExportBar
              loading={false}
              onCSV={() => exportToCSV(report)}
              onPDF={() => exportToPDF(report, dateRangeLabel)}
            />
          </div>

          {report.type === 'revenue'           && <RevenueReportView          report={report} />}
          {report.type === 'top-products'      && <TopProductsReportView      report={report} />}
          {report.type === 'customer-behavior' && <CustomerBehaviorReportView report={report} />}
          {report.type === 'transaction-log'   && <TransactionLogReportView   report={report} />}
          {report.type === 'seasonal'          && <SeasonalReportView         report={report} />}
          {report.type === 'monthly-detail'    && <MonthlyDetailReportView    report={report} overheadEnabled={overheadEnabled} overheadPct={overheadPct} />}
          {report.type === 'cash'              && <CashReportView             report={report} />}
        </>
      )}

      {!generating && !report && (
        <div className="text-center py-16 text-slate-200">
          <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto mb-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          </div>
          <p className="text-sm font-medium text-slate-200">Select a report type, set your date range, and click Generate.</p>
        </div>
      )}
    </div>
  )
}
