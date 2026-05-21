import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { useAnalytics } from '../context/AnalyticsContext'
import { auditCatalogue, type AuditIssue, type AuditSeverity } from '../engine/catalogueAuditEngine'
import { splitItemVariation } from '../types/models'
import { EmptyState } from '../components/ui/EmptyState'
import { useToastStore } from '../store/toastStore'

// ---------------------------------------------------------------------------
// Severity styles
// ---------------------------------------------------------------------------
const SEV: Record<AuditSeverity, { dot: string; badge: string; border: string }> = {
  error:   { dot: 'bg-red-400',   badge: 'bg-red-500/15 text-red-400 border-red-500/30',     border: 'border-red-500/20' },
  warning: { dot: 'bg-amber-400', badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30', border: 'border-amber-500/20' },
  info:    { dot: 'bg-blue-400',  badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',   border: 'border-blue-500/20' },
}

// ---------------------------------------------------------------------------
// Auto-fix helpers
// ---------------------------------------------------------------------------
async function applyFix(issue: AuditIssue): Promise<void> {
  if (!issue.productId) return
  const updates: Record<string, unknown> = {}
  switch (issue.fixType) {
    case 'set_taxable_true':   updates.taxable  = true;  break
    case 'set_taxable_false':  updates.taxable  = false; break
    case 'set_quantity_zero':  updates.quantity = 0;     break
    case 'set_category':       updates.category = issue.fixValue as string; break
    default: return
  }
  await db.catalogueProducts.update(issue.productId, updates)
}

// ---------------------------------------------------------------------------
// Grouped issues by item
// ---------------------------------------------------------------------------
interface ItemIssueGroup {
  itemName: string
  issues: AuditIssue[]
  errorCount: number
  warningCount: number
  infoCount: number
}

function groupIssuesByItem(issues: AuditIssue[]): ItemIssueGroup[] {
  const map = new Map<string, AuditIssue[]>()
  for (const issue of issues) {
    const { itemName } = splitItemVariation(issue.productName)
    if (!map.has(itemName)) map.set(itemName, [])
    map.get(itemName)!.push(issue)
  }
  return Array.from(map.entries())
    .map(([itemName, iss]) => ({
      itemName,
      issues: iss,
      errorCount:   iss.filter(i => i.severity === 'error').length,
      warningCount: iss.filter(i => i.severity === 'warning').length,
      infoCount:    iss.filter(i => i.severity === 'info').length,
    }))
    .sort((a, b) => b.errorCount - a.errorCount || b.warningCount - a.warningCount)
}

// ---------------------------------------------------------------------------
// Chevron
// ---------------------------------------------------------------------------
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
      className={`transition-transform duration-200 shrink-0 ${open ? 'rotate-90' : ''}`}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

type Filter = 'all' | AuditSeverity

export default function CatalogueCheckerView() {
  const { productStats: stats, overrides } = useAnalytics()
  const catalogue     = useLiveQuery(() => db.catalogueProducts.toArray(), []) ?? []
  const showToast     = useToastStore(s => s.show)

  const [filter, setFilter]         = useState<Filter>('all')
  const [fixing, setFixing]         = useState(false)
  const [expandedItems, setExpanded] = useState<Set<string>>(new Set())

  // -- Audit ------------------------------------------------------------------
  const { issues, errorCount, warningCount, infoCount } = useMemo(() => {
    const salesNames = new Set(stats.map(s => s.name))
    const avgPrices  = new Map(stats.map(s => [s.name, s.avgPrice]))
    return auditCatalogue(catalogue, salesNames, avgPrices)
  }, [stats, overrides, catalogue])

  // -- Filter -----------------------------------------------------------------
  const visibleIssues = useMemo(
    () => filter === 'all' ? issues : issues.filter(i => i.severity === filter),
    [issues, filter],
  )

  const itemGroups = useMemo(() => groupIssuesByItem(visibleIssues), [visibleIssues])
  const autoFixable = issues.filter(i => i.fixType && i.productId)

  // -- Toggle expand ----------------------------------------------------------
  function toggleItem(name: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // -- Fix actions ------------------------------------------------------------
  async function fixAll() {
    setFixing(true)
    let fixed = 0
    for (const issue of autoFixable) {
      try { await applyFix(issue); fixed++ } catch { /* skip */ }
    }
    setFixing(false)
    showToast(`Fixed ${fixed} issue${fixed !== 1 ? 's' : ''} automatically.`, 'success')
  }

  async function fixOne(issue: AuditIssue) {
    try {
      await applyFix(issue)
      showToast(`Fixed: ${issue.issue} on "${issue.productName}"`, 'success')
    } catch {
      showToast('Fix failed.', 'error')
    }
  }

  // -- Summary card click helper ----------------------------------------------
  function handleFilterClick(sev: Filter) {
    setFilter(prev => prev === sev ? 'all' : sev)
    // Auto-expand all items when filtering
    if (sev !== 'all') {
      const names = issues
        .filter(i => i.severity === sev)
        .map(i => splitItemVariation(i.productName).itemName)
      setExpanded(new Set(names))
    }
  }

  // -- Empty states -----------------------------------------------------------
  if (catalogue.length === 0) {
    return <EmptyState title="No catalogue loaded" subtitle="Import a Square catalogue XLSX or sync via Square to run the audit." />
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Catalogue Checker</h1>
          <p className="text-sm text-slate-200 mt-0.5">
            Audits {catalogue.length} variations across your catalogue for errors and data quality issues.
          </p>
        </div>
        {autoFixable.length > 0 && (
          <button
            onClick={fixAll} disabled={fixing}
            className="shrink-0 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer"
          >
            {fixing ? 'Fixing…' : `Fix All Auto-Fixable (${autoFixable.length})`}
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { sev: 'error'   as Filter, label: 'Errors',   count: errorCount,   color: 'text-red-400',   bg: 'bg-red-500/10 border-red-500/25' },
          { sev: 'warning' as Filter, label: 'Warnings', count: warningCount, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/25' },
          { sev: 'info'    as Filter, label: 'Info',     count: infoCount,    color: 'text-blue-400',  bg: 'bg-blue-500/10 border-blue-500/25' },
          { sev: 'all'     as Filter, label: 'Total',    count: issues.length, color: 'text-slate-100', bg: 'bg-slate-700/50 border-slate-600/30' },
        ].map(({ sev, label, count, color, bg }) => (
          <button
            key={sev}
            onClick={() => handleFilterClick(sev)}
            className={`rounded-xl border p-4 text-left transition-all cursor-pointer ${bg} ${filter === sev ? 'ring-2 ring-teal-500/50' : 'hover:brightness-110'}`}
          >
            <p className={`text-3xl font-bold tabular-nums ${color}`}>{count}</p>
            <p className="text-xs text-slate-200 mt-1 font-medium">{label}</p>
          </button>
        ))}
      </div>

      {/* Tax rules reminder */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-200 flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2" strokeLinecap="round" className="shrink-0">
          <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
        </svg>
        <span>
          <span className="text-slate-200 font-medium">Tax rules: </span>
          <span className="text-teal-400">Merch items must be taxable.</span> Food and beverage items (ramen, drinks, snacks) are non-taxable. Items with incorrect tax status will be flagged.
        </span>
      </div>

      {/* All-clear */}
      {issues.length === 0 && (
        <div className="text-center py-16">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <p className="font-semibold text-slate-200 text-lg">Catalogue looks clean!</p>
          <p className="text-sm text-slate-200 mt-1">No errors, warnings, or issues found.</p>
        </div>
      )}

      {/* Issue groups */}
      {itemGroups.length > 0 && (
        <div className="space-y-2">
          {/* Filter label */}
          {filter !== 'all' && (
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-slate-200">Showing {filter}s only · {visibleIssues.length} issues across {itemGroups.length} items</p>
              <button onClick={() => setFilter('all')} className="text-xs text-teal-400 hover:underline cursor-pointer">Show all</button>
            </div>
          )}

          {itemGroups.map(group => {
            const isOpen = expandedItems.has(group.itemName)
            const worstSev: AuditSeverity = group.errorCount > 0 ? 'error' : group.warningCount > 0 ? 'warning' : 'info'

            return (
              <div key={group.itemName} className={`bg-slate-800/30 border overflow-hidden ${SEV[worstSev].border}`}>
                {/* Item header row */}
                <button
                  onClick={() => toggleItem(group.itemName)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-700/40 transition-colors cursor-pointer"
                >
                  <Chevron open={isOpen} />
                  <span className="font-semibold text-slate-100 flex-1">{group.itemName}</span>

                  {/* Issue count badges */}
                  <div className="flex items-center gap-1.5">
                    {group.errorCount > 0 && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${SEV.error.badge}`}>
                        {group.errorCount} err
                      </span>
                    )}
                    {group.warningCount > 0 && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${SEV.warning.badge}`}>
                        {group.warningCount} warn
      </span>
                    )}
                    {group.infoCount > 0 && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${SEV.info.badge}`}>
                        {group.infoCount} info
                      </span>
                    )}
                  </div>
                </button>

                {/* Issue detail rows */}
                {isOpen && (
                  <div className="border-t border-slate-700/40 divide-y divide-slate-700/30">
                    {group.issues.map(issue => {
                      const canFix = !!(issue.fixType && issue.productId)
                      const s = SEV[issue.severity]
                      return (
                        <div key={issue.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-700/20 transition-colors">
                          <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${s.badge}`}>
                                {issue.issue}
                              </span>
                              {/\(.+\)$/.test(issue.productName) && (
                                <span className="text-[11px] text-slate-200">
                                  {splitItemVariation(issue.productName).variationName} variation
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-200 mt-1 leading-relaxed">{issue.detail}</p>
                          </div>
                          <div className="shrink-0 pt-0.5">
                            {canFix ? (
                              <button
                                onClick={() => fixOne(issue)}
                                className="text-xs px-2.5 py-1 rounded-md bg-teal-600/20 text-teal-400 hover:bg-teal-600/40 border border-teal-500/30 transition-colors whitespace-nowrap cursor-pointer"
                              >
                                Auto-fix
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-200 px-2">Manual</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* No matches */}
      {visibleIssues.length === 0 && issues.length > 0 && (
        <div className="text-center py-10 text-slate-200 text-sm">
          No {filter}s found.{' '}
          <button onClick={() => setFilter('all')} className="text-teal-400 hover:underline cursor-pointer">Show all issues</button>
        </div>
      )}
    </div>
  )
}
