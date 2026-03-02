/**
 * useAudioEngine - Web Audio API hack voor achtergrond-compatibiliteit
 *
 * Strategie:
 * 1. Start een stille oscillator bij 'Start Run' → voorkomt dat iOS/Android de tab pauzeert
 * 2. Pre-schedule alle audiocues via audioContext.currentTime zodat ze ook spelen
 *    wanneer de pagina op de achtergrond staat en JS throttled is
 * 3. Luister naar visibilitychange om de AudioContext te hervatten als iOS hem
 *    toch gesuspendeerd heeft
 */

import { useRef, useCallback, useEffect } from 'react'

export function useAudioEngine() {
  const ctxRef = useRef(null)
  const silentNodeRef = useRef(null)
  const bufferCacheRef = useRef({})
  const scheduledAudioRef = useRef([])   // Pre-geplande audio nodes
  const tickIntervalRef = useRef(null)
  const tickCallbackRef = useRef(null)
  const startAudioTimeRef = useRef(null)
  const visibilityHandlerRef = useRef(null)

  // ─── Context initialiseren ───────────────────────────────────────────────

  const initContext = useCallback(async () => {
    if (ctxRef.current && ctxRef.current.state !== 'closed') return ctxRef.current

    const AudioContext = window.AudioContext || window.webkitAudioContext
    const ctx = new AudioContext({ sampleRate: 44100 })
    if (ctx.state === 'suspended') await ctx.resume()
    ctxRef.current = ctx
    return ctx
  }, [])

  // ─── Stille oscillator (de "hack") ───────────────────────────────────────

  const startSilentLoop = useCallback((ctx) => {
    if (silentNodeRef.current) return
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()
    gainNode.gain.setValueAtTime(0.001, ctx.currentTime)
    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)
    oscillator.start()
    silentNodeRef.current = { oscillator, gainNode }
  }, [])

  const stopSilentLoop = useCallback(() => {
    if (!silentNodeRef.current) return
    try {
      silentNodeRef.current.oscillator.stop()
      silentNodeRef.current.oscillator.disconnect()
      silentNodeRef.current.gainNode.disconnect()
    } catch (_) {}
    silentNodeRef.current = null
  }, [])

  // ─── Audio buffer laden & cachen ─────────────────────────────────────────

  const loadAudio = useCallback(async (url) => {
    if (bufferCacheRef.current[url]) return bufferCacheRef.current[url]
    const ctx = ctxRef.current
    if (!ctx) throw new Error('AudioContext niet geïnitialiseerd')
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const arrayBuffer = await response.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    bufferCacheRef.current[url] = audioBuffer
    return audioBuffer
  }, [])

  // ─── Direct afspelen (voor handmatige aanroepen) ──────────────────────────

  const playCue = useCallback(async (url) => {
    const ctx = ctxRef.current
    if (!ctx) return
    try {
      const buffer = await loadAudio(url)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.start()
    } catch (err) {
      console.warn('[AudioEngine] Kon cue niet afspelen:', url, err)
    }
  }, [loadAudio])

  // ─── Beep genereren (direct) ──────────────────────────────────────────────

  const playBeep = useCallback((frequency = 880, duration = 0.2, volume = 0.5) => {
    const ctx = ctxRef.current
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(frequency, ctx.currentTime)
    gain.gain.setValueAtTime(volume, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration + 0.05)
  }, [])

  // ─── Beep plannen op absoluut tijdstip ────────────────────────────────────

  const scheduleBeepAt = useCallback((time, frequency = 660, duration = 0.1, volume = 0.4) => {
    const ctx = ctxRef.current
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(frequency, time)
    gain.gain.setValueAtTime(volume, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(time)
    osc.stop(time + duration + 0.05)
    scheduledAudioRef.current.push({ osc, gain })
  }, [])

  // ─── Web Speech API fallback ──────────────────────────────────────────────

  const speakCue = useCallback((text) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'nl-NL'
    utterance.rate = 0.95
    utterance.pitch = 1
    window.speechSynthesis.speak(utterance)
  }, [])

  // ─── MP3 cue afspelen (direct, met Web Speech fallback) ───────────────────

  const playCueOrSpeak = useCallback(async (text, voice = 'rebecca') => {
    const slug = text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-').slice(0, 60)
    const url = `/audio/cues/${voice}/${slug}.mp3`
    try {
      const res = await fetch(url, { method: 'HEAD' })
      if (res.ok) { await playCue(url) } else { speakCue(text) }
    } catch { speakCue(text) }
  }, [playCue, speakCue])

  // ─── Alle cues pre-schedulen via Web Audio tijdlijn ──────────────────────
  // Hierdoor spelen cues ook als JS op de achtergrond throttled wordt door iOS

  const scheduleAllCues = useCallback(async (cueTimeline, voice, startTime) => {
    const ctx = ctxRef.current
    if (!ctx) return

    for (const cue of cueTimeline) {
      const t = startTime + cue.triggerAt

      if (cue.type === 'beep') {
        scheduleBeepAt(t, 660, 0.1, 0.4)

      } else if (cue.type === 'speech' && cue.message) {
        const slug = cue.message.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-').slice(0, 60)
        const url = `/audio/cues/${voice}/${slug}.mp3`
        try {
          const buffer = await loadAudio(url)
          const source = ctx.createBufferSource()
          source.buffer = buffer
          source.connect(ctx.destination)
          // Als t in het verleden valt (door laadtijd), speelt Web Audio het meteen
          source.start(Math.max(t, ctx.currentTime))
          scheduledAudioRef.current.push({ source })
        } catch {
          // MP3 niet gevonden – wordt overgeslagen in achtergrond
        }
      }
    }
  }, [loadAudio, scheduleBeepAt])

  // ─── Nauwkeurige klok ─────────────────────────────────────────────────────

  const getElapsedSeconds = useCallback(() => {
    if (!ctxRef.current || startAudioTimeRef.current === null) return 0
    return Math.max(0, ctxRef.current.currentTime - startAudioTimeRef.current)
  }, [])

  // ─── Start run engine ─────────────────────────────────────────────────────

  const start = useCallback(async (onTick, cueTimeline, voice) => {
    const ctx = await initContext()
    startSilentLoop(ctx)

    startAudioTimeRef.current = ctx.currentTime
    tickCallbackRef.current = onTick

    // Pre-schedule alle audiocues (fire-and-forget – laadt buffers async)
    if (cueTimeline && voice) {
      scheduleAllCues(cueTimeline, voice, ctx.currentTime)
    }

    // iOS: hervatten als AudioContext gesuspendeerd werd door backgrounding
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    visibilityHandlerRef.current = onVisibilityChange

    ctx.onstatechange = () => {
      if (ctx.state === 'suspended' && document.visibilityState === 'visible') {
        ctx.resume().catch(() => {})
      }
    }

    tickIntervalRef.current = setInterval(() => {
      if (tickCallbackRef.current) tickCallbackRef.current(getElapsedSeconds())
    }, 500)

    return ctx
  }, [initContext, startSilentLoop, getElapsedSeconds, scheduleAllCues])

  // ─── Stop run engine ──────────────────────────────────────────────────────

  const stop = useCallback(() => {
    clearInterval(tickIntervalRef.current)

    // Stop alle pre-geplande audio nodes
    scheduledAudioRef.current.forEach(node => {
      try {
        if (node.source) { node.source.stop(); node.source.disconnect() }
        if (node.osc) { node.osc.stop(); node.osc.disconnect(); node.gain.disconnect() }
      } catch (_) {}
    })
    scheduledAudioRef.current = []

    // Verwijder visibility handler
    if (visibilityHandlerRef.current) {
      document.removeEventListener('visibilitychange', visibilityHandlerRef.current)
      visibilityHandlerRef.current = null
    }

    stopSilentLoop()
    tickCallbackRef.current = null
    startAudioTimeRef.current = null
  }, [stopSilentLoop])

  // ─── Pause / Resume ───────────────────────────────────────────────────────

  const pause = useCallback(async () => {
    const ctx = ctxRef.current
    if (!ctx) return
    clearInterval(tickIntervalRef.current)
    await ctx.suspend()
  }, [])

  const resume = useCallback(async () => {
    const ctx = ctxRef.current
    if (!ctx) return
    await ctx.resume()
    tickIntervalRef.current = setInterval(() => {
      if (tickCallbackRef.current) tickCallbackRef.current(getElapsedSeconds())
    }, 500)
  }, [getElapsedSeconds])

  // ─── Cleanup bij unmount ─────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stop()
      const ctx = ctxRef.current
      if (ctx && ctx.state !== 'closed') ctx.close()
    }
  }, [stop])

  return { start, stop, pause, resume, playCue, playBeep, speakCue, playCueOrSpeak, getElapsedSeconds, initContext }
}
