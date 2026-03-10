import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { generateGallowaySchema } from '../lib/galloway'

const GOALS = [
  { id: 'couch_to_30', label: 'Bank → 30 min doorlopen', emoji: '🛋️', description: 'Volledig beginners' },
  { id: '5k', label: '5 Kilometer', emoji: '🥇', description: '~8 weken' },
  { id: '10k', label: '10 Kilometer', emoji: '🏅', description: '~12 weken' },
  { id: '15k', label: '15 Kilometer', emoji: '🎯', description: '~14 weken' },
  { id: 'half_marathon', label: 'Halve Marathon', emoji: '🏆', description: '~16 weken' },
]

const CADENCE_OPTIONS = [150, 155, 160, 165]

// Bereken zone2MaxBpm op basis van leeftijd (70% van maxHR)
function calcZone2Max(age) {
  if (!age || isNaN(age) || age < 10 || age > 100) return null
  return Math.round(0.70 * (220 - age))
}

export default function OnboardingScreen({ onComplete, onCancel }) {
  const [step, setStep] = useState(1)
  const [goal, setGoal] = useState(null)
  const [daysPerWeek, setDaysPerWeek] = useState(3)
  const [level, setLevel] = useState('beginner')
  // B1: Stap 4 — persoonlijke zones
  const [ageInput, setAgeInput] = useState('')
  const [zone2Bpm, setZone2Bpm] = useState(145)
  const [cadenceTarget, setCadenceTarget] = useState(155)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Als leeftijd verandert, stel zone2Bpm voor (maar laat aanpasbaar)
  const handleAgeChange = (val) => {
    setAgeInput(val)
    const suggested = calcZone2Max(Number(val))
    if (suggested) setZone2Bpm(suggested)
  }

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Niet ingelogd')

      const schema = generateGallowaySchema({ goal: goal.id, daysPerWeek, currentLevel: level })

      const { data: plan, error: dbError } = await supabase
        .from('training_plans')
        .insert({
          user_id: user.id,
          goal: goal.id,
          days_per_week: daysPerWeek,
          current_level: level,
          sessions: schema.sessions,
        })
        .select()
        .single()

      if (dbError) throw new Error(dbError.message)

      // B1: Sla user_settings op (leeftijd optioneel)
      const ageVal = ageInput.trim() !== '' ? Number(ageInput) : null
      await supabase.from('user_settings').upsert({
        user_id:            user.id,
        age:                ageVal,
        zone2_max_bpm:      zone2Bpm,
        cadence_target_spm: cadenceTarget,
        updated_at:         new Date().toISOString(),
      }, { onConflict: 'user_id' })

      onComplete(plan)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const totalSteps = 4

  return (
    <div className="h-screen bg-black text-white flex flex-col">
      {/* Status bar safe area */}
      <div className="shrink-0" style={{ height: 'env(safe-area-inset-top)' }} />

      {/* Progress bar */}
      <div className="shrink-0 w-full h-1 bg-gray-900">
        <div
          className="h-full bg-[#39FF14] transition-all duration-500"
          style={{ width: `${(step / totalSteps) * 100}%` }}
        />
      </div>

      {/* ── Stap 1: Doel kiezen ─────────────────────────────────────────── */}
      {step === 1 && (
        <>
          <div className="flex-1 overflow-y-auto px-6 pt-5 pb-2">
            <div className="flex items-start justify-between mb-1">
              <h1 className="text-2xl font-black">Wat is je doel?</h1>
              {onCancel && (
                <button onClick={onCancel} className="text-gray-600 text-2xl leading-none -mt-0.5">×</button>
              )}
            </div>
            <p className="text-gray-500 text-sm mb-4">Wij passen het schema hierop aan</p>

            <div className="space-y-2.5">
              {GOALS.map(g => (
                <button
                  key={g.id}
                  onClick={() => setGoal(g)}
                  className={`w-full flex items-center gap-4 p-3.5 rounded-2xl border-2 transition-all active:scale-[0.98] ${
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
          </div>

          <div
            className="shrink-0 px-6 pt-3"
            style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
          >
            <button
              onClick={() => setStep(2)}
              disabled={!goal}
              className="w-full bg-[#39FF14] text-black font-black py-4 rounded-xl text-lg disabled:opacity-30 active:scale-95 transition-transform"
            >
              VOLGENDE →
            </button>
          </div>
        </>
      )}

      {/* ── Stap 2: Dagen per week ──────────────────────────────────────── */}
      {step === 2 && (
        <>
          <div className="flex-1 flex flex-col px-6 pt-5">
            <h1 className="text-2xl font-black mb-1">Hoeveel dagen per week?</h1>
            <p className="text-gray-500 text-sm mb-4">Minimum 2, maximum 4 voor optimaal herstel</p>

            <div className="flex-1 flex flex-col items-center justify-center gap-6">
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
          </div>

          <div
            className="shrink-0 px-6 pt-3 flex gap-3"
            style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
          >
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
          <div className="flex-1 overflow-y-auto px-6 pt-5 pb-2">
            <h1 className="text-2xl font-black mb-1">Wat is je huidig niveau?</h1>
            <p className="text-gray-500 text-sm mb-4">Wees eerlijk, het schema past zich aan</p>

            <div className="flex flex-col gap-3">
              {[
                { id: 'beginner', label: 'Beginner', emoji: '🌱', desc: 'Ik loop zelden of nooit. 30 seconden lopen is al pittig.' },
                { id: 'intermediate', label: 'Gevorderd', emoji: '💪', desc: 'Ik kan al 5-10 minuten aan een stuk lopen.' },
              ].map(l => (
                <button
                  key={l.id}
                  onClick={() => setLevel(l.id)}
                  className={`w-full flex items-start gap-4 p-4 rounded-2xl border-2 text-left transition-all active:scale-[0.98] ${
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
          </div>

          <div
            className="shrink-0 px-6 pt-3 flex gap-3"
            style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
          >
            <button onClick={() => setStep(2)} className="flex-1 py-4 rounded-xl border border-gray-700 font-bold active:scale-95 transition-transform">
              ← TERUG
            </button>
            <button onClick={() => setStep(4)} className="flex-1 bg-[#39FF14] text-black font-black py-4 rounded-xl text-lg active:scale-95 transition-transform">
              VOLGENDE →
            </button>
          </div>
        </>
      )}

      {/* ── Stap 4: Hartslagzones personaliseren (B1) ───────────────────── */}
      {step === 4 && (
        <>
          <div className="flex-1 overflow-y-auto px-6 pt-5 pb-2 space-y-5">
            <div>
              <h1 className="text-2xl font-black mb-1">Persoonlijke hartslagzone</h1>
              <p className="text-gray-500 text-sm">
                Zone 2 is de basis van duurlopen. De coach gebruikt deze grens om je te begeleiden.
              </p>
            </div>

            {/* Leeftijd — optioneel */}
            <div className="bg-gray-900 rounded-2xl p-4 space-y-3">
              <div>
                <p className="text-white font-bold text-sm">Leeftijd (optioneel)</p>
                <p className="text-gray-500 text-xs mt-0.5">
                  Helpt om je juiste hartslagzones te bepalen voor betere coaching.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  inputMode="numeric"
                  min={10}
                  max={100}
                  placeholder="bijv. 35"
                  value={ageInput}
                  onChange={e => handleAgeChange(e.target.value)}
                  className="w-24 bg-gray-800 text-white text-center text-xl font-bold rounded-xl py-2 px-3 border border-gray-700 focus:border-[#39FF14] outline-none"
                />
                <span className="text-gray-500 text-sm">jaar</span>
                {calcZone2Max(Number(ageInput)) && (
                  <span className="text-[#39FF14] text-xs ml-auto">
                    Berekend: {calcZone2Max(Number(ageInput))} bpm
                  </span>
                )}
              </div>
            </div>

            {/* Zone 2 max BPM — altijd aanpasbaar */}
            <div className="bg-gray-900 rounded-2xl p-4 space-y-3">
              <div>
                <p className="text-white font-bold text-sm">Zone 2 max BPM</p>
                <p className="text-gray-500 text-xs mt-0.5">
                  De coach geeft een waarschuwing als je hierboven komt.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setZone2Bpm(b => Math.max(120, b - 1))}
                  className="w-10 h-10 rounded-full border border-gray-700 text-xl font-bold flex items-center justify-center active:scale-90 transition-transform"
                >−</button>
                <div className="flex-1 text-center">
                  <span className="text-4xl font-black text-[#39FF14]">{zone2Bpm}</span>
                  <span className="text-gray-500 text-sm ml-1">bpm</span>
                </div>
                <button
                  onClick={() => setZone2Bpm(b => Math.min(185, b + 1))}
                  className="w-10 h-10 rounded-full border border-gray-700 text-xl font-bold flex items-center justify-center active:scale-90 transition-transform"
                >+</button>
              </div>
              <input
                type="range"
                min={120}
                max={185}
                value={zone2Bpm}
                onChange={e => setZone2Bpm(Number(e.target.value))}
                className="w-full h-2 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #39FF14 ${((zone2Bpm - 120) / 65) * 100}%, #1f1f1f ${((zone2Bpm - 120) / 65) * 100}%)`,
                }}
              />
            </div>

            {/* Cadans doel */}
            <div className="bg-gray-900 rounded-2xl p-4 space-y-3">
              <div>
                <p className="text-white font-bold text-sm">Cadans doel</p>
                <p className="text-gray-500 text-xs mt-0.5">
                  Stappen per minuut tijdens de loopstukken.
                </p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {CADENCE_OPTIONS.map(c => (
                  <button
                    key={c}
                    onClick={() => setCadenceTarget(c)}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                      cadenceTarget === c
                        ? 'bg-[#39FF14] text-black'
                        : 'bg-gray-800 text-gray-400 border border-gray-700'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p className="text-red-400 text-sm text-center bg-red-950 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>

          <div
            className="shrink-0 px-6 pt-3 flex gap-3"
            style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
          >
            <button onClick={() => setStep(3)} className="flex-1 py-4 rounded-xl border border-gray-700 font-bold active:scale-95 transition-transform">
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
  )
}
