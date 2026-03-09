/**
 * IntervalDial — visuele timer-ring met tick-segmenten, digit-tiles en een ronde actieknop.
 *
 * Props:
 *   subtitle        string        boven de ring, bv "3 / 8"
 *   timeLabel       string        rechts van "Tijd:", bv "1:45"
 *   progress        0..1          hoeveel ticks actief zijn (accentColor vs grijs)
 *   centerDigits    string        2 chars ("35") → twee tiles; 4 chars ("0145") → MM:SS met colon
 *   primaryLabel    string        tekst op de ronde knop ("Start", "Pause", "Resume", ...)
 *   onPrimary       fn
 *   secondaryLabel  string?       optionele knop onder de ronde knop
 *   onSecondary     fn?
 *   secondaryVariant 'text'|'button'  'text' = grijze tekstlink (default), 'button' = donkere knop
 *   accentColor     string?       kleur van actieve ticks (default wit)
 */

import { useMemo, useEffect, useRef, useState } from 'react'

const N       = 100      // aantal ticks rondom de ring
const VB      = 260      // SVG viewBox breedte én hoogte (vierkant)
const CX      = 130      // midden X
const CY      = 130      // midden Y
const R_BG    = 90       // donkere achtergrondcirkel radius
const R_INNER = 102      // tick startpunt (vanuit centrum)
const R_OUTER = 118      // tick eindpunt
const R_RING  = 110      // straal smooth progress ring (midden van tick-band)

