import { useMemo, useState } from 'react'
import {
  ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { useFilteredTransactions, useStoreEvents } from '../db/useTransactions'
import { useDateRangeStore } from '../store/dateRangeStore'
import { computeDailyRevenue } from '../engine/analyticsEngine'
import { EmptyState } from '../components/ui/EmptyState'
import { db } from '../db/database'
import { formatCurrency } from '../utils/format'
import type { StoreEvent, SalesTransaction } from '../types/models'
import { EVENT_TYPES, eventColor } from '../types/models'
import { format, startOfDay } from 'date-fns'
import { parseProductItems } from '../types/models'

interface EventImpact {
  event: StoreEvent
  totalRevenueDuring: number
  avgDailyRevenueDuring: number
  avgDailyRevenueBefore: number
  upliftPct: number
  topProducts: { name: string; qty: number }[]
}

const EVENT_TAILWIND_COLOR: Record<string, string> = {
  purple: 'bg-purple-500/15 text-purple-400',
  orange: 'bg-orange-500/15 text-orange-400',
  red: 'bg-red-500/15 text-red-400',
  blue: 'bg-blue-500/15 text-blue-400',
  green: 'bg-emerald-500/15 text-emerald-400',
  teal: 'bg-teal-100 text-teal-700',
  gray: 'bg-slate-800 text-slate-400',
}

function eventHex(type: string) {
  const map: Record<string, string> = {
    'Spirit Week': '#8b5cf6', 'Homecoming': '#f97316', 'Finals': '#ef4444',
    'Back to School': '#3b82f6', 'Holiday': '#16a34a', 'Sports Game': '#14b8a6',
  }
  return map[type] ?? '#9ca3af'
}

function computeImpact(event: StoreEvent, transactions: SalesTransaction[]): EventImpact {
  const eventStart = startOfDay(event.startDate)
  const eventEnd = startOfDay(event.endDate)

  const duringTx = transactions.filter(tx => {
    const d = startOfDay(tx.date)
    return d >= eventStart && d <= eventEnd
  })
  const totalRevenueDuring = duringTx.reduce((s, t) => s + t.netSales, 0)
  const distinctDaysDuring = new Set(duringTx.map(tx => startOfDay(tx.date).getTime())).size
  const avgDailyRevenueDuring = totalRevenueDuring / Math.max(1, distinctDaysDuring)

  const baselineEnd = new Date(eventStart.getTime() - 86_400_000)
  const baselineStart = new Date(eventStart.getTime() - 14 * 86_400_000)
  const baselineTx = transactions.filter(tx => {
    const d = startOfDay(tx.date)
    return d >= startOfDay(baselineStart) && d <= startOfDay(baselineEnd)
  })
  const baselineRevenue = baselineTx.reduce((s, t) => s + t.netSales, 0)
  const distinctDaysBase = new Set(baselineTx.map(tx => startOfDay(tx.date).getTime())).size
  const avgDailyRevenueBefore = baselineRevenue / Math.max(1, distinctDaysBase)

  const upliftPct = avgDailyRevenueBefore > 0
    ? ((avgDailyRevenueDuring - avgDailyRevenueBefore) / avgDailyRevenueBefore) * 100
    : 0

  const productQty: Record<string, number> = {}
  for (const tx of duringTx) {
    for (const item of parseProductItems(tx.itemDescription)) {
      productQty[item.name] = (productQty[item.name] ?? 0) + item.qty
    }
  }
  const topProducts = Object.entries(productQty)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, qty]) => ({ name, qty }))

  return { event, totalRevenueDuring, avgDailyRevenueDuring, avgDailyRevenueBefore, upliftPct, topProducts }
}

function EventTypeBadge({ type }: { type: string }) {
  const color = eventColor(type)
  const cls = EVENT_TAILWIND_COLOR[color] ?? 'bg-slate-800 text-slate-400'
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{type}</span>
}

