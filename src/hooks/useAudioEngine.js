/**
 * useAudioEngine - Web Audio API met iOS/desktop achtergrond-ondersteuning
 *
 * Strategie:
 * 1. Wall-clock timer (Date.now) — AudioContext.currentTime bevriest bij tab-switch/iOS
 * 2. Pre-schedule alle audio via Web Audio tijdlijn zodat ze spelen in de achtergrond
 * 3. Stille <audio> loop → houdt de iOS audio-sessie actief achter het lock screen
 * 4. visibilitychange: hervatten + toekomstige cues opnieuw inplannen als nodig
 * 5. MediaSession API → iOS toont media controls op lock screen
 */

import { useRef, useCallback, useEffect } from 'react'

// Genereer een 1-seconde stille WAV als data-URL.
// De <audio> loop met deze WAV houdt de iOS audio sessie actief achter het lock screen.
function makeSilentWavUrl() {
  const sr = 8000
  const buf = new ArrayBuffer(44 + sr)
  const v = new DataView(buf)
  const w = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + sr, true); w(8, 'WAVE')
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr, true)
  v.setUint16(32, 1, true); v.setUint16(34, 8, true)
  w(36, 'data'); v.setUint32(40, sr, true)
  new Uint8Array(buf).fill(0x80, 44) // 0x80 = stille DC in unsigned 8-bit PCM
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return 'data:audio/wav;base64,' + btoa(bin)
}

const SILENT_WAV_URL = makeSilentWavUrl()

