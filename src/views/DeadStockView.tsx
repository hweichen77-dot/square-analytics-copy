import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useFilteredTransactions, useProductCostData } from '../db/useTransactions'
import { useDateRangeStore } from '../store/dateRangeStore'
import { computeProductStats } from '../engine/analyticsEngine'
import { EmptyState } from '../components/ui/EmptyState'
import { formatCurrency } from '../utils/format'
import { parseProductItems } from '../types/models'
import type { SalesTransaction, ProductCostData } from '../types/models'
import { effectiveUnitCost } from '../types/models'
import { format, startOfDay, differenceInDays } from 'date-fns'

type Tier = 'Dead' | 'Dying' | 'Slow Mover'

interface DeadStockItem {
  name: string
  category: string
  lastSaleDate: Date
  daysSinceLastSale: number
  last30Units: number
  prior30Units: number
  trendPct: number
  unitCost: number | null
  tier: Tier
  capitalTiedUp: number | null
  recommendation: string
}

function tierColor(tier: Tier) {
  if (tier === 'Dead') return '#ef4444'
  if (tier === 'Dying') return '#f97316'
  return '#eab308'
}

function buildDeadStockItems(
  transactions: SalesTransaction[],
  costData: ProductCostData[],
): DeadStockItem[] {
  if (!transactions.length) return []

  const costByName: Record<string, number> = {}
  for (const c of costData) costByName[c.productName] = effectiveUnitCost(c)

  const activeDaySet = new Set(transactions.map(tx => startOfDay(tx.date).getTime()))
  const activeDaysSorted = Array.from(activeDaySet).sort((a, b) => b - a)
  if (activeDaysSorted.length < 2) return []

  const last30Days = new Set(activeDaysSorted.slice(0, 30))
  const prior30Days = new Set(activeDaysSorted.slice(30, 60))

  const productDailySales: Record<string, Record<number, number>> = {}
  const productLastSale: Record<string, number> = {}

  for (const tx of transactions) {
    const dayTs = startOfDay(tx.date).getTime()
    for (const item of parseProductItems(tx.itemDescription)) {
      if (!productDailySales[item.name]) productDailySales[item.name] = {}
      productDailySales[item.name][dayTs] = (productDailySales[item.name][dayTs] ?? 0) + item.qty
      if (!productLastSale[item.name] || tx.date.getTime() > productLastSale[item.name]) {
        productLastSale[item.name] = tx.date.getTime()
      }
    }
  }

  const products = computeProductStats(transactions)
  const today = startOfDay(new Date()).getTime()

  const rawItems = products.map(p => {
    const daily = productDailySales[p.name] ?? {}
    const last30 = Array.from(last30Days).reduce((s, d) => s + (daily[d] ?? 0), 0)
    const prior30 = Array.from(prior30Days).reduce((s, d) => s + (daily[d] ?? 0), 0)
    const lastSale = productLastSale[p.name] ?? p.lastSoldDate.getTime()
    return { name: p.name, category: p.category, last30, prior30, lastSale }
  })

  if (rawItems.length === 0) return []
  const velocities = rawItems.map(r => r.last30).sort((a, b) => a - b)
  const cutoffIdx = Math.max(0, Math.floor(velocities.length * 0.2))
  const cutoff = velocities[cutoffIdx] ?? 0

  const result: DeadStockItem[] = []
  for (const raw of rawItems) {
    const days = differenceInDays(new Date(today), new Date(raw.lastSale))
    const trendPct = raw.prior30 > 0 ? ((raw.last30 - raw.prior30) / raw.prior30) * 100 : 0

    let tier: Tier | null = null
    if (days >= 30 && raw.last30 === 0) tier = 'Dead'
    else if (raw.last30 > 0 && trendPct <= -50) tier = 'Dying'
    else if (raw.last30 <= cutoff && raw.last30 < 3) tier = 'Slow Mover'
    if (!tier) continue

    const unitCost = costByName[raw.name] ?? null
    const capitalTiedUp =
      unitCost !== null ? Math.max(0, raw.prior30 * 0.5) * unitCost : null

    let recommendation: string
    if (raw.last30 === 0 && raw.prior30 > 10) recommendation = 'Markdown 30% to clear — was popular, now stalled'
    else if (raw.prior30 <= 3) recommendation = 'Consider discontinuing — never sold well'
    else if (trendPct <= -50) recommendation = 'Bundle with a top seller to boost visibility'
    else recommendation = 'Review inventory levels and reorder point'

    result.push({
      name: raw.name,
      category: raw.category,
      lastSaleDate: new Date(raw.lastSale),
      daysSinceLastSale: days,
      last30Units: raw.last30,
      prior30Units: raw.prior30,
      trendPct,
      unitCost,
      tier,
      capitalTiedUp,
      recommendation,
    })
  }

  return result.sort((a, b) => b.daysSinceLastSale - a.daysSinceLastSale)
}