function EventEditModal({
  event,
  onSave,
  onClose,
}: {
  event: StoreEvent | null
  onSave: (name: string, type: string, start: Date, end: Date, notes: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(event?.name ?? '')
  const [type, setType] = useState(event?.eventType ?? EVENT_TYPES[0])
  const [start, setStart] = useState(format(event?.startDate ?? new Date(), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(event?.endDate ?? new Date(), 'yyyy-MM-dd'))
  const [notes, setNotes] = useState(event?.notes ?? '')

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 w-96 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{event ? 'Edit Event' : 'Add Event'}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-400 text-xl">×</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Event Name</label>
            <input className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm"
              value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Spirit Week 2025" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Type</label>
            <select className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm"
              value={type} onChange={e => setType(e.target.value)}>
              {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Start Date</label>
              <input type="date" className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm"
                value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">End Date</label>
              <input type="date" className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm"
                value={end} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Notes (optional)</label>
            <input className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm"
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-300">Cancel</button>
          <button
            disabled={!name.trim()}
            onClick={() => { onSave(name, type, new Date(start), new Date(end), notes); onClose() }}
            className="px-4 py-2 text-sm bg-teal-500 text-slate-950 rounded-lg hover:bg-teal-600 disabled:opacity-50"
          >
            Save Event
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SeasonalView() {
  const { range } = useDateRangeStore()
  const transactions = useFilteredTransactions(range)
  const events = useStoreEvents()
  const [showAdd, setShowAdd] = useState(false)
  const [editingEvent, setEditingEvent] = useState<StoreEvent | null>(null)

  const dailyRevenue = useMemo(() => computeDailyRevenue(transactions), [transactions])
  const impacts = useMemo(
    () => events.map(e => computeImpact(e, transactions)),
    [events, transactions],
  )

  const chartData = useMemo(
    () => dailyRevenue.map(d => ({ date: format(d.date, 'MMM d'), revenue: d.revenue, ts: d.date.getTime() })),
    [dailyRevenue],
  )

  async function addEvent(name: string, type: string, start: Date, end: Date, notes: string) {
    await db.storeEvents.add({ name, startDate: start, endDate: end, eventType: type, notes })
  }

  async function updateEvent(event: StoreEvent, name: string, type: string, start: Date, end: Date, notes: string) {
    await db.storeEvents.update(event.id!, { name, eventType: type, startDate: start, endDate: end, notes })
  }

  async function deleteEvent(event: StoreEvent) {
    if (event.id) await db.storeEvents.delete(event.id)
  }

  if (transactions.length === 0) {
    return <EmptyState title="No data" subtitle="Import sales data to see seasonal analysis." />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-100">Seasonal & Events</h1>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 text-sm bg-teal-500 text-slate-950 rounded-lg hover:bg-teal-600"
        >
          + Add Event
        </button>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h2 className="text-base font-semibold text-slate-100 mb-3">Store Events</h2>
        {events.length === 0 ? (
          <p className="text-sm text-slate-500">No events added yet. Click "Add Event" to get started.</p>
        ) : (
          <div className="divide-y divide-slate-700/40">
            {events.map(event => (
              <div key={event.id} className="flex items-center gap-3 py-3">
                <div
                  className="w-1 self-stretch rounded-full shrink-0"
                  style={{ backgroundColor: eventHex(event.eventType) }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-slate-100">{event.name}</span>
                    <EventTypeBadge type={event.eventType} />
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {format(event.startDate, 'MMM d')} – {format(event.endDate, 'MMM d, yyyy')}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditingEvent(event)} className="text-xs text-slate-500 hover:text-slate-400">Edit</button>
                  <button onClick={() => deleteEvent(event)} className="text-xs text-red-400 hover:text-red-400">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {chartData.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <h2 className="text-base font-semibold text-slate-100 mb-4">Revenue Timeline</h2>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Area type="monotone" dataKey="revenue" fill="#14B8A620" stroke="#14B8A6" strokeWidth={1.5} dot={false} />
              {events.map(event => (
                <ReferenceLine
                  key={`${event.id}-start`}
                  x={format(event.startDate, 'MMM d')}
                  stroke={eventHex(event.eventType)}
                  strokeDasharray="4 2"
                  label={{ value: event.name, position: 'insideTopLeft', fontSize: 9, fill: eventHex(event.eventType) }}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {events.length > 0 && impacts.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <h2 className="text-base font-semibold text-slate-100 mb-4">Event Impact Analysis</h2>
          <div className="space-y-3">
            {impacts.map(impact => {
              const upliftColor = impact.upliftPct >= 0 ? '#16a34a' : '#dc2626'
              const upliftSign = impact.upliftPct >= 0 ? '+' : ''
              return (
                <div key={impact.event.id} className="flex items-start gap-3 p-4 rounded-xl border border-slate-700/50">
                  <div
                    className="w-1 self-stretch rounded-full shrink-0"
                    style={{ backgroundColor: eventHex(impact.event.eventType) }}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-sm text-slate-100">{impact.event.name}</span>
                      <EventTypeBadge type={impact.event.eventType} />
                      <span className="text-xs text-slate-500 ml-auto">
                        {format(impact.event.startDate, 'MMM d')} – {format(impact.event.endDate, 'MMM d')}
                      </span>
                    </div>
                    <div className="flex gap-6 flex-wrap">
                      <div>
                        <p className="text-xs text-slate-500">Total Revenue</p>
                        <p className="font-bold text-sm text-slate-100">{formatCurrency(impact.totalRevenueDuring)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">vs Baseline</p>
                        <p className="font-bold text-sm" style={{ color: upliftColor }}>
                          {upliftSign}{impact.upliftPct.toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Avg Daily During</p>
                        <p className="font-mono text-sm text-slate-300">{formatCurrency(impact.avgDailyRevenueDuring)}/day</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Avg Daily Baseline</p>
                        <p className="font-mono text-sm text-slate-300">{formatCurrency(impact.avgDailyRevenueBefore)}/day</p>
                      </div>
                      {impact.topProducts.length > 0 && (
                        <div>
                          <p className="text-xs text-slate-500">Top Products</p>
                          <p className="text-sm text-slate-300">{impact.topProducts.map(p => `${p.name} (${p.qty})`).join(', ')}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {showAdd && (
        <EventEditModal
          event={null}
          onSave={addEvent}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editingEvent && (
        <EventEditModal
          event={editingEvent}
          onSave={(name, type, start, end, notes) => updateEvent(editingEvent, name, type, start, end, notes)}
          onClose={() => setEditingEvent(null)}
        />
      )}
    </div>
  )
}
