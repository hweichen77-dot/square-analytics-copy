import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import { DateRangePicker } from './components/layout/DateRangePicker'
import { ToastContainer } from './components/ui/ToastContainer'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { CommandPalette } from './components/ui/CommandPalette'
import { useAutoSync } from './hooks/useAutoSync'
import { AnalyticsProvider } from './context/AnalyticsContext'

const DashboardView         = lazy(() => import('./views/DashboardView'))
const InventoryView         = lazy(() => import('./views/InventoryView'))
const ProductDetailView     = lazy(() => import('./views/ProductDetailView'))
const TimeAnalysisView      = lazy(() => import('./views/TimeAnalysisView'))
const StaffView             = lazy(() => import('./views/StaffView'))
const RestockView           = lazy(() => import('./views/RestockView'))
const ProfitView            = lazy(() => import('./views/ProfitView'))
const SeasonalView          = lazy(() => import('./views/SeasonalView'))
const DeadStockView         = lazy(() => import('./views/DeadStockView'))
const BundleView            = lazy(() => import('./views/BundleView'))
const PriceOptimizationView = lazy(() => import('./views/PriceOptimizationView'))
const StaffShiftView        = lazy(() => import('./views/StaffShiftView'))
const CustomerView          = lazy(() => import('./views/CustomerView'))
const CatalogueCheckerView  = lazy(() => import('./views/CatalogueCheckerView'))
const CatalogueProductsView = lazy(() => import('./views/CatalogueProductsView'))
const PurchaseOrderView     = lazy(() => import('./views/PurchaseOrderView'))
const ImportView            = lazy(() => import('./views/ImportView'))
const SquareSyncView        = lazy(() => import('./views/SquareSyncView'))
const SquareCallbackView    = lazy(() => import('./views/SquareCallbackView'))
const ReportsView           = lazy(() => import('./views/ReportsView'))
const ForecastView          = lazy(() => import('./views/ForecastView'))
const AnomalyView           = lazy(() => import('./views/AnomalyView'))
const BasketAnalysisView    = lazy(() => import('./views/BasketAnalysisView'))
const AccountantReportView  = lazy(() => import('./views/AccountantReportView'))
const OpexView              = lazy(() => import('./views/OpexView'))

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-slate-700 border-t-teal-400 rounded-full animate-spin" />
    </div>
  )
}

function useDeepLinkHandler() {
  const navigate = useNavigate()

  useEffect(() => {
    if ((window as any).Capacitor?.isNativePlatform?.()) {
      let cleanup: (() => void) | undefined

      import('@capacitor/app').then(({ App }) => {
        App.addListener('appUrlOpen', (event: { url: string }) => {
          try {
            const parsed = new URL(event.url)
            if (parsed.hostname === 'square' && parsed.pathname === '/callback') {
              const code = parsed.searchParams.get('code') ?? ''
              const state = parsed.searchParams.get('state') ?? ''
              navigate(`/square/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`)
              import('@capacitor/browser').then(({ Browser }) => Browser.close())
            }
          } catch {
          }
        }).then((handle: { remove: () => void }) => {
          cleanup = () => handle.remove()
        })
      })

      return () => cleanup?.()
    }

    if ((window as any).__TAURI_INTERNALS__ !== undefined) {
      let cancel: (() => void) | undefined

      import('@tauri-apps/plugin-deep-link').then(({ onOpenUrl }) => {
        onOpenUrl((urls: string[]) => {
          for (const url of urls) {
            try {
              const parsed = new URL(url)
              if (parsed.hostname === 'square' && parsed.pathname === '/callback') {
                const code = parsed.searchParams.get('code') ?? ''
                const state = parsed.searchParams.get('state') ?? ''
                navigate(`/square/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`)
              }
            } catch {
            }
          }
        }).then((unlisten: () => void) => {
          cancel = unlisten
        })
      })

      return () => cancel?.()
    }
  }, [navigate])
}

export default function App() {
  useDeepLinkHandler()
  useAutoSync()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setPaletteOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <AnalyticsProvider>
    <div className="flex h-screen bg-slate-950 overflow-hidden">
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex-1 overflow-y-auto">
        {/* Global header — visible on all pages */}
        <div className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur-sm border-b border-slate-800 px-4 lg:px-6 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 text-slate-200 hover:text-slate-200"
              aria-label="Open menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <span className="font-display text-[13px] font-semibold text-slate-100 lg:hidden">Walley's Analytics</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-xs text-slate-200 border border-slate-700 hover:border-slate-600 hover:text-slate-300 transition-colors bg-slate-900/50"
              aria-label="Open command palette"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <span>Search products</span>
              <kbd className="ml-1 text-[10px] border border-slate-700 px-1 py-0.5">⌘K</kbd>
            </button>
            <DateRangePicker />
          </div>
        </div>
        <div className="p-4 lg:p-6">
          <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardView />} />
              <Route path="/inventory" element={<InventoryView />} />
              <Route path="/inventory/:productName" element={<ProductDetailView />} />
              <Route path="/time-analysis" element={<TimeAnalysisView />} />
              <Route path="/staff" element={<StaffView />} />
              <Route path="/restock" element={<RestockView />} />
              <Route path="/profit" element={<ProfitView />} />
              <Route path="/seasonal" element={<SeasonalView />} />
              <Route path="/dead-stock" element={<DeadStockView />} />
              <Route path="/bundles" element={<BundleView />} />
              <Route path="/price-optimization" element={<PriceOptimizationView />} />
              <Route path="/staff-shift" element={<StaffShiftView />} />
              <Route path="/customers" element={<CustomerView />} />
              <Route path="/catalogue-checker" element={<CatalogueCheckerView />} />
              <Route path="/catalogue-products" element={<CatalogueProductsView />} />
              <Route path="/purchase-order" element={<PurchaseOrderView />} />
              <Route path="/import" element={<ImportView />} />
              <Route path="/square-sync" element={<SquareSyncView />} />
              <Route path="/square/callback" element={<SquareCallbackView />} />
              <Route path="/reports" element={<ReportsView />} />
              <Route path="/forecast" element={<ForecastView />} />
              <Route path="/anomalies" element={<AnomalyView />} />
              <Route path="/basket-analysis" element={<BasketAnalysisView />} />
              <Route path="/accountant-report" element={<AccountantReportView />} />
              <Route path="/opex" element={<OpexView />} />
            </Routes>
          </Suspense>
          </ErrorBoundary>
        </div>
      </main>
      <ToastContainer />
    </div>
    </AnalyticsProvider>
  )
}

