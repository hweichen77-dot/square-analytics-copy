import { useMemo, useState } from 'react'
import { useAllTransactions, useCatalogueProducts, useStoreEvents } from '../db/useTransactions'
import { generatePurchaseOrder } from '../engine/purchaseOrderEngine'
import { computeProductStats, productVelocity } from '../engine/analyticsEngine'
import { EmptyState } from '../components/ui/EmptyState'
import { formatCurrency } from '../utils/format'
import type { PurchaseOrderItem } from '../engine/purchaseOrderEngine'
import { utils, writeFile } from 'xlsx'
import { format } from 'date-fns'

const PERIOD_OPTIONS = [
  { label: '1 week',  weeks: 1 },
  { label: '2 weeks', weeks: 2 },
  { label: '3 weeks', weeks: 3 },
  { label: '4 weeks', weeks: 4 },
  { label: '6 weeks', weeks: 6 },
  { label: '8 weeks', weeks: 8 },
]

const CATEGORY_COLORS: Record<string, string> = {
  Food:           'bg-orange-500/15 text-orange-400',
  Drinks:         'bg-teal-500/15 text-teal-400',
  'Ice Cream':    'bg-emerald-500/15 text-emerald-400',
  'Ramen/Hot Food': 'bg-red-500/15 text-red-400',
  Merch:          'bg-slate-700 text-slate-400',
  Other:          'bg-slate-700 text-slate-400',
}

function categoryClass(cat: string) {
  return CATEGORY_COLORS[cat] ?? 'bg-slate-700 text-slate-400'
}

function seasonLabel(month: number) {
  if (month >= 8 && month <= 9)   return 'Back to School'
  if (month >= 10 && month <= 11) return 'Fall'
  if (month === 12)               return 'Winter Holiday'
  if (month >= 1 && month <= 2)   return 'Winter'
  if (month === 3)                return 'Spring'
  if (month >= 4 && month <= 5)   return 'Spring / Events'
  return 'Summer'
}

function exportToXLSX(items: PurchaseOrderItem[], qtyOverrides: Record<string, number>) {
  const rows = items.map(item => {
    const qty = qtyOverrides[item.productName] ?? item.recommendedQty
    return {
      Product: item.productName,
      Category: item.category,
      'Weekly Velocity': (item.avgDailyVelocity * 7).toFixed(2),
      'Recommended Qty': qty,
      'Avg Price': item.avgPrice.toFixed(2),
      'Est. Revenue': (item.avgPrice * qty).toFixed(2),
      Reasoning: item.reasoning,
    }
  })
  const ws = utils.json_to_sheet(rows)
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, 'Purchase Order')
  writeFile(wb, `PurchaseOrder-${format(new Date(), 'yyyy-MM-dd')}.xlsx`)
}

// SVG icon helpers
function IconBox() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>
    </svg>
  )
}
function IconDollar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  )
}
function IconCalendar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}
function IconLeaf() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 22c1.25-1.25 2.65-2.25 4.2-2.8C8.25 18.6 10.55 18 13 18c2.75 0 5.5.5 7.5 1.5"/><path d="M20 8c-2.5 0-5 1-6 3-1-2-3.5-3-6-3C4.5 8 2 11 2 14c0 3 2.5 5 5 5 2.5 0 4.5-1 6-3 1.5 2 3.5 3 6 3 2.5 0 5-2 5-5 0-3-2.5-6-4-6z"/>
    </svg>
  )
}

