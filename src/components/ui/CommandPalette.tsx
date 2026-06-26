import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAllTransactions, useOverridesMap } from '../../db/useTransactions'
import { computeProductStats } from '../../engine/analyticsEngine'
import { formatCurrency, formatNumber } from '../../utils/format'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const transactions = useAllTransactions()
  const overrides = useOverridesMap()
  const products = computeProductStats(transactions, overrides)

  const results = query.trim()
    ? products.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : products.slice(0, 8)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => { setSelected(0) }, [query])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(i => Math.min(i + 1, results.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => Math.max(i - 1, 0)) }
      if (e.key === 'Enter' && results[selected]) {
        navigate(`/inventory/${encodeURIComponent(results[selected].name)}`)
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, results, selected, navigate, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg mx-4 bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700">
          <svg className="w-4 h-4 text-slate-200 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search products…"
            className="flex-1 bg-transparent text-slate-100 placeholder-slate-500 text-sm focus:outline-none"
          />
          <kbd className="text-[10px] text-slate-300 border border-slate-700 px-1.5 py-0.5">esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-200 text-center">No products found</p>
          ) : (
            results.map((p, i) => (
              <button
                key={p.name}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
                  i === selected ? 'bg-teal-500/10 text-teal-300' : 'text-slate-200 hover:bg-slate-800'
                }`}
                onClick={() => { navigate(`/inventory/${encodeURIComponent(p.name)}`); onClose() }}
                onMouseEnter={() => setSelected(i)}
              >
                <span className="text-sm font-medium truncate">{p.name}</span>
                <span className="text-xs text-slate-200 font-mono shrink-0 ml-4">
                  {formatCurrency(p.totalRevenue)} · {formatNumber(p.totalUnitsSold)} units
                </span>
              </button>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t border-slate-700/50 flex items-center gap-4 text-[10px] text-slate-300">
          <span><kbd className="border border-slate-700 px-1">↑↓</kbd> navigate</span>
          <span><kbd className="border border-slate-700 px-1">↵</kbd> open</span>
          <span><kbd className="border border-slate-700 px-1">esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
