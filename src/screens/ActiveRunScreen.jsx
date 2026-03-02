import { useState, useRef, useCallback } from 'react'
import { useAudioEngine } from '../hooks/useAudioEngine'
import { resolveWorkoutState, buildCueTimeline, WorkoutState } from '../lib/workoutStateMachine'

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

export default function ActiveRunScreen({ session, onDone }) {
  const audio = useAudioEngine()
  const [voice, setVoice] = useState(() => localStorage.getItem('coachVoice') ?? 'rebecca')
  const [runState, setRunState] = useState(WorkoutState.IDLE)
  const [paused, setPaused] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [currentInterval, setCurrentInterval] = useState(null)
  const [intervalRemaining, setIntervalRemaining] = useState(0)
  const [showStopConfirm, setShowStopConfirm] = useState(false)

  const handleVoiceChange = useCallback((v) => {
    setVoice(v)
    localStorage.setItem('coachVoice', v)
  }, [])

  const intervals = session.intervals

  // ── Tick handler – alleen UI updates, audio is pre-scheduled ─────────────
  const handleTick = useCallback((elapsedSeconds) => {
    setElapsed(elapsedSeconds)
    const result = resolveWorkoutState(elapsedSeconds, intervals)
    setRunState(result.state)
    setCurrentInterval(result.interval)
    setIntervalRemaining(result.intervalRemaining ?? 0)

    if (result.state === WorkoutState.DONE) {
      audio.stop()
      setTimeout(() => onDone(elapsedSeconds), 1500)
    }
  }, [intervals, audio, onDone])

  // ── Start – geeft cue-timeline + stem door aan de audio engine ────────────
  const handleStart = useCallback(async () => {
    const cueTimeline = buildCueTimeline(intervals)
    await audio.start(handleTick, cueTimeline, voice)
    setRunState(WorkoutState.WARMUP)
  }, [audio, handleTick, intervals, voice])

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
    audio.stop()
    onDone(elapsed)
  }, [audio, elapsed, onDone])

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

  return (
    <div className="min-h-screen bg-black text-white flex flex-col select-none overflow-hidden">

      {/* Progress bar bovenaan */}
      <div className="w-full h-1.5 bg-gray-900">
        <div
          className="h-full transition-all duration-1000"
          style={{ width: `${progressPercent}%`, backgroundColor: stateConfig.color }}
        />
      </div>

      {/* ── IDLE state: Start scherm ─────────────────────────────────────── */}
      {runState === WorkoutState.IDLE && (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-black mb-2">{session.description}</h2>
            <p className="text-gray-500">{session.totalMinutes} minuten • {intervals.length} intervallen</p>
          </div>

          <div className="w-full max-w-xs space-y-3 mb-10">
            {intervals.slice(0, 6).map((iv, i) => (
              <div key={i} className="flex items-center gap-3">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: STATE_CONFIG[intervalTypeToState(iv.type)]?.color }}
                />
                <span className="text-gray-400 text-sm capitalize">{iv.type}</span>
                <span className="ml-auto text-gray-600 text-sm">
                  {iv.durationSeconds >= 60 ? `${Math.round(iv.durationSeconds / 60)}min` : `${iv.durationSeconds}sec`}
                </span>
              </div>
            ))}
            {intervals.length > 6 && (
              <p className="text-gray-700 text-xs text-center">+ {intervals.length - 6} meer intervallen</p>
            )}
          </div>

          {/* Stemkeuze */}
          <div className="w-full max-w-xs mb-6">
            <p className="text-gray-500 text-xs text-center mb-2 uppercase tracking-wider">Coach stem</p>
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

          <button
            onClick={handleStart}
            className="w-full bg-[#39FF14] text-black font-black py-6 rounded-2xl text-2xl tracking-widest shadow-xl shadow-[#39FF14]/30 active:scale-95 transition-all"
          >
            START RUN
          </button>

          <button onClick={() => onDone(null)} className="mt-4 text-gray-600 text-sm">
            Annuleren
          </button>
        </div>
      )}

      {/* ── Active run UI ─────────────────────────────────────────────────── */}
      {runState !== WorkoutState.IDLE && runState !== WorkoutState.DONE && (
        <div className="flex-1 flex flex-col">

          {/* Huidige actie - groot en duidelijk */}
          <div className={`flex-1 flex flex-col items-center justify-center p-8 transition-colors duration-700 ${stateConfig.bg}`}>

            {/* Actie label */}
            <div
              className="text-4xl font-black tracking-widest mb-2 transition-colors duration-500"
              style={{ color: stateConfig.color }}
            >
              {paused ? 'GEPAUZEERD' : stateConfig.label}
            </div>

            {/* Grote timer voor huidig interval */}
            <div className="text-8xl font-black tabular-nums my-4 transition-all duration-200">
              {formatTime(intervalRemaining)}
            </div>

            {/* RPE indicator */}
            {currentInterval && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-gray-500 text-sm">RPE doel:</span>
                <div className="flex gap-1">
                  {Array.from({ length: 10 }, (_, i) => (
                    <div
                      key={i}
                      className="w-2.5 h-4 rounded-sm transition-colors"
                      style={{
                        backgroundColor: i < (currentInterval.rpeTarget ?? 0)
                          ? stateConfig.color
                          : '#1f1f1f'
                      }}
                    />
                  ))}
                </div>
                <span className="text-gray-400 text-sm font-bold">{currentInterval.rpeTarget}/10</span>
              </div>
            )}

            {/* Totale verstreken tijd */}
            <p className="text-gray-600 text-sm mt-4">
              Totaal: {formatTime(elapsed)} / {formatTime(totalDuration)}
            </p>
          </div>

          {/* Pause / Stop knoppen */}
          <div className="p-5 space-y-3">
            {/* PAUZE knop - groot en duidelijk */}
            <button
              onPointerDown={handlePause}
              className={`w-full py-5 rounded-2xl text-xl font-black tracking-wider transition-all active:scale-95 ${
                paused
                  ? 'bg-[#39FF14] text-black'
                  : 'bg-gray-900 text-white border border-gray-800'
              }`}
            >
              {paused ? '▶  DOORGAAN' : '⏸  PAUZEER'}
            </button>

            {/* STOP knop */}
            <button
              onPointerDown={() => setShowStopConfirm(true)}
              className="w-full py-4 rounded-2xl text-base font-bold text-red-500 border border-red-900 active:scale-95 transition-transform"
            >
              ■  STOP RUN
            </button>
          </div>
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
