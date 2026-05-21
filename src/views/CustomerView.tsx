import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts'
import { useFilteredTransactions } from '../db/useTransactions'
import { useDateRangeStore } from '../store/dateRangeStore'
import { EmptyState } from '../components/ui/EmptyState'
import { formatCurrency } from '../utils/format'
import type { SalesTransaction } from '../types/models'
import { parseProductItems } from '../types/models'
import { format, startOfDay, differenceInDays, differenceInMonths } from 'date-fns'

type CustomerSegment = 'Regulars' | 'Frequent' | 'Occasional' | 'One-Timers'
type CustomerSort = 'totalSpent' | 'transactions' | 'lastVisit' | 'firstVisit'

interface CustomerProfile {
  id: string
  name: string
  transactionCount: number
  totalSpent: number
  avgTransaction: number
  firstPurchase: Date
  lastPurchase: Date
  favoriteProduct: string
  segment: CustomerSegment
  daysSinceLastVisit: number
  monthlySpending: { month: string; amount: number }[]
}

function segmentFor(count: number): CustomerSegment {
  if (count >= 10) return 'Regulars'
  if (count >= 5) return 'Frequent'
  if (count >= 2) return 'Occasional'
  return 'One-Timers'
}

const SEGMENT_COLOR: Record<CustomerSegment, string> = {
  Regulars: '#8b5cf6',
  Frequent: '#3b82f6',
  Occasional: '#14b8a6',
  'One-Timers': '#9ca3af',
}

function buildProfiles(transactions: SalesTransaction[]): {
  profiles: CustomerProfile[]
  retention: { month: number; rate: number }[]
} {
  const byCustomer: Record<string, SalesTransaction[]> = {}
  for (const tx of transactions) {
    if (!tx.customerID) continue
    if (!byCustomer[tx.customerID]) byCustomer[tx.customerID] = []
    byCustomer[tx.customerID].push(tx)
  }

  const today = startOfDay(new Date())

  const profiles: CustomerProfile[] = Object.entries(byCustomer).map(([cid, txs]) => {
    const sorted = [...txs].sort((a, b) => a.date.getTime() - b.date.getTime())
    const totalSpent = txs.reduce((s, t) => s + t.netSales, 0)
    const displayName = txs.find(t => t.customerName)?.customerName ?? ''

    const productCount: Record<string, number> = {}
    for (const tx of txs) {
      for (const item of parseProductItems(tx.itemDescription)) {
        productCount[item.name] = (productCount[item.name] ?? 0) + item.qty
      }
    }
    const fav = Object.entries(productCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'

    const monthlyMap: Record<string, number> = {}
    for (const tx of txs) {
      const key = format(tx.date, 'yyyy-MM')
      monthlyMap[key] = (monthlyMap[key] ?? 0) + tx.netSales
    }
    const monthlySpending = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, amount }))

    const firstPurchase = sorted[0].date
    const lastPurchase = sorted[sorted.length - 1].date

    return {
      id: cid,
      name: displayName,
      transactionCount: txs.length,
      totalSpent,
      avgTransaction: totalSpent / Math.max(1, txs.length),
      firstPurchase,
      lastPurchase,
      favoriteProduct: fav,
      segment: segmentFor(txs.length),
      daysSinceLastVisit: differenceInDays(today, startOfDay(lastPurchase)),
      monthlySpending,
    }
  }).sort((a, b) => b.totalSpent - a.totalSpent)

  const cohorts: Record<string, Set<string>> = {}
  for (const [cid, txs] of Object.entries(byCustomer)) {
    const first = txs.map(t => t.date).sort((a, b) => a.getTime() - b.getTime())[0]
    const key = format(first, 'yyyy-MM')
    if (!cohorts[key]) cohorts[key] = new Set()
    cohorts[key].add(cid)
  }

  // Latest month we have any data for — cohorts whose offset month exceeds this
  // haven't had a chance to return yet, so exclude them from the denominator.
  const allMonths = Object.values(byCustomer).flat().map(tx => format(tx.date, 'yyyy-MM'))
  const sortedMonths = allMonths.sort()
  const latestDataMonth = sortedMonths.length ? sortedMonths[sortedMonths.length - 1] : ''

  const offsets: Record<number, { returned: number; total: number }> = {}
  for (const [cohortMonth, customerIDs] of Object.entries(cohorts)) {
    for (let offset = 1; offset <= 6; offset++) {
      const [y, m] = cohortMonth.split('-').map(Number)
      const tMonth = m + offset > 12
        ? `${y + Math.floor((m + offset - 1) / 12)}-${String(((m + offset - 1) % 12) + 1).padStart(2, '0')}`
        : `${y}-${String(m + offset).padStart(2, '0')}`

      // Only count this cohort if the target month has already occurred in our data
      if (tMonth > latestDataMonth) continue

      let returned = 0
      for (const cid of customerIDs) {
        const txs = byCustomer[cid]
        if (txs?.some(tx => format(tx.date, 'yyyy-MM') === tMonth)) returned++
      }
      if (!offsets[offset]) offsets[offset] = { returned: 0, total: 0 }
      offsets[offset].returned += returned
      offsets[offset].total += customerIDs.size
    }
  }

  const retention = Array.from({ length: 6 }, (_, i) => i + 1)
    .map(offset => {
      const d = offsets[offset]
      if (!d || d.total === 0) return null
      return { month: offset, rate: (d.returned / d.total) * 100 }
    })
    .filter((x): x is { month: number; rate: number } => x !== null)

  return { profiles, retention }
}

