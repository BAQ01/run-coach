/**
 * galloway.js — Sportwetenschappelijk intervalschema generator
 *
 * Periodisering:
 *   - Drie trainingstypen per week: A = easy/base, B = kwaliteit (steady), C = long run
 *   - Progressie ~10–15% volume per week
 *   - Elke 4e week: step-back (minder volume, herstel)
 *   - Taper: laatste 1–2 weken lager volume
 *   - RPE: easy/run = 3–4, steady = 5–6, walk = 2, warmup = 3, cooldown = 2
 *   - Guardrails: steady blokken max 15 min; max sessieduur per doel
 *     (5K 50 min / 10K 90 min / 15K 105 min / HM 120 min)
 *
 * Output-structuur (ongewijzigd t.o.v. vorige versie):
 *   { goal, totalWeeks, sessions: [{ week, day, sessionNumber,
 *       totalMinutes, intervals, description }] }
 *   Interval: { type, label, durationSeconds, rpeTarget }
 *   type-waarden: 'warmup' | 'run' | 'walk' | 'cooldown'  (zelfde als voor)
 */

// ── Bouw-helpers ──────────────────────────────────────────────────────────────

/** Run-walk blokken, zonder trailing walk na het laatste interval */
function rw(runSec, walkSec, repeats) {
  const out = []
  for (let i = 0; i < repeats; i++) {
    out.push({ type: 'run',  label: 'RUN',  durationSeconds: runSec,  rpeTarget: 4 })
    if (i < repeats - 1)
      out.push({ type: 'walk', label: 'WALK', durationSeconds: walkSec, rpeTarget: 2 })
  }
  return out
}

/** Continue easy-run als één blok (RPE 3) */
function easy(minutes) {
  return [{ type: 'run', label: 'EASY', durationSeconds: minutes * 60, rpeTarget: 3 }]
}

/** Steady-pace blokken met walk-herstel, max 15 min per steady-blok (guardrail) */
function sw(steadySec, walkSec, repeats) {
  const capped = Math.min(steadySec, 15 * 60)
  const out = []
  for (let i = 0; i < repeats; i++) {
    out.push({ type: 'run',  label: 'STEADY', durationSeconds: capped,  rpeTarget: 5 })
    if (i < repeats - 1)
      out.push({ type: 'walk', label: 'WALK',   durationSeconds: walkSec, rpeTarget: 2 })
  }
  return out
}

// ── Schema-data per doel ──────────────────────────────────────────────────────
// Elke rij = één week, met velden A / B / C (core intervals, excl. warmup/cooldown)

const SCHEMA_5K = [
  { A: rw( 60, 90, 6), B: rw( 45, 90, 8), C: rw( 60, 90, 8)  }, // W1
  { A: rw( 90, 90, 6), B: rw( 60, 60, 6), C: rw( 90, 90, 7)  }, // W2
  { A: rw(120, 90, 5), B: rw( 60, 60, 8), C: rw(120, 90, 6)  }, // W3
  { A: rw( 90, 90, 6), B: rw( 60, 60, 6), C: rw(120, 90, 5)  }, // W4 step-back
  { A: rw(150, 75, 6), B: rw(180, 90, 5), C: rw(180, 90, 5)  }, // W5
  { A: rw(240, 90, 5), B: rw( 90, 60, 8), C: rw(300, 90, 4)  }, // W6
  { A: rw(240, 90, 4), B: rw( 60, 60, 6), C: easy(20)         }, // W7 taper
  { A: easy(15),        B: rw( 60, 60, 4), C: easy(30)         }, // W8 race week
]

const SCHEMA_10K = [
  { A: rw( 60, 90, 6),  B: rw( 45, 90, 8),  C: easy(35) }, // W1
  { A: rw( 90, 90, 6),  B: rw( 60, 60, 6),  C: easy(40) }, // W2
  { A: rw(120, 90, 5),  B: rw( 60, 60, 8),  C: easy(45) }, // W3
  { A: rw( 90, 90, 6),  B: rw( 60, 60, 6),  C: easy(40) }, // W4 step-back
  { A: rw(150, 75, 6),  B: rw(180, 90, 5),  C: easy(50) }, // W5
  { A: rw(240, 90, 5),  B: rw(120, 60, 6),  C: easy(55) }, // W6
  { A: rw(360, 90, 4),  B: sw(360,120, 3),  C: easy(60) }, // W7
  { A: rw(180, 90, 5),  B: rw( 90, 60, 6),  C: easy(50) }, // W8 step-back
  { A: rw(480, 90, 3),  B: sw(600,120, 2),  C: easy(70) }, // W9
  { A: easy(25),         B: sw(300,120, 4),  C: easy(75) }, // W10
  { A: easy(25),         B: rw( 60, 60, 6),  C: easy(60) }, // W11 taper
  { A: easy(20),         B: rw( 60, 60, 4),  C: easy(60) }, // W12 race week
]

