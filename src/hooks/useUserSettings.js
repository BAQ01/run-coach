/**
 * useUserSettings — laadt en slaat Zone 2 + cadans-instellingen op.
 *
 * Volgorde van prioriteit:
 *   1. user_settings row in Supabase (persistent, per user)
 *   2. Default-waarden hieronder
 *
 * getEffectiveCadenceTarget(settings) berekent de effectieve target:
 *   - off    → null (cadence coaching uitgeschakeld)
 *   - manual → preset: low=150, normal=160, high=170
 *   - auto   → baseline + 3 als baseline bekend, anders 160 als fallback
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export const CADENCE_PRESET_SPM = { low: 150, normal: 160, high: 170 }
const CADENCE_AUTO_FALLBACK = 160

const DEFAULTS = {
  age:                      null,
  zone2_max_bpm:            145,
  cadence_mode:             'auto',   // 'auto'|'manual'|'off'
  cadence_preset:           'normal', // 'low'|'normal'|'high' — alleen bij manual
  cadence_target_spm:       null,     // afgeleid; niet direct vragen aan user
  cadence_baseline_spm:     null,     // EMA-gecalibreerde loopbaseline
  cadence_baseline_samples: 0,        // runs meegenomen in baseline
}

/**
 * Berekent de effectieve cadance target (spm) op basis van de instellingen.
 * Geeft null terug als cadence coaching uitgeschakeld is.
 */
export function getEffectiveCadenceTarget(settings) {
  const mode = settings?.cadence_mode ?? 'auto'
  if (mode === 'off') return null
  if (mode === 'manual') {
    return CADENCE_PRESET_SPM[settings?.cadence_preset ?? 'normal'] ?? CADENCE_AUTO_FALLBACK
  }
  // auto
  const baseline = settings?.cadence_baseline_spm
  return baseline ? Math.round(baseline + 3) : CADENCE_AUTO_FALLBACK
}

export function useUserSettings() {
  const { user } = useAuth()
  const [settings, setSettings] = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) { setLoading(false); return }
    supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.warn('[UserSettings] Laden mislukt:', error.message)
        if (data) setSettings({ ...DEFAULTS, ...data })
        setLoading(false)
      })
  }, [user])

  const saveSettings = useCallback(async (partial) => {
    if (!user) return
    const updated = { ...DEFAULTS, ...settings, ...partial, user_id: user.id, updated_at: new Date().toISOString() }
    const { error } = await supabase
      .from('user_settings')
      .upsert(updated, { onConflict: 'user_id' })
    if (error) {
      console.error('[UserSettings] Opslaan mislukt:', error.message)
      return
    }
    setSettings(updated)
  }, [user, settings])

  return { settings, saveSettings, loading }
}
