import { useState, useRef, useCallback, useEffect } from 'react'
import { useAudioEngine } from '../hooks/useAudioEngine'
import { useHealthKitWorkout } from '../hooks/useHealthKitWorkout'
import { useBiometricObserver } from '../hooks/useBiometricObserver'
import { useUserSettings } from '../hooks/useUserSettings'
import { resolveWorkoutState, buildCueTimeline, WorkoutState } from '../lib/workoutStateMachine'
import IntervalDial from '../components/IntervalDial'

const VOICES = [
  { id: 'rebecca', label: 'Rebecca', gender: 'V' },
  { id: 'sarah',   label: 'Sarah',   gender: 'V' },
  { id: 'pieter',  label: 'Pieter',  gender: 'M' },
  { id: 'rik',     label: 'Rik',     gender: 'M' },
]

function intervalTypeToState(type) {
  const map = { warmup: WorkoutState.WARMUP, run: WorkoutState.RUN, walk: WorkoutState.WALK, cooldown: WorkoutState.COOLDOWN }
  return map[type] ?? WorkoutState.RUN
}

const STATE_CONFIG = {
  [WorkoutState.WARMUP]:   { label: 'WARMING-UP', color: '#3B82F6', bg: 'bg-blue-950' },
  [WorkoutState.RUN]:      { label: 'RENNEN',      color: '#39FF14', bg: 'bg-[#39FF14]/10' },
  [WorkoutState.WALK]:     { label: 'WANDELEN',    color: '#FF6B00', bg: 'bg-orange-950' },
  [WorkoutState.COOLDOWN]: { label: 'COOLING-DOWN', color: '#8B5CF6', bg: 'bg-purple-950' },
  [WorkoutState.DONE]:     { label: 'KLAAR!',       color: '#39FF14', bg: 'bg-black' },
}

const STORAGE_KEY = 'activeWorkout'

