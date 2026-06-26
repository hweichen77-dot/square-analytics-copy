import { useMemo, useState, useEffect, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  ScatterChart, Scatter, PieChart, Pie, Legend,
} from 'recharts'
import { useProductCostData, useCatalogueProducts, useRefunds } from '../db/useTransactions'
import { useAnalytics } from '../context/AnalyticsContext'
import { EmptyState } from '../components/ui/EmptyState'
import { db } from '../db/database'
import { formatCurrency } from '../utils/format'
import type { ProductCostData } from '../types/models'
import { effectiveUnitCost } from '../types/models'
import { computeGrossProfit } from '../engine/reportEngine'
import { useToastStore } from '../store/toastStore'

const PALETTE = ['#14B8A6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6']

function marginColor(pct: number) {
  if (pct < 20) return '#ef4444'
  if (pct < 40) return '#f59e0b'
  return '#16a34a'
}

function baseName(name: string) {
  if (!name.endsWith(')')) return name
  const idx = name.lastIndexOf('(')
  if (idx < 0) return name
  const before = name.slice(0, idx).trimEnd()
  return before || name
}

interface ProfitRow {
  name: string
  category: string
  unitCost: number | null
  avgPrice: number
  marginPercent: number | null
  unitsSold: number
  totalRevenue: number
  totalCost: number | null
  totalProfit: number | null
  hasCostData: boolean
}

interface CostDraft {
  productName: string
  isPerCase: boolean
  unitCostText: string
  casePriceText: string
  unitsPerCaseText: string
}

function draftEffectiveCost(d: CostDraft): number | null {
  if (d.isPerCase) {
    const cp = parseFloat(d.casePriceText) || 0
    const upc = parseInt(d.unitsPerCaseText, 10) || 0
    return cp > 0 && upc > 0 ? cp / upc : null
  }
  const v = parseFloat(d.unitCostText)
  return isNaN(v) || v <= 0 ? null : v
}

function buildDrafts(products: { name: string }[], costData: ProductCostData[]): CostDraft[] {
  const byName = Object.fromEntries(costData.map(c => [c.productName, c]))
  return products.map(p => {
    const existing = byName[p.name] ?? byName[baseName(p.name)]
    if (existing) {
      const isPerCase = existing.casePrice > 0 && existing.unitsPerCase > 0
      return {
        productName: p.name,
        isPerCase,
        unitCostText: isPerCase ? '' : (existing.unitCost ?? 0).toFixed(2),
        casePriceText: isPerCase ? (existing.casePrice ?? 0).toFixed(2) : '',
        unitsPerCaseText: isPerCase ? String(existing.unitsPerCase) : '',
      }
    }
    return { productName: p.name, isPerCase: false, unitCostText: '', casePriceText: '', unitsPerCaseText: '' }
  })
}