export default function PurchaseOrderView() {
  const transactions = useAllTransactions()
  const catalogueProducts = useCatalogueProducts()
  const events = useStoreEvents()

  const [selectedWeeks, setSelectedWeeks] = useState<number>(2)
  const [generated, setGenerated] = useState(false)

  const [onlyNeedingReorder, setOnlyNeedingReorder] = useState(false)
  const [includeMerch, setIncludeMerch] = useState(false)
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({})
  const [sortKey, setSortKey] = useState<'productName' | 'avgDailyVelocity' | 'recommendedQty' | 'estimatedRevenue'>('estimatedRevenue')
  const [sortDesc, setSortDesc] = useState(true)

  const overrides = useMemo(() => ({}), [])

  // Pre-generate velocity preview (top items by weekly velocity)
  const { velocityPreview, totalProductCount } = useMemo(() => {
    const stats = computeProductStats(transactions)
    const sorted = [...stats].sort((a, b) => productVelocity(b) - productVelocity(a))
    return {
      totalProductCount: stats.length,
      velocityPreview: sorted.slice(0, 8).map(p => ({
        name: p.name,
        weeklyVelocity: productVelocity(p) * 7,
        revenue: p.totalRevenue,
      })),
    }
  }, [transactions])

  const orderItems = useMemo(
    () => generated ? generatePurchaseOrder(transactions, events, [], overrides, selectedWeeks) : [],
    [generated, transactions, events, overrides, selectedWeeks],
  )

  const displayItems = useMemo(() => {
    let items = orderItems.map(item => {
      const qty = qtyOverrides[item.productName] ?? item.recommendedQty
      return { ...item, recommendedQty: qty, estimatedRevenue: item.avgPrice * qty }
    })
    if (!includeMerch) {
      items = items.filter(item => item.category !== 'Merch' && item.category !== 'Other')
    }
    if (onlyNeedingReorder) {
      const catQty = Object.fromEntries(catalogueProducts.filter(p => p.quantity !== null).map(p => [p.name, p.quantity!]))
      items = items.filter(item => {
        const stock = catQty[item.productName]
        return stock === undefined || item.recommendedQty > stock
      })
    }
    return [...items].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'string' && typeof bv === 'string') return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv)
      return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number)
    })
  }, [orderItems, qtyOverrides, onlyNeedingReorder, includeMerch, catalogueProducts, sortKey, sortDesc])

  const totalItemCount    = useMemo(() => displayItems.reduce((s, i) => s + i.recommendedQty, 0), [displayItems])
  const totalRevenue      = useMemo(() => displayItems.reduce((s, i) => s + i.avgPrice * i.recommendedQty, 0), [displayItems])
  const categorySubtotals = useMemo(() => {
    const g: Record<string, { qty: number; rev: number }> = {}
    for (const item of displayItems) {
      if (!g[item.category]) g[item.category] = { qty: 0, rev: 0 }
      g[item.category].qty += item.recommendedQty
      g[item.category].rev += item.avgPrice * item.recommendedQty
    }
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b))
  }, [displayItems])

  const upcomingEvents = useMemo(() => {
    const now = new Date()
    const twoWeeks = new Date(now.getTime() + 14 * 86_400_000)
    return events.filter(e =>
      (e.startDate >= now && e.startDate <= twoWeeks) ||
      (e.endDate   >= now && e.endDate   <= twoWeeks) ||
      (e.startDate <= now && e.endDate   >= now),
    )
  }, [events])

  const currentMonth   = new Date().getMonth() + 1
  const dateRangeLabel = `${format(new Date(), 'MMM d')} – ${format(new Date(Date.now() + selectedWeeks * 7 * 86_400_000), 'MMM d, yyyy')}`

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDesc(d => !d)
    else { setSortKey(key); setSortDesc(true) }
  }

  const sortArrow = (key: typeof sortKey) => sortKey === key ? (sortDesc ? ' ↓' : ' ↑') : ''

  if (transactions.length === 0) {
    return <EmptyState title="No transaction data" subtitle="Import your sales data to generate purchase recommendations." />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-100">Purchase Order</h1>
        {generated && (
          <button
            onClick={() => exportToXLSX(displayItems, qtyOverrides)}
            disabled={displayItems.length === 0}
            className="px-4 py-2 text-sm bg-teal-500 text-slate-950 rounded-lg hover:bg-teal-600 disabled:opacity-40 font-semibold transition-colors cursor-pointer"
          >
            Export XLSX
          </button>
        )}
      </div>

      {/* ── Period selector card ── */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-slate-200 mb-1">Select time period to order for</h2>
        <p className="text-xs text-slate-500 mb-5">
          The report will recommend quantities based on sales velocity over your full transaction history,
          scaled to cover the selected period.
        </p>

        <div className="flex flex-wrap gap-2 mb-6">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.weeks}
              onClick={() => { setSelectedWeeks(opt.weeks); setGenerated(false) }}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors cursor-pointer ${
                selectedWeeks === opt.weeks
                  ? 'bg-teal-500 text-slate-950 border-teal-500'
                  : 'border-slate-600 text-slate-400 hover:border-teal-500/50 hover:text-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => { setGenerated(true); setQtyOverrides({}) }}
            className="px-6 py-2.5 bg-teal-500 text-slate-950 rounded-lg text-sm font-bold hover:bg-teal-400 transition-colors cursor-pointer"
          >
            Generate Report
          </button>
          <p className="text-xs text-slate-500">
            {selectedWeeks}-week window · {dateRangeLabel}
          </p>
        </div>
      </div>

      {/* ── Pre-generate velocity preview ── */}
      {!generated && velocityPreview.length > 0 && (
        <div className="space-y-4">
          {/* Quick stat strip */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <p className="text-xs text-slate-500">Products Tracked</p>
              <p className="text-2xl font-bold text-slate-100 mt-1">{totalProductCount}</p>
              <p className="text-xs text-slate-500 mt-0.5">in transaction history</p>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <p className="text-xs text-slate-500">Top Velocity Item</p>
              <p className="text-sm font-bold text-teal-400 mt-1 truncate">{velocityPreview[0]?.name ?? '—'}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {velocityPreview[0] ? `${velocityPreview[0].weeklyVelocity.toFixed(1)} units/wk` : ''}
              </p>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <p className="text-xs text-slate-500">Projected Units ({selectedWeeks}wk)</p>
              <p className="text-2xl font-bold text-slate-100 mt-1">
                {velocityPreview.reduce((s, p) => s + Math.ceil(p.weeklyVelocity * selectedWeeks), 0)}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">top 8 items combined</p>
            </div>
          </div>

          {/* Top items velocity preview */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-200">Velocity Preview</h2>
                <p className="text-xs text-slate-500 mt-0.5">Top 8 items by weekly sales — likely candidates for reorder</p>
              </div>
              <span className="text-xs text-slate-500 bg-slate-700/50 px-2 py-1 rounded-lg">
                {selectedWeeks}-week window
              </span>
            </div>
            <div className="divide-y divide-slate-700/30">
              {velocityPreview.map((item, i) => {
                const maxVel = velocityPreview[0].weeklyVelocity
                const barWidth = maxVel > 0 ? (item.weeklyVelocity / maxVel) * 100 : 0
                const projectedQty = Math.ceil(item.weeklyVelocity * selectedWeeks)
                return (
                  <div key={item.name} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-700/20 transition-colors">
                    <span className="text-sm font-bold text-slate-600 w-5 shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-200 truncate">{item.name}</p>
                      <div className="mt-1.5 h-1.5 bg-slate-700 rounded-full overflow-hidden w-full">
                        <div className="h-full rounded-full bg-teal-500/60" style={{ width: `${barWidth}%` }} />
                      </div>
                    </div>
                    <div className="text-right shrink-0 min-w-[100px]">
                      <p className="text-sm font-semibold text-slate-100">{item.weeklyVelocity.toFixed(1)} <span className="text-xs font-normal text-slate-500">/wk</span></p>
                      <p className="text-xs text-slate-500">~{projectedQty} units for {selectedWeeks}wk</p>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="px-5 py-3 bg-slate-900/40 border-t border-slate-700/50">
              <p className="text-xs text-slate-500">
                Click <span className="text-teal-400 font-medium">Generate Report</span> above to build the full order with seasonal adjustments, low-stock flags, and XLSX export.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Report content (only after Generate is clicked) ── */}
      {generated && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
                <IconBox />
              </div>
              <div>
                <p className="text-xs text-slate-500">Items to Order</p>
                <p className="text-xl font-bold text-slate-100">{displayItems.length} products</p>
                <p className="text-xs text-slate-500">{totalItemCount} total units</p>
              </div>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <IconDollar />
              </div>
              <div>
                <p className="text-xs text-slate-500">Estimated Revenue</p>
                <p className="text-xl font-bold text-slate-100">{formatCurrency(totalRevenue)}</p>
                <p className="text-xs text-slate-500">at avg sell price</p>
              </div>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <IconCalendar />
              </div>
              <div>
                <p className="text-xs text-slate-500">Generated For</p>
                <p className="text-xl font-bold text-slate-100">{selectedWeeks}-Week Window</p>
                <p className="text-xs text-slate-500">{dateRangeLabel}</p>
              </div>
            </div>
          </div>

          {/* Season / events banner */}
          <div className="bg-teal-500/10 border border-teal-500/20 rounded-xl p-4 flex items-start gap-3">
            <div className="text-teal-400 mt-0.5">
              <IconLeaf />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm text-slate-200">
                Upcoming Season: {seasonLabel(currentMonth)}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Recommendations account for seasonal demand patterns and upcoming events.
              </p>
            </div>
            {upcomingEvents.length > 0 && (
              <span className="text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full">
                {upcomingEvents.length} upcoming event{upcomingEvents.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Filter + count */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={onlyNeedingReorder}
                  onChange={e => setOnlyNeedingReorder(e.target.checked)}
                  className="rounded accent-teal-500"
                />
                Only show items needing reorder
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeMerch}
                  onChange={e => setIncludeMerch(e.target.checked)}
                  className="rounded accent-teal-500"
                />
                Include Merch / Other
              </label>
            </div>
            <p className="text-xs text-slate-500">{displayItems.length} of {orderItems.length} items</p>
          </div>

          {/* Main table */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-900 border-b border-slate-700/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-500 cursor-pointer hover:text-slate-300 select-none"
                      onClick={() => toggleSort('productName')}>Product{sortArrow('productName')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-500 cursor-pointer hover:text-slate-300 select-none"
                      onClick={() => toggleSort('avgDailyVelocity')}>Wkly Velocity{sortArrow('avgDailyVelocity')}</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-500 cursor-pointer hover:text-slate-300 select-none"
                      onClick={() => toggleSort('recommendedQty')}>Rec. Qty{sortArrow('recommendedQty')}</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-500 cursor-pointer hover:text-slate-300 select-none"
                      onClick={() => toggleSort('estimatedRevenue')}>Est. Revenue{sortArrow('estimatedRevenue')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-500">Reasoning</th>
                  </tr>
                </thead>
                <tbody>
                  {displayItems.map((item, idx) => {
                    const qty = qtyOverrides[item.productName] ?? item.recommendedQty
                    return (
                      <tr key={item.productName} className={`border-b border-slate-700/30 hover:bg-slate-700/30 ${idx % 2 === 1 ? 'bg-slate-800/40' : ''}`}>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-100">{item.productName}</div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium mt-0.5 inline-block ${categoryClass(item.category)}`}>
                            {item.category}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-300">
                          {(item.avgDailyVelocity * 7).toFixed(1)}<span className="text-slate-600"> /wk</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <input
                            type="number"
                            className="border border-slate-600 rounded px-2 py-0.5 text-xs w-16 text-right font-mono bg-slate-700/50 text-slate-200"
                            value={qty}
                            onChange={e => {
                              const v = parseInt(e.target.value, 10)
                              if (!isNaN(v) && v >= 0) {
                                setQtyOverrides(prev => ({ ...prev, [item.productName]: v }))
                              }
                            }}
                            min={0}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-100">
                          {formatCurrency(item.avgPrice * qty)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 max-w-48 truncate">
                          {item.reasoning}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Category subtotals */}
          {categorySubtotals.length > 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-4">Category Subtotals</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {categorySubtotals.map(([cat, { qty, rev }]) => (
                  <div key={cat} className="flex items-center justify-between p-3 bg-slate-900 rounded-xl">
                    <div>
                      <p className="font-semibold text-sm text-slate-200">{cat}</p>
                      <p className="text-xs text-slate-500">{qty} units</p>
                    </div>
                    <p className="font-mono text-sm text-slate-300">{formatCurrency(rev)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
