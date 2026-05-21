interface StatCardProps {
  label: string
  value: string
  trend?: string
  trendUp?: boolean
  sub?: string
}

export function StatCard({ label, value, trend, trendUp, sub }: StatCardProps) {
  return (
    <div className="py-5 px-4 border border-slate-700/40 bg-slate-800/20 hover:bg-slate-800/40 transition-colors duration-200 group">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 mb-2.5">{label}</p>
      <p className="text-[2.1rem] font-semibold text-slate-100 font-mono tabular-nums leading-none">{value}</p>
      {trend && (
        <p className={`text-[11px] mt-2.5 font-medium flex items-center gap-1.5 ${trendUp ? 'text-emerald-400' : 'text-red-400'}`}>
          <span aria-hidden="true">{trendUp ? '↑' : '↓'}</span>
          <span>{trend}</span>
        </p>
      )}
      {sub && <p className="text-[11px] text-slate-200 mt-1">{sub}</p>}
    </div>
  )
}
