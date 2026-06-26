import { useState, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCategoryOverrides } from '../db/useTransactions'
import { db } from '../db/database'
import { productTrend, isSlowMover } from '../engine/analyticsEngine'
import { useAnalytics } from '../context/AnalyticsContext'
import { ALL_CATEGORY_NAMES } from '../engine/categoryClassifier'
import { EmptyState } from '../components/ui/EmptyState'
import { CategoryBadge } from '../components/ui/Badge'
import { formatCurrency, formatNumber } from '../utils/format'
import { useToastStore } from '../store/toastStore'
import { splitItemVariation } from '../types/models'
import type { SalesTransaction } from '../types/models'
import type { ProductStats } from '../engine/analyticsEngine'

function exportTransactionsCSV(transactions: SalesTransaction[]) {
  const headers = ['Date', 'Staff', 'Item', 'Net Sales', 'Payment Method', 'Customer']
  const sanitize = (v: string) => /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  const escape = (v: string) => `"${sanitize(String(v)).replace(/"/g, '""')}"`
  const rows = transactions.map(t => [
    (t.date instanceof Date ? t.date : new Date(t.date)).toISOString().slice(0, 10),
    t.staffName,
    t.itemDescription,
    t.netSales.toFixed(2),
    t.paymentMethod,
    t.customerName ?? '',
  ])
  const csv = [headers, ...rows].map(r => r.map(v => escape(String(v))).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `walleys-transactions-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

interface ItemGroup {
  itemName: string
  variations: ProductStats[]
  totalUnits: number
  totalRevenue: number
  avgMarketPrice: number
  category: string
  trend: 'Growing' | 'Declining' | 'Stable'
  hasSlow: boolean
}

function parseTrend(p: ProductStats): 'Growing' | 'Declining' | 'Stable' {
  return productTrend(p) as 'Growing' | 'Declining' | 'Stable'
}

function groupStats(stats: ProductStats[]): ItemGroup[] {
  const map = new Map<string, ProductStats[]>()
  for (const p of stats) {
    const { itemName } = splitItemVariation(p.name)
    if (!map.has(itemName)) map.set(itemName, [])
    map.get(itemName)!.push(p)
  }
  return Array.from(map.entries()).map(([itemName, vars]) => {
    const totalUnits   = vars.reduce((s, v) => s + v.totalUnitsSold, 0)
    const totalRevenue = vars.reduce((s, v) => s + v.totalRevenue, 0)
    const avgMarketPrice = totalUnits > 0 ? totalRevenue / totalUnits : 0
    const trends = vars.map(v => parseTrend(v))
    const trend: ItemGroup['trend'] = trends.includes('Growing') ? 'Growing'
      : trends.includes('Declining') ? 'Declining' : 'Stable'
    return {
      itemName,
      variations: vars,
      totalUnits,
      totalRevenue,
      avgMarketPrice,
      category: vars[0]?.category ?? '',
      trend,
      hasSlow: vars.some(v => isSlowMover(v)),
    }
  }).sort((a, b) => b.totalRevenue - a.totalRevenue)
}

function TrendBadge({ trend }: { trend: ItemGroup['trend'] }) {
  if (trend === 'Growing') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 15l-6-6-6 6" /></svg>
      Up
    </span>
  )
  if (trend === 'Declining') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>
      Down
    </span>
  )
  return <span className="text-xs text-slate-200">→</span>
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
      className={`transition-transform duration-200 shrink-0 text-slate-200 ${open ? 'rotate-90' : ''}`}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

export default function InventoryView() {
  const { transactions, productStats: stats } = useAnalytics()
  const overrides     = useCategoryOverrides()
  const navigate      = useNavigate()
  const { show }      = useToastStore()

  const [search, setSearch]           = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [expandedItems, setExpandedItems]   = useState<Set<string>>(new Set())
  const [ctxMenu, setCtxMenu]         = useState<{ x: number; y: number; name: string } | null>(null)

  const itemGroups = useMemo(() => groupStats(stats), [stats])

  const filteredGroups = useMemo(() => {
    const q = search.toLowerCase()
    return itemGroups.filter(g => {
      if (categoryFilter !== 'All' && g.category !== categoryFilter) return false
      if (q && !g.itemName.toLowerCase().includes(q) && !g.variations.some(v => v.name.toLowerCase().includes(q))) return false
      return true
    })
  }, [itemGroups, search, categoryFilter])

  const topItem       = itemGroups[0]
  const totalRevenue  = stats.reduce((s, p) => s + p.totalRevenue, 0)
  const totalUnits    = stats.reduce((s, p) => s + p.totalUnitsSold, 0)
  const growingCount  = itemGroups.filter(g => g.trend === 'Growing').length
  const slowCount     = stats.filter(p => isSlowMover(p)).length

  async function setOverride(productName: string, category: string) {
    const existing = overrides.find((o: { productName: string }) => o.productName === productName)
    if (existing) await db.categoryOverrides.update(existing.id!, { category })
    else await db.categoryOverrides.add({ productName, category })
    show(`Set "${productName}" → ${category}`, 'success')
    setCtxMenu(null)
  }

  function toggleExpand(itemName: string) {
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(itemName)) next.delete(itemName)
      else next.add(itemName)
      return next
    })
  }

  if (transactions.length === 0) {
    return <EmptyState title="No transaction data" subtitle="Import sales data to see your inventory analytics." />
  }

  return (
    <div className="space-y-5" onClick={() => setCtxMenu(null)}>
      <h1 className="text-xl font-bold text-slate-100">Transactions</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-800/30 border border-slate-700/40 px-4 py-3">
          <p className="text-xl font-bold text-teal-400">{formatCurrency(totalRevenue)}</p>
          <p className="text-xs text-slate-200 mt-0.5">Total revenue</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700/40 px-4 py-3">
          <p className="text-xl font-bold text-slate-200">{formatNumber(totalUnits)}</p>
          <p className="text-xs text-slate-200 mt-0.5">Units sold</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700/40 px-4 py-3">
          <p className="text-xl font-bold text-emerald-400">{growingCount}</p>
          <p className="text-xs text-slate-200 mt-0.5">Growing items</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700/40 px-4 py-3">
          {topItem ? (
            <>
              <p className="text-sm font-semibold text-slate-100 truncate">{topItem.itemName}</p>
              <p className="text-xs text-slate-200 mt-0.5">Top seller · {formatCurrency(topItem.totalRevenue)}</p>
            </>
          ) : (
            <>
              <p className="text-xl font-bold text-orange-400">{slowCount}</p>
              <p className="text-xs text-slate-200 mt-0.5">Slow movers</p>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search product…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
        />
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 cursor-pointer"
        >
          <option value="All">All categories</option>
          {ALL_CATEGORY_NAMES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-sm text-slate-200 self-center">
          {filteredGroups.length} items · {filteredGroups.reduce((s, g) => s + g.variations.length, 0)} variations
        </span>
        <button
          onClick={() => exportTransactionsCSV(transactions)}
          className="ml-auto px-3 py-2 bg-slate-700 border border-slate-600 text-slate-100 rounded-lg text-sm font-medium hover:bg-slate-600 transition-colors"
        >
          Export CSV
        </button>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 uppercase text-xs border-b border-slate-700/60">
              <tr>
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3 text-left">Product</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-right">Units</th>
                <th className="px-4 py-3 text-right">Revenue</th>
                <th className="px-4 py-3 text-right">Avg Price</th>
                <th className="px-4 py-3 text-center">Trend</th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map(group => {
                const isOpen    = expandedItems.has(group.itemName)
                const multiVar  = group.variations.length > 1

                return (
                  <Fragment key={group.itemName}>
                    <tr
                      className={`border-b border-slate-700/30 transition-colors ${
                        multiVar ? 'cursor-pointer hover:bg-slate-700/40' : 'cursor-pointer hover:bg-slate-700/30'
                      } ${isOpen ? 'bg-slate-700/20' : ''}`}
                      onClick={() => {
                        if (multiVar) toggleExpand(group.itemName)
                        else navigate(`/inventory/${encodeURIComponent(group.variations[0].name)}`)
                      }}
                      onContextMenu={e => {
                        e.preventDefault()
                        if (!multiVar) setCtxMenu({ x: e.clientX, y: e.clientY, name: group.variations[0].name })
                      }}
                    >
                      <td className="px-4 py-3 text-slate-200">
                        {multiVar ? <Chevron open={isOpen} /> : <span className="w-3.5 inline-block" />}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-100">
                        <div className="flex items-center gap-2">
                          {group.itemName}
                          {multiVar && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-500/15 text-teal-400 border border-teal-500/25">
                              {group.variations.length} vars
                            </span>
                          )}
                          {group.hasSlow && <span className="text-xs text-orange-400">slow</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3"><CategoryBadge category={group.category} /></td>
                      <td className="px-4 py-3 text-right text-slate-200 tabular-nums">{formatNumber(group.totalUnits)}</td>
                      <td className="px-4 py-3 text-right text-slate-100 font-semibold tabular-nums">{formatCurrency(group.totalRevenue)}</td>
                      <td className="px-4 py-3 text-right text-slate-200 tabular-nums">{formatCurrency(group.avgMarketPrice)}</td>
                      <td className="px-4 py-3 text-center"><TrendBadge trend={group.trend} /></td>
                    </tr>

                    {isOpen && group.variations.map(v => {
                      const vt = parseTrend(v)
                      return (
                        <tr
                          key={`var-${v.name}`}
                          className="border-b border-slate-700/20 bg-slate-900/60 hover:bg-slate-700/30 transition-colors cursor-pointer"
                          onClick={e => { e.stopPropagation(); navigate(`/inventory/${encodeURIComponent(v.name)}`) }}
                          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, name: v.name }) }}
                        >
                          <td className="px-4 py-2.5" />
                          <td className="px-4 py-2.5 pl-10">
                            <div className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />
                              <span className="text-slate-100 text-xs">
                                {splitItemVariation(v.name).variationName}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5"><CategoryBadge category={v.category} /></td>
                          <td className="px-4 py-2.5 text-right text-slate-200 text-xs tabular-nums">{formatNumber(v.totalUnitsSold)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-100 text-xs tabular-nums">{formatCurrency(v.totalRevenue)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-200 text-xs tabular-nums">{formatCurrency(v.avgPrice)}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={vt === 'Growing' ? 'text-emerald-400' : vt === 'Declining' ? 'text-red-400' : 'text-slate-200'}>
                              {vt === 'Growing' ? '↑' : vt === 'Declining' ? '↓' : '→'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        {filteredGroups.length === 0 && (
          <div className="text-center py-12 text-slate-200 text-sm">No products match your filters.</div>
        )}
      </div>

      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setCtxMenu(null)} />
          <div
            className="fixed z-20 bg-slate-800/30 border border-slate-700/40 shadow-xl py-1 min-w-44"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onClick={e => e.stopPropagation()}
          >
            <p className="px-3 py-1 text-xs text-slate-200 font-medium uppercase tracking-wider">Set category</p>
            {ALL_CATEGORY_NAMES.map(cat => (
              <button
                key={cat}
                onClick={() => setOverride(ctxMenu.name, cat)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-700/50 transition-colors cursor-pointer"
              >
                {cat}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
