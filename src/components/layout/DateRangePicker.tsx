import { useState } from 'react'
import { subDays, subMonths, startOfMonth, startOfDay, endOfMonth } from 'date-fns'
import { useDateRangeStore } from '../../store/dateRangeStore'
import type { DateRange } from '../../db/useTransactions'

interface Preset {
  label: string
  range: DateRange
}

function makePresets(): Preset[] {
  const now = new Date()
  return [
    { label: 'Today',          range: { start: startOfDay(now), end: now } },
    { label: 'Last 7 days',    range: { start: subDays(now, 7), end: now } },
    { label: 'Last 30 days',   range: { start: subDays(now, 30), end: now } },
    { label: 'Last 90 days',   range: { start: subDays(now, 90), end: now } },
    { label: 'This month',     range: { start: startOfMonth(now), end: endOfMonth(now) } },
    { label: 'Last month',     range: { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) } },
    { label: 'Last 6 months',  range: { start: subMonths(now, 6), end: now } },
    { label: 'Last 12 months', range: { start: subMonths(now, 12), end: now } },
    { label: 'All time',       range: { start: null, end: null } },
  ]
}

export function DateRangePicker() {
  const { range, setRange } = useDateRangeStore()
  const [open, setOpen] = useState(false)

  const presets = makePresets()
  const activePreset = presets.find(p =>
    p.range.start?.getTime() === range.start?.getTime() &&
    p.range.end?.getTime() === range.end?.getTime()
  ) ?? { label: 'Custom' }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm border border-slate-700 rounded-lg bg-slate-800 hover:bg-slate-700 hover:border-slate-600 text-slate-100 transition-colors cursor-pointer"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span className="font-medium">{activePreset.label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-20 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-1.5 min-w-44">
            {presets.map(p => (
              <button
                key={p.label}
                onClick={() => { setRange(p.range); setOpen(false) }}
                className={`w-full text-left px-4 py-2 text-sm transition-colors cursor-pointer ${
                  activePreset.label === p.label
                    ? 'text-teal-400 bg-teal-500/10'
                    : 'text-slate-100 hover:bg-slate-700 hover:text-slate-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
