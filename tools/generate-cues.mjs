/**
 * generate-cues.mjs
 * Genereert MP3-bestanden voor alle coaching cues via ElevenLabs TTS.
 *
 * Gebruik:
 *   ELEVENLABS_API_KEY=... node tools/generate-cues.mjs
 *
 * Output: public/audio/cues/<voice>/<slug>.mp3
 *
 * Stemmen:
 *   Rebecca - Charlotte  (vrouw, Europees accent)
 *   Sarah   - Matilda    (vrouw, warm)
 *   Pieter  - Daniel     (man, helder)
 *   Rik     - George     (man, energiek)
 */

import fs from 'fs'
import path from 'path'
import https from 'https'

const CUES = [
  'Start je warming-up. Loop rustig mee.',
  'Goed gedaan! Begin nu met je cooling-down.',
  'Halverwege, ga door!',
  'Training voltooid! Geweldig werk!',
  'Start met lopen. Ga ervoor!',
  'Rennen nu! Je kunt dit!',
  'Loop nu. Houd je tempo.',
  'Wandelen nu. Herstel, adem rustig.',
  'Loop even bij. Goed bezig!',
  'Wandelinterval. Herstel voor de volgende run.',
]

const VOICES = [
  { name: 'rebecca', id: 'XB0fDUnXU5powFXDhCwa' }, // Charlotte - vrouw, Europees
  { name: 'sarah',   id: 'XrExE9yKIg1WjnnlVkGX' }, // Matilda   - vrouw, warm
  { name: 'pieter',  id: 'onwK4e9ZLuTAKqWW03F9' }, // Daniel    - man, helder
  { name: 'rik',     id: 'JBFqnCBsd6RMkjVDRZzb' }, // George    - man, energiek
]

const API_KEY = process.env.ELEVENLABS_API_KEY
if (!API_KEY) {
  console.error('Zet ELEVENLABS_API_KEY als omgevingsvariabele.')
  process.exit(1)
}

const MODEL_ID = 'eleven_multilingual_v2'
const BASE_DIR = path.join(process.cwd(), 'public', 'audio', 'cues')

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
}

async function generateCue(text, voiceId, outPath) {
  if (fs.existsSync(outPath)) {
    console.log(`  ⏭  Bestaat al: ${path.basename(outPath)}`)
    return
  }

  const body = JSON.stringify({
    text,
    model_id: MODEL_ID,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.3,
      use_speaker_boost: true,
    },
  })

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${voiceId}`,
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        let err = ''
        res.on('data', d => err += d)
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${err}`)))
        return
      }
      const file = fs.createWriteStream(outPath)
      res.pipe(file)
      file.on('finish', () => {
        console.log(`  ✓  ${path.basename(outPath)}`)
        resolve()
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

for (const voice of VOICES) {
  const dir = path.join(BASE_DIR, voice.name)
  fs.mkdirSync(dir, { recursive: true })
  console.log(`\n🎙  ${voice.name} (${voice.id})`)
  for (const cue of CUES) {
    const outPath = path.join(dir, `${slugify(cue)}.mp3`)
    await generateCue(cue, voice.id, outPath)
  }
}

console.log('\nKlaar!')
