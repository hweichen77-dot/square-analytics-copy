import { useMemo, useState } from 'react'
import { useFilteredTransactions, useProductBundles } from '../db/useTransactions'
import { useDateRangeStore } from '../store/dateRangeStore'
import { computeProductStats } from '../engine/analyticsEngine'
import { EmptyState } from '../components/ui/EmptyState'
import { db } from '../db/database'
import { formatCurrency } from '../utils/format'
import type { SalesTransaction, ProductBundle } from '../types/models'
import { parseProductItems } from '../types/models'
import { format } from 'date-fns'

interface CoPurchasePair {
  id: string
  productA: string
  productB: string
  count: number
  score: number
  categoryPairing: string
  suggestedPrice: number
}

function buildPairs(
  transactions: SalesTransaction[],
  priceByName: Record<string, number>,
  categoryByName: Record<string, string>,
): CoPurchasePair[] {
  const coCount: Record<string, number> = {}
  const txCountByProduct: Record<string, number> = {}

  for (const tx of transactions) {
    const names = Array.from(new Set(parseProductItems(tx.itemDescription).map(i => i.name)))
    for (const n of names) txCountByProduct[n] = (txCountByProduct[n] ?? 0) + 1
    if (names.length < 2) continue
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i] < names[j] ? names[i] : names[j]
        const b = names[i] < names[j] ? names[j] : names[i]
        const key = `${a}:::${b}`
        coCount[key] = (coCount[key] ?? 0) + 1
      }
    }
  }

  const result: CoPurchasePair[] = []
  for (const [key, count] of Object.entries(coCount)) {
    const [a, b] = key.split(':::')
    const txA = txCountByProduct[a] ?? 0
    const txB = txCountByProduct[b] ?? 0
    const union = txA + txB - count
    const jaccard = union > 0 ? (count / union) * 100 : 0
    const catA = categoryByName[a] ?? 'Other'
    const catB = categoryByName[b] ?? 'Other'
    result.push({
      id: key,
      productA: a,
      productB: b,
      count,
      score: jaccard,
      categoryPairing: catA === catB ? `${catA} + ${catA}` : `${catA} + ${catB}`,
      suggestedPrice: ((priceByName[a] ?? 0) + (priceByName[b] ?? 0)) * 0.9,
    })
  }

  return result.sort((a, b) => b.count - a.count).slice(0, 30)
}

