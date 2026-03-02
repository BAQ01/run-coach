import { useState } from 'react'
import { supabase } from '../lib/supabase'

const GOALS = [
  { id: 'couch_to_30', label: 'Bank → 30 min doorlopen', emoji: '🛋️', description: 'Volledig beginners' },
  { id: '5k', label: '5 Kilometer', emoji: '🥇', description: '~8 weken' },
  { id: '10k', label: '10 Kilometer', emoji: '🏅', description: '~12 weken' },
  { id: '15k', label: '15 Kilometer', emoji: '🎯', description: '~14 weken' },
  { id: 'half_marathon', label: 'Halve Marathon', emoji: '🏆', description: '~16 weken' },
]

export default function OnboardingScreen({ onComplete, onCancel }) {
  const [step, setStep] = useState(1)
  const [goal, setGoal] = useState(null)
  const [daysPerWeek, setDaysPerWeek] = useState(3)
  const [level, setLevel] = useState('beginner')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)

    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession()
      const token = currentSession?.access_token

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-schema`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ goal: goal.id, daysPerWeek, currentLevel: level }),
      })

      let data
      try {
        data = await res.json()
      } catch {
        throw new Error(`Server fout (HTTP ${res.status})`)
      }

      if (!res.ok) {
        const msg = data?.error || data?.message || `Fout ${res.status}`
        const detail = data?.detail ? ` — ${data.detail}` : ''
        throw new Error(msg + detail)
      }

      if (!data.plan) throw new Error('Geen schema ontvangen van server')
      onComplete(data.plan)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Progress bar */}
      <div className="w-full h-1 bg-gray-900">
        <div
          className="h-full bg-[#39FF14] transition-all duration-500"
          style={{ width: `${(step / 3) * 100}%` }}
        />
      </div>

      <div className="flex-1 flex flex-col p-6 pt-8">

        {/* ── Stap 1: Doel kiezen ─────────────────────────────────────────── */}
        {step === 1 && (
          <>
            <div className="flex items-start justify-between mb-1">
              <h1 className="text-2xl font-black">Wat is je doel?</h1>
              {onCancel && (
                <button onClick={onCancel} className="text-gray-600 text-2xl leading-none -mt-0.5">×</button>
              )}
            </div>
            <p className="text-gray-500 text-sm mb-6">Wij passen het schema hierop aan</p>

            <div className="space-y-3 flex-1">
              {GOALS.map(g => (
                <button
                  key={g.id}
                  onClick={() => setGoal(g)}
                  className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all active:scale-[0.98] ${
                    goal?.id === g.id
                      ? 'border-[#39FF14] bg-[#39FF14]/10'
                      : 'border-gray-800 bg-gray-900'
                  }`}
                >
                  <span className="text-3xl">{g.emoji}</span>
                  <div className="text-left">
                    <div className="font-bold">{g.label}</div>
                    <div className="text-gray-500 text-xs">{g.description}</div>
                  </div>
                  {goal?.id === g.id && <span className="ml-auto text-[#39FF14] text-xl">✓</span>}
                </button>
              ))}
            </div>

            <button
              onClick={() => setStep(2)}
              disabled={!goal}
              className="mt-6 w-full bg-[#39FF14] text-black font-black py-4 rounded-xl text-lg disabled:opacity-30 active:scale-95 transition-transform"
            >
              VOLGENDE →
            </button>
          </>
        )}

        {/* ── Stap 2: Dagen per week ──────────────────────────────────────── */}
        {step === 2 && (
          <>
            <h1 className="text-2xl font-black mb-1">Hoeveel dagen per week?</h1>
            <p className="text-gray-500 text-sm mb-8">Minimum 2, maximum 4 voor optimaal herstel</p>

            <div className="flex-1 flex flex-col items-center justify-center gap-8">
              <div className="flex items-center gap-8">
                <button
                  onClick={() => setDaysPerWeek(d => Math.max(2, d - 1))}
                  className="w-16 h-16 rounded-full border-2 border-gray-700 text-2xl font-bold flex items-center justify-center active:scale-90 transition-transform"
                >
                  −
                </button>
                <div className="text-center">
                  <div className="text-7xl font-black text-[#39FF14]">{daysPerWeek}</div>
                  <div className="text-gray-500 text-sm mt-1">dagen per week</div>
                </div>
                <button
                  onClick={() => setDaysPerWeek(d => Math.min(4, d + 1))}
                  className="w-16 h-16 rounded-full border-2 border-gray-700 text-2xl font-bold flex items-center justify-center active:scale-90 transition-transform"
                >
                  +
                </button>
              </div>

              <div className="flex gap-2">
                {[2, 3, 4].map(d => (
                  <button
                    key={d}
                    onClick={() => setDaysPerWeek(d)}
                    className={`px-6 py-2 rounded-full text-sm font-bold transition-all ${
                      daysPerWeek === d ? 'bg-[#39FF14] text-black' : 'bg-gray-900 text-gray-400'
                    }`}
                  >
                    {d}x
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(1)} className="flex-1 py-4 rounded-xl border border-gray-700 font-bold active:scale-95 transition-transform">
                ← TERUG
              </button>
              <button onClick={() => setStep(3)} className="flex-1 bg-[#39FF14] text-black font-black py-4 rounded-xl text-lg active:scale-95 transition-transform">
                VOLGENDE →
              </button>
            </div>
          </>
        )}

        {/* ── Stap 3: Huidig niveau ───────────────────────────────────────── */}
        {step === 3 && (
          <>
            <h1 className="text-2xl font-black mb-1">Wat is je huidig niveau?</h1>
            <p className="text-gray-500 text-sm mb-6">Wees eerlijk, het schema past zich aan</p>

            <div className="flex-1 flex flex-col gap-4">
              {[
                { id: 'beginner', label: 'Beginner', emoji: '🌱', desc: 'Ik loop zelden of nooit. 30 seconden lopen is al pittig.' },
                { id: 'intermediate', label: 'Gevorderd', emoji: '💪', desc: 'Ik kan al 5-10 minuten aan een stuk lopen.' },
              ].map(l => (
                <button
                  key={l.id}
                  onClick={() => setLevel(l.id)}
                  className={`w-full flex items-start gap-4 p-5 rounded-2xl border-2 text-left transition-all active:scale-[0.98] ${
                    level === l.id ? 'border-[#39FF14] bg-[#39FF14]/10' : 'border-gray-800 bg-gray-900'
                  }`}
                >
                  <span className="text-3xl">{l.emoji}</span>
                  <div>
                    <div className="font-bold text-lg">{l.label}</div>
                    <div className="text-gray-400 text-sm mt-0.5">{l.desc}</div>
                  </div>
                  {level === l.id && <span className="ml-auto text-[#39FF14] text-xl">✓</span>}
                </button>
              ))}
            </div>

            {error && (
              <p className="text-red-400 text-sm text-center bg-red-950 rounded-lg px-3 py-2 mt-4">{error}</p>
            )}

            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(2)} className="flex-1 py-4 rounded-xl border border-gray-700 font-bold active:scale-95 transition-transform">
                ← TERUG
              </button>
              <button
                onClick={handleGenerate}
                disabled={loading}
                className="flex-1 bg-[#39FF14] text-black font-black py-4 rounded-xl text-lg disabled:opacity-50 active:scale-95 transition-transform"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    GENEREREN...
                  </span>
                ) : 'SCHEMA MAKEN →'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