function TierSection({
  tier,
  tierItems,
}: {
  tier: Tier
  tierItems: DeadStockItem[]
}) {
  const [isExpanded, setIsExpanded] = useState(tier === 'Dead')
  const color = tierColor(tier)

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-700/50"
        onClick={() => setIsExpanded(e => !e)}
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold" style={{ color }}>{tier}</span>
          <span className="text-sm text-slate-500">({tierItems.length})</span>
        </div>
        <span className="text-xs text-slate-500">{isExpanded ? '▲' : '▼'}</span>
      </button>

      {isExpanded && (
        <div className="border-t border-slate-700/50 overflow-x-auto">
          {tierItems.length === 0 ? (
            <p className="text-sm text-slate-500 p-5">No products in this category.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-700/50 text-left">
                  <th className="px-4 py-2 font-semibold text-slate-400">Product</th>
                  <th className="px-4 py-2 font-semibold text-slate-400">Last Sale</th>
                  <th className="px-4 py-2 font-semibold text-slate-400 text-right">Days Idle</th>
                  <th className="px-4 py-2 font-semibold text-slate-400 text-right">Last 30d</th>
                  <th className="px-4 py-2 font-semibold text-slate-400 text-right">Prior 30d</th>
                  <th className="px-4 py-2 font-semibold text-slate-400 text-right">Trend</th>
                  <th className="px-4 py-2 font-semibold text-slate-400 text-right">Capital</th>
                </tr>
              </thead>
              <tbody>
                {tierItems.map(item => (
                  <tr key={item.name} className="border-b border-slate-800 hover:bg-slate-700/50">
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-100">{item.name}</div>
                      <div className="text-slate-500">{item.category}</div>
                    </td>
                    <td className="px-4 py-2 text-slate-400 font-mono">{format(item.lastSaleDate, 'MMM d, yyyy')}</td>
                    <td
                      className="px-4 py-2 text-right font-mono font-semibold"
                      style={{ color: item.daysSinceLastSale > 30 ? '#ef4444' : '#111827' }}
                    >
                      {item.daysSinceLastSale}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-300">{item.last30Units}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-300">{item.prior30Units}</td>
                    <td className="px-4 py-2 text-right font-mono font-medium" style={{ color: item.trendPct >= 0 ? '#16a34a' : '#dc2626' }}>
                      {item.prior30Units > 0 ? `${item.trendPct >= 0 ? '+' : ''}${item.trendPct.toFixed(0)}%` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-400">
                      {item.capitalTiedUp !== null ? formatCurrency(item.capitalTiedUp) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

export default function DeadStockView() {
  const { range } = useDateRangeStore()
  const transactions = useFilteredTransactions(range)
  const costData = useProductCostData()

  const items = useMemo(
    () => buildDeadStockItems(transactions, costData),
    [transactions, costData],
  )

  const deadItems = useMemo(() => items.filter(i => i.tier === 'Dead'), [items])
  const dyingItems = useMemo(() => items.filter(i => i.tier === 'Dying'), [items])
  const slowItems = useMemo(() => items.filter(i => i.tier === 'Slow Mover'), [items])
  const totalCapital = useMemo(() => items.reduce((s, i) => s + (i.capitalTiedUp ?? 0), 0), [items])

  const chartData = useMemo(
    () => [...items].sort((a, b) => b.last30Units - a.last30Units).slice(0, 20),
    [items],
  )

  if (transactions.length === 0) {
    return <EmptyState title="No data" subtitle="Import transaction data to detect dead stock." />
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Dead Stock Detector</h1>
        <p className="text-sm text-slate-500 mt-1">Products with no or declining sales activity</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Dead', count: deadItems.length, color: '#ef4444' },
          { label: 'Dying', count: dyingItems.length, color: '#f97316' },
          { label: 'Slow Movers', count: slowItems.length, color: '#eab308' },
          {
            label: 'Capital Tied Up',
            count: null,
            value: totalCapital > 0 ? formatCurrency(totalCapital) : 'Add costs →',
            color: '#6b7280',
          },
        ].map(c => (
          <div key={c.label} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className="text-2xl font-bold mt-1" style={{ color: c.color }}>
              {c.count !== null ? c.count : c.value}
            </p>
          </div>
        ))}
      </div>

      {(deadItems.length > 0 || dyingItems.length > 0) && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-orange-700 mb-3">Recommended Actions</h2>
          <div className="space-y-2">
            {[...deadItems, ...dyingItems].slice(0, 10).map(item => (
              <div key={item.name} className="flex items-start gap-3 bg-slate-800 rounded-lg p-3 border border-orange-100">
                <div
                  className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                  style={{ backgroundColor: tierColor(item.tier) }}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-100 text-sm">{item.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{item.recommendation}</div>
                </div>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: tierColor(item.tier) + '22',
                    color: tierColor(item.tier),
                  }}
                >
                  {item.tier}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <TierSection tier="Dead" tierItems={deadItems} />
      <TierSection tier="Dying" tierItems={dyingItems} />
      <TierSection tier="Slow Mover" tierItems={slowItems} />

      {chartData.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <h2 className="text-base font-semibold text-slate-100">30-Day Sales by Product</h2>
          <p className="text-xs text-slate-500 mt-0.5 mb-4">Highlighting dead and dying products</p>
          <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 22)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 16, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
              <Tooltip />
              <Bar dataKey="last30Units" radius={[0, 3, 3, 0]}>
                {chartData.map((item, i) => (
                  <Cell
                    key={i}
                    fill={item.tier === 'Dead' ? '#ef4444' : item.tier === 'Dying' ? '#f97316' : '#14B8A6aa'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
