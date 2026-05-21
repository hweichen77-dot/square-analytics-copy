type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'danger'

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default:   'bg-teal-500/15 text-teal-400 border border-teal-500/20',
  secondary: 'bg-slate-700 text-slate-200 border border-slate-600',
  success:   'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20',
  warning:   'bg-amber-500/15 text-amber-400 border border-amber-500/20',
  danger:    'bg-red-500/15 text-red-400 border border-red-500/20',
}

const CATEGORY_BADGE_VARIANT: Record<string, BadgeVariant> = {
  'Food':           'warning',
  'Drinks':         'default',
  'Ice Cream':      'success',
  'Ramen/Hot Food': 'danger',
  'Merch':          'secondary',
  'Other':          'secondary',
}

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
}

export function Badge({ children, variant = 'default' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${VARIANT_CLASSES[variant]}`}>
      {children}
    </span>
  )
}

export function CategoryBadge({ category }: { category: string }) {
  const variant = CATEGORY_BADGE_VARIANT[category] ?? 'secondary'
  return <Badge variant={variant}>{category}</Badge>
}
