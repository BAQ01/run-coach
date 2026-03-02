const GOAL_CONFIG = {
  '5k':           { weeks: 8,  peakRunMinutes: 30 },
  '10k':          { weeks: 12, peakRunMinutes: 50 },
  '15k':          { weeks: 14, peakRunMinutes: 65 },
  'half_marathon':{ weeks: 16, peakRunMinutes: 75 },
  'couch_to_30':  { weeks: 8,  peakRunMinutes: 30 },
}

function lerp(a, b, t) { return a + (b - a) * Math.min(1, Math.max(0, t)) }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t }

function buildDescription(week, day, isContinuous, runSec, walkSec) {
  if (isContinuous) return `Week ${week} dag ${day}: Continue run ${Math.round(20 + week * 2)} minuten`
  const runMin = runSec >= 60 ? `${Math.round(runSec / 60)}min` : `${runSec}sec`
  const walkMin = walkSec >= 60 ? `${Math.round(walkSec / 60)}min` : `${walkSec}sec`
  return `Week ${week} dag ${day}: Run ${runMin} / Walk ${walkMin} intervallen`
}

export function generateGallowaySchema({ goal, daysPerWeek, currentLevel }) {
  const config = GOAL_CONFIG[goal] ?? GOAL_CONFIG['5k']
  const { weeks, peakRunMinutes } = config
  const startRunSeconds  = currentLevel === 'beginner' ? 30 : 60
  const startWalkSeconds = currentLevel === 'beginner' ? 90 : 60

  const sessions = []
  let sessionNumber = 0

  for (let week = 1; week <= weeks; week++) {
    const progress = (week - 1) / (weeks - 1)
    const runSeconds  = Math.round(lerp(startRunSeconds,  peakRunMinutes * 60, easeInOut(progress)))
    const walkSeconds = Math.round(lerp(startWalkSeconds, 30,                  easeInOut(progress)))
    const isContinuousRun = week >= weeks - 1

    for (let day = 1; day <= daysPerWeek; day++) {
      sessionNumber++
      const intervals = []

      intervals.push({ type: 'warmup', durationSeconds: 5 * 60, rpeTarget: 3 })

      if (isContinuousRun) {
        intervals.push({ type: 'run', durationSeconds: Math.min(peakRunMinutes, 20 + week * 2) * 60, rpeTarget: 6 })
      } else {
        const targetActiveMinutes = 15 + Math.floor(progress * 20)
        const cycles = Math.max(2, Math.floor((targetActiveMinutes * 60) / (runSeconds + walkSeconds)))
        for (let c = 0; c < cycles; c++) {
          intervals.push({ type: 'run',  durationSeconds: runSeconds,  rpeTarget: 6 + Math.floor(progress) })
          if (c < cycles - 1)
            intervals.push({ type: 'walk', durationSeconds: walkSeconds, rpeTarget: 3 })
        }
      }

      intervals.push({ type: 'cooldown', durationSeconds: 5 * 60, rpeTarget: 2 })

      sessions.push({
        week, day, sessionNumber,
        totalMinutes: Math.round(intervals.reduce((s, iv) => s + iv.durationSeconds, 0) / 60),
        intervals,
        description: buildDescription(week, day, isContinuousRun, runSeconds, walkSeconds),
      })
    }
  }

  return { goal, totalWeeks: weeks, sessions }
}