function BundleEditorModal({
  bundle,
  products,
  onSave,
  onClose,
}: {
  bundle: ProductBundle | null
  products: string[]
  onSave: (name: string, productNames: string[], price: number, notes: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(bundle?.name ?? '')
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set(bundle?.productNames ?? []))
  const [priceText, setPriceText] = useState(bundle ? bundle.bundlePrice.toFixed(2) : '')
  const [notes, setNotes] = useState(bundle?.notes ?? '')
  const [search, setSearch] = useState('')

  const filtered = search ? products.filter(p => p.toLowerCase().includes(search.toLowerCase())) : products

  function toggle(p: string) {
    const next = new Set(selectedProducts)
    if (next.has(p)) next.delete(p)
    else if (next.size < 3) next.add(p)
    setSelectedProducts(next)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 w-[500px] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
          <h2 className="text-base font-semibold">{bundle ? 'Edit Bundle' : 'Create Bundle'}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-400 text-xl">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Bundle Name</label>
            <input className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm"
              value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Snack Combo" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Bundle Price</label>
            <input type="number" className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm"
              value={priceText} onChange={e => setPriceText(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Notes (optional)</label>
            <input className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm"
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Products (select 2–3 · {selectedProducts.size}/3)
            </label>
            <input className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm mb-2"
              placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} />
            <div className="border border-slate-700 rounded-lg overflow-y-auto h-48">
              {filtered.map(p => (
                <button
                  key={p}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-700/50"
                  onClick={() => toggle(p)}
                  disabled={!selectedProducts.has(p) && selectedProducts.size >= 3}
                >
                  <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${selectedProducts.has(p) ? 'bg-teal-500 border-teal-500' : 'border-slate-600'}`}>
                    {selectedProducts.has(p) && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#020617" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    )}
                  </span>
                  <span className="truncate text-slate-300">{p}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-700/50">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-300">Cancel</button>
          <button
            disabled={!name.trim() || selectedProducts.size < 2}
            onClick={() => {
              onSave(name, Array.from(selectedProducts), parseFloat(priceText) || 0, notes)
              onClose()
            }}
            className="px-4 py-2 text-sm bg-teal-500 text-slate-950 rounded-lg hover:bg-teal-600 disabled:opacity-50"
          >
            Save Bundle
          </button>
        </div>
      </div>
    </div>
  )
}

export default function BundleView() {
  const { range } = useDateRangeStore()
  const transactions = useFilteredTransactions(range)
  const savedBundles = useProductBundles()
  const [showCreate, setShowCreate] = useState(false)
  const [editingBundle, setEditingBundle] = useState<ProductBundle | null>(null)
  const [selectedProduct, setSelectedProduct] = useState('')

  const productStats = useMemo(() => computeProductStats(transactions), [transactions])
  const productList = useMemo(() => productStats.map(p => p.name).sort(), [productStats])
  const priceByName = useMemo(
    () => Object.fromEntries(productStats.map(p => [p.name, p.avgPrice])),
    [productStats],
  )
  const categoryByName = useMemo(
    () => Object.fromEntries(productStats.map(p => [p.name, p.category])),
    [productStats],
  )

  const pairs = useMemo(
    () => buildPairs(transactions, priceByName, categoryByName),
    [transactions, priceByName, categoryByName],
  )

  const multiItemTxCount = useMemo(
    () => transactions.filter(tx => new Set(parseProductItems(tx.itemDescription).map(i => i.name)).size >= 2).length,
    [transactions],
  )

  const affinityForSelected = useMemo(() => {
    if (!selectedProduct) return []
    return pairs
      .filter(p => p.productA === selectedProduct || p.productB === selectedProduct)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  }, [pairs, selectedProduct])

  const groupedPairs = useMemo(() => {
    const g: Record<string, CoPurchasePair[]> = {}
    for (const p of pairs) {
      if (!g[p.categoryPairing]) g[p.categoryPairing] = []
      g[p.categoryPairing].push(p)
    }
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b))
  }, [pairs])

  async function createBundle(name: string, productNames: string[], bundlePrice: number, notes: string) {
    await db.productBundles.add({ name, productNames, bundlePrice, createdDate: new Date(), notes })
  }

  async function updateBundle(bundle: ProductBundle, name: string, productNames: string[], bundlePrice: number, notes: string) {
    await db.productBundles.update(bundle.id!, { name, productNames, bundlePrice, notes })
  }

  async function deleteBundle(bundle: ProductBundle) {
    if (bundle.id) await db.productBundles.delete(bundle.id)
  }

  if (transactions.length === 0) {
    return <EmptyState title="No data" subtitle="Import transaction data to see bundle opportunities." />
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-100">Bundle & Cross-Sell</h1>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Multi-Item Transactions', value: multiItemTxCount },
          { label: 'Product Pairs Found', value: pairs.length },
          { label: 'Saved Bundles', value: savedBundles.length },
        ].map(c => (
          <div key={c.label} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className="text-xl font-bold text-slate-100 mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h2 className="text-base font-semibold text-slate-100 mb-3">Product Affinity Lookup</h2>
        <select
          className="border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300 mb-4 max-w-xs"
          value={selectedProduct}
          onChange={e => setSelectedProduct(e.target.value)}
        >
          <option value="">Choose a product...</option>
          {productList.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        {selectedProduct && affinityForSelected.length === 0 && (
          <p className="text-sm text-slate-500">No co-purchase data found for "{selectedProduct}".</p>
        )}
        {affinityForSelected.length > 0 && (
          <div className="space-y-2">
            {affinityForSelected.map(pair => {
              const partner = pair.productA === selectedProduct ? pair.productB : pair.productA
              const maxCount = affinityForSelected[0].count
              return (
                <div key={pair.id} className="flex items-center gap-3 p-3 bg-slate-900 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-slate-100">{partner}</p>
                    <p className="text-xs text-slate-500">
                      Bought together {pair.count}× · Score: {pair.score.toFixed(1)}%
                    </p>
                  </div>
                  <div className="w-20 bg-gray-200 rounded-full h-1.5">
                    <div
                      className="bg-teal-500/100 rounded-full h-1.5"
                      style={{ width: `${(pair.count / maxCount) * 100}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h2 className="text-base font-semibold text-slate-100 mb-4">Top Co-Purchase Pairs</h2>
        {pairs.length === 0 ? (
          <p className="text-sm text-slate-500">No multi-item transactions found.</p>
        ) : (
          <div className="space-y-6">
            {groupedPairs.map(([category, categoryPairs]) => {
              const maxCount = categoryPairs[0]?.count ?? 1
              return (
                <div key={category}>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">{category}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {categoryPairs.map((p, idx) => {
                      const isTop = idx === 0 && category === groupedPairs[0][0]
                      const strength = p.score > 20 ? 'Strong' : p.score > 10 ? 'Medium' : 'Weak'
                      const strengthColors = {
                        Strong: 'bg-emerald-100 text-emerald-700',
                        Medium: 'bg-amber-100 text-amber-400',
                        Weak: 'bg-slate-800 text-slate-500',
                      }
                      const barColor = p.score > 20 ? '#10b981' : p.score > 10 ? '#f59e0b' : '#9ca3af'
                      return (
                        <div
                          key={p.id}
                          className={`rounded-xl border shadow-sm p-4 flex flex-col gap-3 ${isTop ? 'border-teal-300 bg-teal-500/10' : 'border-slate-700/50 bg-slate-800'}`}
                        >
                          {isTop && (
                            <p className="text-xs font-semibold text-teal-400 uppercase tracking-wide">Top Recommendation</p>
                          )}
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm text-slate-100 truncate">{p.productA}</p>
                              <p className="text-xs text-slate-500 mt-0.5">+</p>
                              <p className="font-semibold text-sm text-slate-100 truncate">{p.productB}</p>
                            </div>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${strengthColors[strength]}`}>
                              {strength}
                            </span>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-slate-500">Bought together {p.count}×</span>
                              <span className="text-xs font-mono font-semibold" style={{ color: barColor }}>{p.score.toFixed(1)}% match</span>
                            </div>
                            <div className="w-full bg-slate-800 rounded-full h-1.5">
                              <div
                                className="rounded-full h-1.5 transition-all"
                                style={{ width: `${Math.min(100, (p.count / maxCount) * 100)}%`, backgroundColor: barColor }}
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-1 border-t border-slate-700/50">
                            <span className="text-xs text-slate-500">Suggested bundle price</span>
                            <span className="text-sm font-mono font-bold text-slate-200">{formatCurrency(p.suggestedPrice)}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-100">Saved Bundles</h2>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 text-sm bg-teal-500 text-slate-950 rounded-lg hover:bg-teal-600"
          >
            + Create Bundle
          </button>
        </div>
        {savedBundles.length === 0 ? (
          <p className="text-sm text-slate-500">No bundles created yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {savedBundles.map(bundle => (
              <div key={bundle.id} className="border border-slate-700 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-sm text-slate-100">{bundle.name}</p>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingBundle(bundle)} className="text-xs text-slate-500 hover:text-teal-400">Edit</button>
                    <button onClick={() => deleteBundle(bundle)} className="text-xs text-red-400 hover:text-red-400">Delete</button>
                  </div>
                </div>
                {bundle.productNames.map(p => (
                  <div key={p} className="text-xs text-slate-500 flex items-center gap-1">
                    <span>🛍</span> {p}
                  </div>
                ))}
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-700/50">
                  <span className="text-sm font-semibold text-slate-100">{formatCurrency(bundle.bundlePrice)}</span>
                  <span className="text-xs text-slate-500">{format(bundle.createdDate, 'MMM d, yyyy')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <BundleEditorModal bundle={null} products={productList} onSave={createBundle} onClose={() => setShowCreate(false)} />
      )}
      {editingBundle && (
        <BundleEditorModal
          bundle={editingBundle}
          products={productList}
          onSave={(name, pn, price, notes) => updateBundle(editingBundle, name, pn, price, notes)}
          onClose={() => setEditingBundle(null)}
        />
      )}
    </div>
  )
}
