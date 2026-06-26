import { useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { runSquareSync, isSyncInFlight } from '../engine/squareSyncEngine'
import { useToastStore } from '../store/toastStore'

const MIN_FOCUS_SYNC_GAP_MS = 15 * 60 * 1000

export function useAutoSync() {
  const { autoSyncEnabled, syncIntervalMinutes, accessToken, locationID, lastSyncDate } = useAuthStore()
  const { show } = useToastStore()

  useEffect(() => {
    if (!autoSyncEnabled || !accessToken || !locationID) return

    const ms = Math.max(syncIntervalMinutes, 5) * 60 * 1000
    const id = setInterval(() => {
      if (isSyncInFlight()) return
      runSquareSync(() => {}).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Auto-sync failed'
        show(`Square sync failed: ${msg}`, 'error')
      })
    }, ms)

    return () => clearInterval(id)
  }, [autoSyncEnabled, syncIntervalMinutes, accessToken, locationID, show])

  useEffect(() => {
    if (!autoSyncEnabled || !accessToken || !locationID) return

    function onFocus() {
      if (isSyncInFlight()) return
      const lastMs = lastSyncDate ? new Date(lastSyncDate).getTime() : 0
      if (Date.now() - lastMs < MIN_FOCUS_SYNC_GAP_MS) return
      runSquareSync(() => {}).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Auto-sync failed'
        show(`Square sync failed: ${msg}`, 'error')
      })
    }

    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [autoSyncEnabled, accessToken, locationID, lastSyncDate, show])
}
