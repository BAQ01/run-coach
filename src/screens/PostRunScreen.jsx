import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const RPE_LABELS = {
  1: 'Heel makkelijk', 2: 'Makkelijk', 3: 'Comfortabel',
  4: 'Matig', 5: 'Stevig', 6: 'Intensief',
  7: 'Heel intensief', 8: 'Zwaar', 9: 'Zeer zwaar', 10: 'Maximaal',
}

export default function PostRunScreen({ session, planId, elapsedSeconds, onComplete }) {
  const { user } = useAuth()
  const [rpe, setRpe] = useState(6)
  const [saving, setSaving] = useState(false)

  const formatTime = (secs) => {
    if (!secs) return '0:00'
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    await supabase.from('workout_logs').insert({
      user_id: user.id,
      plan_id: planId,
      session_number: session.sessionNumber,
      week: session.week,
      day: session.day,
      duration_seconds: Math.round(elapsedSeconds ?? 0),
      rpe_score: rpe,
      completed_at: new Date().toISOString(),
    })
    setSaving(false)
    onComplete()
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">

      {/* Resultaat header */}
      <div className="text-center mb-10">
        <div className="text-6xl mb-4">🎉</div>
        <h2 className="text-3xl font-black mb-2">TRAINING KLAAR!</h2>
        <p className="text-gray-400">Week {session.week} • Dag {session.day}</p>

        {/* Stats */}
        <div className="flex gap-6 justify-center mt-6">
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

      {/* RPE slider */}
      <div className="w-full max-w-sm">
        <h3 className="text-lg font-black mb-1 text-center">Hoe zwaar was dit?</h3>
        <p className="text-gray-500 text-sm text-center mb-6">RPE schaal 1–10</p>

        {/* Huidige score */}
        <div className="text-center mb-6">
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
        <div className="flex gap-1.5 justify-center mt-6">
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

      {/* Opslaan */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-10 w-full max-w-sm bg-[#39FF14] text-black font-black py-5 rounded-2xl text-xl disabled:opacity-50 active:scale-95 transition-transform"
      >
        {saving ? 'OPSLAAN...' : 'OPSLAAN ✓'}
      </button>
    </div>
  )
}

function rpeColor(rpe) {
  if (rpe <= 3) return '#3B82F6'
  if (rpe <= 5) return '#39FF14'
  if (rpe <= 7) return '#FF6B00'
  return '#EF4444'
}