export default function CustomerView() {
  const { range } = useDateRangeStore()
  const transactions = useFilteredTransactions(range)
  const [selectedSegment, setSelectedSegment] = useState<CustomerSegment | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerProfile | null>(null)
  const [sort, setSort] = useState<CustomerSort>('totalSpent')
  const [search, setSearch] = useState('')

  const { profiles, retention } = useMemo(
    () => buildProfiles(transactions),
    [transactions],
  )

  const identifiedCount = useMemo(() => transactions.filter(t => t.customerID).length, [transactions])
  const identifiedPct = transactions.length > 0 ? Math.round((identifiedCount / transactions.length) * 100) : 0
  const repeatCustomers = profiles.filter(p => p.transactionCount > 1).length
  const avgCLV = profiles.length > 0 ? profiles.reduce((s, p) => s + p.totalSpent, 0) / profiles.length : 0

  const filteredProfiles = useMemo(() => {
    let list = selectedSegment ? profiles.filter(p => p.segment === selectedSegment) : profiles
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        (p.name || p.id).toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
      )
    }
    return [...list].sort((a, b) => {
      if (sort === 'totalSpent') return b.totalSpent - a.totalSpent
      if (sort === 'transactions') return b.transactionCount - a.transactionCount
      if (sort === 'lastVisit') return b.lastPurchase.getTime() - a.lastPurchase.getTime()
      return a.firstPurchase.getTime() - b.firstPurchase.getTime()
    })
  }, [profiles, selectedSegment, search, sort])

  const segmentData = useMemo(() => {
    return (['Regulars', 'Frequent', 'Occasional', 'One-Timers'] as CustomerSegment[]).map(seg => ({
      seg,
      count: profiles.filter(p => p.segment === seg).length,
      rev: profiles.filter(p => p.segment === seg).reduce((s, p) => s + p.totalSpent, 0),
    }))
  }, [profiles])

  const pareto = useMemo(() => {
    if (profiles.length === 0) return null
    const totalRev = profiles.reduce((s, p) => s + p.totalSpent, 0)
    if (totalRev === 0) return null
    const top20n = Math.max(1, Math.ceil(profiles.length * 0.2))
    // profiles are sorted by totalSpent desc from buildProfiles
    const top20rev = profiles.slice(0, top20n).reduce((s, p) => s + p.totalSpent, 0)
    return { pct: (top20rev / totalRev) * 100, count: top20n, total: profiles.length }
  }, [profiles])

  if (transactions.length === 0) {
    return <EmptyState title="No data" subtitle="Import transaction data to analyze customer frequency." />
  }

  if (identifiedCount === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-slate-100">Customer Frequency</h1>
        <div className="bg-slate-800/30 border border-slate-700/40 p-8 text-center">
          <p className="text-4xl mb-3">🙅</p>
          <h2 className="text-lg font-semibold text-slate-100 mb-2">No Customer IDs Found</h2>
          <p className="text-sm text-slate-200 max-w-md mx-auto">
            Customer IDs are found in Square CSV exports when customers have accounts.
            Cash and guest transactions won't have IDs.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-100">Customer Frequency</h1>
      <p className="text-sm text-slate-200 -mt-4">{identifiedPct}% of transactions have customer data</p>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-slate-800/30 border border-slate-700/40 p-4">
          <p className="text-xs text-slate-200">Identified Customers</p>
          <p className="text-xl font-bold text-slate-100 mt-1">{profiles.length}</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700/40 p-4">
          <p className="text-xs text-slate-200">Repeat Customers</p>
          <p className="text-xl font-bold text-slate-100 mt-1">
            {repeatCustomers} ({profiles.length ? Math.round(repeatCustomers / profiles.length * 100) : 0}%)
          </p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700/40 p-4">
          <p className="text-xs text-slate-200">Avg Lifetime Value</p>
          <p className="text-xl font-bold text-slate-100 mt-1 font-mono">{formatCurrency(avgCLV)}</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700/40 p-4">
          <p className="text-xs text-slate-200">Avg Transactions</p>
          <p className="text-xl font-bold text-slate-100 mt-1">
            {profiles.length ? (profiles.reduce((s, p) => s + p.transactionCount, 0) / profiles.length).toFixed(1) : '—'}
          </p>
        </div>
      </div>

      {pareto && (
        <div className="border border-teal-500/20 bg-teal-500/5 px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-400 mb-1">Pareto Insight</p>
            <p className="text-sm text-slate-100">
              Top <span className="text-teal-400 font-semibold">{pareto.count}</span> customers
              ({Math.round((pareto.count / pareto.total) * 100)}% of {pareto.total}) generate{' '}
              <span className="text-teal-400 font-semibold">{pareto.pct.toFixed(0)}%</span> of all customer revenue
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-mono font-bold text-teal-400">{pareto.pct.toFixed(0)}%</p>
            <p className="text-[10px] text-slate-200">from top {Math.round((pareto.count / pareto.total) * 100)}%</p>
          </div>
        </div>
      )}

      <div className="bg-slate-800/30 border border-slate-700/40 p-5">
        <h2 className="text-base font-semibold text-slate-100 mb-3">Customer Segments</h2>
        <div className="grid grid-cols-4 gap-3 mb-4">
          {segmentData.map(({ seg, count, rev }) => {
            const pct = profiles.length ? Math.round(count / profiles.length * 100) : 0
            const isSelected = selectedSegment === seg
            return (
              <button
                key={seg}
                onClick={() => setSelectedSegment(isSelected ? null : seg)}
                className={`text-left p-3 rounded-xl border-2 transition-colors ${isSelected ? 'border-current' : 'border-slate-700/50 hover:border-slate-700'}`}
                style={{ borderColor: isSelected ? SEGMENT_COLOR[seg] : undefined, backgroundColor: isSelected ? SEGMENT_COLOR[seg] + '18' : undefined }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SEGMENT_COLOR[seg] }} />
                  <span className="text-xs text-slate-200">{seg}</span>
                </div>
                <p className="text-xl font-bold text-slate-100">{count}</p>
                <p className="text-xs text-slate-200">{pct}% · {formatCurrency(rev)}</p>
              </button>
            )
          })}
        </div>
        {segmentData.some(s => s.rev > 0) && (
          <ResponsiveContainer width="100%" height={120}>
            <PieChart>
              <Pie data={segmentData.filter(s => s.rev > 0)} dataKey="rev" nameKey="seg" cx="50%" cy="50%" outerRadius={55} innerRadius={30}>
                {segmentData.map((s, i) => <Cell key={i} fill={SEGMENT_COLOR[s.seg]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      {retention.length > 0 && (
        <div className="bg-slate-800/30 border border-slate-700/40 p-5">
          <h2 className="text-base font-semibold text-slate-100 mb-1">Retention Curve</h2>
          <p className="text-xs text-slate-200 mb-4">
            Of customers who first purchased in a given month, what % returned the next month.
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={retention} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" label={{ value: 'Months After First Purchase', position: 'insideBottom', offset: -4, fontSize: 11 }} />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Line type="linear" dataKey="rate" stroke="#14B8A6" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/50 flex items-center gap-4 flex-wrap">
          <h2 className="text-base font-semibold text-slate-100 flex-1">
            {selectedSegment ? `${selectedSegment} (${filteredProfiles.length})` : `All Customers (${filteredProfiles.length})`}
          </h2>
          <input
            className="border border-slate-700 rounded-lg px-3 py-1.5 text-sm w-48"
            placeholder="Search name or ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className="border border-slate-700 rounded-lg px-3 py-1.5 text-sm"
            value={sort}
            onChange={e => setSort(e.target.value as CustomerSort)}
          >
            <option value="totalSpent">Total Spent</option>
            <option value="transactions">Transactions</option>
            <option value="lastVisit">Last Visit</option>
            <option value="firstVisit">First Visit</option>
          </select>
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-900 border-b border-slate-700/50">
              <tr>
                {['Name', 'Segment', 'Transactions', 'Total Spent', 'Avg Tx', 'Annual LTV', 'First', 'Last', 'Days Since', 'Fav Product'].map(h => (
                  <th key={h} className="px-4 py-2.5 font-semibold text-slate-200 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.map(p => (
                <tr
                  key={p.id}
                  className="border-b border-slate-800 hover:bg-slate-700/50 cursor-pointer"
                  onClick={() => setSelectedCustomer(selectedCustomer?.id === p.id ? null : p)}
                >
                  <td className="px-4 py-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: SEGMENT_COLOR[p.segment] + '80' }} />
                    <span className="font-medium text-slate-100 truncate max-w-32">{p.name || p.id}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: SEGMENT_COLOR[p.segment] + '20', color: SEGMENT_COLOR[p.segment] }}>
                      {p.segment}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-slate-100">{p.transactionCount}</td>
                  <td className="px-4 py-2 font-mono text-slate-100">{formatCurrency(p.totalSpent)}</td>
                  <td className="px-4 py-2 font-mono text-slate-100">{formatCurrency(p.avgTransaction)}</td>
                  <td className="px-4 py-2 font-mono text-teal-400/80">
                    {(() => {
                      const months = Math.max(1, differenceInMonths(p.lastPurchase, p.firstPurchase) + 1)
                      return formatCurrency((p.totalSpent / months) * 12)
                    })()}
                  </td>
                  <td className="px-4 py-2 font-mono text-slate-200">{format(p.firstPurchase, 'M/d/yy')}</td>
                  <td className="px-4 py-2 font-mono text-slate-200">{format(p.lastPurchase, 'M/d/yy')}</td>
                  <td className="px-4 py-2 font-mono" style={{ color: p.daysSinceLastVisit > 60 ? '#dc2626' : p.daysSinceLastVisit > 30 ? '#f97316' : '#374151' }}>
                    {p.daysSinceLastVisit}
                  </td>
                  <td className="px-4 py-2 text-slate-200 truncate max-w-32">{p.favoriteProduct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedCustomer && (
        <div className="bg-slate-800/30 border border-slate-700/40 p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">{selectedCustomer.name || selectedCustomer.id}</h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: SEGMENT_COLOR[selectedCustomer.segment] + '20', color: SEGMENT_COLOR[selectedCustomer.segment] }}>
                {selectedCustomer.segment}
              </span>
            </div>
            <button onClick={() => setSelectedCustomer(null)} className="text-slate-200 hover:text-slate-200 text-lg">×</button>
          </div>
          <div className="grid grid-cols-4 gap-4 mb-5">
            {[
              { label: 'Total Spent', value: formatCurrency(selectedCustomer.totalSpent) },
              { label: 'Transactions', value: selectedCustomer.transactionCount },
              { label: 'Avg Transaction', value: formatCurrency(selectedCustomer.avgTransaction) },
              { label: 'Favorite Product', value: selectedCustomer.favoriteProduct },
            ].map(c => (
              <div key={c.label}>
                <p className="text-xs text-slate-200">{c.label}</p>
                <p className="font-semibold text-sm text-slate-100 mt-0.5">{c.value}</p>
              </div>
            ))}
          </div>
          {selectedCustomer.monthlySpending.length > 0 && (
            <>
              <p className="text-sm font-medium text-slate-100 mb-2">Spending Over Time</p>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={selectedCustomer.monthlySpending} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={v => `$${v}`} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="amount" fill="#14B8A6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      )}
    </div>
  )
}