function polar(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180  // 0° = boven
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function DigitTile({ ch, width, height, fontSize, flash }) {
  return (
    <div
      className="bg-[#1c1c1e] rounded-xl flex items-center justify-center shadow-inner"
      style={{
        width,
        height,
        transform: flash ? 'scale(1.04)' : 'scale(1)',
        transition: 'transform 80ms ease-out',
      }}
    >
      <span
        className="text-white font-black tabular-nums leading-none"
        style={{ fontSize }}
      >
        {ch}
      </span>
    </div>
  )
}

export default function IntervalDial({
  subtitle,
  timeLabel,
  progress = 0,
  centerDigits = '00',
  primaryLabel = 'Start',
  onPrimary,
  secondaryLabel,
  onSecondary,
  secondaryVariant = 'text',
  accentColor = '#ffffff',
}) {
  const clampedProgress = Math.max(0, Math.min(1, progress))
  const activeCount = Math.floor(clampedProgress * N)
  const is4 = (centerDigits?.length ?? 0) >= 4

  // ── Micro-animatie op digit tiles bij digit-wissel ────────────────────────
  const prevDigitsRef = useRef(centerDigits)
  const [digitFlash, setDigitFlash] = useState(false)
  const flashTimerRef = useRef(null)

  useEffect(() => {
    if (centerDigits !== prevDigitsRef.current) {
      prevDigitsRef.current = centerDigits
      clearTimeout(flashTimerRef.current)
      setDigitFlash(true)
      flashTimerRef.current = setTimeout(() => setDigitFlash(false), 120)
    }
    return () => clearTimeout(flashTimerRef.current)
  }, [centerDigits])

  // ── Ticks (memoiseerd op activeCount) ────────────────────────────────────
  const ticks = useMemo(() => (
    Array.from({ length: N }, (_, i) => {
      const angle = (i / N) * 360
      return {
        p1: polar(CX, CY, R_INNER, angle),
        p2: polar(CX, CY, R_OUTER, angle),
        active: i < activeCount,
      }
    })
  ), [activeCount])

  // ── Smooth progress ring ──────────────────────────────────────────────────
  const circumference = 2 * Math.PI * R_RING
  const dashOffset = circumference * (1 - clampedProgress)

  return (
    <div
      className="flex-1 flex flex-col items-center justify-evenly px-5"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      {/* Tekst boven de ring */}
      <div className="text-center space-y-1">
        <p className="text-gray-500 text-sm tracking-wide">{subtitle}</p>
        {timeLabel && (
          <p className="text-gray-400 text-base">
            Tijd:&nbsp;<span className="text-white font-bold">{timeLabel}</span>
          </p>
        )}
      </div>

      {/* Ring + digit tiles */}
      <div className="relative w-full max-w-[260px] aspect-square mx-auto">

        <svg
          viewBox={`0 0 ${VB} ${VB}`}
          className="absolute inset-0 w-full h-full"
          aria-hidden="true"
        >
          {/* Achtergrondcirkel */}
          <circle cx={CX} cy={CY} r={R_BG} fill="#0d0d0d" />

          {/* Smooth progress ring — ONDER de ticks, subtiele band */}
          <circle
            cx={CX}
            cy={CY}
            r={R_RING}
            fill="none"
            stroke={accentColor}
            strokeWidth={14}
            strokeOpacity={0.13}
            strokeLinecap="butt"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${CX} ${CY})`}
            style={{ transition: 'stroke-dashoffset 220ms linear' }}
          />

          {/* Glow layer — uitsluitend actieve ticks */}
          {ticks.map((t, i) => t.active && (
            <line
              key={`g${i}`}
              x1={t.p1.x} y1={t.p1.y}
              x2={t.p2.x} y2={t.p2.y}
              stroke={accentColor}
              strokeWidth={9}
              strokeOpacity={0.2}
              strokeLinecap="round"
            />
          ))}

          {/* Sharp tick layer — alle ticks */}
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={t.p1.x} y1={t.p1.y}
              x2={t.p2.x} y2={t.p2.y}
              stroke={t.active ? accentColor : '#252525'}
              strokeWidth={t.active ? 3 : 1.5}
              strokeLinecap="round"
            />
          ))}
        </svg>

        {/* Digit tiles gecentreerd over de ring */}
        <div className="absolute inset-0 flex items-center justify-center">
          {is4 ? (
            /* MM:SS — vier kleinere tiles met colon */
            <div className="flex items-center gap-1">
              <DigitTile ch={centerDigits[0]} width={42} height={58} fontSize="2rem" flash={digitFlash} />
              <DigitTile ch={centerDigits[1]} width={42} height={58} fontSize="2rem" flash={digitFlash} />
              <span className="text-white font-black leading-none mx-0.5" style={{ fontSize: '2rem', marginBottom: 4 }}>:</span>
              <DigitTile ch={centerDigits[2]} width={42} height={58} fontSize="2rem" flash={digitFlash} />
              <DigitTile ch={centerDigits[3]} width={42} height={58} fontSize="2rem" flash={digitFlash} />
            </div>
          ) : (
            /* 2-digit — twee grote tiles */
            <div className="flex items-center gap-3">
              <DigitTile ch={centerDigits?.[0] ?? '0'} width={58} height={76} fontSize="3rem" flash={digitFlash} />
              <DigitTile ch={centerDigits?.[1] ?? '0'} width={58} height={76} fontSize="3rem" flash={digitFlash} />
            </div>
          )}
        </div>
      </div>

      {/* Knoppen */}
      <div className="flex flex-col items-center gap-3 w-full">
        <button
          onClick={onPrimary}
          className="w-20 h-20 rounded-full bg-rose-500 text-white font-black text-base leading-tight shadow-lg shadow-rose-500/40 active:scale-95 active:brightness-90 transition-all flex items-center justify-center text-center px-2"
        >
          {primaryLabel}
        </button>

        {secondaryLabel && onSecondary && (
          secondaryVariant === 'button' ? (
            <button
              onClick={onSecondary}
              className="px-10 py-3 rounded-2xl border border-red-900 text-red-500 font-bold text-sm active:scale-95 transition-transform"
            >
              {secondaryLabel}
            </button>
          ) : (
            <button
              onClick={onSecondary}
              className="text-gray-600 text-sm py-1 active:text-gray-400 transition-colors"
            >
              {secondaryLabel}
            </button>
          )
        )}
      </div>
    </div>
  )
}
