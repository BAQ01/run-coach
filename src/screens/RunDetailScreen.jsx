import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const GOAL_LABELS = {
  couch_to_30:    'Bank → 30 min',
  '5k':           '5 Kilometer',
  '10k':          '10 Kilometer',
  '15k':          '15 Kilometer',
  half_marathon:  'Halve Marathon',
}

const RPE_LABELS = {
  1: 'Heel makkelijk', 2: 'Makkelijk',    3: 'Comfortabel',
  4: 'Matig',          5: 'Stevig',        6: 'Intensief',
  7: 'Heel intensief', 8: 'Zwaar',         9: 'Zeer zwaar', 10: 'Maximaal',
}

function formatDuration(secs) {
  if (!secs) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDateTime(isoString) {
  if (!isoString) return '–'
  return new Intl.DateTimeFormat('nl-NL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(isoString))
}

function rpeColor(rpe) {
  if (!rpe) return '#6b7280'
  if (rpe <= 3) return '#3B82F6'
  if (rpe <= 5) return '#39FF14'
  if (rpe <= 7) return '#FF6B00'
  return '#EF4444'
}

function planLabel(plans, planId) {
  if (!planId) return 'Onbekend schema'
  const plan = plans.find(p => p.id === planId)
  if (!plan) return 'Verwijderd schema'
  return GOAL_LABELS[plan.goal] ?? plan.goal
}

export default function RunDetailScreen({ logId, plans, onBack }) {
  const [log, setLog]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    if (!logId) return
    setLoading(true)
    setError(null)

    supabase
      .from('workout_logs')
      .select('*')
      .eq('id', logId)
      .single()
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setLog(data)
        setLoading(false)
      })
  }, [logId])

  return (
    <div className="h-screen bg-black text-white flex flex-col">

      {/* Status bar safe area */}
      <div className="shrink-0" style={{ height: 'env(safe-area-inset-top)' }} />

      {/* Header */}
      <header className="shrink-0 px-5 pt-3 pb-3 flex items-center gap-3 border-b border-gray-900">
        <button
          onClick={onBack}
          className="text-gray-400 text-2xl leading-none active:text-white transition-colors p-1 -ml-1"
          aria-label="Terug"
        >
          ←
        </button>
        <h1 className="text-xl font-black flex-1">Run detail</h1>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5">

        {loading && (
          <div className="flex items-center justify-center pt-16">
            <div className="w-8 h-8 border-2 border-[#39FF14] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center pt-16 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-gray-400 text-sm">{error}</p>
          </div>
        )}

        {!loading && !error && log && (
          <div className="space-y-4">

            {/* Datum + tijd */}
            <div className="bg-gray-900 rounded-2xl p-4">
              <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Datum</p>
              <p className="text-white font-bold capitalize">
                {formatDateTime(log.completed_at)}
              </p>
            </div>

            {/* Duur — grote weergave */}
            <div className="bg-gray-900 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Duur</p>
                <p className="text-4xl font-black text-[#39FF14] tabular-nums">
                  {formatDuration(log.duration_seconds)}
                </p>
              </div>
              {log.started_at && log.ended_at && (
                <div className="text-right">
                  <p className="text-gray-600 text-xs">
                    {new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' }).format(new Date(log.started_at))}
                    {' – '}
                    {new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' }).format(new Date(log.ended_at))}
                  </p>
                </div>
              )}
            </div>

            {/* Schema */}
            <div className="bg-gray-900 rounded-2xl p-4">
              <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Schema</p>
              <p className="text-white font-bold">{planLabel(plans, log.plan_id)}</p>
              {log.week != null && (
                <p className="text-gray-500 text-sm mt-0.5">Week {log.week} · Dag {log.day}</p>
              )}
            </div>

            {/* RPE */}
            {log.rpe_score != null && (
              <div className="bg-gray-900 rounded-2xl p-4 flex items-center gap-4">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-black text-2xl font-black shrink-0"
                  style={{ backgroundColor: rpeColor(log.rpe_score) }}
                >
                  {log.rpe_score}
                </div>
                <div>
                  <p className="text-gray-500 text-xs uppercase tracking-wider mb-0.5">Inspanning (RPE)</p>
                  <p className="text-white font-bold">{RPE_LABELS[log.rpe_score] ?? '–'}</p>
                </div>
              </div>
            )}

            {/* HR stats (als aanwezig) */}
            {(log.avg_hr != null || log.max_hr != null) && (
              <div className="bg-gray-900 rounded-2xl p-4">
                <p className="text-gray-500 text-xs uppercase tracking-wider mb-3">Hartslag</p>
                <div className="flex gap-6">
                  {log.avg_hr != null && (
                    <div>
                      <p className="text-2xl font-black text-red-400">{log.avg_hr}</p>
                      <p className="text-gray-500 text-xs mt-0.5">Gem. bpm</p>
                    </div>
                  )}
                  {log.max_hr != null && (
                    <div>
                      <p className="text-2xl font-black text-red-500">{log.max_hr}</p>
                      <p className="text-gray-500 text-xs mt-0.5">Max. bpm</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Cadence stats (als aanwezig) */}
            {(log.avg_cadence != null || log.max_cadence != null) && (
              <div className="bg-gray-900 rounded-2xl p-4">
                <p className="text-gray-500 text-xs uppercase tracking-wider mb-3">Cadans</p>
                <div className="flex gap-6">
                  {log.avg_cadence != null && (
                    <div>
                      <p className="text-2xl font-black text-blue-400">{log.avg_cadence}</p>
                      <p className="text-gray-500 text-xs mt-0.5">Gem. spm</p>
                    </div>
                  )}
                  {log.max_cadence != null && (
                    <div>
                      <p className="text-2xl font-black text-blue-500">{log.max_cadence}</p>
                      <p className="text-gray-500 text-xs mt-0.5">Max. spm</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Notes (als aanwezig) */}
            {log.notes && (
              <div className="bg-gray-900 rounded-2xl p-4">
                <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Notitie</p>
                <p className="text-white text-sm leading-relaxed">{log.notes}</p>
              </div>
            )}

            {/* Bottom safe area */}
            <div style={{ height: 'env(safe-area-inset-bottom)' }} />
          </div>
        )}
      </div>
    </div>
  )
}
