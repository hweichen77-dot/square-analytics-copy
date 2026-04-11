import { useState, useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { startOAuthFlow } from '../engine/squareAuth'
import { fetchLocations } from '../engine/squareAPIClient'
import { runSquareSync } from '../engine/squareSyncEngine'
import type { SyncStatus } from '../engine/squareSyncEngine'
import { useToastStore } from '../store/toastStore'
import { formatNumber } from '../utils/format'

type ConnectionState = 'disconnected' | 'connecting' | 'connected'

export default function SquareSyncView() {
  const store = useAuthStore()
  const { show } = useToastStore()
  const [appIDInput, setAppIDInput] = useState(store.appID)
  const [appSecretInput, setAppSecretInput] = useState(store.appSecret)
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([])
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string; detail?: string } | null>(null)
  const [connState, setConnState] = useState<ConnectionState>(store.accessToken ? 'connected' : 'disconnected')

  const isConnected = !!store.accessToken

  // Keep connState in sync with the auth store (e.g. after OAuth callback sets the token)
  useEffect(() => {
    if (store.accessToken) {
      setConnState('connected')
    } else if (connState !== 'connecting') {
      setConnState('disconnected')
    }
  }, [store.accessToken]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-load locations on mount whenever the user is already connected so the
  // dropdown shows correctly after navigating away and back.
  useEffect(() => {
    if (store.accessToken) {
      fetchLocations(store.accessToken)
        .then(locs => setLocations(locs))
        .catch(() => {})
    }
  }, [store.accessToken])

  async function handleConnect() {
    if (!appIDInput.trim()) { show('Enter your Square Application ID first', 'error'); return }
    if (!appSecretInput.trim()) { show('Enter your Square Application Secret first', 'error'); return }
    store.setCredentials({ appID: appIDInput.trim(), appSecret: appSecretInput.trim() })
    setConnState('connecting')
    try {
      await startOAuthFlow(appIDInput.trim())
    } catch (e) {
      setConnState('disconnected')
      const msg = e instanceof Error ? e.message : (typeof e === 'string' ? e : JSON.stringify(e))
      show(`Failed to open Square login: ${msg}`, 'error')
    }
  }

  function handleCancelConnect() {
    setConnState('disconnected')
  }

  async function handleLoadLocations() {
    try {
      const locs = await fetchLocations(store.accessToken)
      setLocations(locs)
      if (locs.length === 1) store.setCredentials({ locationID: locs[0].id })
      show(`Found ${locs.length} location(s)`, 'success')
    } catch (e) {
      show(`Failed to load locations: ${(e as Error).message}`, 'error')
    }
  }

  async function handleSync() {
    if (!store.locationID) { show('Select a location first', 'error'); return }
    setSyncing(true)
    setSyncResult(null)
    try {
      let lastStatus: SyncStatus | null = null
      await runSquareSync(status => { setSyncStatus(status); lastStatus = status })
      setSyncResult({
        ok: true,
        message: 'Sync succeeded',
        detail: lastStatus
          ? `${(lastStatus as SyncStatus).ordersAdded} orders · ${(lastStatus as SyncStatus).productsAdded} products synced`
          : undefined,
      })
    } catch (e) {
      setSyncResult({ ok: false, message: 'Sync failed', detail: (e as Error).message })
    } finally {
      setSyncing(false)
    }
  }

  const statusBar = {
    disconnected: {
      bg: 'bg-slate-800 border-slate-700',
      dot: 'bg-gray-400',
      text: 'text-slate-400',
      label: 'Not connected',
      sub: 'Enter your credentials and connect your Square account.',
    },
    connecting: {
      bg: 'bg-amber-500/10 border-amber-500/30',
      dot: null,
      text: 'text-amber-400',
      label: 'Connecting…',
      sub: 'Waiting for Square OAuth authorisation. Complete sign-in in the browser window.',
    },
    connected: {
      bg: 'bg-emerald-500/10 border-emerald-500/30',
      dot: 'bg-emerald-500',
      text: 'text-emerald-400',
      label: `Connected${store.merchantID ? ` — ${store.merchantID}` : ''}`,
      sub: store.locationID ? `Location selected · ready to sync` : 'Select a location to start syncing.',
    },
  }[connState]

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-xl font-bold text-slate-100">Square Sync</h1>

      {/* ── Status bar ── */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${statusBar.bg}`}>
        {connState === 'connecting' ? (
          <div className="w-3 h-3 shrink-0 border-2 border-amber-400 border-t-amber-700 rounded-full animate-spin" />
        ) : (
          <div className={`w-3 h-3 shrink-0 rounded-full ${statusBar.dot}`} />
        )}
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${statusBar.text}`}>{statusBar.label}</p>
          <p className={`text-xs mt-0.5 ${statusBar.text} opacity-75`}>{statusBar.sub}</p>
        </div>
        {connState === 'connecting' && (
          <button
            onClick={handleCancelConnect}
            className="ml-auto text-xs text-amber-400 hover:text-amber-900 underline shrink-0"
          >
            Cancel
          </button>
        )}
        {connState === 'connected' && (
          <button
            onClick={() => { store.clearAuth(); setConnState('disconnected'); show('Disconnected', 'info') }}
            className="ml-auto text-xs text-red-400 hover:text-red-400 underline shrink-0"
          >
            Disconnect
          </button>
        )}
      </div>

      {/* ── Redirect URI notice ── */}
      {connState !== 'connected' && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 text-sm text-blue-300">
          <p className="font-semibold mb-1">Required: add this Redirect URI in Square Developer Dashboard</p>
          {[7329,7330,7331,7332,7333].map(p => (
            <p key={p} className="font-mono bg-slate-800 border border-blue-200 rounded px-2 py-1 text-xs select-all mb-1">
              http://localhost:{p}/square/callback
            </p>
          ))}
          <p className="text-xs text-blue-300 mt-2">Go to developer.squareup.com → your app → OAuth → Redirect URLs → add all URLs above. The app tries each port until one is free.</p>
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
        <h2 className="font-semibold text-slate-200">Square Application ID</h2>
        <input
          type="text"
          value={appIDInput}
          onChange={e => setAppIDInput(e.target.value)}
          placeholder="sq0idp-…"
          className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm font-mono focus:outline-none focus:outline-none focus:ring-2 focus:ring-teal-500/30"
        />
        <label className="block text-sm font-medium text-slate-300 mt-3 mb-1">Application Secret</label>
        <input
          type="password"
          value={appSecretInput}
          onChange={e => setAppSecretInput(e.target.value)}
          placeholder="sq0csp-…"
          className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm font-mono focus:outline-none focus:outline-none focus:ring-2 focus:ring-teal-500/30"
        />
        {!isConnected && connState !== 'connecting' && (
          <button
            onClick={handleConnect}
            className="px-4 py-2 bg-teal-500 text-slate-950 rounded-lg text-sm font-medium hover:bg-teal-600"
          >
            Connect Square Account
          </button>
        )}
        {connState === 'connecting' && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-amber-400 font-medium">Waiting for Square authorisation…</span>
            <button
              onClick={handleCancelConnect}
              className="px-3 py-1.5 text-sm border border-slate-600 rounded-lg text-slate-400 hover:bg-slate-700/50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {isConnected && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-slate-200">Location</h2>
          {locations.length === 0 ? (
            <button
              onClick={handleLoadLocations}
              className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-sm hover:bg-slate-600"
            >
              Load Locations
            </button>
          ) : (
            <select
              value={store.locationID}
              onChange={e => store.setCredentials({ locationID: e.target.value })}
              className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm focus:outline-none focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            >
              <option value="">Select location…</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
        </div>
      )}

      {isConnected && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-slate-200">Sync Period</h2>
          <div className="flex items-center gap-3">
            <button onClick={() => store.setCredentials({ daysBack: Math.max(7, store.daysBack - 7) })}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-600 text-lg font-bold flex items-center justify-center">−</button>
            <span className="w-24 text-center font-medium">{store.daysBack} days</span>
            <button onClick={() => store.setCredentials({ daysBack: Math.min(365, store.daysBack + 7) })}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-600 text-lg font-bold flex items-center justify-center">+</button>
          </div>
        </div>
      )}

      {isConnected && store.locationID && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-200">Sync Now</h2>
            {store.lastSyncDate && (
              <p className="text-xs text-slate-500">
                Last: {new Date(store.lastSyncDate).toLocaleString()} · {formatNumber(store.lastSyncCount)} added
              </p>
            )}
          </div>
          {syncing && syncStatus && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <div className="w-3.5 h-3.5 border-2 border-slate-600 border-t-teal-400 rounded-full animate-spin shrink-0" />
              {syncStatus.message}
            </div>
          )}
          {!syncing && syncResult && (
            <div className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm ${
              syncResult.ok ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'
            }`}>
              <span className="mt-0.5 shrink-0">
                {syncResult.ok
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><polyline points="20 6 9 17 4 12"/></svg>
                  : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                }
              </span>
              <div>
                <p className={`font-semibold ${syncResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {syncResult.message}
                </p>
                {syncResult.detail && (
                  <p className={`mt-0.5 ${syncResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {syncResult.detail}
                  </p>
                )}
              </div>
            </div>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Start Sync'}
          </button>
        </div>
      )}
    </div>
  )
}
