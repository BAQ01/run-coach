/**
 * Coach Cue Library — centraal register van alle biometric coach cues (Coach Policy v1.0)
 *
 * MP3-bestanden die per voice moeten worden toegevoegd:
 *   public/audio/cues/<voice>/coach_hr_soft_warning.mp3
 *   public/audio/cues/<voice>/coach_hr_too_high.mp3
 *   public/audio/cues/<voice>/coach_hr_recover_walk.mp3
 *   public/audio/cues/<voice>/coach_cadence_low.mp3
 *   public/audio/cues/<voice>/coach_cadence_low_hr_high.mp3
 *   public/audio/cues/<voice>/coach_hold_steady.mp3
 *   public/audio/cues/<voice>/coach_start_slow.mp3    (optioneel)
 *
 * Voices: rebecca, sarah, pieter, rik
 */

// ── Cue definities ────────────────────────────────────────────────────────────

export const COACH_CUES = {
  coach_hr_soft_warning:     'Je hartslag loopt op. Maak je pas iets kleiner.',
  coach_hr_too_high:         'Hartslag te hoog. Vertraag twintig seconden.',
  coach_hr_recover_walk:     'Herstel echt tijdens het wandelen: schouders los, adem rustig.',
  coach_cadence_low:         'Maak je passen korter en lichter.',
  coach_cadence_low_hr_high: 'Kortere passen, rustig tempo. Niet versnellen.',
  coach_hold_steady:         'Perfect tempo. Hou dit vast.',
  coach_start_slow:          'Rustig starten. Dit moet makkelijk voelen.',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Geeft de canonieke NL tekst voor een slug, of null als onbekend. */
export function getCoachCueText(slug) {
  return COACH_CUES[slug] ?? null
}

/** Geeft het relatieve asset-pad voor een cue MP3. */
export function getCoachCuePath(slug, voice) {
  return `/audio/cues/${voice}/${slug}.mp3`
}

// ── Missing cue detection ─────────────────────────────────────────────────────

// Sessie-cache: { [voice]: string[] }
const _missingCache = {}

/**
 * Controleert via HEAD requests welke coach cue MP3's ontbreken voor een voice.
 * Resultaat wordt gecacht voor de rest van de sessie.
 * @param {string} voice
 * @returns {Promise<string[]>} array van ontbrekende slugs
 */
export async function listMissingCoachCues(voice) {
  if (_missingCache[voice] !== undefined) return _missingCache[voice]
  const missing = []
  await Promise.all(
    Object.keys(COACH_CUES).map(async slug => {
      const path = getCoachCuePath(slug, voice)
      try {
        const res = await fetch(path, { method: 'HEAD' })
        if (res.status >= 400) missing.push(slug)
      } catch {
        missing.push(slug)
      }
    })
  )
  _missingCache[voice] = missing
  return missing
}

// ── Dev auto-check ────────────────────────────────────────────────────────────

const DEBUG_COACH_CUES = false  // zet op true om ontbrekende cues te loggen bij import

if (DEBUG_COACH_CUES && import.meta.env?.DEV) {
  const VOICES = ['rebecca', 'sarah', 'pieter', 'rik']
  Promise.all(VOICES.map(async v => {
    const missing = await listMissingCoachCues(v)
    if (missing.length === 0) {
      console.log(`[CoachCue] ✓ Alle cues aanwezig voor voice: ${v}`)
    } else {
      console.warn(`[CoachCue] Missing cues for voice ${v}: ${missing.join(', ')}`)
    }
  }))
}