export default function ActiveRunScreen({ session, planId, initialElapsed = 0, onDone, autoAttach = false }) {
  const audio = useAudioEngine()
  const healthkit = useHealthKitWorkout()
  const { settings } = useUserSettings()  // B1: personalized zones

  // ── BiometricObserver — Zone 2 Enforcer + Cadence Coach ───────────────────
  const { onSample: observerOnSample, reset: observerReset, setConfig: observerSetConfig, getSummary: observerGetSummary } = useBiometricObserver({
    playCoachCue: audio.playCoachCue,
  })

  // B1: Sync personalized zone config naar observer zodra settings geladen zijn
  useEffect(() => {
    if (!settings) return
    observerSetConfig({
      targetMaxBpm:      settings.zone2_max_bpm,
      cadenceTargetSpm:  settings.cadence_target_spm,
    })
  }, [settings, observerSetConfig])

  // Stable ref so biometrics listener closure always reads current runState
  const runStateRef = useRef(WorkoutState.IDLE)
  const [voice, setVoice] = useState(() => localStorage.getItem('coachVoice') ?? 'rebecca')
  const [runState, setRunState] = useState(() => {
    if (!autoAttach) return WorkoutState.IDLE
    const r = resolveWorkoutState(initialElapsed, session.intervals)
    return r.state !== WorkoutState.IDLE ? r.state : WorkoutState.WARMUP
  })
  const [paused, setPaused] = useState(false)
  const [elapsed, setElapsed] = useState(initialElapsed)
  const [currentInterval, setCurrentInterval] = useState(() => {
    if (!autoAttach) return null
    return resolveWorkoutState(initialElapsed, session.intervals).interval ?? null
  })
  const [intervalRemaining, setIntervalRemaining] = useState(() => {
    if (!autoAttach) return 0
    return resolveWorkoutState(initialElapsed, session.intervals).intervalRemaining ?? 0
  })
  const [showStopConfirm, setShowStopConfirm] = useState(false)
  const [startError, setStartError] = useState(null)
  const [biometricsStale, setBiometricsStale] = useState(false)

  const biometricsListenerRef = useRef(null)
  const staleListenerRef = useRef(null)
  const hasReceivedBiometricsRef = useRef(false)

  const handleVoiceChange = useCallback((v) => {
    setVoice(v)
    localStorage.setItem('coachVoice', v)
  }, [])

  const intervals = session.intervals

  // ── A4: Helper die altijd beide listeners opruimt vóór re-attach ──────────
  const removeHKListeners = useCallback(() => {
    biometricsListenerRef.current?.remove()
    biometricsListenerRef.current = null
    staleListenerRef.current?.remove()
    staleListenerRef.current = null
  }, [])

  // A4: Cleanup listeners on unmount
  useEffect(() => () => removeHKListeners(), [removeHKListeners])

  // ── Tick handler – alleen UI updates, audio is pre-scheduled ─────────────
  const handleTick = useCallback((elapsedSeconds) => {
    setElapsed(elapsedSeconds)
    const result = resolveWorkoutState(elapsedSeconds, intervals)
    setRunState(result.state)
    runStateRef.current = result.state   // keep ref in sync for biometrics listener closure
    setCurrentInterval(result.interval)
    setIntervalRemaining(result.intervalRemaining ?? 0)

    // Bewaar staat elke tick zodat iOS-herstart de workout kan hervatten
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        session, planId, voice: localStorage.getItem('coachVoice') ?? 'rebecca',
        elapsedSeconds, savedAt: Date.now(),
      }))
    } catch (_) {}

    if (result.state === WorkoutState.DONE) {
      localStorage.removeItem(STORAGE_KEY)
      audio.stop()
      const summary = observerGetSummary()  // B2: verzamel inzichten
      setTimeout(() => onDone(elapsedSeconds, summary), 1500)
    }
  }, [intervals, audio, onDone, session, planId, observerGetSummary])

  // ── Start – geeft cue-timeline + stem door aan de audio engine ────────────
  const handleStart = useCallback(async () => {
    setStartError(null)
    try {
      const cueTimeline = buildCueTimeline(intervals)

      // Audio direct starten — timer begint onmiddellijk, geen wachttijd voor HealthKit
      await audio.start(handleTick, cueTimeline, voice, initialElapsed)
      setRunState(WorkoutState.WARMUP)

      // HealthKit in de achtergrond koppelen
      setBiometricsStale(false)
      hasReceivedBiometricsRef.current = false
      observerReset()

      // A4: Verwijder eventuele overgebleven listeners vóór nieuwe attach
      removeHKListeners()

      healthkit.requestPermissions()
        .then(async () => {
          biometricsListenerRef.current = await healthkit.attachBiometrics(sample => {
            hasReceivedBiometricsRef.current = true
            setBiometricsStale(false)
            observerOnSample(sample, runStateRef.current)
          })
          staleListenerRef.current = await healthkit.attachStale(() => setBiometricsStale(true))
          healthkit.startWorkout()
        })
        .catch(err => console.warn('[ActiveRun] HealthKit setup mislukt:', err))
    } catch (err) {
      console.error('[ActiveRun] Start mislukt:', err)
      setStartError(err?.message ?? String(err))
    }
  }, [audio, healthkit, handleTick, intervals, voice, initialElapsed, removeHKListeners])

  // ── Auto-attach: koppel listeners aan al-lopende native sessie ────────────
  useEffect(() => {
    if (!autoAttach) return
    audio.attach(handleTick).catch(err => console.error('[ActiveRun] Attach mislukt:', err))

    // A4: Verwijder eventuele overgebleven listeners vóór re-attach
    removeHKListeners()

    hasReceivedBiometricsRef.current = false
    observerReset()
    healthkit.attachBiometrics(sample => {
      hasReceivedBiometricsRef.current = true
      setBiometricsStale(false)
      observerOnSample(sample, runStateRef.current)
    }).then(h => { biometricsListenerRef.current = h })
    healthkit.attachStale(() => setBiometricsStale(true))
      .then(h => { staleListenerRef.current = h })
  }, [autoAttach]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pause / Resume ─────────────────────────────────────────────────────────
  const handlePause = useCallback(async () => {
    if (paused) {
      await audio.resume()
      setPaused(false)
    } else {
      await audio.pause()
      setPaused(true)
    }
  }, [paused, audio])

  // ── Stop ───────────────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    audio.stop()
    healthkit.stopWorkout()
    removeHKListeners()
    const summary = observerGetSummary()  // B2: verzamel inzichten ook bij vroegtijdig stoppen
    observerReset()
    onDone(elapsed, summary)
  }, [audio, healthkit, elapsed, onDone, removeHKListeners, observerReset, observerGetSummary])

  const stateConfig = STATE_CONFIG[runState] ?? STATE_CONFIG[WorkoutState.RUN]
  const totalDuration = intervals.reduce((s, iv) => s + iv.durationSeconds, 0)
  const progressPercent = totalDuration > 0 ? Math.min(100, (elapsed / totalDuration) * 100) : 0

  // Formatteer timer
  const formatTime = (secs) => {
    const s = Math.floor(secs)
    const m = Math.floor(s / 60)
    const ss = s % 60
    return `${m}:${ss.toString().padStart(2, '0')}`
  }

  // ── Actieve dial props ────────────────────────────────────────────────────
  const intervalTotalSeconds = currentInterval?.durationSeconds ?? 1
  const activeProgress = currentInterval
    ? Math.max(0, Math.min(1, 1 - intervalRemaining / intervalTotalSeconds))
    : 0
  const intervalIndex = currentInterval ? intervals.indexOf(currentInterval) : 0
  const _remSec = Math.floor(intervalRemaining)
  const activeCenterDigits =
    String(Math.floor(_remSec / 60)).padStart(2, '0') +
    String(_remSec % 60).padStart(2, '0')
  const activeSubtitle = `${intervalIndex + 1} / ${intervals.length}`

  return (
    <div className="h-screen bg-black text-white flex flex-col select-none overflow-hidden">

      {/* Status bar safe area */}
      <div className="shrink-0" style={{ height: 'env(safe-area-inset-top)' }} />

      {/* Progress bar bovenaan */}
      <div className="shrink-0 w-full h-1.5 bg-gray-900">
        <div
          className="h-full transition-all duration-1000"
          style={{ width: `${progressPercent}%`, backgroundColor: stateConfig.color }}
        />
      </div>

      {/* ── IDLE state: Start scherm ─────────────────────────────────────── */}
      {runState === WorkoutState.IDLE && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-5">

          {/* Session info */}
          <div className="text-center space-y-1">
            <p className="text-gray-500 text-sm tracking-wide">{session.description}</p>
            <p className="text-white text-3xl font-black tabular-nums">{formatTime(totalDuration)}</p>
          </div>

          {/* Hervattingsbanner */}
          {initialElapsed > 0 && (
            <div className="w-full bg-[#39FF14]/10 border border-[#39FF14]/30 rounded-xl px-4 py-2 text-center">
              <p className="text-[#39FF14] text-sm font-bold">Training hervat</p>
              <p className="text-gray-400 text-xs mt-0.5">Was al {formatTime(initialElapsed)} ver</p>
            </div>
          )}

          {/* Start knop */}
          <button
            onClick={handleStart}
            className="w-24 h-24 rounded-full bg-rose-500 text-white font-black text-lg leading-tight shadow-lg shadow-rose-500/40 active:scale-95 active:brightness-90 transition-all flex items-center justify-center text-center px-2"
          >
            {initialElapsed > 0 ? 'Ga verder' : 'Start'}
          </button>

          {/* Annuleren */}
          <button
            onClick={() => { localStorage.removeItem(STORAGE_KEY); onDone(null, null) }}
            className="text-gray-600 text-sm py-1 active:text-gray-400 transition-colors"
          >
            Annuleren
          </button>

          {/* Stemkeuze — onder Annuleren */}
          <div className="w-full pt-2 border-t border-gray-900">
            <p className="text-gray-600 text-xs text-center mb-2 uppercase tracking-wider">Coach stem</p>
            <div className="grid grid-cols-4 gap-2">
              {VOICES.map(v => (
                <button
                  key={v.id}
                  onClick={() => handleVoiceChange(v.id)}
                  className={`py-2 rounded-xl text-xs font-bold transition-all active:scale-95 ${
                    voice === v.id
                      ? 'bg-[#39FF14] text-black'
                      : 'bg-gray-900 text-gray-400 border border-gray-800'
                  }`}
                >
                  <div>{v.label}</div>
                  <div className="text-[10px] opacity-60">{v.gender}</div>
                </button>
              ))}
            </div>
          </div>

          {startError && (
            <div className="w-full bg-red-950 border border-red-800 rounded-xl px-4 py-2 text-center">
              <p className="text-red-400 text-xs font-mono break-all">{startError}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Active run UI ─────────────────────────────────────────────────── */}
      {runState !== WorkoutState.IDLE && runState !== WorkoutState.DONE && (
        <div className={`flex-1 flex flex-col overflow-hidden transition-colors duration-700 ${stateConfig.bg}`}>

          {/* Staat label + totaaltijd + stale banner */}
          <div className="shrink-0 px-5 pt-3 space-y-2">
            {biometricsStale && hasReceivedBiometricsRef.current && (
              <div className="bg-yellow-900/60 border border-yellow-700 rounded-xl px-4 py-1.5 text-center">
                <p className="text-yellow-400 text-xs font-bold tracking-wide">
                  ⌚ Geen hartslagdata — controleer je Apple Watch
                </p>
              </div>
            )}
            <div
              className="text-center text-2xl font-black tracking-widest transition-colors duration-500"
              style={{ color: stateConfig.color }}
            >
              {paused ? 'GEPAUZEERD' : stateConfig.label}
            </div>
            {/* Totale workout afteller */}
            <div className="text-center">
              <span className="text-white font-black tabular-nums text-2xl">{formatTime(Math.max(0, totalDuration - elapsed))}</span>
            </div>
          </div>

          {/* IntervalDial vult de resterende ruimte */}
          <IntervalDial
            subtitle={activeSubtitle}
            progress={activeProgress}
            centerDigits={activeCenterDigits}
            primaryLabel={paused ? 'Resume' : 'Pause'}
            onPrimary={handlePause}
            secondaryLabel="Stop Run"
            onSecondary={() => setShowStopConfirm(true)}
            secondaryVariant="button"
            accentColor={stateConfig.color}
          />
        </div>
      )}

      {/* ── Stop bevestiging modal ─────────────────────────────────────────── */}
      {showStopConfirm && (
        <div className="absolute inset-0 bg-black/90 flex items-center justify-center p-8 z-50">
          <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-sm text-center">
            <div className="text-3xl mb-3">⚠️</div>
            <h3 className="text-xl font-black mb-2">Training stoppen?</h3>
            <p className="text-gray-500 text-sm mb-6">
              Je hebt {formatTime(elapsed)} gelopen. Je voortgang wordt opgeslagen.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowStopConfirm(false)}
                className="flex-1 py-4 rounded-xl border border-gray-700 font-bold"
              >
                DOORGAAN
              </button>
              <button
                onClick={handleStop}
                className="flex-1 py-4 rounded-xl bg-red-600 font-black"
              >
                STOPPEN
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
