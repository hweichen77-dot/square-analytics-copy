import { useMemo, useState } from 'react'
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useFilteredTransactions } from '../db/useTransactions'
import { useDateRangeStore } from '../store/dateRangeStore'
import { computeProductStats } from '../engine/analyticsEngine'
import { EmptyState } from '../components/ui/EmptyState'
import { formatCurrency } from '../utils/format'
import { parseProductItems } from '../types/models'
import type { SalesTransaction } from '../types/models'
import { format } from 'date-fns'

interface PriceChange {
  id: string
  productName: string
  oldPrice: number
  newPrice: number
  changeDate: Date
  before30Revenue: number
  after30Revenue: number
  priceChangePct: number
  unitChangePct: number
  revenueChangePct: number
  elasticity: number
  revenueImproved: boolean
}

function buildPriceChanges(transactions: SalesTransaction[]): PriceChange[] {
  const productPriceHistory: Record<string, { date: Date; price: number; qty: number }[]> = {}

  for (const tx of transactions) {
    const items = parseProductItems(tx.itemDescription)
    const totalQty = items.reduce((s, i) => s + i.qty, 0)
    if (!totalQty) continue
    const pricePerUnit = tx.netSales / totalQty
    for (const item of items.filter(i => i.qty > 0)) {
      if (!productPriceHistory[item.name]) productPriceHistory[item.name] = []
      productPriceHistory[item.name].push({ date: tx.date, price: pricePerUnit, qty: item.qty })
    }
  }

  const result: PriceChange[] = []
  const threshold = 0.1

  for (const [product, history] of Object.entries(productPriceHistory)) {
    const sorted = [...history].sort((a, b) => a.date.getTime() - b.date.getTime())
    if (sorted.length < 4) continue

    let lastPrice = sorted[0].price
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i].price
      if (Math.abs(current - lastPrice) > threshold) {
        const changeDate = sorted[i].date
        const before = sorted.slice(0, i).slice(-30)
        const after = sorted.slice(i, i + 30)
        const beforeUnits = before.reduce((s, x) => s + x.qty, 0)
        const afterUnits = after.reduce((s, x) => s + x.qty, 0)
        const beforeRev = before.reduce((s, x) => s + x.price * x.qty, 0)
        const afterRev = after.reduce((s, x) => s + x.price * x.qty, 0)

        const priceChangePct = lastPrice > 0 ? ((current - lastPrice) / lastPrice) * 100 : 0
        const unitChangePct = beforeUnits > 0 ? ((afterUnits - beforeUnits) / beforeUnits) * 100 : 0
        const revenueChangePct = beforeRev > 0 ? ((afterRev - beforeRev) / beforeRev) * 100 : 0
        const elasticity = priceChangePct !== 0 ? unitChangePct / priceChangePct : 0

        result.push({
          id: `${product}-${changeDate.getTime()}`,
          productName: product,
          oldPrice: lastPrice,
          newPrice: current,
          changeDate,
          before30Revenue: beforeRev,
          after30Revenue: afterRev,
          priceChangePct,
          unitChangePct,
          revenueChangePct,
          elasticity,
          revenueImproved: afterRev > beforeRev,
        })
        lastPrice = current
      }
    }
  }

  return result.sort((a, b) => b.changeDate.getTime() - a.changeDate.getTime())
}

