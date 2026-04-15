import { useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, parseISO } from 'date-fns'
import { db } from '../db/database'
import { OPEX_CATEGORIES } from '../types/models'
import type { OpexEntry, OpexCategory } from '../types/models'
import { formatCurrency } from '../utils/format'
import { useToastStore } from '../store/toastStore'

// ─── Category badge colours ───────────────────────────────────────────────────

const CATEGORY_STYLES: Record<string, string> = {
  'Store Equipment':   'bg-blue-500/15 text-blue-400 border border-blue-500/25',
  'Marketing':         'bg-purple-500/15 text-purple-400 border border-purple-500/25',
  'Misc':              'bg-slate-500/15 text-slate-400 border border-slate-500/25',
  'Employee Expenses': 'bg-orange-500/15 text-orange-400 border border-orange-500/25',
  'Gift Cards':        'bg-pink-500/15 text-pink-400 border border-pink-500/25',
  'Service Charge':    'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25',
  'Other':             'bg-slate-600/15 text-slate-500 border border-slate-600/25',
}

function CategoryBadge({ category }: { category: string }) {
  const cls = CATEGORY_STYLES[category] ?? CATEGORY_STYLES['Other']
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {category}
    </span>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

const EMPTY_FORM = (): Omit<OpexEntry, 'id'> => ({
  name: '',
  category: 'Store Equipment',
  amount: 0,
  month: format(new Date(), 'yyyy-MM'),
  notes: '',
})

function EntryModal({
  initial,
  onSave,
  onClose,
}: {
  initial: OpexEntry | null
  onSave: (entry: Omit<OpexEntry, 'id'>, id?: number) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<Omit<OpexEntry, 'id'>>(
    initial ? { name: initial.name, category: initial.category, amount: initial.amount, month: initial.month, notes: initial.notes ?? '' }
            : EMPTY_FORM()
  )
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    await onSave(form, initial?.id)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="font-semibold text-slate-100">{initial ? 'Edit Expense' : 'Add Expense'}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Expense Name</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Display shelving unit"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/60"
            />
          </div>

          {/* Category + Month row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Category</label>
              <select
                value={form.category}
                onChange={e => set('category', e.target.value as OpexCategory)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/60 cursor-pointer"
              >
                {OPEX_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Month</label>
              <input
                type="month"
                required
                value={form.month}
                onChange={e => set('month', e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/60"
              />
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Amount ($)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
              <input
                type="number"
                required
                min="0"
                step="0.01"
                value={form.amount || ''}
                onChange={e => set('amount', parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-7 pr-3 py-2 text-sm text-slate-100 placeholder-slate-600 font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/60"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Notes <span className="text-slate-600">(optional)</span></label>
            <input
              type="text"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="e.g. Receipt #12345"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/60"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 text-sm font-medium border border-slate-600 text-slate-400 rounded-lg hover:bg-slate-700/50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.name.trim() || form.amount <= 0}
              className="flex-1 py-2 text-sm font-semibold bg-teal-500 text-slate-950 rounded-lg hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {saving ? 'Saving…' : initial ? 'Save Changes' : 'Add Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function OpexView() {
  const { show } = useToastStore()
  const [filterMonth, setFilterMonth] = useState<string>('all')
  const [modalEntry, setModalEntry] = useState<OpexEntry | null | 'new'>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const allEntries = useLiveQuery(() => db.opexEntries.orderBy('month').reverse().toArray(), []) ?? []

  // Distinct months for filter dropdown
  const availableMonths = useMemo(() => {
    const set = new Set(allEntries.map(e => e.month))
    return Array.from(set).sort().reverse()
  }, [allEntries])

  const filtered = useMemo(() => {
    if (filterMonth === 'all') return allEntries
    return allEntries.filter(e => e.month === filterMonth)
  }, [allEntries, filterMonth])

  // Summary stats
  const totalOpex = filtered.reduce((s, e) => s + e.amount, 0)
  const byCategory = useMemo(() => {
    const map: Record<string, number> = {}
    for (const e of filtered) map[e.category] = (map[e.category] ?? 0) + e.amount
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [filtered])

  async function handleSave(data: Omit<OpexEntry, 'id'>, id?: number) {
    try {
      if (id !== undefined) {
        await db.opexEntries.update(id, data)
        show('Expense updated', 'success')
      } else {
        await db.opexEntries.add(data)
        show('Expense added', 'success')
      }
      setModalEntry(null)
    } catch {
      show('Failed to save expense', 'error')
    }
  }

  async function handleDelete(id: number) {
    try {
      await db.opexEntries.delete(id)
      show('Expense deleted', 'success')
    } catch {
      show('Failed to delete', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Operating Expenses</h1>
          <p className="text-sm text-slate-500 mt-0.5">Track manual OPEX entries that appear in the Monthly Income Statement</p>
        </div>
        <button
          onClick={() => setModalEntry('new')}
          className="flex items-center gap-2 px-4 py-2 bg-teal-500 text-slate-950 text-sm font-semibold rounded-lg hover:bg-teal-400 transition-colors cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Expense
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">{filterMonth === 'all' ? 'Total OPEX' : 'OPEX This Month'}</p>
          <p className="text-xl font-semibold font-mono text-slate-100">{formatCurrency(totalOpex)}</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Entries</p>
          <p className="text-xl font-semibold text-slate-100">{filtered.length}</p>
        </div>
        {byCategory.slice(0, 2).map(([cat, amt]) => (
          <div key={cat} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1 truncate">{cat}</p>
            <p className="text-xl font-semibold font-mono text-slate-100">{formatCurrency(amt)}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-slate-500">Filter by month</label>
        <select
          value={filterMonth}
          onChange={e => setFilterMonth(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 cursor-pointer"
        >
          <option value="all">All months</option>
          {availableMonths.map(m => (
            <option key={m} value={m}>{format(parseISO(m + '-01'), 'MMMM yyyy')}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-12 text-center">
          <div className="w-10 h-10 bg-slate-700 rounded-xl flex items-center justify-center mx-auto mb-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
          <p className="text-slate-400 font-medium mb-1">No expenses yet</p>
          <p className="text-sm text-slate-600">Add operating expenses to include them in your Monthly Income Statement.</p>
          <button
            onClick={() => setModalEntry('new')}
            className="mt-4 px-4 py-2 bg-teal-500/15 text-teal-400 border border-teal-500/30 rounded-lg text-sm font-medium hover:bg-teal-500/25 transition-colors cursor-pointer"
          >
            Add your first expense
          </button>
        </div>
      ) : (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 border-b border-slate-700/50">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Category</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Month</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40">
              {filtered.map(entry => (
                <tr key={entry.id} className="hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-200">{entry.name}</td>
                  <td className="px-4 py-3"><CategoryBadge category={entry.category} /></td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {format(parseISO(entry.month + '-01'), 'MMM yyyy')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-200">{formatCurrency(entry.amount)}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs max-w-xs truncate">{entry.notes || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setModalEntry(entry)}
                        className="p-1.5 text-slate-500 hover:text-teal-400 hover:bg-teal-500/10 rounded-md transition-colors cursor-pointer"
                        aria-label="Edit"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      {deletingId === entry.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(entry.id!)}
                            className="px-2 py-1 text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 rounded-md hover:bg-red-500/30 transition-colors cursor-pointer"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="px-2 py-1 text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeletingId(entry.id!)}
                          className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors cursor-pointer"
                          aria-label="Delete"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Category totals footer */}
          {byCategory.length > 0 && (
            <div className="border-t border-slate-700 px-4 py-3 bg-slate-900/50">
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Totals:</span>
                {byCategory.map(([cat, amt]) => (
                  <span key={cat} className="text-xs text-slate-400">
                    <span className="text-slate-600">{cat}: </span>
                    <span className="font-mono text-slate-300">{formatCurrency(amt)}</span>
                  </span>
                ))}
                <span className="ml-auto text-xs font-semibold text-slate-200 font-mono">
                  Total: {formatCurrency(totalOpex)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {modalEntry !== null && (
        <EntryModal
          initial={modalEntry === 'new' ? null : modalEntry}
          onSave={handleSave}
          onClose={() => setModalEntry(null)}
        />
      )}
    </div>
  )
}
