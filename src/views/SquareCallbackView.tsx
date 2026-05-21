import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { exchangeCodeForToken } from '../engine/squareAuth'

export default function SquareCallbackView() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = params.get('code')
    const state = params.get('state')
    const storedState = sessionStorage.getItem('square_oauth_state')

    if (!code) { setError('No authorization code returned by Square.'); return }
    if (state !== storedState) { setError('OAuth state mismatch — possible CSRF.'); return }

    exchangeCodeForToken(code)
      .then(() => navigate('/square-sync'))
      .catch(e => setError((e as Error).message))
  }, [params, navigate])

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </div>
          <p className="font-semibold text-red-400">{error}</p>
          <button onClick={() => navigate('/square-sync')} className="mt-4 text-sm text-teal-400 underline">
            Back to settings
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-teal-500/30 border-t-teal-500 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-200">Connecting to Square…</p>
      </div>
    </div>
  )
}