function CostManagementModal({
  products,
  costData,
  onClose,
}: {
  products: { name: string }[]
  costData: ProductCostData[]
  onClose: () => void
}) {
  const { show } = useToastStore()
  const [search, setSearch] = useState('')
  const [drafts, setDrafts] = useState<CostDraft[]>(() => buildDrafts(products, costData))

  const synced = useRef(false)
  useEffect(() => {
    if (!synced.current && costData.length > 0) {
      synced.current = true
      setDrafts(buildDrafts(products, costData))
    }
  }, [costData, products])

  async function saveAll() {
    try {
      const currentData = await db.productCostData.toArray()
      const freshByName = Object.fromEntries(currentData.map(c => [c.productName, c]))

      const processedBaseNames = new Set<string>()

      let badEntries = 0

      for (const draft of drafts) {
        const hasData = draft.isPerCase
          ? draft.casePriceText.trim() || draft.unitsPerCaseText.trim()
          : draft.unitCostText.trim()
        if (!hasData) continue

        if (draft.isPerCase) {
          const cp = parseFloat(draft.casePriceText)
          const upc = parseInt(draft.unitsPerCaseText, 10)
          if (draft.casePriceText.trim() && (isNaN(cp) || cp <= 0)) { badEntries++; continue }
          if (draft.unitsPerCaseText.trim() && (isNaN(upc) || upc <= 0)) { badEntries++; continue }
        } else {
          const uc = parseFloat(draft.unitCostText)
          if (isNaN(uc) || uc <= 0) { badEntries++; continue }
        }

        const saveKey = baseName(draft.productName)
        if (processedBaseNames.has(saveKey)) continue
        processedBaseNames.add(saveKey)

        const existing = freshByName[draft.productName] ?? freshByName[saveKey]
        const now = new Date()

        if (existing?.id != null) {
          if (draft.isPerCase) {
            await db.productCostData.update(existing.id, {
              casePrice: parseFloat(draft.casePriceText) || 0,
              unitsPerCase: parseInt(draft.unitsPerCaseText, 10) || 0,
              unitCost: 0,
              lastUpdated: now,
            })
          } else {
            await db.productCostData.update(existing.id, {
              unitCost: parseFloat(draft.unitCostText) || 0,
              casePrice: 0,
              unitsPerCase: 0,
              lastUpdated: now,
            })
          }
        } else {
          await db.productCostData.add({
            productName: saveKey,
            unitCost: draft.isPerCase ? 0 : parseFloat(draft.unitCostText) || 0,
            casePrice: draft.isPerCase ? parseFloat(draft.casePriceText) || 0 : 0,
            unitsPerCase: draft.isPerCase ? parseInt(draft.unitsPerCaseText, 10) || 0 : 0,
            lastUpdated: now,
          })
        }
      }
      if (badEntries > 0) {
        show(`Saved. ${badEntries} entr${badEntries === 1 ? 'y' : 'ies'} skipped — invalid values.`, 'info')
      } else {
        show('Costs saved!', 'success')
      }
      onClose()
    } catch (e) {
      show(`Save failed: ${(e as Error).message}`, 'error')
    }
  }

  const filtered = drafts.filter(d =>
    !search || d.productName.toLowerCase().includes(search.toLowerCase()),
  )

  function update(productName: string, patch: Partial<CostDraft>) {
    setDrafts(ds => ds.map(d => d.productName === productName ? { ...d, ...patch } : d))
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
          <div>
            <h2 className="text-lg font-bold text-slate-100">Manage Costs</h2>
            <p className="text-xs text-slate-200">{products.length} products</p>
          </div>
          <button onClick={onClose} className="text-slate-200 hover:text-slate-200 text-xl">×</button>
        </div>

        <div className="px-6 py-3 border-b border-slate-700/50">
          <input
            className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm"
            placeholder="Search products..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900 border-b border-slate-700/50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-200">Product</th>
                <th className="px-4 py-2 text-center text-xs font-semibold text-slate-200 w-20">Mode</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200 w-36">Unit / Case Price</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200 w-24">Units/Case</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-200 w-28">Eff. Cost</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(draft => {
                const eff = draftEffectiveCost(draft)
                return (
                  <tr key={draft.productName} className="border-b border-slate-800">
                    <td className="px-4 py-2 text-slate-100 truncate max-w-48">{draft.productName}</td>
                    <td className="px-4 py-2 text-center">
                      <button
                        className={`text-xs px-2 py-0.5 rounded-full border ${draft.isPerCase ? 'bg-teal-500/15 text-teal-400 border-teal-500/30' : 'border-slate-700 text-slate-200'}`}
                        onClick={() => update(draft.productName, { isPerCase: !draft.isPerCase })}
                      >
                        Case
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <input
                        type="number"
                        className="border border-slate-600 rounded px-2 py-1 bg-slate-700/50 text-xs w-28 text-right"
                        placeholder={draft.isPerCase ? 'Case $' : 'Unit $'}
                        value={draft.isPerCase ? draft.casePriceText : draft.unitCostText}
                        onChange={e =>
                          update(draft.productName, draft.isPerCase
                            ? { casePriceText: e.target.value }
                            : { unitCostText: e.target.value })
                        }
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      {draft.isPerCase ? (
                        <input
                          type="number"
                          className="border border-slate-600 rounded px-2 py-1 bg-slate-700/50 text-xs w-20 text-right"
                          placeholder="Units"
                          value={draft.unitsPerCaseText}
                          onChange={e => update(draft.productName, { unitsPerCaseText: e.target.value })}
                        />
                      ) : <span className="text-slate-200">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold text-sm">
                      {eff !== null ? `$${eff.toFixed(3)}` : <span className="text-slate-200">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700/50">
          <p className="text-xs text-slate-200">Toggle 'Case' to enter bulk pricing.</p>
          <button onClick={saveAll} className="px-4 py-2 text-sm bg-teal-500 text-slate-950 rounded-lg hover:bg-teal-600">
            Save All
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ProfitView() {
  const { transactions, productStats: cachedStats, totalRevenue } = useAnalytics()
  const costData = useProductCostData()
  const catalogueProducts = useCatalogueProducts()
  const refunds = useRefunds()
  const [showCostSheet, setShowCostSheet] = useState(false)
  const [sortKey, setSortKey] = useState<keyof ProfitRow>('totalProfit')
  const [sortDesc, setSortDesc] = useState(true)

  const { rawStats, profitRows } = useMemo(() => {
    const stats = cachedStats
    const byName = Object.fromEntries(costData.map((c: ProductCostData) => [c.productName, c]))
    const byNameLower = Object.fromEntries(costData.map((c: ProductCostData) => [c.productName.toLowerCase().trim(), c]))
    const catPriceLower: Record<string, number> = {}
    for (const cp of catalogueProducts) {
      if (cp.price !== null && cp.price > 0) {
        catPriceLower[cp.name.toLowerCase().trim()] = cp.price
      }
    }
    function lookupCataloguePrice(name: string): number | null {
      const lower = name.toLowerCase().trim()
      if (catPriceLower[lower] !== undefined) return catPriceLower[lower]
      const stripped = lower.startsWith('*') ? lower.slice(1).trim() : lower
      if (catPriceLower[stripped] !== undefined) return catPriceLower[stripped]
      const base = lower.replace(/\s*\([^)]*\)\s*$/, '').trim()
      if (catPriceLower[base] !== undefined) return catPriceLower[base]
      const strippedBase = stripped.replace(/\s*\([^)]*\)\s*$/, '').trim()
      return catPriceLower[strippedBase] ?? null
    }
    function stripStar(n: string) { return n.startsWith('*') ? n.slice(1).trim() : n }
    function normalizeForLookup(n: string): string[] {
      const clean = stripStar(n).trim()
      const base = baseName(clean)
      const noVariant = clean.replace(/\s*[-/]\s*(sm|md|lg|xl|xxl|small|medium|large|x-?large|\d+\s*oz|\d+\s*ml)\s*$/i, '').trim()
      const noParens  = clean.replace(/\s*\([^)]*\)\s*/g, '').trim()
      return [clean, base, noVariant, noParens].filter(Boolean)
    }
    function lookupCost(name: string) {
      const candidates = normalizeForLookup(name)
      for (const c of candidates) {
        if (byName[c]) return byName[c]
        const cl = c.toLowerCase()
        if (byNameLower[cl]) return byNameLower[cl]
      }
      return undefined
    }
    const rows: ProfitRow[] = stats.map(p => {
      const c = lookupCost(p.name)
      const sellingPrice = lookupCataloguePrice(p.name) ?? p.avgPrice
      if (c) {
        const euc = effectiveUnitCost(c)
        const gp = sellingPrice - euc
        const margin = sellingPrice > 0 ? (gp / sellingPrice) * 100 : 0
        const tc = euc * p.totalUnitsSold
        const tp = gp * p.totalUnitsSold
        return {
          name: p.name, category: p.category, unitCost: euc, avgPrice: sellingPrice,
          marginPercent: margin, unitsSold: p.totalUnitsSold, totalRevenue: p.totalRevenue,
          totalCost: tc, totalProfit: tp, hasCostData: true,
        }
      }
      return {
        name: p.name, category: p.category, unitCost: null, avgPrice: sellingPrice,
        marginPercent: null, unitsSold: p.totalUnitsSold, totalRevenue: p.totalRevenue,
        totalCost: null, totalProfit: null, hasCostData: false,
      }
    })
    return { rawStats: stats, profitRows: rows }
  }, [cachedStats, costData, catalogueProducts])

  const sortedRows = useMemo(() => {
    return [...profitRows].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv)
      }
      const an = (av as number | null) ?? (sortDesc ? -Infinity : Infinity)
      const bn = (bv as number | null) ?? (sortDesc ? -Infinity : Infinity)
      return sortDesc ? bn - an : an - bn
    })
  }, [profitRows, sortKey, sortDesc])

  const totalCost = useMemo(() => profitRows.reduce((s, r) => s + (r.totalCost ?? 0), 0), [profitRows])
  const totalProfit = useMemo(() => profitRows.reduce((s, r) => s + (r.totalProfit ?? 0), 0), [profitRows])
  const coveredRevenue = useMemo(() => profitRows.filter(r => r.hasCostData).reduce((s, r) => s + r.totalRevenue, 0), [profitRows])
  const overallMargin = coveredRevenue > 0 ? (totalProfit / coveredRevenue) * 100 : 0
  const sharedGP = useMemo(
    () => computeGrossProfit(cachedStats, costData, totalRevenue),
    [cachedStats, costData, totalRevenue],
  )
  const totalProcessingFees = useMemo(
    () => transactions.reduce((s, t) => s + (t.processingFee ?? 0), 0) / 100,
    [transactions],
  )
  const hasProcessingFees = totalProcessingFees > 0
  const totalRefunds = useMemo(() => {
    if (refunds.length === 0 || transactions.length === 0) return 0
    let min = Infinity, max = -Infinity
    for (const t of transactions) {
      const ms = t.date.getTime()
      if (ms < min) min = ms
      if (ms > max) max = ms
    }
    return refunds
      .filter(r => {
        const ms = r.createdAt.getTime()
        return ms >= min && ms <= max
      })
      .reduce((s, r) => s + r.amount, 0) / 100
  }, [refunds, transactions])
  const hasRefunds = totalRefunds > 0
  const moneyLosers = useMemo(() => profitRows.filter(r => r.marginPercent !== null && r.marginPercent <= 0), [profitRows])

  const top15Profit = useMemo(
    () => profitRows.filter(r => r.totalProfit !== null).sort((a, b) => (b.totalProfit ?? 0) - (a.totalProfit ?? 0)).slice(0, 15).reverse(),
    [profitRows],
  )

  const categoryProfitData = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of profitRows) {
      if (r.totalProfit !== null && r.totalProfit > 0) {
        map[r.category] = (map[r.category] ?? 0) + r.totalProfit
      }
    }
    return Object.entries(map).map(([category, profit]) => ({ category, profit })).sort((a, b) => b.profit - a.profit)
  }, [profitRows])

  const scatterData = useMemo(
    () => profitRows.filter(r => r.hasCostData).map(r => ({ name: r.name, x: r.unitsSold, y: r.marginPercent ?? 0, fill: marginColor(r.marginPercent ?? 0) })),
    [profitRows],
  )

  function toggleSort(key: keyof ProfitRow) {
    if (sortKey === key) setSortDesc(d => !d)
    else { setSortKey(key); setSortDesc(true) }
  }

  if (transactions.length === 0) {
    return <EmptyState title="No data" subtitle="Import sales data to see profit margins." />
  }

  const sortArrow = (key: keyof ProfitRow) => sortKey === key ? (sortDesc ? ' ↓' : ' ↑') : ''

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-100">Profit Margins</h1>
        <button
          onClick={() => setShowCostSheet(true)}
          className="px-4 py-2 text-sm bg-teal-500 text-slate-950 rounded-lg hover:bg-teal-600"
        >
          Manage Costs
        </button>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Total Revenue', value: formatCurrency(totalRevenue), color: '#3b82f6' },
          { label: 'Total Cost', value: formatCurrency(sharedGP.cogs || totalCost), color: '#f59e0b' },
          { label: 'Total Gross Profit', value: sharedGP.grossProfit !== null ? formatCurrency(sharedGP.grossProfit) : formatCurrency(totalProfit), color: (sharedGP.grossProfit ?? totalProfit) >= 0 ? '#16a34a' : '#dc2626' },
          { label: coveredRevenue < totalRevenue ? `Margin (${Math.round(coveredRevenue / totalRevenue * 100)}% of rev)` : 'Overall Margin', value: totalCost > 0 ? `${overallMargin.toFixed(1)}%` : '—', color: totalCost > 0 ? marginColor(overallMargin) : '#9ca3af' },
          { label: 'Costs Entered', value: `${profitRows.filter(r => r.hasCostData).length}/${rawStats.length}`, color: '#9ca3af' },
        ].map(c => (
          <div key={c.label} className="bg-slate-800/30 border border-slate-700/40 p-4">
            <p className="text-xs text-slate-200">{c.label}</p>
            <p className="text-xl font-bold mt-1 font-mono" style={{ color: c.color }}>{c.value}</p>
          </div>
        ))}
      </div>

      {(hasProcessingFees || hasRefunds) && (
        <div className="bg-slate-800/30 border border-slate-700/40 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Revenue Breakdown</h2>
          <div className="space-y-2 text-sm font-mono">
            <div className="flex justify-between text-slate-100">
              <span>Gross Revenue</span>
              <span>{formatCurrency(totalRevenue)}</span>
            </div>
            {hasRefunds && (
              <div className="flex justify-between text-amber-400">
                <span>Refunds</span>
                <span>- {formatCurrency(totalRefunds)}</span>
              </div>
            )}
            {hasProcessingFees && (
              <div className="flex justify-between text-amber-400">
                <span>Processing Fees</span>
                <span>- {formatCurrency(totalProcessingFees)}</span>
              </div>
            )}
            <div className="border-t border-slate-700/50 pt-2 flex justify-between font-bold text-teal-400">
              <span>Net Revenue</span>
              <span>{formatCurrency(totalRevenue - totalProcessingFees - totalRefunds)}</span>
            </div>
          </div>
        </div>
      )}

      {moneyLosers.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5">
          <p className="font-semibold mb-2 text-red-400">
            Money Losers — {moneyLosers.length} product{moneyLosers.length !== 1 ? 's' : ''} at 0% or negative margin
          </p>
          <div className="space-y-1">
            {moneyLosers.map(r => (
              <div key={r.name} className="flex items-center gap-3 text-sm text-slate-100">
                <span className="flex-1">{r.name}</span>
                <span className="font-mono w-14 text-right text-red-400">{(r.marginPercent ?? 0).toFixed(1)}%</span>
                <span className="font-mono w-22 text-right text-red-400">{formatCurrency(r.totalProfit ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/50">
          <h2 className="text-base font-semibold text-slate-100">Product Profit Analysis</h2>
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-900 border-b border-slate-700/50">
              <tr>
                {([
                  ['name', 'Product'], ['category', 'Category'], ['unitCost', 'Unit Cost'],
                  ['avgPrice', 'Avg Price'], ['marginPercent', 'Margin %'],
                  ['unitsSold', 'Units Sold'], ['totalRevenue', 'Total Revenue'],
                  ['totalCost', 'Total Cost'], ['totalProfit', 'Total Profit'],
                ] as [keyof ProfitRow, string][]).map(([key, label]) => (
                  <th
                    key={key}
                    className="px-4 py-2.5 font-semibold text-slate-200 text-left cursor-pointer hover:bg-slate-700 select-none"
                    onClick={() => toggleSort(key)}
                  >
                    {label}{sortArrow(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(r => (
                <tr key={r.name} className="border-b border-slate-800 hover:bg-slate-700/50">
                  <td className="px-4 py-2 font-medium text-slate-100 max-w-40 truncate">{r.name}</td>
                  <td className="px-4 py-2 text-slate-200">{r.category}</td>
                  <td className="px-4 py-2 font-mono text-slate-100">{r.unitCost != null ? `$${r.unitCost.toFixed(3)}` : <span className="text-slate-400 text-[10px]">enter cost</span>}</td>
                  <td className="px-4 py-2 font-mono text-slate-100">${(r.avgPrice ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-2 font-mono font-semibold"
                    style={{ color: r.marginPercent !== null ? marginColor(r.marginPercent) : '#94a3b8' }}>
                    {r.marginPercent !== null ? `${r.marginPercent.toFixed(1)}%` : <span className="text-slate-400 font-normal text-[10px]">no cost</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-slate-100">{r.unitsSold}</td>
                  <td className="px-4 py-2 font-mono text-slate-100">{formatCurrency(r.totalRevenue)}</td>
                  <td className="px-4 py-2 font-mono text-slate-200">{r.totalCost !== null ? formatCurrency(r.totalCost) : <span className="text-slate-400 text-[10px]">—</span>}</td>
                  <td className="px-4 py-2 font-mono font-semibold" style={{ color: r.totalProfit !== null ? ((r.totalProfit >= 0) ? '#e2e8f0' : '#f87171') : '#64748b' }}>
                    {r.totalProfit !== null ? formatCurrency(r.totalProfit) : <span className="text-slate-400 text-[10px]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {top15Profit.length > 0 && (
        <div className="bg-slate-800/30 border border-slate-700/40 p-5">
          <h2 className="text-base font-semibold text-slate-100 mb-4">Top 15 Products by Profit</h2>
          <ResponsiveContainer width="100%" height={top15Profit.length * 28 + 40}>
            <BarChart data={top15Profit} layout="vertical" margin={{ top: 4, right: 80, left: 16, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="totalProfit" fill="#34D399" radius={[0, 3, 3, 0]}
                label={{ position: 'right', formatter: (v: number) => formatCurrency(v), fontSize: 10, fill: '#cbd5e1' }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {scatterData.length > 0 && (
          <div className="bg-slate-800/30 border border-slate-700/40 p-5">
            <h2 className="text-base font-semibold text-slate-100 mb-4">Popularity vs. Profitability</h2>
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 4, right: 16, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="x" name="Units Sold" label={{ value: 'Units Sold', position: 'insideBottom', offset: -10, fontSize: 11 }} tick={{ fontSize: 11 }} />
                <YAxis dataKey="y" name="Margin %" label={{ value: 'Margin %', angle: -90, position: 'insideLeft', fontSize: 11 }} tick={{ fontSize: 11 }} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v: number) => `${v.toFixed(1)}`} />
                <Scatter data={scatterData}>
                  {scatterData.map((entry, i) => <Cell key={i} fill={entry.fill} fillOpacity={0.75} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}

        {categoryProfitData.length > 0 && (
          <div className="bg-slate-800/30 border border-slate-700/40 p-5">
            <h2 className="text-base font-semibold text-slate-100 mb-4">Profit by Category</h2>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={categoryProfitData} dataKey="profit" nameKey="category" cx="50%" cy="50%" outerRadius={110} innerRadius={55}>
                  {categoryProfitData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Legend formatter={(v) => <span className="text-xs">{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {showCostSheet && (
        <CostManagementModal
          products={rawStats}
          costData={costData}
          onClose={() => setShowCostSheet(false)}
        />
      )}
    </div>
  )
}
