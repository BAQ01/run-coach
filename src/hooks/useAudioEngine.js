/**
 * useAudioEngine - Web Audio API hack voor achtergrond-compatibiliteit
 *
 * Strategie:
 * 1. Start een stille oscillator bij 'Start Run' → voorkomt dat iOS/Android de tab pauzeert
 * 2. Gebruik audioContext.currentTime als nauwkeurige klok (niet setInterval)
 * 3. Injecteer coach-audiocues als BufferSource bovenop de stille track
 */

import { useRef, useCallback, useEffect } from 'react'

export function useAudioEngine() {
  const ctxRef = useRef(null)           // AudioContext
  const silentNodeRef = useRef(null)    // Stille oscillator
  const bufferCacheRef = useRef({})     // Gecachete audio buffers
  const scheduledRef = useRef([])       // Geplande timeout IDs
  const tickCallbackRef = useRef(null)  // Callback voor de klok-tick
  const tickIntervalRef = useRef(null)  // setInterval als fallback-backup
  const startWallTimeRef = useRef(null) // wall-clock startpunt
  const startAudioTimeRef = useRef(null)// audioContext.currentTime bij start

  // ─── Context initialiseren ───────────────────────────────────────────────

  const initContext = useCallback(async () => {
    if (ctxRef.current && ctxRef.current.state !== 'closed') return ctxRef.current

    const AudioContext = window.AudioContext || window.webkitAudioContext
    const ctx = new AudioContext({ sampleRate: 44100 })

    // iOS vereist een unlock via user-gesture – al afgehandeld doordat we
    // deze functie aanroepen vanuit een onClick handler
    if (ctx.state === 'suspended') await ctx.resume()

    ctxRef.current = ctx
    return ctx
  }, [])

  // ─── Stille oscillator (de "hack") ───────────────────────────────────────

  const startSilentLoop = useCallback((ctx) => {
    // Maak een oscillator die continu draait maar naar een GainNode met
    // gain=0 gaat, zodat er niets hoorbaar is maar de AudioContext actief blijft
    if (silentNodeRef.current) return

    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()
    gainNode.gain.setValueAtTime(0.001, ctx.currentTime) // niet 0.0 → voorkomt browser-optimalisatie

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
    } catch (_err) { /* al gestopt */ }
    silentNodeRef.current = null
  }, [])

  // ─── Audio buffer laden & cachen ─────────────────────────────────────────

  const loadAudio = useCallback(async (url) => {
    if (bufferCacheRef.current[url]) return bufferCacheRef.current[url]

    const ctx = ctxRef.current
    if (!ctx) throw new Error('AudioContext niet geïnitialiseerd')

    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

    bufferCacheRef.current[url] = audioBuffer
    return audioBuffer
  }, [])

  // ─── Audiocue direct afspelen ─────────────────────────────────────────────

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

  // ─── Beep genereren (synthesized, geen extern bestand nodig) ─────────────

  const playBeep = useCallback((frequency = 880, duration = 0.2, volume = 0.5) => {
    const ctx = ctxRef.current
    if (!ctx) return

    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime)

    gainNode.gain.setValueAtTime(volume, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)

    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + duration + 0.05)
  }, [])

  // ─── Gesproken cue via Web Speech API (fallback als er geen MP3 is) ──────

  const speakCue = useCallback((text) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'nl-NL'
    utterance.rate = 0.95
    utterance.pitch = 1
    window.speechSynthesis.speak(utterance)
  }, [])

  // ─── MP3 cue afspelen, met Web Speech als fallback ───────────────────────

  const playCueOrSpeak = useCallback(async (text, voice = 'rebecca') => {
    const slug = text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60)
    const url = `/audio/cues/${voice}/${slug}.mp3`
    try {
      const res = await fetch(url, { method: 'HEAD' })
      if (res.ok) {
        await playCue(url)
      } else {
        speakCue(text)
      }
    } catch {
      speakCue(text)
    }
  }, [playCue, speakCue])

  // ─── Nauwkeurige klok gebaseerd op AudioContext.currentTime ──────────────

  const getElapsedSeconds = useCallback(() => {
    if (!ctxRef.current || startAudioTimeRef.current === null) return 0
    return ctxRef.current.currentTime - startAudioTimeRef.current
  }, [])

  // ─── Start run engine ─────────────────────────────────────────────────────

  const start = useCallback(async (onTick) => {
    const ctx = await initContext()
    startSilentLoop(ctx)

    startAudioTimeRef.current = ctx.currentTime
    startWallTimeRef.current = Date.now()
    tickCallbackRef.current = onTick

    // Tick elke seconde via requestAnimationFrame wanneer scherm aan is,
    // via setInterval als fallback wanneer scherm uit is
    const tick = () => {
      if (tickCallbackRef.current) {
        tickCallbackRef.current(getElapsedSeconds())
      }
    }

    // setInterval werkt ook met vergrendeld scherm (beperkt tot ~1Hz door throttling,
    // maar nauwkeurige elapsed time komt van audioContext.currentTime)
    tickIntervalRef.current = setInterval(tick, 500)

    return ctx
  }, [initContext, startSilentLoop, getElapsedSeconds])

  // ─── Stop run engine ──────────────────────────────────────────────────────

  const stop = useCallback(() => {
    clearInterval(tickIntervalRef.current)
    scheduledRef.current.forEach(clearTimeout)
    scheduledRef.current = []
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
    // Herstart tick
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
