import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'

export default function AuthScreen() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const fn = mode === 'signin' ? signIn : signUp
    const { error } = await fn(email, password)

    setLoading(false)
    if (error) {
      setError(error.message)
    } else if (mode === 'signup') {
      setSuccess(true)
    }
  }

  if (success) {
    return (
      <div className="h-screen bg-black flex flex-col items-center justify-center p-6 text-center">
        <div className="text-5xl mb-4">✉️</div>
        <h2 className="text-xl font-bold text-white mb-2">Check je email</h2>
        <p className="text-gray-400 text-sm">We hebben een bevestigingslink gestuurd naar {email}</p>
        <button onClick={() => { setMode('signin'); setSuccess(false) }} className="mt-6 text-[#39FF14] text-sm underline">
          Terug naar inloggen
        </button>
      </div>
    )
  }

  return (
    <div className="h-screen bg-black flex flex-col">
      {/* Status bar safe area */}
      <div className="shrink-0" style={{ height: 'env(safe-area-inset-top)' }} />

      {/* Centered content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="text-5xl mb-3">🏃</div>
          <h1 className="text-3xl font-black text-white tracking-tight">RUN COACH</h1>
          <p className="text-gray-500 text-sm mt-1">Van de bank naar je doel</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3.5 text-white placeholder-gray-500 focus:outline-none focus:border-[#39FF14] text-base"
          />
          <input
            type="password"
            placeholder="Wachtwoord"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3.5 text-white placeholder-gray-500 focus:outline-none focus:border-[#39FF14] text-base"
          />

          {error && (
            <p className="text-red-400 text-sm text-center bg-red-950 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#39FF14] text-black font-black py-4 rounded-xl text-lg tracking-wide disabled:opacity-50 active:scale-95 transition-transform"
          >
            {loading ? '...' : mode === 'signin' ? 'INLOGGEN' : 'ACCOUNT AANMAKEN'}
          </button>
        </form>

        {/* Toggle mode */}
        <button
          onClick={() => { setMode(m => m === 'signin' ? 'signup' : 'signin'); setError(null) }}
          className="mt-5 text-gray-400 text-sm"
        >
          {mode === 'signin' ? 'Nog geen account? ' : 'Al een account? '}
          <span className="text-[#39FF14]">{mode === 'signin' ? 'Aanmelden' : 'Inloggen'}</span>
        </button>
      </div>

      {/* Bottom safe area */}
      <div className="shrink-0" style={{ height: 'env(safe-area-inset-bottom)' }} />
    </div>
  )
}
