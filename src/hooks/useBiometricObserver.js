/**
 * useBiometricObserver — Coach Policy Document v1.0
 *
 * Buffers / smoothing:
 *   - HR buffer (180 sec): median(laatste 15 sec) = hrNow;
 *     hrTrend = hrNow − median(15–30 sec geleden)
 *   - SPM buffer (180 sec): spmNow = median(laatste 12 sec) als >= 3 samples, anders null
 *   - Stale: als laatste HR sample > 45 sec geleden → geen triggers
 *
 * Cooldowns (allemaal ref-based, geen re-renders):
 *   - Global anti-spam  : 10 sec tussen elke twee cues
 *   - HR hard           : 120 sec na coach_hr_too_high
 *   - HR soft           : 90 sec na coach_hr_soft_warning
 *   - Cadence           : 300 sec na cadence-cue
 *   - Hold steady       : 600 sec na coach_hold_steady
 *
 * Walk-recovery per interval: één cue per WALK-interval, reset bij mode-wissel.
 *
 * API: { onSample(sample, mode), reset(), setConfig(partial), getSummary(), replaySamples(samples, modes) }
 *   mode = WorkoutState string: 'RUN' | 'WALK' | 'WARMUP' | 'COOLDOWN' | 'IDLE'
 *
 * getSummary() → { zone2Pct, hrWarnings, avgCadence, tip }
 */

import { useRef, useCallback } from 'react'

// ── Debug flag — zet op true voor uitgebreide console output ─────────────────
const DEBUG_COACHING = false
const log = DEBUG_COACHING ? (...a) => console.log('[Coach]', ...a) : () => {}

