// @ts-ignore Deno types worden geleverd door de Deno VS Code extensie
/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

/**
 * Supabase Edge Function: generate-schema
 *
 * Genereert een gepersonaliseerd Galloway hardloopschema.
 * Beveiligd met JWT verificatie – alleen voor ingelogde gebruikers.
 *
 * POST /functions/v1/generate-schema
 * Body: { goal: string, daysPerWeek: number, currentLevel?: 'beginner'|'intermediate' }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Toegestane origins — voeg je productie-domein toe als je de PWA publiek deployt.
const ALLOWED_ORIGINS = new Set([
  'capacitor://localhost',   // iOS Capacitor app
  'http://localhost:5173',   // Vite dev server
  'http://localhost:4173',   // Vite preview
])

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'capacitor://localhost',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }

  try {
  // ── JWT Verificatie ──────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Niet geautoriseerd' }), {
      status: 401,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    console.error('Auth error:', authError?.message)
    return new Response(JSON.stringify({ error: 'Ongeldige sessie', detail: authError?.message }), {
      status: 401,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  // ── Request body parsen ──────────────────────────────────────────────────
  let body: { goal?: string; daysPerWeek?: number; currentLevel?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Ongeldig JSON body' }), {
      status: 400,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  const { goal = '5k', daysPerWeek = 3, currentLevel = 'beginner' } = body

  if (daysPerWeek < 2 || daysPerWeek > 4) {
    return new Response(JSON.stringify({ error: 'daysPerWeek moet tussen 2 en 4 zijn' }), {
      status: 400,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  // ── Schema genereren (Galloway methode) ──────────────────────────────────
  const schema = generateGallowaySchema({ goal, daysPerWeek, currentLevel, userId: user.id })

  // ── Schema opslaan — gebruik aparte client met user JWT voor correcte RLS ──
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: savedSchema, error: dbError } = await userClient
    .from('training_plans')
    .insert({
      user_id: user.id,
      goal,
      days_per_week: daysPerWeek,
      current_level: currentLevel,
      sessions: schema.sessions,
    })
    .select()
    .single()

  if (dbError) {
    console.error('DB error:', dbError)
    return new Response(JSON.stringify({ error: 'Schema opslaan mislukt', detail: dbError.message }), {
      status: 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ plan: savedSchema, schema }), {
    status: 200,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })

  } catch (err) {
    console.error('Onverwachte fout:', err)
    return new Response(JSON.stringify({ error: 'Interne fout', detail: String(err) }), {
      status: 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// Galloway schema generator
// ────────────────────────────────────────────────────────────────────────────

interface Interval {
  type: 'warmup' | 'run' | 'walk' | 'cooldown'
  durationSeconds: number
  rpeTarget: number
  cue?: string
}

interface Session {
  week: number
  day: number
  sessionNumber: number
  totalMinutes: number
  intervals: Interval[]
  description: string
}

interface SchemaResult {
  goal: string
  totalWeeks: number
  sessions: Session[]
}

function generateGallowaySchema(params: {
  goal: string
  daysPerWeek: number
  currentLevel: string
  userId: string
}): SchemaResult {
  const { goal, daysPerWeek, currentLevel } = params

  // Configuratie per doel
  const goalConfig: Record<string, { weeks: number; peakRunMinutes: number }> = {
    '5k': { weeks: 8, peakRunMinutes: 30 },
    '10k': { weeks: 12, peakRunMinutes: 50 },
    '15k': { weeks: 14, peakRunMinutes: 65 },
    'half_marathon': { weeks: 16, peakRunMinutes: 75 },
    'couch_to_30': { weeks: 8, peakRunMinutes: 30 },
  }

  const config = goalConfig[goal] ?? goalConfig['5k']
  const { weeks, peakRunMinutes } = config

  // Startconfiguratie afhankelijk van niveau
  const startRunSeconds = currentLevel === 'beginner' ? 30 : 60
  const startWalkSeconds = currentLevel === 'beginner' ? 90 : 60

  const sessions: Session[] = []
  let sessionNumber = 0

  for (let week = 1; week <= weeks; week++) {
    const progress = (week - 1) / (weeks - 1) // 0 → 1

    // Progressieve aanpassing: run langer, walk korter
    const runSeconds = Math.round(lerp(startRunSeconds, peakRunMinutes * 60, easeInOut(progress)))
    const walkSeconds = Math.round(lerp(startWalkSeconds, 30, easeInOut(progress)))

    // Laatste 2 weken: continue run (geen walk-intervallen meer)
    const isContinuousRun = week >= weeks - 1

    for (let day = 1; day <= daysPerWeek; day++) {
      sessionNumber++

      const intervals: Interval[] = []

      // Warming-up: 5 minuten wandelen
      intervals.push({ type: 'warmup', durationSeconds: 5 * 60, rpeTarget: 3 })

      if (isContinuousRun) {
        // Continue run
        const totalRunMinutes = Math.min(peakRunMinutes, 20 + week * 2)
        intervals.push({
          type: 'run',
          durationSeconds: totalRunMinutes * 60,
          rpeTarget: 6,
        })
      } else {
        // Run/walk intervallen
        const targetActiveMinutes = 15 + Math.floor(progress * 20) // 15 → 35 min
        const cycleSeconds = runSeconds + walkSeconds
        const cycles = Math.max(2, Math.floor((targetActiveMinutes * 60) / cycleSeconds))

        for (let c = 0; c < cycles; c++) {
          intervals.push({ type: 'run', durationSeconds: runSeconds, rpeTarget: 6 + Math.floor(progress) })
          if (c < cycles - 1) {
            intervals.push({ type: 'walk', durationSeconds: walkSeconds, rpeTarget: 3 })
          }
        }
      }

      // Cooling-down: 5 minuten wandelen
      intervals.push({ type: 'cooldown', durationSeconds: 5 * 60, rpeTarget: 2 })

      const totalMinutes = Math.round(intervals.reduce((s, iv) => s + iv.durationSeconds, 0) / 60)

      sessions.push({
        week,
        day,
        sessionNumber,
        totalMinutes,
        intervals,
        description: buildSessionDescription(week, day, isContinuousRun, runSeconds, walkSeconds, progress),
      })
    }
  }

  return { goal, totalWeeks: weeks, sessions }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t))
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

function buildSessionDescription(
  week: number,
  day: number,
  isContinuous: boolean,
  runSec: number,
  walkSec: number,
  progress: number
): string {
  if (isContinuous) return `Week ${week} dag ${day}: Continue run ${Math.round(20 + week * 2)} minuten`
  const runMin = runSec >= 60 ? `${Math.round(runSec / 60)}min` : `${runSec}sec`
  const walkMin = walkSec >= 60 ? `${Math.round(walkSec / 60)}min` : `${walkSec}sec`
  return `Week ${week} dag ${day}: Run ${runMin} / Walk ${walkMin} intervallen`
}
