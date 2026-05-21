import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useStaffWages } from '../db/useTransactions'
import { useAnalytics } from '../context/AnalyticsContext'
import { EmptyState } from '../components/ui/EmptyState'
import { formatCurrency, formatNumber } from '../utils/format'
import { format } from 'date-fns'
import { upsertStaffWage } from '../db/dbUtils'
import type { SalesTransaction } from '../types/models'

function estimateShiftHours(txs: SalesTransaction[]): number {
  const byDate: Record<string, number[]> = {}
  for (const tx of txs) {
    const key = format(tx.date, 'yyyy-MM-dd')
    if (!byDate[key]) byDate[key] = []
    byDate[key].push(tx.hour)
  }
  let total = 0
  for (const hours of Object.values(byDate)) {
    const mn = Math.min(...hours)
    const mx = Math.max(...hours)
    total += Math.max(0.5, mx - mn + 0.5)
  }
  return total
}

export default function StaffView() {
  const { transactions, staffStats } = useAnalytics()
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null)
  const [editingWage, setEditingWage] = useState<string | null>(null)
  const [wageInput, setWageInput] = useState('')
  const wages = useStaffWages()
  const wageMap = useMemo(() => new Map(wages.map(w => [w.staffName, w.hourlyWage])), [wages])
  const totalRevenue = useMemo(() => staffStats.reduce((s, x) => s + x.totalSales, 0), [staffStats])

  const roiData = useMemo(() => {
    return staffStats.map(s => {
      const staffTxs = transactions.filter(t => (t.staffName.trim() || 'Unknown') === s.name)
      const hours = estimateShiftHours(staffTxs)
      const wage = wageMap.get(s.name) ?? null
      const wageCost = wage != null ? wage * hours : null
      const netROI = wageCost != null ? s.totalSales - wageCost : null
      const revenuePerHour = hours > 0 ? s.totalSales / hours : null
      return { ...s, hours, wage, wageCost, netROI, revenuePerHour }
    })
  }, [staffStats, transactions, wageMap])

  // Build per-staff transaction lists for the expanded view.
  const txByStaff = useMemo(() => {
    const map: Record<string, typeof transactions> = {}
    for (const tx of transactions) {
      const name = tx.staffName.trim() || 'Unknown'
      if (!map[name]) map[name] = []
      map[name].push(tx)
    }
    // Sort each list newest first.
    for (const name of Object.keys(map)) {
      map[name].sort((a, b) => b.date.getTime() - a.date.getTime())
    }
    return map
  }, [transactions])

  if (transactions.length === 0) {
    return <EmptyState title="No data" subtitle="Import CSV data to see staff performance." />
  }

  if (staffStats.length === 0) {
    return <EmptyState title="No staff data" subtitle="No staff names found in the imported transactions." />
  }

  const chartData = [...staffStats].reverse()

  function initials(name: string) {
    if (name === 'Unknown') return '?'
    return name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').slice(0, 2).join('')
  }

  const AVATAR_COLORS = [
    'bg-teal-500/100', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500',
    'bg-violet-500', 'bg-cyan-500', 'bg-pink-500', 'bg-teal-500',
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-100">Staff Performance</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800/30 border border-slate-700/40 p-4">
          <p className="text-xs text-slate-200">Staff Members</p>
          <p className="text-xl font-bold text-slate-100 mt-1">{staffStats.length}</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700/40 p-4">
          <p className="text-xs text-slate-200">Total Revenue</p>
          <p className="text-xl font-bold text-slate-100 mt-1">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700/40 p-4">
          <p className="text-xs text-slate-200">Total Transactions</p>
          <p className="text-xl font-bold text-slate-100 mt-1">{formatNumber(transactions.length)}</p>
        </div>
      </div>

      {/* Leaderboard */}
      {staffStats.length > 0 && (
        <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700/50">
            <h2 className="text-base font-semibold text-slate-100">Leaderboard</h2>
          </div>
          <div className="divide-y divide-slate-700/30">
            {staffStats.map((s, i) => {
              const avg = s.transactionCount > 0 ? s.totalSales / s.transactionCount : 0
              const share = totalRevenue > 0 ? (s.totalSales / totalRevenue) * 100 : 0
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
              return (
                <div key={s.name} className="flex items-center gap-4 px-5 py-3">
                  <span className="w-6 text-center shrink-0">
                    {medal ?? <span className="text-xs font-mono text-slate-300">{i + 1}</span>}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-100 truncate">{s.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="h-1 bg-slate-700/60 rounded-full w-24">
                        <div className="h-1 bg-teal-500 rounded-full" style={{ width: `${share}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-300">{share.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-8 shrink-0 text-right">
                    <div>
                      <p className="text-[10px] text-slate-200">Revenue</p>
                      <p className="text-sm font-mono font-semibold text-slate-100">{formatCurrency(s.totalSales)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-200">Transactions</p>
                      <p className="text-sm font-mono text-slate-100">{formatNumber(s.transactionCount)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-200">Avg Sale</p>
                      <p className="text-sm font-mono text-slate-200">{formatCurrency(avg)}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ROI Table */}
      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Staff ROI</h2>
            <p className="text-xs text-slate-200 mt-0.5">Hours estimated from first → last transaction per shift. Enter wage to see net ROI.</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50 text-left">
                <th className="px-5 py-3 text-xs font-semibold text-slate-200">Staff</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-200 text-right">Revenue</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-200 text-right">Est. Hours</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-200 text-right">Rev/hr</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-200 text-center">Wage/hr</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-200 text-right">Wage Cost</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-200 text-right">Net ROI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {roiData.map(s => {
                const isEditing = editingWage === s.name
                return (
                  <tr key={s.name} className="hover:bg-slate-700/20">
                    <td className="px-5 py-3 font-medium text-slate-200">{s.name}</td>
                    <td className="px-4 py-3 font-mono text-slate-100 text-right">{formatCurrency(s.totalSales)}</td>
                    <td className="px-4 py-3 font-mono text-slate-200 text-right">{s.hours.toFixed(1)}h</td>
                    <td className="px-4 py-3 font-mono text-slate-100 text-right">
                      {s.revenuePerHour != null ? formatCurrency(s.revenuePerHour) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isEditing ? (
                        <form
                          className="flex items-center gap-1 justify-center"
                          onSubmit={async e => {
                            e.preventDefault()
                            const v = parseFloat(wageInput)
                            if (!isNaN(v) && v > 0) await upsertStaffWage(s.name, v)
                            setEditingWage(null)
                          }}
                        >
                          <input
                            autoFocus
                            type="number"
                            value={wageInput}
                            onChange={e => setWageInput(e.target.value)}
                            className="w-16 bg-slate-900 border border-teal-500/50 px-2 py-0.5 text-xs text-slate-200 font-mono text-right focus:outline-none focus-visible:border-teal-400"
                            placeholder="0.00"
                          />
                          <button type="submit" className="text-xs text-teal-400 hover:text-teal-300 px-1">✓</button>
                          <button type="button" onClick={() => setEditingWage(null)} className="text-xs text-slate-200 hover:text-slate-300">✕</button>
                        </form>
                      ) : (
                        <button
                          onClick={() => { setEditingWage(s.name); setWageInput(s.wage?.toString() ?? '') }}
                          className={`font-mono text-xs px-2 py-0.5 border border-transparent hover:border-slate-600 hover:bg-slate-700/40 rounded ${
                            s.wage != null ? 'text-slate-100' : 'text-slate-200 hover:text-slate-200'
                          }`}
                        >
                          {s.wage != null ? `$${s.wage.toFixed(2)}` : '+ Add'}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-200 text-right">
                      {s.wageCost != null ? formatCurrency(s.wageCost) : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-right">
                      {s.netROI != null ? (
                        <span className={s.netROI >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {formatCurrency(s.netROI)}
                        </span>
                      ) : (
                        <span className="text-slate-200 text-xs">enter wage</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 p-5">
        <h2 className="text-base font-semibold text-slate-100 mb-4">Revenue by Staff Member</h2>
        <ResponsiveContainer width="100%" height={Math.max(200, staffStats.length * 40)}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 60, left: 16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 11 }}
            />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Bar dataKey="totalSales" radius={[0, 3, 3, 0]} label={{ position: 'right', formatter: (v: number) => `$${Math.round(v)}`, fontSize: 10, fill: '#64748B' }}>
              {chartData.map((_, i) => (
                <Cell key={i} fill="#14B8A6" />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Staff breakdown with expandable transaction rows */}
      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/50">
          <h2 className="text-base font-semibold text-slate-100">Staff Breakdown</h2>
          <p className="text-xs text-slate-200 mt-0.5">Click a row to see individual transactions</p>
        </div>
        <div className="divide-y divide-slate-700/40">
          {staffStats.map((staff, idx) => {
            const avg = staff.transactionCount > 0 ? staff.totalSales / staff.transactionCount : 0
            const share = totalRevenue > 0 ? (staff.totalSales / totalRevenue) * 100 : 0
            const isExpanded = expandedStaff === staff.name
            const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length]
            const staffTxs = txByStaff[staff.name] ?? []

            return (
              <div key={staff.name}>
                <button
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-700/50 transition-colors text-left"
                  onClick={() => setExpandedStaff(isExpanded ? null : staff.name)}
                >
                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-full ${avatarColor} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                    {initials(staff.name)}
                  </div>

                  {/* Name + share bar */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-100 text-sm">{staff.name}</p>
                      {staff.name === 'Unknown' && (
                        <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-200 rounded-full">no name in CSV</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1.5 bg-slate-800 rounded-full max-w-32">
                        <div
                          className={`h-1.5 rounded-full ${avatarColor}`}
                          style={{ width: `${share}%`, opacity: 0.7 }}
                        />
                      </div>
                      <span className="text-xs text-slate-200">{share.toFixed(1)}% of revenue</span>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="hidden sm:flex items-center gap-8 shrink-0">
                    <div className="text-right">
                      <p className="text-xs text-slate-200">Transactions</p>
                      <p className="font-mono font-semibold text-sm text-slate-100">{formatNumber(staff.transactionCount)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-200">Total Sales</p>
                      <p className="font-mono font-semibold text-sm text-slate-100">{formatCurrency(staff.totalSales)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-200">Avg Sale</p>
                      <p className="font-mono text-sm text-slate-100">{formatCurrency(avg)}</p>
                    </div>
                  </div>

                  {/* Expand chevron */}
                  <span className="text-slate-200 text-sm shrink-0">{isExpanded ? '▲' : '▼'}</span>
                </button>

                {/* Expanded transactions */}
                {isExpanded && (
                  <div className="border-t border-slate-700/50 bg-slate-900">
                    <div className="px-5 py-3">
                      <p className="text-xs font-semibold text-slate-200 uppercase tracking-wide mb-2">
                        Recent Transactions — {staff.name}
                      </p>
                      {staffTxs.length === 0 ? (
                        <p className="text-xs text-slate-200">No transactions found.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-slate-700 text-left">
                                <th className="pb-2 font-semibold text-slate-200">Date</th>
                                <th className="pb-2 font-semibold text-slate-200">Staff</th>
                                <th className="pb-2 font-semibold text-slate-200">Items</th>
                                <th className="pb-2 font-semibold text-slate-200 text-right">Amount</th>
                                <th className="pb-2 font-semibold text-slate-200">Payment</th>
                              </tr>
                            </thead>
                            <tbody>
                              {staffTxs.slice(0, 20).map(tx => (
                                <tr key={tx.transactionID} className="border-b border-slate-700/50 hover:bg-slate-800">
                                  <td className="py-1.5 font-mono text-slate-200">{format(tx.date, 'MMM d, yyyy h:mm a')}</td>
                                  <td className="py-1.5">
                                    <span className="font-semibold text-slate-200">{tx.staffName.trim() || 'Unknown'}</span>
                                  </td>
                                  <td className="py-1.5 text-slate-200 max-w-56 truncate">{tx.itemDescription || '—'}</td>
                                  <td className="py-1.5 font-mono font-semibold text-slate-100 text-right">{formatCurrency(tx.netSales)}</td>
                                  <td className="py-1.5 text-slate-200">{tx.paymentMethod || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {staffTxs.length > 20 && (
                            <p className="text-xs text-slate-200 mt-2">Showing 20 of {staffTxs.length} transactions.</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