const SCHEMA_15K = [
  { A: rw( 60, 90, 6),  B: rw( 45, 90, 8),  C: easy( 40) }, // W1
  { A: rw( 90, 90, 6),  B: rw( 60, 60, 6),  C: easy( 45) }, // W2
  { A: rw(120, 90, 5),  B: rw( 60, 60, 8),  C: easy( 50) }, // W3
  { A: rw( 90, 90, 6),  B: rw( 60, 60, 6),  C: easy( 45) }, // W4 step-back
  { A: rw(150, 75, 6),  B: rw(180, 90, 5),  C: easy( 55) }, // W5
  { A: rw(240, 90, 5),  B: sw(300,120, 3),  C: easy( 60) }, // W6
  { A: easy(35),         B: sw(360,120, 3),  C: easy( 70) }, // W7
  { A: easy(30),         B: rw( 90, 60, 6),  C: easy( 60) }, // W8 step-back
  { A: easy(40),         B: sw(480,120, 2),  C: easy( 80) }, // W9
  { A: easy(40),         B: sw(300, 90, 3),  C: easy( 90) }, // W10
  { A: easy(35),         B: sw(240, 90, 3),  C: easy( 75) }, // W11 step-back
  { A: easy(40),         B: sw(360,120, 2),  C: easy( 80) }, // W12
  { A: easy(30),         B: rw( 60, 60, 6),  C: easy( 60) }, // W13 taper
  { A: easy(20),         B: rw( 60, 60, 4),  C: easy( 60) }, // W14 race week
]

const SCHEMA_HM = [
  { A: easy(35), B: rw( 60,  60, 8),  C: easy( 45) }, // W1
  { A: easy(40), B: rw(120,  60, 6),  C: easy( 50) }, // W2
  { A: easy(45), B: rw(240,  90, 4),  C: easy( 55) }, // W3
  { A: easy(35), B: rw( 90,  60, 6),  C: easy( 50) }, // W4 step-back
  { A: easy(45), B: sw(360, 120, 3),  C: easy( 60) }, // W5
  { A: easy(45), B: sw(600, 180, 2),  C: easy( 70) }, // W6
  { A: easy(50), B: sw(300, 120, 4),  C: easy( 75) }, // W7
  { A: easy(40), B: rw( 90,  60, 6),  C: easy( 65) }, // W8 step-back
  { A: easy(50), B: sw(720, 180, 2),  C: easy( 85) }, // W9
  { A: easy(50), B: sw(480, 120, 3),  C: easy( 95) }, // W10
  { A: easy(55), B: sw(300, 120, 4),  C: easy(105) }, // W11
  { A: easy(45), B: rw(120,  60, 6),  C: easy( 85) }, // W12 step-back
  { A: easy(55), B: sw(900, 180, 2),  C: easy(110) }, // W13 (cap: 115→110 voor max 120 min totaal)
  { A: easy(45), B: rw( 60,  60, 6),  C: easy( 90) }, // W14
  { A: easy(40), B: rw(180, 120, 4),  C: easy( 65) }, // W15 taper
  { A: easy(25), B: rw( 60,  60, 4),  C: easy( 60) }, // W16 race week
]

