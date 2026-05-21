interface EmptyStateProps {
  title: string
  subtitle?: string
  action?: { label: string; onClick: () => void }
}

export function EmptyState({ title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-5">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3h18v18H3z" /><path d="M9 9h6M9 12h6M9 15h4" />
          <circle cx="19" cy="19" r="5" fill="#0F172A" stroke="#475569" />
          <path d="M17 19h4M19 17v4" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-slate-200">{title}</h3>
      {subtitle && <p className="text-sm text-slate-200 mt-1.5 max-w-sm leading-relaxed">{subtitle}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 px-4 py-2 bg-teal-500 text-slate-950 rounded-lg text-sm font-semibold hover:bg-teal-400 transition-colors cursor-pointer"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
