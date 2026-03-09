/**
 * useBiometricObserver — Zone 2 Enforcer + Cadence Coach
 *
 * Receives biometrics samples and current workout interval type,
 * triggers coach cues via playCoachCue when thresholds are exceeded.
 *
 * Rules:
 *  - HR: bpm > targetMaxBpm for >= hrOverThresholdSeconds → play coach_hr_too_high
 *        cooldown: 120s. Counter uses sample timestamps (not sample count).
 *  - Cadence: spm < cadenceMinSpm during RUN interval → play coach_increase_cadence
 *        cooldown: 300s
 *  - Global anti-spam: max 1 cue per 10s regardless of which rule triggered
 *  - Never auto-pauses the workout.
 */

import { useRef, useCallback, useState } from 'react'

const DEV = import.meta.env.DEV
const log = DEV ? (...args) => console.log('[BiometricObserver]', ...args) : () => {}

const DEFAULTS = {
  targetMaxBpm:           145,
  hrOverThresholdSeconds:  15,
  hrCooldownSeconds:      120,
  cadenceMinSpm:          155,
  cadenceCooldownSeconds: 300,
  globalAntiSpamSeconds:   10,
}

export function useBiometricObserver({ playCoachCue, config = {} }) {
  // Merge config once into a stable ref — config changes mid-run are ignored by design
  const cfgRef = useRef(null)
  if (cfgRef.current === null) cfgRef.current = { ...DEFAULTS, ...config }

  // ── Internal tracking (no re-render on every sample) ─────────────────────
  const aboveSinceTsRef         = useRef(null) // ms when bpm first exceeded threshold
  const hrCooldownUntilRef      = useRef(0)    // ms epoch when HR cooldown expires
  const cadenceCooldownUntilRef = useRef(0)
  const lastCueTsRef            = useRef(0)    // ms epoch of last played cue (any type)

  // ── UI-observable state ───────────────────────────────────────────────────
  const [uiState, setUiState] = useState({
    lastBpm:                 null,
    lastSpm:                 null,
    hrAboveThresholdSeconds: 0,
    hrCooldownActive:        false,
    cadenceCooldownActive:   false,
  })

  // ── Helpers ───────────────────────────────────────────────────────────────

  const canPlayCue = () => {
    const now = Date.now()
    const wait = lastCueTsRef.current + cfgRef.current.globalAntiSpamSeconds * 1000 - now
    if (wait > 0) {
      log(`Anti-spam: nog ${(wait / 1000).toFixed(1)}s wachten`)
      return false
    }
    return true
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  /**
   * onSample — call with each biometrics event.
   *
   * @param {{ timestamp: number, bpm: number|null, spm: number|null }} sample
   *   timestamp is Unix epoch in seconds (matches HealthKit payload)
   * @param {string} intervalType  Current workout state: 'run' | 'walk' | 'warmup' | 'cooldown' | 'idle'
   */
  const onSample = useCallback((sample, intervalType) => {
    const { timestamp, bpm, spm } = sample
    const cfg = cfgRef.current
    const now = Date.now()
    // Convert Unix-seconds timestamp to ms for internal duration math
    const sampleMs = timestamp * 1000

    log(`Sample — bpm=${bpm ?? 'null'}  spm=${spm ?? 'null'}  interval=${intervalType}`)

    // ── Zone 2 HR Enforcer ────────────────────────────────────────────────
    if (bpm !== null && bpm !== undefined) {
      if (bpm > cfg.targetMaxBpm) {
        // Start accumulating time above threshold
        if (aboveSinceTsRef.current === null) {
          aboveSinceTsRef.current = sampleMs
          log(`HR boven drempel (${bpm} > ${cfg.targetMaxBpm}), teller gestart`)
        }

        const aboveDuration = (sampleMs - aboveSinceTsRef.current) / 1000
        const hrCooldownActive = now < hrCooldownUntilRef.current

        log(`HR boven drempel: ${aboveDuration.toFixed(1)}s / ${cfg.hrOverThresholdSeconds}s — cooldown: ${hrCooldownActive}`)

        if (aboveDuration >= cfg.hrOverThresholdSeconds && !hrCooldownActive && canPlayCue()) {
          log(`▶ HR interventie — bpm=${bpm}, ${aboveDuration.toFixed(1)}s boven drempel, interval=${intervalType}`)
          playCoachCue('coach_hr_too_high')
          hrCooldownUntilRef.current = now + cfg.hrCooldownSeconds * 1000
          lastCueTsRef.current = now
          // Reset so bpm must exceed threshold again after cooldown
          aboveSinceTsRef.current = null
        }

        setUiState(prev => ({
          ...prev,
          lastBpm: bpm,
          hrAboveThresholdSeconds: (sampleMs - (aboveSinceTsRef.current ?? sampleMs)) / 1000,
          hrCooldownActive: now < hrCooldownUntilRef.current,
        }))
      } else {
        // bpm at or below threshold — reset accumulator
        if (aboveSinceTsRef.current !== null) {
          log(`HR terug onder drempel (${bpm} ≤ ${cfg.targetMaxBpm}), teller gereset`)
        }
        aboveSinceTsRef.current = null
        setUiState(prev => ({
          ...prev,
          lastBpm: bpm,
          hrAboveThresholdSeconds: 0,
          hrCooldownActive: now < hrCooldownUntilRef.current,
        }))
      }
    }

    // ── Cadence Enforcer (RUN intervals only) ─────────────────────────────
    if (spm !== null && spm !== undefined) {
      const isRun = intervalType === 'run'
      const cadenceCooldownActive = now < cadenceCooldownUntilRef.current

      log(`SPM=${spm}  interval=${intervalType}  isRun=${isRun}  cooldown=${cadenceCooldownActive}`)

      if (isRun && spm < cfg.cadenceMinSpm && !cadenceCooldownActive && canPlayCue()) {
        log(`▶ Cadence interventie — spm=${spm} < ${cfg.cadenceMinSpm}, interval=${intervalType}`)
        playCoachCue('coach_increase_cadence')
        cadenceCooldownUntilRef.current = now + cfg.cadenceCooldownSeconds * 1000
        lastCueTsRef.current = now
      }

      setUiState(prev => ({
        ...prev,
        lastSpm: spm,
        cadenceCooldownActive: now < cadenceCooldownUntilRef.current,
      }))
    }
  }, [playCoachCue]) // cfgRef and cooldown refs are stable; only playCoachCue is external

  // ── Reset — call on workout stop ──────────────────────────────────────────
  const reset = useCallback(() => {
    aboveSinceTsRef.current         = null
    hrCooldownUntilRef.current      = 0
    cadenceCooldownUntilRef.current = 0
    lastCueTsRef.current            = 0
    setUiState({
      lastBpm:                 null,
      lastSpm:                 null,
      hrAboveThresholdSeconds: 0,
      hrCooldownActive:        false,
      cadenceCooldownActive:   false,
    })
    log('Observer gereset')
  }, [])

  return { onSample, reset, uiState }
}