// Couch-to-30: hergebruik 5K weken 1–6, dan opbouw naar 25/30 min
const SCHEMA_COUCH = [
  ...SCHEMA_5K.slice(0, 6),
  { A: easy(20), B: rw(60, 60, 6), C: easy(25) }, // W7
  { A: easy(25), B: rw(60, 60, 4), C: easy(30) }, // W8
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDur(secs) {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return s === 0 ? `${m}m` : `${m}:${String(s).padStart(2, '0')}`
}

function buildSessionDescription(week, sessionType, coreIntervals) {
  const typeNames = { A: 'Easy', B: 'Kwaliteit', C: 'Long run', E: 'Extra easy' }
  const typeName  = typeNames[sessionType] ?? 'Easy'
  const first     = coreIntervals[0]
  if (!first) return `Week ${week} · ${typeName}`

  if (first.label === 'EASY') {
    return `Week ${week} · ${typeName} · ${Math.round(first.durationSeconds / 60)} min`
  }
  if (first.label === 'STEADY') {
    const count = coreIntervals.filter(iv => iv.label === 'STEADY').length
    return `Week ${week} · ${typeName} · ${count}× ${formatDur(first.durationSeconds)} steady`
  }
  // RUN-WALK
  const runs = coreIntervals.filter(iv => iv.label === 'RUN')
  const walk = coreIntervals.find(iv => iv.label === 'WALK')
  const walkStr = walk ? ` / ${formatDur(walk.durationSeconds)} walk` : ''
  return `Week ${week} · ${typeName} · ${runs.length}× ${formatDur(first.durationSeconds)}${walkStr}`
}

/** Kap core-intervals op maxSec; in de praktijk al voldaan door schema-data */
function capIntervals(intervals, maxSec) {
  let remaining = maxSec
  const out = []
  for (const iv of intervals) {
    if (remaining <= 0) break
    if (iv.durationSeconds <= remaining) {
      out.push(iv)
      remaining -= iv.durationSeconds
    } else {
      out.push({ ...iv, durationSeconds: remaining })
      remaining = 0
    }
  }
  return out
}

/** Extra easy sessie voor dag 4/5 — schaalt zacht mee met week */
function extraEasyCore(week, totalWeeks) {
  const progress = (week - 1) / Math.max(1, totalWeeks - 1)
  return easy(Math.round(25 + progress * 15))  // 25–40 min
}

// ── Schema-config per doel ────────────────────────────────────────────────────

const GOAL_SCHEMA = {
  '5k':           { data: SCHEMA_5K,    weeks:  8, maxCoreSec: 40 * 60 },
  '10k':          { data: SCHEMA_10K,   weeks: 12, maxCoreSec: 80 * 60 },
  '15k':          { data: SCHEMA_15K,   weeks: 14, maxCoreSec: 95 * 60 },
  'half_marathon':{ data: SCHEMA_HM,    weeks: 16, maxCoreSec: 110 * 60 },
  'couch_to_30':  { data: SCHEMA_COUCH, weeks:  8, maxCoreSec: 40 * 60 },
}

// ── Hoofd-export (zelfde signatuur als voor) ──────────────────────────────────

export function generateGallowaySchema({ goal, daysPerWeek, currentLevel }) {
  const config  = GOAL_SCHEMA[goal] ?? GOAL_SCHEMA['5k']
  const { data, weeks, maxCoreSec } = config
  const days    = Math.max(1, Math.min(5, daysPerWeek ?? 3))

  // Dagtype-volgorde per daysPerWeek
  const dayTypes =
    days === 1 ? ['A'] :
    days === 2 ? ['A', 'C'] :
    days === 3 ? ['A', 'B', 'C'] :
    days === 4 ? ['A', 'B', 'C', 'E'] :
                 ['A', 'B', 'C', 'E', 'E']

  const sessions = []
  let sessionNumber = 0

  for (let week = 1; week <= weeks; week++) {
    const weekData = data[week - 1] ?? data[data.length - 1]

    dayTypes.forEach((sessionType, dayIdx) => {
      sessionNumber++
      const day = dayIdx + 1

      // Kern-intervals op basis van dagtype
      let coreIntervals =
        sessionType === 'E'
          ? extraEasyCore(week, weeks)
          : (weekData[sessionType] ?? weekData.A)

      // Guardrail: kap op maximum kernduur
      const coreSec = coreIntervals.reduce((s, iv) => s + iv.durationSeconds, 0)
      if (coreSec > maxCoreSec) coreIntervals = capIntervals(coreIntervals, maxCoreSec)

      const intervals = [
        { type: 'warmup',   label: 'WARM-UP',   durationSeconds: 5 * 60, rpeTarget: 3 },
        ...coreIntervals,
        { type: 'cooldown', label: 'COOL-DOWN', durationSeconds: 5 * 60, rpeTarget: 2 },
      ]

      sessions.push({
        week,
        day,
        sessionNumber,
        totalMinutes: Math.round(intervals.reduce((s, iv) => s + iv.durationSeconds, 0) / 60),
        intervals,
        description: buildSessionDescription(week, sessionType, coreIntervals),
      })
    })
  }

  return { goal, totalWeeks: weeks, sessions }
}

// ── Dev-verificatie (Vite: alleen in development build) ───────────────────────
if (import.meta.env?.DEV) {
  const CAPS = { '5k': 50, '10k': 90, '15k': 105, 'half_marathon': 120 }
  const CHECK_WEEKS = {
    '5k':           [1, 3, 6, 7],
    '10k':          [1, 5, 9, 11],
    '15k':          [1, 7, 10, 13],
    'half_marathon':[1, 7, 11, 15],
  }
  Object.keys(CAPS).forEach(goal => {
    const plan = generateGallowaySchema({ goal, daysPerWeek: 3 })
    const maxMin = Math.max(...plan.sessions.map(s => s.totalMinutes))
    const cap    = CAPS[goal]
    const ok     = maxMin <= cap ? '✓' : `✗ BOVEN CAP (${cap})`
    console.log(`[galloway] ${goal}: max sessie = ${maxMin} min ${ok}`)
    CHECK_WEEKS[goal].forEach(w => {
      const s = plan.sessions.filter(s => s.week === w)
      s.forEach(s => console.log(`  W${w}D${s.day} ${s.totalMinutes}m — ${s.description}`))
    })
  })
}
