import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const GOAL_LABELS = {
  couch_to_30: 'Bank → 30 min',
  '5k': '5 Kilometer',
  '10k': '10 Kilometer',
  '15k': '15 Kilometer',
  half_marathon: 'Halve Marathon',
}

export default function DashboardScreen({ plans, onStartWorkout, onNewPlan, refreshKey }) {
  const { user } = useAuth()
  const [logsByPlan, setLogsByPlan] = useState({})

  useEffect(() => {
    if (!user) return
    supabase
      .from('workout_logs')
      .select('plan_id, session_number')
      .eq('user_id', user.id)
      .then(({ data, error }) => {
        if (error || !data) return
        const grouped = {}
        data.forEach(log => {
          if (!grouped[log.plan_id]) grouped[log.plan_id] = []
          grouped[log.plan_id].push(log.session_number)
        })
        setLogsByPlan(grouped)
      })
  }, [user?.id, refreshKey])

  const totalWorkouts = Object.values(logsByPlan).reduce((sum, arr) => sum + arr.length, 0)
  const activePlans = plans.filter(p => {
    const sessions = p.sessions ?? []
    const completed = logsByPlan[p.id] ?? []
    return sessions.some(s => !completed.includes(s.sessionNumber))
  })

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">

      {/* Header */}
      <header className="px-5 pt-6 pb-2">
        <h1 className="text-xl font-black">RUN COACH</h1>
        <p className="text-gray-500 text-xs">
          {plans.length} schema{plans.length !== 1 ? "'s" : ''} • {totalWorkouts} trainingen voltooid
        </p>
      </header>

      {/* Statistieken */}
      {plans.length > 0 && (
        <div className="px-5 pt-4">
          <div className="grid grid-cols-3 gap-2">
            <StatBox label="Schema's" value={plans.length} />
            <StatBox label="Voltooid" value={totalWorkouts} />
            <StatBox label="Actief" value={activePlans.length} />
          </div>
        </div>
      )}

      {/* Plannen lijst */}
      <div className="flex-1 px-5 pb-8 pt-4 space-y-4">

        {plans.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">🏃</div>
            <h2 className="text-xl font-black mb-2">Begin je eerste schema</h2>
            <p className="text-gray-500 text-sm">Maak een gepersonaliseerd trainingsplan</p>
          </div>
        ) : (
          plans.map(plan => (
            <PlanCard
              key={plan.id}
              plan={plan}
              completed={logsByPlan[plan.id] ?? []}
              onStartWorkout={onStartWorkout}
            />
          ))
        )}

        <button
          onClick={onNewPlan}
          className="w-full border-2 border-dashed border-gray-700 rounded-2xl py-5 text-gray-500 text-sm font-bold transition-colors active:scale-[0.98] active:border-[#39FF14]/50 active:text-[#39FF14]/70"
        >
          + NIEUW SCHEMA MAKEN
        </button>
      </div>
    </div>
  )
}

function StatBox({ label, value }) {
  return (
    <div className="bg-gray-900 rounded-xl p-3 text-center">
      <div className="text-2xl font-black text-[#39FF14]">{value}</div>
      <div className="text-gray-500 text-xs mt-0.5">{label}</div>
    </div>
  )
}

