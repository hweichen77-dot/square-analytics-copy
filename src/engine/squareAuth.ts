import { useAuthStore } from '../store/authStore'

const SQUARE_OAUTH_URL = 'https://connect.squareup.com/oauth2/authorize'
const SQUARE_TOKEN_URL = 'https://connect.squareup.com/oauth2/token'
const SCOPES = 'MERCHANT_PROFILE_READ ORDERS_READ PAYMENTS_READ ITEMS_READ INVENTORY_READ TEAM_MEMBERS_READ CUSTOMERS_READ'

const LOCALHOST_REDIRECT_URI = 'http://localhost:7329/square/callback'

function isCapacitorNative(): boolean {
  return (window as any).Capacitor?.isNativePlatform?.() === true
}

function isTauri(): boolean {
  return (window as any).__TAURI_INTERNALS__ !== undefined
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  const verifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  return { verifier, challenge }
}

export function getRedirectURI(): string {
  if (isTauri() || isCapacitorNative()) return LOCALHOST_REDIRECT_URI
  const base = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '')
  return `${base}/square/callback`
}

async function startOAuthFlowTauri(appID: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  const { openUrl } = await import('@tauri-apps/plugin-opener').catch(() => ({ openUrl: null }))

  const port = await invoke<number>('prepare_oauth_listener')
  const redirectUri = `http://localhost:${port}/square/callback`

  const state = crypto.randomUUID()
  const params = new URLSearchParams({
    client_id:     appID,
    scope:         SCOPES,
    response_type: 'code',
    redirect_uri:  redirectUri,
    state,
  })
  const url = `${SQUARE_OAUTH_URL}?${params}`

  const codePromise = invoke<string>('wait_for_oauth_code', { expectedState: state })

  if (openUrl) {
    await openUrl(url).catch(() => { window.open(url, '_blank') })
  } else {
    window.open(url, '_blank')
  }

  const code = await codePromise

  await exchangeCode(code, appID, redirectUri)
}

async function startOAuthFlowWeb(appID: string): Promise<void> {
  const { verifier, challenge } = await generatePKCE()
  const state = crypto.randomUUID()
  sessionStorage.setItem('square_pkce_verifier', verifier)
  sessionStorage.setItem('square_oauth_state', state)

  const redirectUri = getRedirectURI()

  const params = new URLSearchParams({
    client_id:             appID,
    scope:                 SCOPES,
    response_type:         'code',
    redirect_uri:          redirectUri,
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  })

  if (isCapacitorNative()) {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url: `${SQUARE_OAUTH_URL}?${params}` })
  } else {
    window.location.href = `${SQUARE_OAUTH_URL}?${params}`
  }
}

export async function startOAuthFlow(appID: string): Promise<void> {
  if (isTauri()) {
    return startOAuthFlowTauri(appID)
  }
  return startOAuthFlowWeb(appID)
}

async function exchangeCode(code: string, appID: string, redirectUri: string): Promise<void> {
  const { appSecret } = useAuthStore.getState()
  const { invoke } = await import('@tauri-apps/api/core')

  const data = await invoke<{
    access_token?: string
    refresh_token?: string
    merchant_id?: string
    expires_at?: string
    error?: string
    error_description?: string
    message?: string
  }>('exchange_square_code', {
    code,
    appId: appID,
    appSecret,
    redirectUri,
  })

  if (!data.access_token) {
    const msg = data.error_description ?? data.error ?? data.message ?? 'Token exchange failed'
    throw new Error(`Square OAuth failed: ${msg}`)
  }

  useAuthStore.getState().setCredentials({
    accessToken:    data.access_token,
    refreshToken:   data.refresh_token ?? '',
    merchantID:     data.merchant_id ?? '',
    tokenExpiresAt: data.expires_at ? new Date(data.expires_at).getTime() : 0,
  })
}

export async function exchangeCodeForToken(code: string): Promise<void> {
  const verifier = sessionStorage.getItem('square_pkce_verifier') ?? ''
  const { appID, appSecret } = useAuthStore.getState()

  const res = await fetch(SQUARE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     appID,
      client_secret: appSecret,
      code,
      redirect_uri:  getRedirectURI(),
      grant_type:    'authorization_code',
      code_verifier: verifier,
    }),
  })

  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`)

  const data = await res.json() as {
    access_token: string
    refresh_token: string
    merchant_id: string
    expires_at: string
  }

  sessionStorage.removeItem('square_pkce_verifier')
  sessionStorage.removeItem('square_oauth_state')

  useAuthStore.getState().setCredentials({
    accessToken:    data.access_token,
    refreshToken:   data.refresh_token,
    merchantID:     data.merchant_id,
    tokenExpiresAt: new Date(data.expires_at).getTime(),
  })
}

export async function refreshAccessToken(): Promise<void> {
  const { appID, appSecret, refreshToken } = useAuthStore.getState()
  if (!refreshToken) throw new Error('No refresh token available. Please reconnect to Square.')

  let data: { access_token?: string; refresh_token?: string; expires_at?: string; error?: string; error_description?: string }

  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    data = await invoke('refresh_square_token', {
      appId: appID,
      appSecret,
      refreshToken,
    })
  } else {
    const res = await fetch(SQUARE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     appID,
        client_secret: appSecret,
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
      }),
    })
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
    data = await res.json()
  }

  if (!data.access_token) {
    throw new Error(data.error_description ?? data.error ?? 'Token refresh failed — please reconnect.')
  }

  useAuthStore.getState().setCredentials({
    accessToken:    data.access_token,
    refreshToken:   data.refresh_token ?? refreshToken,
    tokenExpiresAt: data.expires_at ? new Date(data.expires_at).getTime() : 0,
  })
}
