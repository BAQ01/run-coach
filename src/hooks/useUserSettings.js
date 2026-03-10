/**
 * useUserSettings — laadt en slaat Zone 2 + cadans-instellingen op.
 *
 * Volgorde van prioriteit:
 *   1. user_settings row in Supabase (persistent, per user)
 *   2. Default-waarden (zone2MaxBpm 145, cadenceTargetSpm 155)
 *
 * De hook geeft direct defaults terug (settings is nooit null na mount).
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const DEFAULTS = {
  age:                null,
  zone2_max_bpm:      145,
  cadence_target_spm: 155,
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
