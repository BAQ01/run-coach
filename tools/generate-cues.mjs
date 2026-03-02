/**
 * generate-cues.mjs
 * Genereert MP3-bestanden voor alle coaching cues via OpenAI TTS.
 *
 * Gebruik:
 *   OPENAI_API_KEY=sk-... node tools/generate-cues.mjs
 *
 * Output: public/audio/cues/<slug>.mp3
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

const API_KEY = process.env.OPENAI_API_KEY
if (!API_KEY) {
  console.error('Zet OPENAI_API_KEY als omgevingsvariabele.')
  process.exit(1)
}

const OUTPUT_DIR = path.join(process.cwd(), 'public', 'audio', 'cues')
fs.mkdirSync(OUTPUT_DIR, { recursive: true })

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
}

async function generateCue(text) {
  const slug = slugify(text)
  const outPath = path.join(OUTPUT_DIR, `${slug}.mp3`)

  if (fs.existsSync(outPath)) {
    console.log(`⏭  Bestaat al: ${slug}.mp3`)
    return
  }

  const body = JSON.stringify({
    model: 'tts-1',
    input: text,
    voice: 'nova',
    response_format: 'mp3',
  })

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/audio/speech',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
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
        console.log(`✓  ${slug}.mp3`)
        resolve()
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

console.log(`Genereer ${CUES.length} cues naar ${OUTPUT_DIR}\n`)
for (const cue of CUES) {
  await generateCue(cue)
}
console.log('\nKlaar!')