export function useAudioEngine() {
  const ctxRef = useRef(null)
  const silentNodeRef = useRef(null)
  const silentHtmlAudioRef = useRef(null) // <audio> loop voor iOS lock screen
  const bufferCacheRef = useRef({})
  const scheduledAudioRef = useRef([])    // Geplande audio nodes (voor annulering)

  // Wall-clock timer (bevriest NIET bij AudioContext suspend)
  const startWallRef = useRef(null)       // Date.now() bij start
  const pausedMsRef = useRef(0)           // Totale pauzetijd in ms
  const pauseAtRef = useRef(null)         // Date.now() bij begin van pauze

  // Sla op voor herplanning bij terugkeer uit achtergrond
  const storedCueTimelineRef = useRef([])
  const storedVoiceRef = useRef('rebecca')

  const tickIntervalRef = useRef(null)
  const tickCallbackRef = useRef(null)
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

  // ─── Stille oscillator ────────────────────────────────────────────────────

  const startSilentLoop = useCallback((ctx) => {
    if (silentNodeRef.current) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    silentNodeRef.current = { osc, gain }
  }, [])

  const stopSilentLoop = useCallback(() => {
    if (!silentNodeRef.current) return
    try {
      silentNodeRef.current.osc.stop()
      silentNodeRef.current.osc.disconnect()
      silentNodeRef.current.gain.disconnect()
    } catch (_) {}
    silentNodeRef.current = null
  }, [])

  // ─── HTML <audio> loop (iOS lock screen trick) ────────────────────────────
  // iOS beëindigt de Web Audio sessie zodra het scherm vergrendelt, tenzij er
  // een actief HTML audio element speelt. Deze stille loop voorkomt dat.

  const startHtmlAudioLoop = useCallback(() => {
    if (silentHtmlAudioRef.current) return
    const audio = new Audio(SILENT_WAV_URL)
    audio.loop = true
    audio.volume = 0.001
    audio.play().catch(() => {})
    silentHtmlAudioRef.current = audio
  }, [])

  const stopHtmlAudioLoop = useCallback(() => {
    if (!silentHtmlAudioRef.current) return
    silentHtmlAudioRef.current.pause()
    silentHtmlAudioRef.current.src = ''
    silentHtmlAudioRef.current = null
  }, [])

  // ─── Audio buffer laden & cachen ─────────────────────────────────────────

  const loadAudio = useCallback(async (url) => {
    if (bufferCacheRef.current[url]) return bufferCacheRef.current[url]
    const ctx = ctxRef.current
    if (!ctx) throw new Error('AudioContext niet geïnitialiseerd')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = await ctx.decodeAudioData(await res.arrayBuffer())
    bufferCacheRef.current[url] = buf
    return buf
  }, [])

  // ─── Beep inplannen op absoluut AudioContext tijdstip ────────────────────

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

  // ─── Alle (gefilterde) cues inplannen op AudioContext tijdlijn ─────────────

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
        try {
          const buffer = await loadAudio(`/audio/cues/${voice}/${slug}.mp3`)
          const source = ctx.createBufferSource()
          source.buffer = buffer
          source.connect(ctx.destination)
          source.start(t)
          scheduledAudioRef.current.push({ source })
        } catch { /* MP3 niet beschikbaar */ }
      }
    }
  }, [loadAudio, scheduleBeepAt])

  // ─── Annuleer alle geplande nodes ─────────────────────────────────────────

  const cancelScheduledAudio = useCallback(() => {
    scheduledAudioRef.current.forEach(node => {
      try {
        if (node.source) { node.source.stop(); node.source.disconnect() }
        if (node.osc) { node.osc.stop(); node.osc.disconnect(); node.gain.disconnect() }
      } catch (_) {}
    })
    scheduledAudioRef.current = []
  }, [])

  // ─── Wall-clock gebaseerde klok (bevriest niet bij suspend) ──────────────

  const getElapsedSeconds = useCallback(() => {
    if (!startWallRef.current) return 0
    const now = Date.now()
    const paused = pausedMsRef.current + (pauseAtRef.current ? now - pauseAtRef.current : 0)
    return Math.max(0, (now - startWallRef.current - paused) / 1000)
  }, [])

  // ─── Herplan toekomstige cues na terugkeer uit achtergrond ───────────────

  const rescheduleFutureCues = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx || !startWallRef.current) return

    const elapsed = getElapsedSeconds()
    const futureCues = storedCueTimelineRef.current.filter(c => c.triggerAt > elapsed + 1)
    if (futureCues.length === 0) return

    cancelScheduledAudio()

    // audioStartTime zodanig dat: audioStartTime + cue.triggerAt = ctx.currentTime + (triggerAt - elapsed)
    const audioStartTime = ctx.currentTime - elapsed
    scheduleAudioCues(futureCues, storedVoiceRef.current, audioStartTime)
  }, [getElapsedSeconds, cancelScheduledAudio, scheduleAudioCues])

  // ─── Directe afspeelfuncties (voor handmatige aanroepen) ─────────────────

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

  const speakCue = useCallback((text) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'nl-NL'
    utterance.rate = 0.95
    window.speechSynthesis.speak(utterance)
  }, [])

  const playCueOrSpeak = useCallback(async (text, voice = 'rebecca') => {
    const slug = text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-').slice(0, 60)
    const url = `/audio/cues/${voice}/${slug}.mp3`
    try {
      const res = await fetch(url, { method: 'HEAD' })
      if (res.ok) { await playCue(url) } else { speakCue(text) }
    } catch { speakCue(text) }
  }, [playCue, speakCue])

  // ─── Start run engine ─────────────────────────────────────────────────────

  const start = useCallback(async (onTick, cueTimeline, voice) => {
    const ctx = await initContext()
    startSilentLoop(ctx)

    // Wall-clock timer
    startWallRef.current = Date.now()
    pausedMsRef.current = 0
    pauseAtRef.current = null
    tickCallbackRef.current = onTick

    // Sla op voor herplanning
    storedCueTimelineRef.current = cueTimeline ?? []
    storedVoiceRef.current = voice ?? 'rebecca'

    // Pre-schedule alle audio (fire-and-forget)
    if (cueTimeline && voice) {
      scheduleAudioCues(cueTimeline, voice, ctx.currentTime)
    }

    // HTML audio loop → houdt iOS audio sessie actief achter lock screen
    startHtmlAudioLoop()

    // MediaSession API → iOS toont media controls op lock screen
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Run Coach Training' })
      navigator.mediaSession.playbackState = 'playing'
    }

    // Hervatten bij terugkeer naar tab/app
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const c = ctxRef.current
      if (!c || c.state === 'closed') return
      if (c.state === 'suspended') {
        c.resume()
          .then(() => rescheduleFutureCues())
          .catch(() => {})
      } else {
        // AudioContext liep wel door maar toekomstige cues controleren
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

    return ctx
  }, [initContext, startSilentLoop, startHtmlAudioLoop, getElapsedSeconds, scheduleAudioCues, rescheduleFutureCues])

  // ─── Stop ─────────────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    clearInterval(tickIntervalRef.current)
    cancelScheduledAudio()

    if (visibilityHandlerRef.current) {
      document.removeEventListener('visibilitychange', visibilityHandlerRef.current)
      visibilityHandlerRef.current = null
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none'
    }

    stopHtmlAudioLoop()
    stopSilentLoop()
    tickCallbackRef.current = null
    startWallRef.current = null
    pausedMsRef.current = 0
    pauseAtRef.current = null
  }, [stopSilentLoop, stopHtmlAudioLoop, cancelScheduledAudio])

  // ─── Pause / Resume ───────────────────────────────────────────────────────

  const pause = useCallback(async () => {
    const ctx = ctxRef.current
    if (!ctx) return
    pauseAtRef.current = Date.now()
    clearInterval(tickIntervalRef.current)
    await ctx.suspend()
    stopHtmlAudioLoop()
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
  }, [stopHtmlAudioLoop])

  const resume = useCallback(async () => {
    const ctx = ctxRef.current
    if (!ctx) return
    if (pauseAtRef.current) {
      pausedMsRef.current += Date.now() - pauseAtRef.current
      pauseAtRef.current = null
    }
    await ctx.resume()
    startHtmlAudioLoop()
    rescheduleFutureCues()
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
    tickIntervalRef.current = setInterval(() => {
      if (tickCallbackRef.current) tickCallbackRef.current(getElapsedSeconds())
    }, 500)
  }, [getElapsedSeconds, rescheduleFutureCues, startHtmlAudioLoop])

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
