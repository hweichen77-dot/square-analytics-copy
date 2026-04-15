import { useMemo, useState } from 'react'
import { useFilteredTransactions, useRestockLogs, useCatalogueProducts } from '../db/useTransactions'
import { useDateRangeStore } from '../store/dateRangeStore'
import { computeProductStats } from '../engine/analyticsEngine'
import { EmptyState } from '../components/ui/EmptyState'
import { db } from '../db/database'
import type { SalesTransaction, RestockLog, CatalogueProduct } from '../types/models'
import { startOfDay } from 'date-fns'
import { format } from 'date-fns'

type UrgencyTier = 'outOfStock' | 'critical' | 'low' | 'safe' | 'noData'

interface RestockAlert {
  productName: string
  category: string
  weeklyVelocity: number
  stockRemaining: number | null
  daysUntilStockout: number | null
  projectedStockoutDate: Date | null
  lastRestockedDate: Date | null
  lastRestockedQuantity: number | null
  urgency: UrgencyTier
  recommendedRestockQty: number
}

const URGENCY_ORDER: Record<UrgencyTier, number> = {
  outOfStock: 0, critical: 1, low: 2, safe: 3, noData: 4,
}

function urgencyColor(tier: UrgencyTier) {
  if (tier === 'outOfStock' || tier === 'critical') return '#ef4444'
  if (tier === 'low') return '#f97316'
  if (tier === 'safe') return '#16a34a'
  return '#9ca3af'
}

function urgencyLabel(tier: UrgencyTier) {
  if (tier === 'outOfStock') return 'OUT OF STOCK'
  if (tier === 'critical') return 'Critical'
  if (tier === 'low') return 'Low'
  if (tier === 'safe') return 'Safe'
  return 'No data'
}

function computeAlerts(
  transactions: SalesTransaction[],
  restockLogs: RestockLog[],
  catalogueProducts: CatalogueProduct[],
): RestockAlert[] {
  if (!transactions.length) return []

  const stats = computeProductStats(transactions)

  const latestLog: Record<string, RestockLog> = {}
  for (const log of restockLogs) {
    const existing = latestLog[log.productName]
    if (!existing || log.date > existing.date) latestLog[log.productName] = log
  }

  // Build a case-insensitive lookup for catalogue quantities.
  const catalogueQtyLower: Record<string, number> = {}
  for (const p of catalogueProducts) {
    if (p.quantity !== null) catalogueQtyLower[p.name.toLowerCase().trim()] = p.quantity
  }

  function lookupCatalogueQty(name: string): number | undefined {
    // Exact match first, then case-insensitive, then strip trailing variant "(S)" etc.
    const lower = name.toLowerCase().trim()
    if (catalogueQtyLower[lower] !== undefined) return catalogueQtyLower[lower]
    // Try stripping a trailing parenthetical variant like " (S)", " (M)", etc.
    const base = lower.replace(/\s*\([^)]*\)\s*$/, '').trim()
    return catalogueQtyLower[base]
  }

  const today = new Date()
  const alerts: RestockAlert[] = []

  for (const product of stats) {
    // Span from first sale to today — counts quiet weeks so a burst doesn't inflate velocity.
    const spanDays = (today.getTime() - product.firstSoldDate.getTime()) / 86_400_000
    const weeksSpan = Math.max(1, spanDays / 7)
    const weeklyVelocity = product.totalUnitsSold / weeksSpan
    const dailyVelocity = weeklyVelocity / 7

    let stockRemaining: number | null = null
    let daysUntilStockout: number | null = null
    let projectedStockoutDate: Date | null = null
    let lastRestockedDate: Date | null = null
    let lastRestockedQuantity: number | null = null

    const log = latestLog[product.name]
    if (log) {
      lastRestockedDate = log.date
      lastRestockedQuantity = log.quantity
      const restockDay = startOfDay(log.date).getTime()
      const soldAfter = Object.entries(product.dailySales)
        .filter(([key]) => startOfDay(new Date(key + 'T00:00:00')).getTime() > restockDay)
        .reduce((s, [, v]) => s + v, 0)
      const remaining = log.quantity - soldAfter
      stockRemaining = remaining
      if (remaining > 0 && dailyVelocity > 0) {
        daysUntilStockout = remaining / dailyVelocity
        projectedStockoutDate = new Date(today.getTime() + daysUntilStockout * 86_400_000)
      }
    } else {
      const qty = lookupCatalogueQty(product.name)
      if (qty !== undefined) {
        stockRemaining = qty
        if (qty > 0 && dailyVelocity > 0) {
          daysUntilStockout = qty / dailyVelocity
          projectedStockoutDate = new Date(today.getTime() + daysUntilStockout * 86_400_000)
        }
      }
    }

    let urgency: UrgencyTier
    if (stockRemaining !== null) {
      if (stockRemaining <= 0) urgency = 'outOfStock'
      else if (daysUntilStockout !== null) {
        urgency = daysUntilStockout <= 5 ? 'critical' : daysUntilStockout <= 10 ? 'low' : 'safe'
      } else urgency = 'safe'
    } else urgency = 'noData'

    alerts.push({
      productName: product.name,
      category: product.category,
      weeklyVelocity,
      stockRemaining,
      daysUntilStockout,
      projectedStockoutDate,
      lastRestockedDate,
      lastRestockedQuantity,
      urgency,
      recommendedRestockQty: Math.ceil(weeklyVelocity * 3),
    })
  }

  return alerts.sort((a, b) => {
    const uo = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]
    if (uo !== 0) return uo
    const da = a.daysUntilStockout ?? Infinity
    const db_ = b.daysUntilStockout ?? Infinity
    return da - db_
  })
}

