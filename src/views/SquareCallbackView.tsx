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
          <p className="text-4xl mb-3">❌</p>
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
        <p className="text-slate-400">Connecting to Square…</p>
      </div>
    </div>
  )
}