function PlanCard({ plan, completed, onStartWorkout }) {
  const [showAll, setShowAll] = useState(false)

  const sessions = plan.sessions ?? []
  const nextSession = sessions.find(s => !completed.includes(s.sessionNumber))
  const totalCompleted = completed.length
  const progressPercent = sessions.length > 0
    ? Math.round((totalCompleted / sessions.length) * 100)
    : 0
  const isDone = !nextSession && sessions.length > 0

  // Groepeer sessies per week
  const weeks = sessions.reduce((acc, s) => {
    if (!acc[s.week]) acc[s.week] = []
    acc[s.week].push(s)
    return acc
  }, {})

  return (
    <div className="bg-gray-900 rounded-2xl overflow-hidden">

      {/* Plan header */}
      <div className="p-5 border-b border-gray-800">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="font-black text-lg leading-tight">
              {GOAL_LABELS[plan.goal] ?? plan.goal}
            </div>
            <div className="text-gray-500 text-xs mt-0.5">
              {plan.total_weeks ?? plan.totalWeeks} weken
            </div>
          </div>
          {isDone ? (
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-[#39FF14]/20 text-[#39FF14] shrink-0">
              ✓ Voltooid
            </span>
          ) : (
            <span className="text-gray-500 text-sm font-bold shrink-0">
              {totalCompleted}/{sessions.length}
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#39FF14] rounded-full transition-all duration-700"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="text-gray-600 text-xs mt-1.5">{progressPercent}% voltooid</div>
      </div>

      {/* Volgende training + start */}
      {!isDone && nextSession && (
        <div className="p-5 space-y-4 border-b border-gray-800">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Volgende training</div>
              <div className="text-xs text-gray-400">Week {nextSession.week} • Dag {nextSession.day}</div>
              <div className="font-bold text-sm mt-0.5">{nextSession.description}</div>
            </div>
            <div className="text-right shrink-0 ml-3">
              <div className="text-2xl font-black text-[#39FF14]">{nextSession.totalMinutes}</div>
              <div className="text-xs text-gray-500">min</div>
            </div>
          </div>

          <div className="flex gap-1 flex-wrap">
            {nextSession.intervals.map((iv, i) => (
              <IntervalPill key={i} type={iv.type} durationSeconds={iv.durationSeconds} />
            ))}
          </div>

          <button
            onClick={() => onStartWorkout(plan, nextSession)}
            className="w-full bg-[#39FF14] text-black font-black py-4 rounded-xl text-lg tracking-widest active:scale-95 transition-transform shadow-lg shadow-[#39FF14]/20"
          >
            START RUN
          </button>
        </div>
      )}

      {isDone && (
        <div className="px-5 py-4 border-b border-gray-800 text-center">
          <p className="text-gray-500 text-sm">Geweldig! Je hebt dit schema voltooid.</p>
        </div>
      )}

      {/* Alle trainingen toggle */}
      <button
        onClick={() => setShowAll(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-gray-400 text-sm font-bold active:bg-gray-800 transition-colors"
      >
        <span>Alle trainingen ({sessions.length})</span>
        <span className="text-lg">{showAll ? '▲' : '▼'}</span>
      </button>

      {/* Weekoverzicht */}
      {showAll && (
        <div className="border-t border-gray-800">
          {Object.entries(weeks).map(([week, weekSessions]) => (
            <WeekRow
              key={week}
              week={Number(week)}
              sessions={weekSessions}
              completed={completed}
              nextSessionNumber={nextSession?.sessionNumber}
              onStartWorkout={(s) => onStartWorkout(plan, s)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function WeekRow({ week, sessions, completed, nextSessionNumber, onStartWorkout }) {
  const weekCompleted = sessions.every(s => completed.includes(s.sessionNumber))

  return (
    <div className="border-b border-gray-800 last:border-0">
      {/* Week label */}
      <div className="flex items-center justify-between px-5 py-2 bg-gray-800/50">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Week {week}</span>
        {weekCompleted && <span className="text-[#39FF14] text-xs font-bold">✓</span>}
      </div>

      {/* Sessies in deze week */}
      <div className="divide-y divide-gray-800/50">
        {sessions.map(s => {
          const isCompleted = completed.includes(s.sessionNumber)
          const isNext = s.sessionNumber === nextSessionNumber

          return (
            <div
              key={s.sessionNumber}
              className={`flex items-center gap-3 px-5 py-3 ${isNext ? 'bg-[#39FF14]/5' : ''}`}
            >
              {/* Status icon */}
              <div className="w-5 shrink-0 text-center">
                {isCompleted ? (
                  <span className="text-[#39FF14] text-sm font-bold">✓</span>
                ) : isNext ? (
                  <span className="text-[#39FF14] text-sm">→</span>
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-700 inline-block" />
                )}
              </div>

              {/* Sessie info */}
              <div className={`flex-1 min-w-0 ${isCompleted ? 'opacity-40' : ''}`}>
                <div className={`text-xs ${isNext ? 'text-[#39FF14] font-bold' : 'text-gray-400'}`}>
                  Dag {s.day}
                </div>
                <div className={`text-xs truncate ${isNext ? 'text-white' : 'text-gray-500'}`}>
                  {intervalSummary(s.intervals)}
                </div>
              </div>

              {/* Duur */}
              <div className={`text-sm font-bold shrink-0 ${isNext ? 'text-[#39FF14]' : isCompleted ? 'text-gray-700' : 'text-gray-500'}`}>
                {s.totalMinutes}m
              </div>

              {/* Start knop voor volgende sessie */}
              {isNext && (
                <button
                  onClick={() => onStartWorkout(s)}
                  className="shrink-0 bg-[#39FF14] text-black text-xs font-black px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
                >
                  START
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Korte samenvatting van de intervals (bijv. "5× Run 2m / Walk 90s")
function intervalSummary(intervals) {
  const runs = intervals.filter(iv => iv.type === 'run')
  const walks = intervals.filter(iv => iv.type === 'walk')

  if (runs.length === 0) return 'Warming-up + cooling-down'

  const runDur = runs[0].durationSeconds >= 60
    ? `${Math.round(runs[0].durationSeconds / 60)}min`
    : `${runs[0].durationSeconds}s`

  if (walks.length === 0) {
    return `Continue run ${runDur}`
  }

  const walkDur = walks[0].durationSeconds >= 60
    ? `${Math.round(walks[0].durationSeconds / 60)}min`
    : `${walks[0].durationSeconds}s`

  return `${runs.length}× Run ${runDur} / Walk ${walkDur}`
}

function IntervalPill({ type, durationSeconds }) {
  const config = {
    warmup:   { label: 'WU', color: 'bg-blue-900 text-blue-300' },
    run:      { label: 'R',  color: 'bg-[#39FF14]/20 text-[#39FF14]' },
    walk:     { label: 'W',  color: 'bg-gray-800 text-gray-400' },
    cooldown: { label: 'CD', color: 'bg-purple-900 text-purple-300' },
  }
  const c = config[type] ?? config.run
  const mins = durationSeconds >= 60
    ? `${Math.round(durationSeconds / 60)}m`
    : `${durationSeconds}s`

  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded ${c.color}`}>
      {c.label} {mins}
    </span>
  )
}
