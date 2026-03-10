/**
 * useWatchSync — WatchConnectivity bridge vanuit JS.
 *
 * Stuurt run-state naar Apple Watch via WatchSyncPlugin.
 * Ontvangt "pause"|"resume"|"stop" commands van Watch.
 *
 * Gebruik:
 *   const { sendRunState } = useWatchSync({ onPause, onResume, onStop })
 *   sendRunState({ mode, remainingSeconds, hr, spm, isPaused, accentColor, totalSeconds })
 *
 * Alle calls zijn no-ops op web of als Watch niet gekoppeld is.
 */

import { useEffect, useCallback, useRef } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'

const IS_NATIVE = Capacitor.isNativePlatform()
const WatchSync  = IS_NATIVE ? registerPlugin('WatchSync') : null

export function useWatchSync({ onPause, onResume, onStop } = {}) {
  const listenersRef = useRef([])

  // Handlers in refs zodat ze altijd actueel zijn in de listener closure
  const onPauseRef  = useRef(onPause)
  const onResumeRef = useRef(onResume)
  const onStopRef   = useRef(onStop)
  useEffect(() => { onPauseRef.current  = onPause  }, [onPause])
  useEffect(() => { onResumeRef.current = onResume }, [onResume])
  useEffect(() => { onStopRef.current   = onStop   }, [onStop])

  useEffect(() => {
    if (!IS_NATIVE || !WatchSync) return

    WatchSync.activate().catch(e =>
      console.warn('[WatchSync] activate mislukt:', e?.message ?? e)
    )

    WatchSync.addListener('watchCommand', ({ action }) => {
      console.log('[WatchSync] Command van Watch:', action)
      if (action === 'pause'  && onPauseRef.current)  onPauseRef.current()
      if (action === 'resume' && onResumeRef.current) onResumeRef.current()
      if (action === 'stop'   && onStopRef.current)   onStopRef.current()
    }).then(l => { listenersRef.current.push(l) })
      .catch(e => console.warn('[WatchSync] addListener mislukt:', e?.message ?? e))

    return () => {
      listenersRef.current.forEach(l => l.remove())
      listenersRef.current = []
    }
  }, []) // eenmalig — handlers via refs bijgehouden

  /**
   * Stuur actuele run-state naar Watch (gethrottled op 1s in de native plugin).
   * @param {{ mode, remainingSeconds, hr?, spm?, isPaused, accentColor?, totalSeconds? }} state
   */
  const sendRunState = useCallback(async (state) => {
    if (!IS_NATIVE || !WatchSync) return
    try {
      await WatchSync.sendRunState({
        mode:             state.mode             ?? 'IDLE',
        remainingSeconds: state.remainingSeconds ?? 0,
        hr:               state.hr               ?? null,
        spm:              state.spm              ?? null,
        isPaused:         state.isPaused         ?? false,
        accentColor:      state.accentColor      ?? '#39FF14',
        totalSeconds:     state.totalSeconds     ?? 0,
      })
    } catch {
      // Watch niet verbonden — stilletjes negeren
    }
  }, [])

  return { sendRunState }
}
