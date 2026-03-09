/**
 * useAudioEngine
 *
 * Native path (Capacitor iOS):
 *   Delegates volledig naar WorkoutAudioPlugin.swift.
 *   Audio session, scheduling, background en playback zijn 100% native.
 *   JS stuurt alleen de cue timeline op via de plugin API en luistert naar events.
 *
 * Web path (PWA/browser):
 *   Web Audio API met pre-scheduling en wall-clock timer.
 *   Stille zero-buffer node houdt AudioContext actief.
 */

import { useRef, useCallback, useEffect } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import audioCueData from '../lib/audioCueData.js'
import { getCoachCueText, getCoachCuePath } from '../lib/coachCues.js'

export const WorkoutAudio = registerPlugin('WorkoutAudio')
const IS_NATIVE = Capacitor.isNativePlatform()


export function useAudioEngine() {
  // ── Gedeelde refs ────────────────────────────────────────────────────────
  const tickCallbackRef = useRef(null)

  // ── Native-only refs ─────────────────────────────────────────────────────
  const nativeListenersRef = useRef([])  // Alle actieve Capacitor event listeners

  // ── Web-only refs ─────────────────────────────────────────────────────────
  const ctxRef = useRef(null)
  const silentNodeRef = useRef(null)
  const scheduledAudioRef = useRef([])
  const startWallRef = useRef(null)
  const pausedMsRef = useRef(0)
  const pauseAtRef = useRef(null)
  const storedCueTimelineRef = useRef([])
  const storedVoiceRef = useRef('rebecca')
  const tickIntervalRef = useRef(null)
  const visibilityHandlerRef = useRef(null)

  // ── Web: context en stille loop ──────────────────────────────────────────

  const initContext = useCallback(async () => {
    if (ctxRef.current && ctxRef.current.state !== 'closed') return ctxRef.current
    const AudioContext = window.AudioContext || window.webkitAudioContext
    const ctx = new AudioContext({ sampleRate: 44100 })
    if (ctx.state === 'suspended') await ctx.resume()
    ctxRef.current = ctx
    return ctx
  }, [])

  const startSilentLoop = useCallback((ctx) => {
    if (silentNodeRef.current) return
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.connect(ctx.destination)
    src.start()
    silentNodeRef.current = { source: src }
  }, [])

  const stopSilentLoop = useCallback(() => {
    if (!silentNodeRef.current) return
    try { silentNodeRef.current.source.stop(); silentNodeRef.current.source.disconnect() } catch (_) {}
    silentNodeRef.current = null
  }, [])

  // ── Web: audio scheduling ─────────────────────────────────────────────────

  const scheduleBeepAt = useCallback((time, frequency = 660, duration = 0.1, volume = 0.4) => {
    const ctx = ctxRef.current
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(frequency, time)
    gain.gain.setValueAtTime(volume, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration)
    osc.connect(gain); gain.connect(ctx.destination)
    osc.start(time); osc.stop(time + duration + 0.05)
    scheduledAudioRef.current.push({ osc, gain })
  }, [])

  const cancelScheduledAudio = useCallback(() => {
    scheduledAudioRef.current.forEach(node => {
      try {
        if (node.source) { node.source.stop(); node.source.disconnect() }
        if (node.osc) { node.osc.stop(); node.osc.disconnect(); node.gain.disconnect() }
      } catch (_) {}
    })
    scheduledAudioRef.current = []
  }, [])

  const getElapsedSeconds = useCallback(() => {
    if (!startWallRef.current) return 0
    const now = Date.now()
    const paused = pausedMsRef.current + (pauseAtRef.current ? now - pauseAtRef.current : 0)
    return Math.max(0, (now - startWallRef.current - paused) / 1000)
  }, [])

  const scheduleAudioCues = useCallback(async (cues, voice, audioStartTime) => {
    const ctx = ctxRef.current
    if (!ctx) return
    for (const cue of cues) {
      const t = Math.max(audioStartTime + cue.triggerAt, ctx.currentTime + 0.05)
      if (cue.type === 'beep') {
        scheduleBeepAt(t, 660, 0.1, 0.4)
      } else if (cue.type === 'speech' && cue.message) {
        const slug = cue.message.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-').slice(0, 60)
        const dataUri = audioCueData[voice]?.[slug]
        let loaded = false
        if (dataUri) {
          try {
            const res = await fetch(dataUri)
            const buffer = await ctx.decodeAudioData(await res.arrayBuffer())
            const source = ctx.createBufferSource()
            source.buffer = buffer; source.connect(ctx.destination); source.start(t)
            scheduledAudioRef.current.push({ source })
            loaded = true
          } catch (err) {
            console.warn('[AudioEngine] Base64 decode mislukt:', slug, err.message)
          }
        }
        if (!loaded && window.speechSynthesis) {
          const delay = Math.max(0, (t - ctx.currentTime) * 1000)
          const msg = cue.message
          setTimeout(() => {
            window.speechSynthesis.cancel()
            const utt = new SpeechSynthesisUtterance(msg)
            utt.lang = 'nl-NL'; utt.rate = 0.95
            window.speechSynthesis.speak(utt)
          }, delay)
        }
      }
    }
  }, [scheduleBeepAt])

  const rescheduleFutureCues = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx || !startWallRef.current) return
    const elapsed = getElapsedSeconds()
    const futureCues = storedCueTimelineRef.current.filter(c => c.triggerAt > elapsed + 1)
    if (futureCues.length === 0) return
    cancelScheduledAudio()
    scheduleAudioCues(futureCues, storedVoiceRef.current, ctx.currentTime - elapsed)
  }, [getElapsedSeconds, cancelScheduledAudio, scheduleAudioCues])

  // ── start ─────────────────────────────────────────────────────────────────

  const start = useCallback(async (onTick, cueTimeline, voice, fromElapsedSeconds = 0) => {
    tickCallbackRef.current = onTick

    if (IS_NATIVE) {
      // Verwijder eventuele vorige listeners
      nativeListenersRef.current.forEach(l => l.remove())
      nativeListenersRef.current = []

      const tickL = await WorkoutAudio.addListener('tick', ({ elapsedSeconds }) => {
        if (tickCallbackRef.current) tickCallbackRef.current(elapsedSeconds)
      })
      const completedL = await WorkoutAudio.addListener('completed', ({ elapsedSeconds }) => {
        // Stuur een groot elapsed getal zodat resolveWorkoutState DONE retourneert
        if (tickCallbackRef.current) tickCallbackRef.current(elapsedSeconds ?? 999999)
      })
      nativeListenersRef.current = [tickL, completedL]

      await WorkoutAudio.start({
        cueTimeline: (cueTimeline ?? []).map(c => ({
          triggerAt: c.triggerAt,
          type: c.type,
          message: c.message ?? undefined,
        })),
        voice: voice ?? 'rebecca',
        fromElapsed: fromElapsedSeconds,
      })
      return
    }

    // ── Web path ────────────────────────────────────────────────────────────
    const ctx = await initContext()
    startSilentLoop(ctx)
    startWallRef.current = Date.now() - fromElapsedSeconds * 1000
    pausedMsRef.current = 0
    pauseAtRef.current = null
    storedCueTimelineRef.current = cueTimeline ?? []
    storedVoiceRef.current = voice ?? 'rebecca'

    if (cueTimeline && voice) {
      const cutoff = Math.max(0, fromElapsedSeconds - 2)
      const futureCues = cueTimeline.filter(c => c.triggerAt >= cutoff)
      if (futureCues.length > 0) {
        scheduleAudioCues(futureCues, voice, ctx.currentTime - fromElapsedSeconds)
      }
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Run Coach Training' })
      navigator.mediaSession.playbackState = 'playing'
    }

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const c = ctxRef.current
      if (!c || c.state === 'closed') return
      if (c.state === 'suspended') {
        c.resume().then(() => rescheduleFutureCues()).catch(() => {})
      } else {
        rescheduleFutureCues()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    visibilityHandlerRef.current = onVisibility

    ctx.onstatechange = () => {
      if (ctx.state === 'suspended' && document.visibilityState === 'visible') {
        ctx.resume().then(() => rescheduleFutureCues()).catch(() => {})
      }
    }

    tickIntervalRef.current = setInterval(() => {
      if (tickCallbackRef.current) tickCallbackRef.current(getElapsedSeconds())
    }, 500)
  }, [initContext, startSilentLoop, getElapsedSeconds, scheduleAudioCues, rescheduleFutureCues])

  // ── stop ──────────────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    tickCallbackRef.current = null

    if (IS_NATIVE) {
      WorkoutAudio.stop()
      nativeListenersRef.current.forEach(l => l.remove())
      nativeListenersRef.current = []
      return
    }

    clearInterval(tickIntervalRef.current)
    cancelScheduledAudio()
    if (visibilityHandlerRef.current) {
      document.removeEventListener('visibilitychange', visibilityHandlerRef.current)
      visibilityHandlerRef.current = null
    }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'
    stopSilentLoop()
    startWallRef.current = null
    pausedMsRef.current = 0
    pauseAtRef.current = null
  }, [stopSilentLoop, cancelScheduledAudio])

  // ── pause / resume ────────────────────────────────────────────────────────

  const pause = useCallback(async () => {
    if (IS_NATIVE) { await WorkoutAudio.pause(); return }

    const ctx = ctxRef.current
    if (!ctx) return
    pauseAtRef.current = Date.now()
    clearInterval(tickIntervalRef.current)
    await ctx.suspend()
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
  }, [])

  const resume = useCallback(async () => {
    if (IS_NATIVE) { await WorkoutAudio.resume(); return }

    const ctx = ctxRef.current
    if (!ctx) return
    if (pauseAtRef.current) {
      pausedMsRef.current += Date.now() - pauseAtRef.current
      pauseAtRef.current = null
    }
    await ctx.resume()
    rescheduleFutureCues()
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
    tickIntervalRef.current = setInterval(() => {
      if (tickCallbackRef.current) tickCallbackRef.current(getElapsedSeconds())
    }, 500)
  }, [getElapsedSeconds, rescheduleFutureCues])

  // ── Native: attach to already-running session (no restart) ───────────────

  const attach = useCallback(async (onTick) => {
    if (!IS_NATIVE) return
    tickCallbackRef.current = onTick
    nativeListenersRef.current.forEach(l => l.remove())
    nativeListenersRef.current = []
    const tickL = await WorkoutAudio.addListener('tick', ({ elapsedSeconds }) => {
      if (tickCallbackRef.current) tickCallbackRef.current(elapsedSeconds)
    })
    const completedL = await WorkoutAudio.addListener('completed', ({ elapsedSeconds }) => {
      if (tickCallbackRef.current) tickCallbackRef.current(elapsedSeconds ?? 999999)
    })
    nativeListenersRef.current = [tickL, completedL]
  }, [])

  // ── playCoachCue — Phase B: immediate cue outside scheduled timeline ─────

  const playCoachCue = useCallback(async (slug) => {
    const voice = storedVoiceRef.current ?? 'rebecca'
    const fallbackText = getCoachCueText(slug) ?? slug.replace(/_/g, ' ')

    if (IS_NATIVE) {
      await WorkoutAudio.playCoachCue({ slug, voice, fallbackText })
        .catch(err => console.warn('[AudioEngine] playCoachCue mislukt:', err))
      return
    }

    // Web path: probeer eerst de base64-embedded MP3, dan TTS
    const ctx = ctxRef.current
    if (!ctx) return

    const dataUri = audioCueData[voice]?.[slug]
    if (dataUri) {
      try {
        const res = await fetch(dataUri)
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer())
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.connect(ctx.destination)
        source.start()
        return
      } catch (err) {
        console.warn('[AudioEngine] Coach cue decode mislukt:', slug, err.message)
      }
    }

    // Controleer of het bestand überhaupt bestaat (dev-diagnose)
    if (import.meta.env?.DEV) {
      console.warn(`[CoachCue] Missing mp3 for ${voice}/${slug}, using TTS fallback`)
    }

    // TTS fallback — gebruikt canonieke NL tekst uit coachCues.js
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel()
      const utt = new SpeechSynthesisUtterance(fallbackText)
      utt.lang = 'nl-NL'; utt.rate = 0.95
      window.speechSynthesis.speak(utt)
    }
  }, []) // storedVoiceRef en ctxRef zijn stabiele refs; geen deps nodig

  // ── Native bridge: query methods ──────────────────────────────────────────

  const getStatus = useCallback(async () => {
    if (!IS_NATIVE) return { state: 'idle' }
    return WorkoutAudio.getStatus()
  }, [])

  const recoverActiveWorkout = useCallback(async () => {
    if (!IS_NATIVE) return { hasActiveSession: false }
    return WorkoutAudio.recoverActiveWorkout()
  }, [])

  // ── Cleanup bij unmount ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      tickCallbackRef.current = null
      if (IS_NATIVE) {
        // Remove JS listeners only — do NOT stop the native workout
        nativeListenersRef.current.forEach(l => l.remove())
        nativeListenersRef.current = []
      } else {
        stop()
        const ctx = ctxRef.current
        if (ctx && ctx.state !== 'closed') ctx.close()
      }
    }
  }, [stop])

  return { start, stop, pause, resume, attach, getStatus, recoverActiveWorkout, playCoachCue }
}