export default function PriceOptimizationView() {
  const { range } = useDateRangeStore()
  const transactions = useFilteredTransactions(range)
  const [selectedProduct, setSelectedProduct] = useState('')
  const [simPrice, setSimPrice] = useState('')

  const changes = useMemo(() => buildPriceChanges(transactions), [transactions])
  const productStats = useMemo(() => computeProductStats(transactions), [transactions])
  const productNames = useMemo(() => productStats.map(p => p.name).sort(), [productStats])
  const avgPriceByProduct = useMemo(
    () => Object.fromEntries(productStats.map(p => [p.name, p.avgPrice])),
    [productStats],
  )
  const velocityByProduct = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of productStats) {
      const spanDays = Math.max(
        (p.lastSoldDate.getTime() - p.firstSoldDate.getTime()) / 86_400_000 + 1,
        7,
      )
      const calendarWeeks = spanDays / 7
      map[p.name] = calendarWeeks > 0 ? p.totalUnitsSold / calendarWeeks : 0
    }
    return map
  }, [productStats])

  const improved = changes.filter(c => c.revenueImproved).length
  const declined = changes.filter(c => !c.revenueImproved).length

  const changesForSelected = useMemo(
    () => changes.filter(c => c.productName === selectedProduct),
    [changes, selectedProduct],
  )

  const simPriceNum = parseFloat(simPrice)
  const currentPrice = avgPriceByProduct[selectedProduct]
  const currentVelocity = velocityByProduct[selectedProduct]
  const elasticity = changesForSelected[0]?.elasticity ?? -1
  const sim = selectedProduct && simPriceNum > 0 && currentPrice && currentVelocity
    ? {
        currentRevenue: currentVelocity * currentPrice,
        estimatedUnits: Math.max(0, currentVelocity * (1 + ((simPriceNum - currentPrice) / currentPrice) * elasticity)),
        estimatedRevenue: Math.max(0, currentVelocity * (1 + ((simPriceNum - currentPrice) / currentPrice) * elasticity)) * simPriceNum,
      }
    : null

  const priceChartData = useMemo(() => {
    if (!selectedProduct) return []
    return changesForSelected.map(c => ({
      date: format(c.changeDate, 'MMM d'),
      before: c.before30Revenue,
      after: c.after30Revenue,
      label: `$${c.oldPrice.toFixed(2)}→$${c.newPrice.toFixed(2)}`,
    }))
  }, [changesForSelected, selectedProduct])

  if (transactions.length === 0) {
    return <EmptyState title="No data" subtitle="Import sales data to detect price changes." />
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-100">Price Optimization</h1>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-slate-800/30 border border-slate-700/40 p-4">
          <p className="text-xs text-slate-400">Price Changes Detected</p>
          <p className="text-xl font-bold text-slate-100 mt-1">{changes.length}</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700/40 p-4">
          <p className="text-xs text-slate-400">Revenue Improved</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{improved}</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700/40 p-4">
          <p className="text-xs text-slate-400">Revenue Declined</p>
          <p className="text-2xl font-bold text-red-400 mt-1">{declined}</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700/40 p-4">
          <p className="text-xs text-slate-400">Products Tracked</p>
          <p className="text-xl font-bold text-slate-100 mt-1">{productNames.length}</p>
        </div>
      </div>

      {changes.length > 0 && (
        <div
          className={`p-4 border flex items-start gap-3 ${improved >= declined ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-orange-500/10 border-orange-500/30'}`}
        >
          <div>
            <p className="text-sm font-medium text-slate-200">
              {improved} of {changes.length} detected price changes resulted in higher revenue
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Elasticity &lt; −1 means demand is price-sensitive; &gt; −1 means relatively inelastic
            </p>
          </div>
        </div>
      )}

      {changes.length > 0 && (
        <div className="bg-slate-800/30 border border-slate-700/40 p-5">
          <h2 className="text-base font-semibold text-slate-100 mb-1">All Detected Price Changes</h2>
          <p className="text-xs text-slate-400 mb-4">
            A price change is detected when a product's per-unit price differs by more than $0.10.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700 text-left">
                  {['Product', 'Date', 'Old $', 'New $', 'Price Δ', 'Unit Δ (30d)', 'Revenue Δ', 'Elasticity'].map(h => (
                    <th key={h} className="pb-2 font-semibold text-slate-400 pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {changes.map(c => (
                  <tr key={c.id} className="border-b border-slate-800 hover:bg-slate-700/50">
                    <td className="py-2 font-medium text-slate-100 pr-4">{c.productName}</td>
                    <td className="py-2 font-mono text-slate-400 pr-4">{format(c.changeDate, 'MMM d, yyyy')}</td>
                    <td className="py-2 font-mono text-slate-300 pr-4">${c.oldPrice.toFixed(2)}</td>
                    <td className="py-2 font-mono text-slate-300 pr-4">${c.newPrice.toFixed(2)}</td>
                    <td className="py-2 font-mono pr-4" style={{ color: c.priceChangePct >= 0 ? '#dc2626' : '#16a34a' }}>
                      {c.priceChangePct >= 0 ? '+' : ''}{c.priceChangePct.toFixed(1)}%
                    </td>
                    <td className="py-2 font-mono pr-4" style={{ color: c.unitChangePct >= 0 ? '#16a34a' : '#dc2626' }}>
                      {c.unitChangePct >= 0 ? '+' : ''}{c.unitChangePct.toFixed(1)}%
                    </td>
                    <td className="py-2 font-mono font-semibold pr-4" style={{ color: c.revenueImproved ? '#16a34a' : '#dc2626' }}>
                      {c.revenueChangePct >= 0 ? '+' : ''}{c.revenueChangePct.toFixed(1)}%
                    </td>
                    <td className="py-2 font-mono" style={{ color: Math.abs(c.elasticity) > 1 ? '#f97316' : '#6b7280' }}>
                      {c.elasticity.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-slate-800/30 border border-slate-700/40 p-5">
        <h2 className="text-base font-semibold text-slate-100 mb-3">Per-Product Price History</h2>
        <select
          className="border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300 mb-4"
          value={selectedProduct}
          onChange={e => { setSelectedProduct(e.target.value); setSimPrice('') }}
        >
          <option value="">Select a product...</option>
          {productNames.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        {selectedProduct && changesForSelected.length === 0 && (
          <p className="text-sm text-slate-400">No price changes detected for "{selectedProduct}".</p>
        )}

        {priceChartData.length > 0 && (
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={priceChartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `$${v.toFixed(0)}`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Line type="linear" dataKey="before" stroke="#3b82f6" dot strokeWidth={2} name="Before (30d)" />
              <Line type="linear" dataKey="after" stroke="#16a34a" dot strokeWidth={2} name="After (30d)" />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {selectedProduct && currentPrice !== undefined && (
        <div className="bg-slate-800/30 border border-slate-700/40 p-5">
          <h2 className="text-base font-semibold text-slate-100 mb-1">Price Simulator</h2>
          <p className="text-xs text-slate-400 mb-4">
            Estimate the impact of a price change using historical elasticity.
          </p>
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <p className="text-xs text-slate-400">Current Price</p>
              <p className="text-lg font-bold text-slate-100">{formatCurrency(currentPrice)}</p>
            </div>
            <span className="text-slate-400">→</span>
            <div>
              <p className="text-xs text-slate-400">New Hypothetical Price</p>
              <input
                type="number"
                className="border border-slate-700 rounded-lg px-3 py-1.5 text-sm w-28"
                placeholder="e.g. 2.99"
                value={simPrice}
                onChange={e => setSimPrice(e.target.value)}
              />
            </div>

            {sim && (
              <>
                <div className="border-l border-slate-700 pl-6">
                  <p className="text-xs text-slate-400">Est. Weekly Revenue</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-sm text-slate-400">{formatCurrency(sim.currentRevenue)}</span>
                    <span className="text-slate-400 text-xs">→</span>
                    <span
                      className="text-lg font-bold"
                      style={{ color: sim.estimatedRevenue >= sim.currentRevenue ? '#16a34a' : '#dc2626' }}
                    >
                      {formatCurrency(sim.estimatedRevenue)}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Est. Weekly Units</p>
                  <p className="text-sm font-mono text-slate-300 mt-0.5">
                    {currentVelocity.toFixed(1)} → {sim.estimatedUnits.toFixed(1)}
                  </p>
                </div>
              </>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-3">
            {changesForSelected.length === 0
              ? 'Note: Using default elasticity of −1.0 (no historical price changes for this product).'
              : `Based on elasticity of ${elasticity.toFixed(2)} from ${changesForSelected.length} detected change(s).`}
          </p>
        </div>
      )}
    </div>
  )
}
