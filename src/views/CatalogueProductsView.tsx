import { useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { EmptyState } from '../components/ui/EmptyState'
import { Badge } from '../components/ui/Badge'
import { formatCurrency } from '../utils/format'
import { exportCatalogueToXLSX } from '../engine/catalogueExporter'
import { useToastStore } from '../store/toastStore'
import { splitItemVariation } from '../types/models'
import type { CatalogueProduct } from '../types/models'

const KNOWN_CATEGORIES = [
  'Ramen',
  'Carbonated Drinks',
  'Snacks',
  'Candy',
  'Chips',
  'Prepared Food and Beverage',
  'Beverages',
  'Hot Food',
  'Cold Food',
  'Merchandise',
  'Other',
]

interface ItemGroup {
  itemName: string
  category: string
  variations: CatalogueProduct[]
  totalQuantity: number
  priceRange: { min: number; max: number } | null
  anyTaxable: boolean
  allEnabled: boolean
  hasEnabled: boolean
}

function groupByItem(products: CatalogueProduct[]): ItemGroup[] {
  const map = new Map<string, CatalogueProduct[]>()
  for (const p of products) {
    const key = p.itemName || splitItemVariation(p.name).itemName
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(p)
  }
  return Array.from(map.entries()).map(([itemName, variations]) => {
    const prices = variations.map(v => v.price).filter((x): x is number => x !== null)
    const quantities = variations.map(v => v.quantity ?? 0)
    return {
      itemName,
      category: variations[0]?.category ?? '',
      variations,
      totalQuantity: quantities.reduce((a, b) => a + b, 0),
      priceRange: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
      anyTaxable: variations.some(v => v.taxable),
      allEnabled: variations.every(v => v.enabled),
      hasEnabled: variations.some(v => v.enabled),
    }
  }).sort((a, b) => a.itemName.localeCompare(b.itemName))
}

interface FormData {
  itemName: string
  variationName: string
  sku: string
  price: string
  category: string
  customCategory: string
  taxable: boolean
  quantity: string
  enabled: boolean
}

const EMPTY_FORM: FormData = {
  itemName: '', variationName: '', sku: '', price: '',
  category: '', customCategory: '', taxable: false, quantity: '', enabled: true,
}

function toForm(p: CatalogueProduct): FormData {
  const isKnown = KNOWN_CATEGORIES.includes(p.category ?? '')
  return {
    itemName: p.itemName || splitItemVariation(p.name).itemName,
    variationName: p.variationName || splitItemVariation(p.name).variationName,
    sku: p.sku ?? '',
    price: p.price != null ? String(p.price) : '',
    category: isKnown ? (p.category ?? '') : '__custom__',
    customCategory: !isKnown ? (p.category ?? '') : '',
    taxable: p.taxable,
    quantity: p.quantity != null ? String(p.quantity) : '',
    enabled: p.enabled,
  }
}

interface ItemModalProps {
  editing?: CatalogueProduct | null
  forItem?: string
  onClose: () => void
  onSave: (data: Omit<CatalogueProduct, 'id'>) => Promise<void>
}

function ItemModal({ editing, forItem, onClose, onSave }: ItemModalProps) {
  const init: FormData = editing
    ? toForm(editing)
    : forItem
      ? { ...EMPTY_FORM, itemName: forItem }
      : EMPTY_FORM

  const [form, setForm] = useState<FormData>(init)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({})

  const isAddVariation = !!forItem && !editing
  const title = editing ? 'Edit Variation' : isAddVariation ? `Add Variation — ${forItem}` : 'Add New Item'

  function field(key: keyof FormData) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({
        ...f,
        [key]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value,
      }))
  }

  function validate(): boolean {
    const errs: typeof errors = {}
    if (!form.itemName.trim()) errs.itemName = 'Item name is required'
    if (form.itemName.includes(',')) errs.itemName = 'Name cannot contain a comma'
    if (form.price && isNaN(parseFloat(form.price))) errs.price = 'Must be a number'
    const qty = parseInt(form.quantity, 10)
    if (form.quantity && (isNaN(qty) || qty < 0)) errs.quantity = 'Must be a whole number ≥ 0'
    if (form.category === '__custom__' && !form.customCategory.trim()) errs.customCategory = 'Enter a category'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    const cat = form.category === '__custom__' ? form.customCategory.trim() : form.category
    const variation = form.variationName.trim() || 'Regular'
    const itemN = form.itemName.trim()
    const fullName = variation === 'Regular' ? itemN : `${itemN} (${variation})`
    await onSave({
      name: fullName,
      itemName: itemN,
      variationName: variation,
      sku: form.sku.trim(),
      price: form.price ? parseFloat(form.price) : null,
      category: cat,
      taxable: form.taxable,
      enabled: form.enabled,
      quantity: form.quantity ? parseInt(form.quantity, 10) : null,
      importedAt: new Date(),
      squareItemID: editing?.squareItemID ?? '',
    })
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-100 text-base">{title}</h2>
            {!editing && !isAddVariation && (
              <p className="text-xs text-slate-200 mt-0.5">Creates the item with its first variation</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-200 hover:text-slate-200 transition-colors cursor-pointer p-1 rounded-md hover:bg-slate-700"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[72vh] overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-slate-200 mb-1.5">
              Item Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.itemName}
              onChange={field('itemName')}
              disabled={isAddVariation}
              placeholder="e.g. Ramune Soda"
              className="w-full bg-slate-700/60 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {errors.itemName && <p className="text-xs text-red-400 mt-1">{errors.itemName}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-200 mb-1.5">Variation Name</label>
            <input
              type="text"
              value={form.variationName}
              onChange={field('variationName')}
              placeholder="e.g. Strawberry, Large, 12oz… (blank = Regular)"
              className="w-full bg-slate-700/60 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-200 mb-1.5">Price ($)</label>
              <input
                type="number" min="0" step="0.01"
                value={form.price} onChange={field('price')}
                placeholder="e.g. 3.50"
                className="w-full bg-slate-700/60 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              />
              {errors.price && <p className="text-xs text-red-400 mt-1">{errors.price}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-200 mb-1.5">Stock Qty</label>
              <input
                type="number" min="0" step="1"
                value={form.quantity} onChange={field('quantity')}
                placeholder="e.g. 24"
                className="w-full bg-slate-700/60 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              />
              {errors.quantity && <p className="text-xs text-red-400 mt-1">{errors.quantity}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-200 mb-1.5">SKU</label>
            <input
              type="text"
              value={form.sku} onChange={field('sku')}
              placeholder="e.g. RAM-STRAW-001"
              className="w-full bg-slate-700/60 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-200 mb-1.5">Category</label>
            <select
              value={form.category} onChange={field('category')}
              className="w-full bg-slate-700/60 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500/40 cursor-pointer"
            >
              <option value="">Select a category…</option>
              {KNOWN_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="__custom__">Custom…</option>
            </select>
          </div>
          {form.category === '__custom__' && (
            <div>
              <label className="block text-xs font-medium text-slate-200 mb-1.5">Custom Category</label>
              <input
                type="text"
                value={form.customCategory} onChange={field('customCategory')}
                placeholder="Enter category name"
                className="w-full bg-slate-700/60 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              />
              {errors.customCategory && <p className="text-xs text-red-400 mt-1">{errors.customCategory}</p>}
            </div>
          )}

          <div className="flex gap-6 pt-1">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={form.taxable} onChange={field('taxable')} className="w-4 h-4 rounded accent-teal-500" />
              <span className="text-sm text-slate-100">Taxable</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={form.enabled} onChange={field('enabled')} className="w-4 h-4 rounded accent-teal-500" />
              <span className="text-sm text-slate-100">Active</span>
            </label>
          </div>

          <div className="text-xs text-slate-200 bg-slate-700/30 rounded-lg px-3 py-2 border border-slate-700/60">
            Tax rule: only <span className="text-teal-400">ramen</span> and <span className="text-teal-400">carbonated drinks</span> are taxable.
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-700 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-200 hover:text-slate-200 transition-colors cursor-pointer">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer"
          >
            {saving ? 'Saving…' : editing ? 'Save Changes' : isAddVariation ? 'Add Variation' : 'Add Item'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PriceDisplay({ range }: { range: { min: number; max: number } | null }) {
  if (!range) return <span className="text-slate-200">—</span>
  if (range.min === range.max) return <span className="text-slate-100">{formatCurrency(range.min)}</span>
  return <span className="text-slate-100">{formatCurrency(range.min)} – {formatCurrency(range.max)}</span>
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
      className={`transition-transform duration-200 shrink-0 ${open ? 'rotate-90' : ''}`}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

export default function CatalogueProductsView() {
  const catalogue  = useLiveQuery(() => db.catalogueProducts.orderBy('name').toArray(), []) ?? []
  const showToast  = useToastStore(s => s.show)
  const [search, setSearch]                 = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [showArchived, setShowArchived]     = useState(false)
  const [expandedItems, setExpandedItems]   = useState<Set<string>>(new Set())
  const [showModal, setShowModal]           = useState(false)
  const [editTarget, setEditTarget]         = useState<CatalogueProduct | null>(null)
  const [addVarFor, setAddVarFor]           = useState<string | null>(null)
  const [exporting, setExporting]           = useState(false)

  const categories = useMemo(() => {
    const cats = Array.from(new Set(catalogue.map(c => c.category).filter(Boolean)))
    return ['All', ...cats.sort()]
  }, [catalogue])

  const allGroups = useMemo(() => groupByItem(catalogue), [catalogue])

  const filteredGroups = useMemo(() => {
    const q = search.toLowerCase()
    return allGroups
      .map(g => {
        const vars = g.variations.filter(v => {
          if (!showArchived && !v.enabled) return false
          if (categoryFilter !== 'All' && v.category !== categoryFilter) return false
          if (q && !v.name.toLowerCase().includes(q) && !v.sku.toLowerCase().includes(q)) return false
          return true
        })
        if (vars.length === 0 && !g.itemName.toLowerCase().includes(q)) return null
        return { ...g, variations: vars }
      })
      .filter((g): g is ItemGroup => g !== null)
  }, [allGroups, search, categoryFilter, showArchived])

  const totalItems    = allGroups.length
  const totalVars     = catalogue.length
  const activeVars    = catalogue.filter(c => c.enabled).length
  const archivedVars  = catalogue.filter(c => !c.enabled).length
  const totalStock    = catalogue.reduce((s, c) => s + (c.quantity ?? 0), 0)
  const multiVarItems = allGroups.filter(g => g.variations.length > 1).length

  function toggleExpand(itemName: string) {
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(itemName)) next.delete(itemName)
      else next.add(itemName)
      return next
    })
  }

  function expandAll() {
    setExpandedItems(new Set(filteredGroups.map(g => g.itemName)))
  }

  function collapseAll() {
    setExpandedItems(new Set())
  }

  async function handleSave(data: Omit<CatalogueProduct, 'id'>) {
    if (editTarget?.id) {
      await db.catalogueProducts.update(editTarget.id, data)
      showToast(`Updated "${data.name}"`, 'success')
    } else {
      await db.catalogueProducts.add(data)
      const msg = addVarFor
        ? `Added variation "${data.variationName}" to "${data.itemName}"`
        : `Added "${data.itemName}" to catalogue`
      showToast(msg, 'success')
      setExpandedItems(prev => new Set([...prev, data.itemName]))
    }
  }

  function openAdd() {
    setEditTarget(null)
    setAddVarFor(null)
    setShowModal(true)
  }

  function openAddVariation(itemName: string) {
    setEditTarget(null)
    setAddVarFor(itemName)
    setShowModal(true)
  }

  function openEdit(product: CatalogueProduct) {
    setEditTarget(product)
    setAddVarFor(null)
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditTarget(null)
    setAddVarFor(null)
  }

  function handleExport() {
    if (catalogue.length === 0) { showToast('No items to export.', 'error'); return }
    setExporting(true)
    try {
      exportCatalogueToXLSX(catalogue)
      showToast(`Exported ${catalogue.length} variations across ${totalItems} items`, 'success')
    } catch {
      showToast('Export failed.', 'error')
    } finally {
      setExporting(false)
    }
  }

  if (catalogue.length === 0) {
    return (
      <>
        <div className="flex justify-end mb-4">
          <button onClick={openAdd} className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium transition-colors flex items-center gap-2 cursor-pointer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New Item
          </button>
        </div>
        <EmptyState title="No catalogue products" subtitle="Import a Square catalogue XLSX, sync via Square, or add items manually." />
        {showModal && <ItemModal onClose={closeModal} onSave={handleSave} />}
      </>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Catalogue Products</h1>
          <p className="text-sm text-slate-200 mt-0.5">{totalItems} items · {totalVars} total variations</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleExport} disabled={exporting}
            className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-600 disabled:opacity-50 text-slate-200 text-sm font-medium transition-colors flex items-center gap-2 cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            {exporting ? 'Exporting…' : 'Export to Square'}
          </button>
          <button
            onClick={openAdd}
            className="px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium transition-colors flex items-center gap-2 cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New Item
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Items',           value: totalItems,    color: 'text-teal-400' },
          { label: 'Multi-variation', value: multiVarItems, color: 'text-blue-400' },
          { label: 'Active vars',     value: activeVars,    color: 'text-emerald-400' },
          { label: 'Archived',        value: archivedVars,  color: 'text-slate-200' },
          { label: 'Total stock',     value: totalStock,    color: 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="bg-slate-800/30 border border-slate-700/40 px-4 py-3">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value.toLocaleString()}</p>
            <p className="text-xs text-slate-200 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search items or SKU…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
        />
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 cursor-pointer"
        >
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer select-none">
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="rounded" />
          Show archived
        </label>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-200">{filteredGroups.length} items</span>
          <button onClick={expandAll} className="text-xs text-slate-200 hover:text-teal-400 transition-colors cursor-pointer px-2 py-1 rounded hover:bg-slate-800">
            Expand all
          </button>
          <button onClick={collapseAll} className="text-xs text-slate-200 hover:text-teal-400 transition-colors cursor-pointer px-2 py-1 rounded hover:bg-slate-800">
            Collapse all
          </button>
        </div>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 uppercase text-xs border-b border-slate-700/60">
              <tr>
                <th className="px-4 py-3 text-left w-8"></th>
                <th className="px-4 py-3 text-left">Item</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-center">Tax</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map(group => {
                const isOpen = expandedItems.has(group.itemName)
                const varCount = group.variations.length

                return (
                  <>
                    <tr
                      key={`item-${group.itemName}`}
                      onClick={() => varCount > 1 && toggleExpand(group.itemName)}
                      className={`border-b border-slate-700/40 transition-colors ${varCount > 1 ? 'cursor-pointer hover:bg-slate-700/40' : 'hover:bg-slate-700/20'} ${isOpen ? 'bg-slate-700/20' : ''}`}
                    >
                      <td className="px-4 py-3 text-slate-200">
                        {varCount > 1
                          ? <Chevron open={isOpen} />
                          : <span className="w-3.5 inline-block" />
                        }
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-100">{group.itemName}</span>
                          {varCount > 1 && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-500/15 text-teal-400 border border-teal-500/25 tabular-nums">
                              {varCount} vars
                            </span>
                          )}
                          {varCount === 1 && group.variations[0].variationName !== 'Regular' && (
                            <span className="text-xs text-slate-200">{group.variations[0].variationName}</span>
                          )}
                        </div>
                        {varCount === 1 && group.variations[0].sku && (
                          <p className="text-[11px] text-slate-200 font-mono mt-0.5">{group.variations[0].sku}</p>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        {group.category
                          ? <Badge variant="secondary">{group.category}</Badge>
                          : <span className="text-slate-200">—</span>}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <PriceDisplay range={group.priceRange} />
                      </td>

                      <td className="px-4 py-3 text-right text-slate-100 tabular-nums">
                        {group.totalQuantity > 0 ? group.totalQuantity : <span className="text-slate-200">—</span>}
                      </td>

                      <td className="px-4 py-3 text-center">
                        {group.anyTaxable
                          ? <span className="text-xs font-medium text-emerald-400">Yes</span>
                          : <span className="text-xs text-slate-200">No</span>}
                      </td>

                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          group.allEnabled ? 'bg-emerald-500/15 text-emerald-400'
                          : group.hasEnabled ? 'bg-amber-500/15 text-amber-400'
                          : 'bg-slate-700 text-slate-200'
                        }`}>
                          {group.allEnabled ? 'Active' : group.hasEnabled ? 'Partial' : 'Archived'}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {varCount === 1 && (
                            <button
                              onClick={() => openEdit(group.variations[0])}
                              className="text-xs px-2.5 py-1 rounded-md text-slate-200 hover:text-teal-400 hover:bg-slate-700 border border-slate-600/60 hover:border-teal-500/40 transition-colors cursor-pointer"
                            >
                              Edit
                            </button>
                          )}
                          <button
                            onClick={() => openAddVariation(group.itemName)}
                            className="text-xs px-2.5 py-1 rounded-md text-slate-200 hover:text-teal-400 hover:bg-slate-700 border border-slate-600/60 hover:border-teal-500/40 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            + Variation
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isOpen && group.variations.map((v, vi) => (
                      <tr
                        key={`var-${v.id ?? v.name}`}
                        className={`border-b border-slate-700/20 bg-slate-900/60 hover:bg-slate-700/30 transition-colors ${!v.enabled ? 'opacity-50' : ''}`}
                      >
                        <td className="px-4 py-2.5" />

                        <td className="px-4 py-2.5 pl-10">
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />
                            <span className="text-slate-200 text-xs font-medium">
                              {v.variationName || 'Regular'}
                            </span>
                            {v.sku && <span className="text-[10px] text-slate-200 font-mono">{v.sku}</span>}
                          </div>
                        </td>

                        <td className="px-4 py-2.5">
                          {vi === 0
                            ? group.category ? <Badge variant="secondary">{group.category}</Badge> : <span className="text-slate-200">—</span>
                            : null}
                        </td>

                        <td className="px-4 py-2.5 text-right text-slate-100 text-xs tabular-nums">
                          {v.price != null ? formatCurrency(v.price) : <span className="text-slate-200">—</span>}
                        </td>

                        <td className="px-4 py-2.5 text-right text-slate-100 text-xs tabular-nums">
                          {v.quantity != null ? v.quantity : <span className="text-slate-200">—</span>}
                        </td>

                        <td className="px-4 py-2.5 text-center">
                          {v.taxable
                            ? <span className="text-xs text-emerald-400">Yes</span>
                            : <span className="text-xs text-slate-200">No</span>}
                        </td>

                        <td className="px-4 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${v.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-200'}`}>
                            {v.enabled ? 'Active' : 'Archived'}
                          </span>
                        </td>

                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => openEdit(v)}
                            className="text-xs px-2.5 py-1 rounded-md text-slate-200 hover:text-teal-400 hover:bg-slate-700 border border-slate-600/60 hover:border-teal-500/40 transition-colors cursor-pointer"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
        {filteredGroups.length === 0 && (
          <div className="text-center py-12 text-slate-200 text-sm">No items match your filters.</div>
        )}
      </div>

      <p className="text-xs text-slate-200 text-right">
        "Export to Square" downloads a .xlsx importable at Square Dashboard → Items → Actions → Import Library.
      </p>

      {showModal && (
        <ItemModal
          editing={editTarget}
          forItem={addVarFor ?? undefined}
          onClose={closeModal}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
