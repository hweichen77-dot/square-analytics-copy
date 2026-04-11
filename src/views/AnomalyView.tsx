import { useMemo, useState } from 'react'
import { useAllTransactions } from '../db/useTransactions'
import { computeAnomalies } from '../engine/forecastEngine'
import type { AnomalyDay } from '../engine/forecastEngine'
import { EmptyState } from '../components/ui/EmptyState'
import { formatCurrency, formatPercent } from '../utils/format'
import { useNavigate } from 'react-router-dom'

type Filter = 'all' | 'above' | 'below'

function SeverityBadge({ severity }: { severity: 'mild' | 'strong' }) {
  return severity === 'strong'
    ? <span className="px-1.5 py-0.5 text-xs font-medium bg-red-500/15 text-red-400 rounded">Strong</span>
    : <span className="px-1.5 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-400 rounded">Mild</span>
}

function AnomalyRow({ anomaly }: { anomaly: AnomalyDay }) {
  const { dayLabel, actualRevenue, expectedRevenue, percentDiff, direction, severity } = anomaly
  const isAbove = direction === 'above'
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-700/50 last:border-0 hover:bg-slate-700/50">
      <div className={`w-2 h-2 rounded-full shrink-0 ${isAbove ? 'bg-emerald-500' : 'bg-red-400'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200">{dayLabel}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Expected ~{formatCurrency(expectedRevenue)}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-slate-100">{formatCurrency(actualRevenue)}</p>
        <p className={`text-xs font-medium ${isAbove ? 'text-emerald-400' : 'text-red-400'}`}>
          {isAbove ? '+' : ''}{formatPercent(percentDiff, 1)}
        </p>
      </div>
      <SeverityBadge severity={severity} />
    </div>
  )
}

export default function AnomalyView() {
  const transactions = useAllTransactions()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')

  const anomalies = useMemo(() => computeAnomalies(transactions), [transactions])

  const filtered = useMemo(
    () => filter === 'all' ? anomalies : anomalies.filter(a => a.direction === filter),
    [anomalies, filter],
  )

  const aboveCount = anomalies.filter(a => a.direction === 'above').length
  const belowCount = anomalies.filter(a => a.direction === 'below').length

  if (transactions.length === 0) {
    return (
      <EmptyState
        title="No data yet"
        subtitle="Import transactions to detect anomalous days."
        action={{ label: 'Go to Import', onClick: () => navigate('/import') }}
      />
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Anomaly Alerts</h1>
        <p className="text-sm text-slate-500 mt-1">
          Days that were unusually above or below your typical revenue for that day of the week.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
          <p className="text-xl font-bold text-slate-100">{anomalies.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">Total anomalies</p>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-emerald-400">{aboveCount}</p>
          <p className="text-xs text-emerald-400 mt-0.5">Above normal</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-red-400">{belowCount}</p>
          <p className="text-xs text-red-400 mt-0.5">Below normal</p>
        </div>
      </div>

      {anomalies.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center text-slate-500 text-sm">
          No anomalous days detected. Your revenue is remarkably consistent!
        </div>
      ) : (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          {/* Filter tabs */}
          <div className="flex border-b border-slate-700/50">
            {(['all', 'above', 'below'] as Filter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                  filter === f
                    ? 'border-b-2 border-teal-500 text-teal-400'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {f === 'all' ? `All (${anomalies.length})` : f === 'above' ? `Above (${aboveCount})` : `Below (${belowCount})`}
              </button>
            ))}
          </div>

          {/* Anomaly list */}
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No {filter} anomalies.</div>
          ) : (
            <div>
              {filtered.map((a, i) => <AnomalyRow key={i} anomaly={a} />)}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-slate-500">
        A day is flagged as anomalous when its revenue is more than 1.5 standard deviations from the mean for that day of the week.
        Strong anomalies are more than 2.5 standard deviations away.
      </p>
    </div>
  )
}
