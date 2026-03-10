import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const RPE_LABELS = {
  1: 'Heel makkelijk', 2: 'Makkelijk', 3: 'Comfortabel',
  4: 'Matig', 5: 'Stevig', 6: 'Intensief',
  7: 'Heel intensief', 8: 'Zwaar', 9: 'Zeer zwaar', 10: 'Maximaal',
}

// B2: biometricSummary = { zone2Pct, hrWarnings, avgCadence, tip, zone2MaxBpm }
export default function PostRunScreen({ session, planId, elapsedSeconds, onComplete, biometricSummary }) {
  const { user } = useAuth()
  const [rpe, setRpe] = useState(6)
  const [saving, setSaving] = useState(false)
  const savedRef = useRef(false)  // Idempotency guard: voorkomt dubbele inserts bij snel dubbel-tikken

  const formatTime = (secs) => {
    if (!secs) return '0:00'
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const handleSave = async () => {
    if (!user || savedRef.current || saving) return
    savedRef.current = true
    setSaving(true)

    const now = new Date()
    const startedAt = new Date(now.getTime() - (elapsedSeconds ?? 0) * 1000)

    const { error } = await supabase.from('workout_logs').insert({
      user_id:            user.id,
      plan_id:            planId ?? null,
      session_number:     session.sessionNumber,
      week:               session.week,
      day:                session.day,
      duration_seconds:   Math.round(elapsedSeconds ?? 0),
      rpe_score:          rpe,
      completed_at:       now.toISOString(),
      started_at:         startedAt.toISOString(),
      ended_at:           now.toISOString(),
      // B2: post-run inzichten
      time_in_zone2_pct:  biometricSummary?.zone2Pct ?? null,
      hr_warnings_count:  biometricSummary?.hrWarnings ?? 0,
      avg_cadence_run:    biometricSummary?.avgCadence ?? null,
    })

    if (error) {
      console.error('[PostRun] Opslaan mislukt:', error.message)
      savedRef.current = false
      setSaving(false)
      return
    }

    setSaving(false)
    onComplete()
  }

  const hasBiometrics = biometricSummary && (
    biometricSummary.zone2Pct !== null ||
    biometricSummary.hrWarnings > 0 ||
    biometricSummary.avgCadence !== null
  )

  return (
    <div className="h-screen bg-black text-white flex flex-col">

      {/* Status bar safe area */}
      <div className="shrink-0" style={{ height: 'env(safe-area-inset-top)' }} />

      {/* Scrollbare content */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center px-6 pt-8 pb-4">

        {/* Resultaat header */}
        <div className="text-center mb-6 w-full">
          <div className="text-6xl mb-3">🎉</div>
          <h2 className="text-3xl font-black mb-1">TRAINING KLAAR!</h2>
          <p className="text-gray-400">Week {session.week} • Dag {session.day}</p>

          {/* Basis stats */}
          <div className="flex gap-6 justify-center mt-5">
            <div className="text-center">
              <div className="text-3xl font-black text-[#39FF14]">{formatTime(elapsedSeconds)}</div>
              <div className="text-gray-600 text-xs mt-1">Gelopen</div>
            </div>
            <div className="w-px bg-gray-800" />
            <div className="text-center">
              <div className="text-3xl font-black text-[#39FF14]">{session.intervals?.length ?? 0}</div>
              <div className="text-gray-600 text-xs mt-1">Intervallen</div>
            </div>
          </div>
        </div>

        {/* B2: Post-run inzichten */}
        {hasBiometrics && (
          <div className="w-full max-w-sm mb-6 space-y-3">
            <h3 className="text-base font-black text-white text-center uppercase tracking-wider">
              Analyse
            </h3>

            {/* Statistieken row */}
            <div className="grid grid-cols-3 gap-2">
              {biometricSummary.zone2Pct !== null && (
                <div className="bg-gray-900 rounded-xl p-3 text-center">
                  <div className={`text-2xl font-black ${biometricSummary.zone2Pct >= 70 ? 'text-[#39FF14]' : biometricSummary.zone2Pct >= 50 ? 'text-orange-400' : 'text-red-400'}`}>
                    {biometricSummary.zone2Pct}%
                  </div>
                  <div className="text-gray-500 text-xs mt-0.5">Zone 2</div>
                </div>
              )}
              {biometricSummary.hrWarnings !== null && (
                <div className="bg-gray-900 rounded-xl p-3 text-center">
                  <div className={`text-2xl font-black ${biometricSummary.hrWarnings === 0 ? 'text-[#39FF14]' : biometricSummary.hrWarnings <= 2 ? 'text-orange-400' : 'text-red-400'}`}>
                    {biometricSummary.hrWarnings}
                  </div>
                  <div className="text-gray-500 text-xs mt-0.5">HR alerts</div>
                </div>
              )}
              {biometricSummary.avgCadence !== null && (
                <div className="bg-gray-900 rounded-xl p-3 text-center">
                  <div className={`text-2xl font-black ${biometricSummary.avgCadence >= 155 ? 'text-[#39FF14]' : 'text-orange-400'}`}>
                    {biometricSummary.avgCadence}
                  </div>
                  <div className="text-gray-500 text-xs mt-0.5">Cadans</div>
                </div>
              )}
            </div>

            {/* Coach tip */}
            {biometricSummary.tip && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Coach tip</p>
                <p className="text-white text-sm leading-snug">{biometricSummary.tip}</p>
              </div>
            )}
          </div>
        )}

        {/* RPE slider */}
        <div className="w-full max-w-sm">
          <h3 className="text-lg font-black mb-1 text-center">Hoe zwaar was dit?</h3>
          <p className="text-gray-500 text-sm text-center mb-4">RPE schaal 1–10</p>

          {/* Huidige score */}
          <div className="text-center mb-4">
            <div className="text-7xl font-black" style={{ color: rpeColor(rpe) }}>{rpe}</div>
            <div className="text-gray-400 mt-1">{RPE_LABELS[rpe]}</div>
          </div>

          {/* Slider */}
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={rpe}
            onChange={(e) => setRpe(Number(e.target.value))}
            className="w-full h-3 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, ${rpeColor(rpe)} ${(rpe - 1) * 11.1}%, #1f1f1f ${(rpe - 1) * 11.1}%)`,
            }}
          />

          {/* Labels */}
          <div className="flex justify-between text-gray-700 text-xs mt-2">
            <span>1 Makkelijk</span>
            <span>10 Maximaal</span>
          </div>

          {/* RPE dottenrij */}
          <div className="flex gap-1.5 justify-center mt-4">
            {Array.from({ length: 10 }, (_, i) => (
              <button
                key={i + 1}
                onClick={() => setRpe(i + 1)}
                className="w-7 h-7 rounded-full font-bold text-xs transition-all"
                style={{
                  backgroundColor: rpe >= i + 1 ? rpeColor(i + 1) : '#1f1f1f',
                  color: rpe >= i + 1 ? '#000' : '#666',
                  transform: rpe === i + 1 ? 'scale(1.3)' : 'scale(1)',
                }}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Vaste opslaan-knop onderaan */}
      <div
        className="shrink-0 px-6 pt-3"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <button
          onClick={handleSave}
          disabled={saving || savedRef.current}
          className="w-full bg-[#39FF14] text-black font-black py-5 rounded-2xl text-xl disabled:opacity-50 active:scale-95 transition-transform"
        >
          {saving ? 'OPSLAAN...' : 'OPSLAAN ✓'}
        </button>
      </div>
    </div>
  )
}

function rpeColor(rpe) {
  if (rpe <= 3) return '#3B82F6'
  if (rpe <= 5) return '#39FF14'
  if (rpe <= 7) return '#FF6B00'
  return '#EF4444'
}
