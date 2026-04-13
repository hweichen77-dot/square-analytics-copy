import { NavLink } from 'react-router-dom'
import { useTransactionCount } from '../../db/useTransactions'
import { useRestockAlertCount } from '../../hooks/useRestockAlertCount'

// Inline SVG icon components — no external dependencies
function Icon({ path, path2 }: { path: string; path2?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d={path} />
      {path2 && <path d={path2} />}
    </svg>
  )
}

const ICONS: Record<string, JSX.Element> = {
  dashboard:        <Icon path="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3z" path2="M14 14h7v7h-7z" />,
  transactions:     <Icon path="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9h6m-6-4h6" />,
  time:             <Icon path="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 5v5l3.5 3.5" />,
  staff:            <Icon path="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" path2="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
  bell:             <Icon path="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />,
  profit:           <Icon path="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  calendar:         <Icon path="M3 4h18v18H3zM3 9h18M8 2v4M16 2v4" />,
  archive:          <Icon path="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />,
  chart:            <Icon path="M18 20V10M12 20V4M6 20v-6" />,
  warning:          <Icon path="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />,
  basket:           <Icon path="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0" />,
  link:             <Icon path="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />,
  tag:              <Icon path="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01" />,
  shift:            <Icon path="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  user:             <Icon path="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
  checkClipboard:   <Icon path="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2m-2-2H9" path2="M9 12l2 2 4-4" />,
  folder:           <Icon path="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  cart:             <Icon path="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" path2="M16 10a4 4 0 0 1-8 0" />,
  document:         <Icon path="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" path2="M14 2v6h6M16 13H8M16 17H8M10 9H8" />,
  receipt:          <Icon path="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" path2="M16 8H8M16 12H8M10 16H8" />,
  upload:           <Icon path="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />,
  sync:             <Icon path="M23 4v6h-6M1 20v-6h6" path2="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />,
}

type NavItem = { label: string; path: string; iconKey: string }

const NAV_SECTIONS: { heading?: string; items: NavItem[] }[] = [
  {
    items: [
      { label: 'Dashboard',          path: '/dashboard',         iconKey: 'dashboard' },
      { label: 'Transactions',        path: '/inventory',         iconKey: 'transactions' },
    ],
  },
  {
    heading: 'Analytics',
    items: [
      { label: 'Time Analysis',       path: '/time-analysis',     iconKey: 'time' },
      { label: 'Staff Performance',   path: '/staff',             iconKey: 'staff' },
      { label: 'Profit Margins',      path: '/profit',            iconKey: 'profit' },
      { label: 'Seasonal & Events',   path: '/seasonal',          iconKey: 'calendar' },
      { label: 'Customer Frequency',  path: '/customers',         iconKey: 'user' },
    ],
  },
  {
    heading: 'Inventory',
    items: [
      { label: 'Restock Alerts',      path: '/restock',           iconKey: 'bell' },
      { label: 'Dead Stock',          path: '/dead-stock',        iconKey: 'archive' },
      { label: 'Purchase Order',      path: '/purchase-order',    iconKey: 'cart' },
    ],
  },
  {
    heading: 'Insights',
    items: [
      { label: 'Sales Forecast',      path: '/forecast',          iconKey: 'chart' },
      { label: 'Anomaly Alerts',      path: '/anomalies',         iconKey: 'warning' },
      { label: 'Basket Analysis',     path: '/basket-analysis',   iconKey: 'basket' },
      { label: 'Bundle & Cross-Sell', path: '/bundles',           iconKey: 'link' },
      { label: 'Price Optimization',  path: '/price-optimization',iconKey: 'tag' },
      { label: 'Staff Shift Analysis',path: '/staff-shift',       iconKey: 'shift' },
    ],
  },
  {
    heading: 'Catalogue',
    items: [
      { label: 'Catalogue Checker',   path: '/catalogue-checker', iconKey: 'checkClipboard' },
      { label: 'Catalogue Products',  path: '/catalogue-products',iconKey: 'folder' },
    ],
  },
]

const BOTTOM_ITEMS: NavItem[] = [
  { label: 'Reports',          path: '/reports',         iconKey: 'document' },
  { label: 'Accountant Report',path: '/accountant-report',iconKey: 'receipt' },
  { label: 'Import Data',      path: '/import',          iconKey: 'upload' },
  { label: 'Square Sync',      path: '/square-sync',     iconKey: 'sync' },
]

function NavItemFull({ item, badge }: { item: NavItem; badge?: number }) {
  return (
    <NavLink
      to={item.path}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-1.5 mx-2 rounded-md text-[13px] font-medium transition-all duration-150 cursor-pointer border-l-2 ${
          isActive
            ? 'bg-teal-500/10 text-teal-400 border-teal-400'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border-transparent'
        }`
      }
    >
      {ICONS[item.iconKey]}
      <span className="truncate flex-1">{item.label}</span>
      {badge != null && badge > 0 && (
        <span className="shrink-0 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 leading-none">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  )
}

export default function Sidebar() {
  const txCount = useTransactionCount()
  const restockAlertCount = useRestockAlertCount()

  return (
    <aside className="w-52 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2 mb-0.5">
          <div className="w-6 h-6 bg-teal-500 rounded-md flex items-center justify-center shrink-0">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#020617" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
            </svg>
          </div>
          <h1 className="text-[13px] font-semibold text-slate-100 leading-tight">Walley's Analytics</h1>
        </div>
        <p className="text-[11px] text-slate-500 mt-1 pl-8">{txCount.toLocaleString()} transactions</p>
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto py-2 space-y-0.5">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si} className={si > 0 ? 'mt-1' : ''}>
            {section.heading && (
              <p className="px-5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600 select-none">
                {section.heading}
              </p>
            )}
            {section.items.map(item => (
              <NavItemFull
                key={item.path}
                item={item}
                badge={item.path === '/restock' ? restockAlertCount : undefined}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* Bottom items */}
      <div className="border-t border-slate-800 py-2 space-y-0.5">
        {BOTTOM_ITEMS.map(item => (
          <NavItemFull key={item.path} item={item} />
        ))}
      </div>
    </aside>
  )
}
