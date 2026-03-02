/**
 * Workout State Machine
 *
 * States: IDLE → WARMUP → RUN ↔ WALK → COOLDOWN → DONE
 *
 * Een 'workout' is een array van intervals:
 * [{ type: 'warmup'|'run'|'walk'|'cooldown', durationSeconds: number, rpeTarget: number, cue: string }]
 */

export const WorkoutState = {
  IDLE: 'IDLE',
  WARMUP: 'WARMUP',
  RUN: 'RUN',
  WALK: 'WALK',
  COOLDOWN: 'COOLDOWN',
  DONE: 'DONE',
  PAUSED: 'PAUSED',
}

/**
 * Gegeven de verstreken tijd en de interval-array, berekent de huidige state.
 * Geeft null terug als er niets veranderd is.
 */
export function resolveWorkoutState(elapsedSeconds, intervals) {
  if (!intervals || intervals.length === 0) return { state: WorkoutState.DONE, intervalIndex: 0, intervalElapsed: 0 }

  let accumulated = 0
  for (let i = 0; i < intervals.length; i++) {
    const interval = intervals[i]
    if (elapsedSeconds < accumulated + interval.durationSeconds) {
      return {
        state: typeToState(interval.type),
        interval,
        intervalIndex: i,
        intervalElapsed: elapsedSeconds - accumulated,
        intervalRemaining: interval.durationSeconds - (elapsedSeconds - accumulated),
        totalElapsed: elapsedSeconds,
        totalDuration: intervals.reduce((s, iv) => s + iv.durationSeconds, 0),
      }
    }
    accumulated += interval.durationSeconds
  }

  return {
    state: WorkoutState.DONE,
    interval: null,
    intervalIndex: intervals.length,
    intervalElapsed: 0,
    intervalRemaining: 0,
    totalElapsed: elapsedSeconds,
    totalDuration: accumulated,
  }
}

function typeToState(type) {
  switch (type) {
    case 'warmup': return WorkoutState.WARMUP
    case 'run': return WorkoutState.RUN
    case 'walk': return WorkoutState.WALK
    case 'cooldown': return WorkoutState.COOLDOWN
    default: return WorkoutState.RUN
  }
}

/**
 * Genereert een lijst van audio-cues die op specifieke tijdstippen afgaan.
 * Elke cue heeft: { triggerAt: seconds, message: string, type: 'beep'|'speech' }
 */
export function buildCueTimeline(intervals) {
  const cues = []
  let t = 0

  intervals.forEach((interval, i) => {
    // Cue bij start van elk interval
    cues.push({
      triggerAt: t,
      message: intervalStartMessage(interval, i, intervals),
      type: 'speech',
      intervalIndex: i,
    })

    // Halftime waarschuwing voor run-intervallen langer dan 60s
    if (interval.type === 'run' && interval.durationSeconds > 60) {
      cues.push({
        triggerAt: t + Math.floor(interval.durationSeconds / 2),
        message: 'Halfway, keep going!',
        type: 'speech',
        intervalIndex: i,
      })
    }

    // 5 seconden van te voren piepen
    if (i < intervals.length - 1) {
      cues.push({
        triggerAt: t + interval.durationSeconds - 5,
        message: null,
        type: 'beep',
        intervalIndex: i,
      })
    }

    t += interval.durationSeconds
  })

  return cues
}

function intervalStartMessage(interval, index, intervals) {
  if (interval.type === 'warmup') return 'Start je warming-up. Loop rustig mee.'
  if (interval.type === 'cooldown') return 'Goed gedaan! Begin nu met je cooling-down wandeling.'

  const runCount = intervals.slice(0, index).filter(iv => iv.type === 'run').length

  if (interval.type === 'run') {
    const msgs = [
      `Loop-interval ${runCount + 1}. RPE doel: ${interval.rpeTarget}. Ga ervoor!`,
      `Rennen nu! Doel RPE: ${interval.rpeTarget}. Je kunt dit!`,
      `Run ${runCount + 1}. Houd je tempo. RPE: ${interval.rpeTarget}.`,
    ]
    return msgs[runCount % msgs.length]
  }

  if (interval.type === 'walk') {
    const msgs = [
      'Wandelen nu. Herstel, adem rustig.',
      'Loop even bij. Goed bezig!',
      'Wandelinterval. Herstel voor de volgende run.',
    ]
    return msgs[Math.floor(index / 2) % msgs.length]
  }

  return 'Volgende interval.'
}