function LogRestockModal({ productName, onClose }: { productName: string; onClose: () => void }) {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [qty, setQty] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState(false)

  async function save() {
    const n = parseInt(qty, 10)
    if (!n || n <= 0) { setError(true); return }
    await db.restockLogs.add({ productName, date: new Date(date), quantity: n, notes })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 w-96 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Log Restock</h2>
            <p className="text-sm text-slate-500">{productName}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-400 text-xl leading-none">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Restock Date</label>
            <input type="date" className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm"
              value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Quantity Restocked</label>
            <input type="number" placeholder="e.g. 48"
              className={`w-full border rounded-lg px-3 py-2 text-sm ${error ? 'border-red-400' : 'border-slate-700'}`}
              value={qty} onChange={e => { setQty(e.target.value); setError(false) }} />
            {error && <p className="text-xs text-red-400 mt-1">Enter a valid whole number</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Notes (optional)</label>
            <input type="text" placeholder="e.g. Received from supplier"
              className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm"
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={save} className="px-4 py-2 text-sm bg-teal-500 text-slate-950 rounded-lg hover:bg-teal-600">
            Save Restock
          </button>
        </div>
      </div>
    </div>
  )
}

export default function RestockView() {
  const { range } = useDateRangeStore()
  const transactions = useFilteredTransactions(range)
  const restockLogs = useRestockLogs()
  const catalogueProducts = useCatalogueProducts()
  const [productToRestock, setProductToRestock] = useState<string | null>(null)

  const alerts = useMemo(
    () => computeAlerts(transactions, restockLogs, catalogueProducts),
    [transactions, restockLogs, catalogueProducts],
  )

  const outOfStockCount = useMemo(() => alerts.filter(a => a.urgency === 'outOfStock').length, [alerts])
  const criticalCount = useMemo(() => alerts.filter(a => a.urgency === 'critical').length, [alerts])
  const lowCount = useMemo(() => alerts.filter(a => a.urgency === 'low').length, [alerts])
  const suggestedList = useMemo(
    () => alerts.filter(a => a.urgency === 'outOfStock' || a.urgency === 'critical' || a.urgency === 'low'),
    [alerts],
  )

  if (transactions.length === 0) {
    return <EmptyState title="No data" subtitle="Import CSV sales data to see restock alerts." />
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-100">Restock Alerts & Forecasting</h1>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Products', value: alerts.length, color: 'text-slate-100' },
          { label: 'Out of Stock', value: outOfStockCount, color: outOfStockCount > 0 ? 'text-red-400' : 'text-slate-500' },
          { label: 'Critical (≤5 days)', value: criticalCount, color: criticalCount > 0 ? 'text-red-400' : 'text-slate-500' },
          { label: 'Low (6–10 days)', value: lowCount, color: lowCount > 0 ? 'text-orange-400' : 'text-slate-500' },
        ].map(c => (
          <div key={c.label} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {suggestedList.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-orange-400 mb-3">Suggested Restock List</h2>
          <div className="space-y-2">
            {suggestedList.map(alert => (
              <div key={alert.productName} className="flex items-center gap-3 p-3 rounded-lg"
                style={{ backgroundColor: urgencyColor(alert.urgency) + '0d' }}>
                <div
                  className="w-1 self-stretch rounded-full shrink-0"
                  style={{ backgroundColor: urgencyColor(alert.urgency) }}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-100 text-sm">{alert.productName}</p>
                  <p className="text-xs text-slate-500">{alert.category}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-sm text-slate-100">
                    Restock {alert.recommendedRestockQty} units
                  </p>
                  {alert.stockRemaining !== null ? (
                    <p className="text-xs" style={{ color: urgencyColor(alert.urgency) }}>
                      {alert.stockRemaining <= 0 ? 'OUT OF STOCK' : `${alert.stockRemaining} remaining`}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">No stock data</p>
                  )}
                </div>
                <button
                  onClick={() => setProductToRestock(alert.productName)}
                  className="shrink-0 text-xs px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-700/50"
                >
                  Log Restock
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/50">
          <h2 className="text-base font-semibold text-slate-100">All Products — Stock Status</h2>
        </div>
        {alerts.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">Import CSV sales data to see restock alerts.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-700/50 text-left">
                  {['Product', 'Category', 'Weekly Vel.', 'Est. Stock', 'Days Left', 'Proj. Stockout', 'Last Restocked', 'Status', 'Action'].map(h => (
                    <th key={h} className="px-4 py-2.5 font-semibold text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {alerts.map(alert => (
                  <tr key={alert.productName} className="border-b border-slate-800 hover:bg-slate-700/50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-100">{alert.productName}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{alert.category}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-300">{alert.weeklyVelocity.toFixed(1)}/wk</td>
                    <td className="px-4 py-2.5 font-mono font-semibold" style={{ color: urgencyColor(alert.urgency) }}>
                      {alert.stockRemaining !== null
                        ? alert.stockRemaining <= 0 ? 'OUT' : alert.stockRemaining
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono" style={{ color: urgencyColor(alert.urgency) }}>
                      {alert.urgency === 'outOfStock' ? '0'
                        : alert.daysUntilStockout !== null ? Math.round(alert.daysUntilStockout)
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-400">
                      {alert.projectedStockoutDate ? format(alert.projectedStockoutDate, 'MMM d') : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {alert.lastRestockedDate ? format(alert.lastRestockedDate, 'M/d/yy') : 'Never'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: urgencyColor(alert.urgency) + '20',
                          color: urgencyColor(alert.urgency),
                        }}
                      >
                        {urgencyLabel(alert.urgency)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => setProductToRestock(alert.productName)}
                        className="text-xs px-2 py-1 border border-slate-700 rounded hover:bg-slate-700/50"
                      >
                        Log Restock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {productToRestock && (
        <LogRestockModal productName={productToRestock} onClose={() => setProductToRestock(null)} />
      )}
    </div>
  )
}