// ── Config defaults (Coach Policy Document v1.0) ─────────────────────────────
const DEFAULTS = {
  targetMaxBpm:           145,
  hrHardDurationSec:       15,   // sec boven max voor hard warning
  hrSoftDurationSec:        8,   // sec boven max voor soft warning
  hrSoftTrendBpm:           6,   // bpm/15sec stijging voor soft warning
  hrHardCooldownSec:      120,
  hrSoftCooldownSec:       90,
  hrRecoveryMinDropBpm:     6,   // minimale daling tijdens WALK
  hrRecoveryWindowStart:   20,   // sec in WALK vanaf wanneer te checken
  hrRecoveryWindowEnd:     45,   // sec in WALK tot wanneer te checken
  hrStaleSec:              45,   // sec zonder HR → stale
  cadenceTargetSpm:       155,
  cadenceDurationSec:      12,   // sec onder target voor cadence-cue
  cadenceCooldownSec:     300,
  steadyWindowSec:        180,   // sec stabiel voor positive cue
  steadyHrRangeBpm:         8,   // max HR spreiding in window
  steadySpmRange:           8,   // max SPM spreiding in window
  steadyCooldownSec:      600,
  globalAntiSpamSec:       10,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function median(arr) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

const RETENTION_MS = 180 * 1000  // 3 min buffer

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBiometricObserver({ playCoachCue, config = {} }) {
  const cfgRef = useRef({ ...DEFAULTS, ...config })

  // ── Sample buffers ────────────────────────────────────────────────────────
  const hrBufRef  = useRef([])   // { ts: ms, bpm: number }[]
  const spmBufRef = useRef([])   // { ts: ms, spm: number }[]
  const lastHrTsRef = useRef(0)  // ms, timestamp van laatste geldige HR sample

  // ── HR timing refs (A1: timestamp-based, reset bij threshold-wissel) ──────
  // hrHardAboveSinceRef: alleen gezet als hrNow > max en was null.
  // Reset naar null zodra hrNow <= max of mode wisselt.
  const hrHardAboveSinceRef = useRef(null)  // ms
  const hrSoftAboveSinceRef = useRef(null)  // ms

  // ── Walk recovery ─────────────────────────────────────────────────────────
  const walkStartTsRef    = useRef(null)   // ms: start van huidige WALK
  const hrAtWalkStartRef  = useRef(null)   // bpm: median vlak voor walk start
  const walkCueGivenRef   = useRef(false)  // max 1 cue per WALK interval

  // ── Cadence below since ───────────────────────────────────────────────────
  const spmBelowSinceRef = useRef(null)  // ms: spmNow eerste keer < target

  // ── Cooldown timestamps ───────────────────────────────────────────────────
  const hrHardUntilRef    = useRef(0)
  const hrSoftUntilRef    = useRef(0)
  const cadenceUntilRef   = useRef(0)
  const holdSteadyUntilRef = useRef(0)
  const lastCueAtRef      = useRef(0)  // global anti-spam

  // ── Mode transition ───────────────────────────────────────────────────────
  const prevModeRef = useRef(null)

  // ── B2: Summary counters (reset per run) ─────────────────────────────────
  const runSampleCountRef   = useRef(0)   // RUN samples met geldige hrNow
  const zone2SampleCountRef = useRef(0)   // RUN samples waarbij hrNow <= targetMaxBpm
  const hrWarningsRef       = useRef(0)   // aantal HR-waarschuwings-cues
  const cadenceSumRef       = useRef(0)   // som spmNow tijdens RUN
  const cadenceCountRef     = useRef(0)   // aantal RUN samples met geldige spmNow

  // ── Internal functions ────────────────────────────────────────────────────

  function getHrMetrics(tsMs) {
    const buf = hrBufRef.current
    const recent = buf.filter(s => s.ts >= tsMs - 15000).map(s => s.bpm)
    const older  = buf.filter(s => s.ts >= tsMs - 30000 && s.ts < tsMs - 15000).map(s => s.bpm)
    const hrNow   = median(recent)
    const hrPrev  = median(older)
    const hrTrend = (hrNow !== null && hrPrev !== null) ? hrNow - hrPrev : 0
    return { hrNow, hrTrend }
  }

  function getSpmMetrics(tsMs) {
    const recent = spmBufRef.current.filter(s => s.ts >= tsMs - 12000).map(s => s.spm)
    return { spmNow: recent.length >= 3 ? median(recent) : null }
  }

  function canPlayCue(tsMs) {
    const wait = lastCueAtRef.current + cfgRef.current.globalAntiSpamSec * 1000 - tsMs
    if (wait > 0) { log(`anti-spam: ${(wait / 1000).toFixed(1)}s`); return false }
    return true
  }

  function fireCue(slug, tsMs) {
    playCoachCue(slug)
    lastCueAtRef.current = tsMs
    log(`▶ cue="${slug}"`)
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  const onSample = useCallback((sample, mode) => {
    const { timestamp, bpm, spm } = sample
    const cfg   = cfgRef.current
    const tsMs  = typeof timestamp === 'number' ? timestamp * 1000 : Date.now()
    const modeU = (mode ?? '').toUpperCase()

    // ── Update buffers ─────────────────────────────────────────────────────
    const prevHrTs = lastHrTsRef.current

    if (bpm != null && !isNaN(bpm)) {
      hrBufRef.current.push({ ts: tsMs, bpm })
      lastHrTsRef.current = tsMs
      hrBufRef.current = hrBufRef.current.filter(s => s.ts >= tsMs - RETENTION_MS)
    }
    if (spm != null && !isNaN(spm)) {
      spmBufRef.current.push({ ts: tsMs, spm })
      spmBufRef.current = spmBufRef.current.filter(s => s.ts >= tsMs - RETENTION_MS)
    }

    // ── Stale check ────────────────────────────────────────────────────────
    const isHrStale = prevHrTs > 0 && bpm == null
      && (tsMs - prevHrTs) > cfg.hrStaleSec * 1000
    if (isHrStale) {
      log(`HR stale (${((tsMs - prevHrTs) / 1000).toFixed(0)}s geen HR)`)
      return
    }

    // ── Mode transition ────────────────────────────────────────────────────
    if (modeU !== prevModeRef.current) {
      const prev = prevModeRef.current
      log(`mode: ${prev} → ${modeU}`)

      if (modeU === 'WALK') {
        walkStartTsRef.current  = tsMs
        walkCueGivenRef.current = false
        const { hrNow } = getHrMetrics(tsMs)
        hrAtWalkStartRef.current = hrNow
        log(`WALK start — hrAtWalkStart=${hrNow?.toFixed(1)}`)
      }
      if (prev === 'WALK') {
        walkStartTsRef.current  = null
        walkCueGivenRef.current = false
      }

      // Reset duratie-tellers bij mode-wissel (A1: expliciete reset)
      hrHardAboveSinceRef.current = null
      hrSoftAboveSinceRef.current = null
      spmBelowSinceRef.current    = null
      prevModeRef.current         = modeU
    }

    const { hrNow, hrTrend } = getHrMetrics(tsMs)
    const { spmNow }         = getSpmMetrics(tsMs)
    const isRun  = modeU === 'RUN'
    const isWalk = modeU === 'WALK'
    const now    = Date.now()  // wall-clock voor cooldown vergelijking

    // ── B2: Accumulate summary counters (alleen tijdens RUN) ───────────────
    if (isRun) {
      if (hrNow !== null) {
        runSampleCountRef.current++
        if (hrNow <= cfg.targetMaxBpm) zone2SampleCountRef.current++
      }
      if (spmNow !== null) {
        cadenceSumRef.current   += spmNow
        cadenceCountRef.current++
      }
    }

    if (DEBUG_COACHING) {
      log(
        `mode=${modeU}  hrNow=${hrNow?.toFixed(1) ?? 'n/a'}  hrTrend=${hrTrend?.toFixed(1)}` +
        `  spmNow=${spmNow?.toFixed(1) ?? 'n/a'}` +
        `  hrHardSince=${hrHardAboveSinceRef.current ? ((tsMs - hrHardAboveSinceRef.current)/1000).toFixed(1)+'s' : '-'}` +
        `  spmBelowSince=${spmBelowSinceRef.current ? ((tsMs - spmBelowSinceRef.current)/1000).toFixed(1)+'s' : '-'}` +
        `  hrHardCd=${Math.max(0,(hrHardUntilRef.current - now)/1000).toFixed(0)}s` +
        `  hrSoftCd=${Math.max(0,(hrSoftUntilRef.current - now)/1000).toFixed(0)}s` +
        `  cadCd=${Math.max(0,(cadenceUntilRef.current - now)/1000).toFixed(0)}s`
      )
    }

    // ── Priority queue: verzamel alle triggers, vuur de hoogste prio ────────
    let pendingSlug = null
    let pendingPrio = Infinity

    const propose = (slug, prio) => {
      if (prio < pendingPrio) { pendingSlug = slug; pendingPrio = prio }
    }

    // Prio 1 — HR hard warning (RUN only)
    // A1: aboveSince alleen zetten wanneer null EN hrNow > max; reset wanneer <= max.
    if (isRun && hrNow !== null) {
      if (hrNow > cfg.targetMaxBpm) {
        if (hrHardAboveSinceRef.current === null) hrHardAboveSinceRef.current = tsMs
        const aboveSec = (tsMs - hrHardAboveSinceRef.current) / 1000
        log(`HR hard: ${aboveSec.toFixed(1)}s boven max=${cfg.targetMaxBpm}`)
        if (aboveSec >= cfg.hrHardDurationSec && now >= hrHardUntilRef.current) {
          propose('coach_hr_too_high', 1)
        }
      } else {
        // hrNow <= max: reset timer (A1 spec: reset zodra hrNow <= max)
        hrHardAboveSinceRef.current = null
      }
    }

    // Prio 2 — HR recovery tijdens WALK
    if (
      isWalk &&
      !walkCueGivenRef.current &&
      walkStartTsRef.current !== null &&
      hrAtWalkStartRef.current !== null &&
      hrNow !== null
    ) {
      const walkSec = (tsMs - walkStartTsRef.current) / 1000
      const drop    = hrAtWalkStartRef.current - hrNow
      log(`WALK recovery: ${walkSec.toFixed(1)}s in walk, drop=${drop.toFixed(1)}bpm (min ${cfg.hrRecoveryMinDropBpm})`)
      if (
        walkSec >= cfg.hrRecoveryWindowStart &&
        walkSec <= cfg.hrRecoveryWindowEnd &&
        drop < cfg.hrRecoveryMinDropBpm
      ) {
        propose('coach_hr_recover_walk', 2)
      }
    }

    // Prio 3 — Cadence cue (RUN only)
    if (isRun && spmNow !== null) {
      if (spmNow < cfg.cadenceTargetSpm) {
        if (spmBelowSinceRef.current === null) spmBelowSinceRef.current = tsMs
        const belowSec = (tsMs - spmBelowSinceRef.current) / 1000
        log(`Cadence: ${spmNow.toFixed(1)} spm, ${belowSec.toFixed(1)}s onder ${cfg.cadenceTargetSpm}`)
        if (belowSec >= cfg.cadenceDurationSec && now >= cadenceUntilRef.current) {
          const slug = (hrNow !== null && hrNow > cfg.targetMaxBpm - 2)
            ? 'coach_cadence_low_hr_high'
            : 'coach_cadence_low'
          propose(slug, 3)
        }
      } else {
        spmBelowSinceRef.current = null
      }
    }

    // Prio 4 — HR soft warning (RUN only)
    // A1: aboveSince alleen zetten wanneer null EN condA||condB; reset wanneer geen conditie.
    if (isRun && hrNow !== null) {
      const condA = hrNow > cfg.targetMaxBpm
      const condB = hrTrend >= cfg.hrSoftTrendBpm && hrNow >= cfg.targetMaxBpm - 3
      if (condA || condB) {
        if (hrSoftAboveSinceRef.current === null) hrSoftAboveSinceRef.current = tsMs
        const aboveSec = (tsMs - hrSoftAboveSinceRef.current) / 1000
        log(`HR soft: ${aboveSec.toFixed(1)}s (condA=${condA} condB=${condB})`)
        if (aboveSec >= cfg.hrSoftDurationSec && now >= hrSoftUntilRef.current) {
          propose('coach_hr_soft_warning', 4)
        }
      } else {
        hrSoftAboveSinceRef.current = null
      }
    }

    // Prio 5 — Positive reinforcement: hold steady (RUN only)
    if (isRun && hrNow !== null && hrNow <= cfg.targetMaxBpm && now >= holdSteadyUntilRef.current) {
      const windowMs  = cfg.steadyWindowSec * 1000
      const hrWindow  = hrBufRef.current.filter(s => s.ts >= tsMs - windowMs).map(s => s.bpm)
      const spmWindow = spmBufRef.current.filter(s => s.ts >= tsMs - windowMs).map(s => s.spm)
      if (hrWindow.length >= 10 && spmWindow.length >= 10) {
        const hrRange  = Math.max(...hrWindow)  - Math.min(...hrWindow)
        const spmRange = Math.max(...spmWindow) - Math.min(...spmWindow)
        log(`Hold steady: hrRange=${hrRange.toFixed(1)} spmRange=${spmRange.toFixed(1)}`)
        if (hrRange <= cfg.steadyHrRangeBpm && spmRange <= cfg.steadySpmRange) {
          propose('coach_hold_steady', 5)
        }
      }
    }

    // ── Vuur hoogste-prio cue (mits global anti-spam vrij) ─────────────────
    if (pendingSlug && canPlayCue(now)) {
      log(`firing prio=${pendingPrio} slug="${pendingSlug}"`)
      fireCue(pendingSlug, now)

      // Per-cue side-effects
      switch (pendingSlug) {
        case 'coach_hr_too_high':
          hrHardUntilRef.current      = now + cfg.hrHardCooldownSec * 1000
          hrHardAboveSinceRef.current = null
          hrWarningsRef.current++   // B2
          break
        case 'coach_hr_recover_walk':
          walkCueGivenRef.current = true
          break
        case 'coach_cadence_low':
        case 'coach_cadence_low_hr_high':
          cadenceUntilRef.current  = now + cfg.cadenceCooldownSec * 1000
          spmBelowSinceRef.current = null
          break
        case 'coach_hr_soft_warning':
          hrSoftUntilRef.current      = now + cfg.hrSoftCooldownSec * 1000
          hrSoftAboveSinceRef.current = null
          hrWarningsRef.current++   // B2
          break
        case 'coach_hold_steady':
          holdSteadyUntilRef.current = now + cfg.steadyCooldownSec * 1000
          break
      }
    }
  }, [playCoachCue])

  // ── Reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    hrBufRef.current            = []
    spmBufRef.current           = []
    lastHrTsRef.current         = 0
    hrHardAboveSinceRef.current = null
    hrSoftAboveSinceRef.current = null
    spmBelowSinceRef.current    = null
    walkStartTsRef.current      = null
    hrAtWalkStartRef.current    = null
    walkCueGivenRef.current     = false
    hrHardUntilRef.current      = 0
    hrSoftUntilRef.current      = 0
    cadenceUntilRef.current     = 0
    holdSteadyUntilRef.current  = 0
    lastCueAtRef.current        = 0
    prevModeRef.current         = null
    // B2: reset summary counters
    runSampleCountRef.current   = 0
    zone2SampleCountRef.current = 0
    hrWarningsRef.current       = 0
    cadenceSumRef.current       = 0
    cadenceCountRef.current     = 0
    log('Observer gereset')
  }, [])

  // ── setConfig (runtime config update, B1: personalized zones) ────────────

  const setConfig = useCallback((partial) => {
    cfgRef.current = { ...cfgRef.current, ...partial }
    log('Config updated:', partial)
  }, [])

  // ── getSummary (B2: post-run insights) ────────────────────────────────────

  const getSummary = useCallback(() => {
    const cfg = cfgRef.current
    const zone2Pct = runSampleCountRef.current > 0
      ? Math.round((zone2SampleCountRef.current / runSampleCountRef.current) * 100)
      : null
    const avgCadence = cadenceCountRef.current > 0
      ? Math.round(cadenceSumRef.current / cadenceCountRef.current)
      : null
    const hrWarnings = hrWarningsRef.current

    // Genereer contextgevoelige coach-tip
    let tip
    if (hrWarnings >= 3) {
      tip = 'Je hartslag was vaak te hoog. Probeer volgende keer langzamer te starten.'
    } else if (zone2Pct !== null && zone2Pct >= 80) {
      tip = 'Uitstekend! Je bleef bijna altijd in Zone 2 — de basis van een sterke loopconditie.'
    } else if (zone2Pct !== null && zone2Pct < 50) {
      tip = 'Je liep veel boven Zone 2. Vertraag wat meer tijdens de loopstukken.'
    } else if (avgCadence !== null && avgCadence < 150) {
      tip = 'Je cadans was aan de lage kant. Probeer kleinere, snellere stappen te zetten.'
    } else {
      tip = 'Goed gedaan! Consistentie is de sleutel bij het Galloway-schema.'
    }

    log(`Summary: zone2=${zone2Pct}% hrWarnings=${hrWarnings} avgCadence=${avgCadence}`)
    return { zone2Pct, hrWarnings, avgCadence, tip, zone2MaxBpm: cfg.targetMaxBpm }
  }, [])

  // ── replaySamples (dev/test only) ─────────────────────────────────────────

  const replaySamples = useCallback((samples, modeSequence = []) => {
    if (!DEBUG_COACHING) return
    console.log('[Coach] replaySamples:', samples.length, 'samples')
    reset()
    samples.forEach((s, i) => {
      const mode = modeSequence[i] ?? modeSequence.at(-1) ?? 'RUN'
      onSample(s, mode)
    })
  }, [onSample, reset])

  return { onSample, reset, setConfig, getSummary, replaySamples }
}

