import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const PAGE_SIZE = 20

const GOAL_LABELS = {
  couch_to_30:    'Bank → 30 min',
  '5k':           '5 Kilometer',
  '10k':          '10 Kilometer',
  '15k':          '15 Kilometer',
  half_marathon:  'Halve Marathon',
}

const DAY_OPTIONS = [
  { value: 7,  label: '7 dagen' },
  { value: 30, label: '30 dagen' },
  { value: 90, label: '90 dagen' },
]

function formatDuration(secs) {
  if (!secs) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDate(isoString) {
  const d = new Date(isoString)
  return new Intl.DateTimeFormat('nl-NL', {
    weekday: 'short', day: 'numeric', month: 'short',
  }).format(d)
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

export default function RunHistoryScreen({ onBack, onSelectLog, plans }) {
  const { user } = useAuth()
  const [dayFilter, setDayFilter]   = useState(30)
  const [planFilter, setPlanFilter] = useState('all')
  const [logs, setLogs]             = useState([])
  const [loading, setLoading]       = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]           = useState(null)
  const [hasMore, setHasMore]       = useState(false)
  const pageRef = useRef(0)

  // ── Query builder ──────────────────────────────────────────────────────────
  const buildQuery = useCallback((page) => {
    const cutoff = new Date(
      Date.now() - dayFilter * 24 * 60 * 60 * 1000
    ).toISOString()

    let q = supabase
      .from('workout_logs')
      .select('id, completed_at, duration_seconds, rpe_score, plan_id, session_number, week, day')
      .eq('user_id', user.id)
      .gte('completed_at', cutoff)
      .order('completed_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (planFilter !== 'all') q = q.eq('plan_id', planFilter)
    return q
  }, [user?.id, dayFilter, planFilter])

  // ── Initial / filter-change load ──────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    let active = true
    pageRef.current = 0
    setLoading(true)
    setError(null)

    buildQuery(0).then(({ data, error: err }) => {
      if (!active) return
      if (err) { setError(err.message); setLoading(false); return }
      setLogs(data ?? [])
      setHasMore((data?.length ?? 0) === PAGE_SIZE)
      setLoading(false)
    })

    return () => { active = false }
  }, [buildQuery, user?.id])

  // ── Load more ─────────────────────────────────────────────────────────────
  const handleLoadMore = () => {
    if (loadingMore || loading || !hasMore) return
    const nextPage = pageRef.current + 1
    pageRef.current = nextPage
    setLoadingMore(true)

    buildQuery(nextPage).then(({ data, error: err }) => {
      if (err) { setLoadingMore(false); return }
      setLogs(prev => [...prev, ...(data ?? [])])
      setHasMore((data?.length ?? 0) === PAGE_SIZE)
      setLoadingMore(false)
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────
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
        <h1 className="text-xl font-black flex-1">Logboek</h1>
      </header>

      {/* Filters */}
      <div className="shrink-0 px-5 py-3 flex gap-2 border-b border-gray-900">
        {/* Periode */}
        <div className="flex-1 relative">
          <select
            value={dayFilter}
            onChange={e => setDayFilter(Number(e.target.value))}
            className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-xl px-3 py-2.5 appearance-none pr-8 font-medium"
          >
            {DAY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">▾</span>
        </div>

        {/* Plan filter (alleen tonen als er plannen zijn) */}
        {plans.length > 0 && (
          <div className="flex-1 relative">
            <select
              value={planFilter}
              onChange={e => setPlanFilter(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-xl px-3 py-2.5 appearance-none pr-8 font-medium"
            >
              <option value="all">Alle schema's</option>
              {plans.map(p => (
                <option key={p.id} value={p.id}>
                  {GOAL_LABELS[p.goal] ?? p.goal}
                </option>
              ))}
            </select>
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">▾</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center pt-16">
            <div className="w-8 h-8 border-2 border-[#39FF14] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center pt-16 px-8 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-gray-400 text-sm mb-4">{error}</p>
            <button
              onClick={() => {
                pageRef.current = 0
                setLoading(true)
                setError(null)
                buildQuery(0).then(({ data, error: err }) => {
                  if (err) { setError(err.message); setLoading(false); return }
                  setLogs(data ?? [])
                  setHasMore((data?.length ?? 0) === PAGE_SIZE)
                  setLoading(false)
                })
              }}
              className="bg-gray-800 text-white px-6 py-3 rounded-xl font-bold text-sm active:scale-95 transition-transform"
            >
              Opnieuw proberen
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && logs.length === 0 && (
          <div className="flex flex-col items-center justify-center pt-16 px-8 text-center">
            <div className="text-5xl mb-4">🏃</div>
            <h2 className="text-lg font-black mb-2">Nog geen runs</h2>
            <p className="text-gray-500 text-sm">
              {planFilter !== 'all'
                ? 'Geen runs voor dit schema in de geselecteerde periode.'
                : 'Voltooi je eerste training om hem hier te zien.'}
            </p>
          </div>
        )}

        {/* Log lijst */}
        {!loading && !error && logs.length > 0 && (
          <div className="divide-y divide-gray-900">
            {logs.map(log => (
              <LogItem
                key={log.id}
                log={log}
                plans={plans}
                onPress={() => onSelectLog(log)}
              />
            ))}

            {/* Laad meer */}
            {hasMore && (
              <div className="px-5 py-4">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="w-full bg-gray-900 border border-gray-800 rounded-xl py-3 text-gray-400 text-sm font-bold disabled:opacity-50 active:scale-[0.98] transition-transform"
                >
                  {loadingMore ? 'Laden...' : 'Laad meer'}
                </button>
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

function LogItem({ log, plans, onPress }) {
  const rpe = log.rpe_score
  return (
    <button
      onClick={onPress}
      className="w-full px-5 py-4 flex items-center gap-4 text-left active:bg-gray-900 transition-colors"
    >
      {/* RPE kleurstrook */}
      <div
        className="w-1 self-stretch rounded-full shrink-0"
        style={{ backgroundColor: rpeColor(rpe), minHeight: 40 }}
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-white font-bold text-base">
            {formatDate(log.completed_at)}
          </span>
          <span className="text-[#39FF14] font-black text-lg tabular-nums shrink-0">
            {formatDuration(log.duration_seconds)}
          </span>
        </div>
        <div className="text-gray-500 text-xs mt-0.5 truncate">
          {planLabel(plans, log.plan_id)}
          {log.week != null && ` · Week ${log.week} · Dag ${log.day}`}
        </div>
      </div>

      {/* RPE badge */}
      <div className="shrink-0 text-right">
        {rpe != null ? (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-black text-sm font-black"
            style={{ backgroundColor: rpeColor(rpe) }}
          >
            {rpe}
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center">
            <span className="text-gray-600 text-xs">–</span>
          </div>
        )}
      </div>

      {/* Chevron */}
      <span className="text-gray-700 shrink-0">›</span>
    </button>
  )
}
