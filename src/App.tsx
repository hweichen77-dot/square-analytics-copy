import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import { ToastContainer } from './components/ui/ToastContainer'

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
      <div className="w-7 h-7 border-2 border-slate-700 border-t-teal-400 rounded-full animate-spin" />
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

  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6">
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
        </div>
      </main>
      <ToastContainer />
    </div>
  )
}
