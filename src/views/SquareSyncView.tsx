import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { startOAuthFlow } from '../engine/squareAuth'
import { fetchLocations } from '../engine/squareAPIClient'
import { runSquareSync } from '../engine/squareSyncEngine'
import type { SyncStatus } from '../engine/squareSyncEngine'
import { useToastStore } from '../store/toastStore'
import { formatNumber } from '../utils/format'
import { removeCsvDuplicates } from '../db/dbUtils'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'

type ConnectionState = 'disconnected' | 'connecting' | 'connected'

const OAUTH_CALLBACK_PORTS = [7329, 7330, 7331, 7332, 7333]

export default function SquareSyncView() {
  const store = useAuthStore()
  const { show } = useToastStore()
  const navigate = useNavigate()
  const [appIDInput, setAppIDInput] = useState(store.appID)
  const [appSecretInput, setAppSecretInput] = useState(store.appSecret)
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([])
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncLog, setSyncLog] = useState<string[]>([])
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string; detail?: string } | null>(null)
  const [connState, setConnState] = useState<ConnectionState>(store.accessToken ? 'connected' : 'disconnected')

  const isConnected = !!store.accessToken
  const [deduping, setDeduping] = useState(false)
  const sourceCounts = useLiveQuery(async () => {
    const all = await db.salesTransactions.toArray()
    const api = all.filter(t => t.source === 'api').length
    const csv = all.filter(t => t.source === 'csv').length
    const unknown = all.filter(t => !t.source).length
    return { api, csv, unknown, total: all.length }
  }, [])

  async function handleDedup() {
    setDeduping(true)
    try {
      const removed = await removeCsvDuplicates()
      if (removed > 0) {
        show(`Removed ${removed} duplicate CSV transactions that overlap with API data.`, 'success')
      } else {
        show('No duplicates found. CSV and API data do not overlap.', 'info')
      }
    } catch (e) {
      show(`Dedup failed: ${(e as Error).message}`, 'error')
    } finally {
      setDeduping(false)
    }
  }

  useEffect(() => {
    if (store.accessToken) {
      setConnState('connected')
    } else if (connState !== 'connecting') {
      setConnState('disconnected')
    }
  }, [store.accessToken]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!store.accessToken) return
    fetchLocations(store.accessToken)
      .then(locs => setLocations(locs))
      .catch(e => show(`Failed to load locations: ${e instanceof Error ? e.message : String(e)}`, 'error'))
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
    if (!store.accessToken) return
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
    setSyncLog([])
    const log: string[] = []
    const ts = () => new Date().toLocaleTimeString()
    try {
      let lastStatus: SyncStatus | null = null
      await runSquareSync(status => {
        setSyncStatus(status)
        lastStatus = status
        const entry = `[${ts()}] ${status.message}`
        log.push(entry)
        setSyncLog([...log])
      })
      const detail = lastStatus
        ? `${(lastStatus as SyncStatus).ordersAdded} new orders · ${(lastStatus as SyncStatus).productsAdded} catalogue items`
        : 'Done'
      setSyncResult({ ok: true, message: 'Sync complete', detail })
      log.push(`[${ts()}] Done — ${detail}`)
      setSyncLog([...log])
    } catch (e) {
      const msg = (e as Error).message
      setSyncResult({ ok: false, message: 'Sync failed', detail: msg })
      log.push(`[${ts()}] ERROR: ${msg}`)
      setSyncLog([...log])
    } finally {
      setSyncing(false)
    }
  }

  const statusBar = {
    disconnected: {
      bg: 'bg-slate-800 border-slate-700',
      dot: 'bg-gray-400',
      text: 'text-slate-200',
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
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Square Sync</h1>
        <p className="text-sm text-slate-200 mt-1">Automatically import orders and catalogue data from your Square account.</p>
      </div>

      {!isConnected && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl px-4 py-3 flex items-start gap-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p className="text-sm text-slate-200 leading-relaxed">
            Square Sync is optional. You can import data via CSV on the{' '}
            <button
              onClick={() => navigate('/import')}
              className="text-teal-400 hover:underline font-medium"
            >
              Import Data page
            </button>{' '}
            instead.
          </p>
        </div>
      )}

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

      {connState !== 'connected' && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 text-sm text-blue-300">
          <p className="font-semibold mb-1">Required: add this Redirect URI in Square Developer Dashboard</p>
          {OAUTH_CALLBACK_PORTS.map(p => (
            <p key={p} className="font-mono bg-slate-800 border border-blue-200 rounded px-2 py-1 text-xs select-all mb-1">
              http://localhost:{p}/square/callback
            </p>
          ))}
          <p className="text-xs text-blue-300 mt-2">Go to developer.squareup.com → your app → OAuth → Redirect URLs → add all URLs above. The app tries each port until one is free.</p>
        </div>
      )}

      <div className="bg-slate-800/30 border border-slate-700/40 p-5 space-y-3">
        {!isConnected && connState !== 'connecting' && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-4">
            <p className="text-xs font-semibold text-blue-400 mb-1">Setup required before connecting</p>
            <p className="text-xs text-slate-200">In your <span className="text-blue-300">Square Developer Portal</span>, add <span className="font-mono text-teal-400">http://localhost:7329/square/callback</span> as an OAuth redirect URI. Without this, the connection will fail.</p>
          </div>
        )}
        <h2 className="font-semibold text-slate-200">Square Application ID</h2>
        <input
          type="text"
          value={appIDInput}
          onChange={e => setAppIDInput(e.target.value)}
          placeholder="sq0idp-…"
          className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/30"
        />
        <label className="block text-sm font-medium text-slate-100 mt-3 mb-1">Application Secret</label>
        <input
          type="password"
          value={appSecretInput}
          onChange={e => setAppSecretInput(e.target.value)}
          placeholder="sq0csp-…"
          className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/30"
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
              className="px-3 py-1.5 text-sm border border-slate-600 rounded-lg text-slate-200 hover:bg-slate-700/50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {isConnected && (
        <div className="bg-slate-800/30 border border-slate-700/40 p-5 space-y-3">
          <h2 className="font-semibold text-slate-200">Location</h2>
          {locations.length === 0 ? (
            <button
              onClick={handleLoadLocations}
              className="px-4 py-2 bg-slate-800 text-slate-100 rounded-lg text-sm hover:bg-slate-600"
            >
              Load Locations
            </button>
          ) : (
            <select
              value={store.locationID}
              onChange={e => store.setCredentials({ locationID: e.target.value })}
              className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-700/50 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            >
              <option value="">Select location…</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
        </div>
      )}

      {isConnected && (
        <div className="bg-slate-800/30 border border-slate-700/40 p-5 space-y-3">
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
        <div className="bg-slate-800/30 border border-slate-700/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-200">Auto-Sync</h2>
              <p className="text-xs text-slate-200 mt-0.5">Sync automatically in the background</p>
            </div>
            <button
              onClick={() => store.setCredentials({ autoSyncEnabled: !store.autoSyncEnabled })}
              className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-800 ${
                store.autoSyncEnabled ? 'bg-teal-500' : 'bg-slate-600'
              }`}
              role="switch"
              aria-checked={store.autoSyncEnabled}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200 ${
                store.autoSyncEnabled ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </div>
          {store.autoSyncEnabled && (
            <div className="flex items-center gap-2">
              <p className="text-sm text-slate-200 shrink-0">Interval:</p>
              {([15, 30, 60] as const).map(min => (
                <button
                  key={min}
                  onClick={() => store.setCredentials({ syncIntervalMinutes: min })}
                  className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                    store.syncIntervalMinutes === min
                      ? 'bg-teal-500/20 border-teal-500/50 text-teal-300'
                      : 'border-slate-600 text-slate-200 hover:border-slate-500'
                  }`}
                >
                  {min}m
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isConnected && store.locationID && (
        <div className="bg-slate-800/30 border border-slate-700/40 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-200">Sync Now</h2>
            {store.lastSyncDate && (
              <p className="text-xs text-slate-200">
                Last: {new Date(store.lastSyncDate).toLocaleString()} · {formatNumber(store.lastSyncCount)} added
              </p>
            )}
          </div>
          {syncing && syncStatus && (
            <div className="flex items-center gap-2 text-sm text-slate-200">
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
          {syncLog.length > 0 && (
            <div className="mt-3 bg-slate-900 border border-slate-700 rounded-lg p-3 font-mono text-xs text-slate-100 max-h-36 overflow-y-auto space-y-0.5">
              {syncLog.map((line, i) => (
                <p key={i} className={line.includes('ERROR') ? 'text-red-400' : 'text-slate-100'}>{line}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {sourceCounts && (sourceCounts.api > 0 || sourceCounts.csv > 0) && (
        <div className="bg-slate-800/30 border border-slate-700/40 p-5 space-y-3">
          <h2 className="font-semibold text-slate-200">Data Source Diagnostics</h2>
          <div className="grid grid-cols-4 gap-3 text-sm">
            <div className="bg-slate-900/50 rounded-lg p-3">
              <p className="text-xs text-slate-200">Total Transactions</p>
              <p className="text-lg font-bold text-slate-100 mt-0.5">{sourceCounts.total.toLocaleString()}</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <p className="text-xs text-slate-200">From Square API</p>
              <p className="text-lg font-bold text-teal-400 mt-0.5">{sourceCounts.api.toLocaleString()}</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <p className="text-xs text-slate-200">From CSV Import</p>
              <p className="text-lg font-bold text-blue-400 mt-0.5">{sourceCounts.csv.toLocaleString()}</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <p className="text-xs text-slate-200">Legacy (no tag)</p>
              <p className="text-lg font-bold text-slate-200 mt-0.5">{sourceCounts.unknown.toLocaleString()}</p>
            </div>
          </div>
          {sourceCounts.api > 0 && sourceCounts.csv > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
              <p className="text-sm font-semibold text-amber-400 mb-1">Possible duplicate transactions detected</p>
              <p className="text-xs text-slate-200 mb-3">
                Square CSV uses payment IDs; the API uses order IDs. The same sale can appear twice if you imported CSV data
                and then synced via API for the same date range. Click below to remove CSV transactions that overlap with API data.
              </p>
              <button
                onClick={handleDedup}
                disabled={deduping}
                className="px-4 py-2 bg-amber-500 text-slate-950 rounded-lg text-sm font-semibold hover:bg-amber-400 disabled:opacity-50"
              >
                {deduping ? 'Removing duplicates…' : 'Remove CSV Duplicates'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