/**
 * Cue slugs + default Dutch TTS fallback tekst (in WorkoutAudioPlugin.swift):
 *   coach_hr_soft_warning    → "Je hartslag loopt op. Maak je pas iets kleiner."
 *   coach_hr_too_high        → "Hartslag te hoog. Vertraag twintig seconden."
 *   coach_hr_recover_walk    → "Herstel echt tijdens het wandelen: schouders los, adem rustig."
 *   coach_cadence_low        → "Maak je passen korter en lichter."
 *   coach_cadence_low_hr_high→ "Kortere passen, rustig tempo. Niet versnellen."
 *   coach_hold_steady        → "Perfect tempo. Hou dit vast."
 *   coach_start_slow         → "Rustig starten. Dit moet makkelijk voelen."
 *
 * Test checklist:
 *   1) HR > 145 bpm gedurende >= 15 sec in RUN  → coach_hr_too_high, 120s cooldown
 *   2) hrTrend >= +6 bpm/15s EN hrNow >= 142 in RUN, 8 sec  → coach_hr_soft_warning, 90s cooldown
 *   3) WALK: hrDrop < 6 bpm na 20–45 sec  → coach_hr_recover_walk, 1× per WALK interval
 *   4) spmNow < 155 gedurende >= 12 sec in RUN  → coach_cadence_low(_hr_high), 300s cooldown
 *   5) Stabiele RUN (hr/spm range <= 8 in 3 min, hrNow <= 145)  → coach_hold_steady, 600s cooldown
 */
