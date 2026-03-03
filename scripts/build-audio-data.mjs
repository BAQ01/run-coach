/**
 * Genereert src/lib/audioCueData.js met alle MP3s als base64 data URIs.
 * Zo hoeft de Capacitor build geen XHR te doen naar capacitor://localhost/...
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join, basename } from 'path'

const cuesDir = new URL('../public/audio/cues', import.meta.url).pathname
const outFile = new URL('../src/lib/audioCueData.js', import.meta.url).pathname

if (!existsSync(cuesDir)) {
  console.error('[build-audio-data] Map niet gevonden:', cuesDir)
  process.exit(1)
}

const voices = readdirSync(cuesDir).filter(f =>
  !f.startsWith('.') && existsSync(join(cuesDir, f, ''))
)

const data = {}
let totalBytes = 0

for (const voice of voices) {
  data[voice] = {}
  const voiceDir = join(cuesDir, voice)
  let files
  try { files = readdirSync(voiceDir).filter(f => f.endsWith('.mp3')) }
  catch { continue }
  for (const file of files) {
    const slug = basename(file, '.mp3')
    const buf = readFileSync(join(voiceDir, file))
    data[voice][slug] = 'data:audio/mpeg;base64,' + buf.toString('base64')
    totalBytes += buf.length
    console.log(`  ${voice}/${slug} (${(buf.length / 1024).toFixed(0)}KB)`)
  }
}

const js = `// Automatisch gegenereerd door scripts/build-audio-data.mjs
// MP3s als base64 data URIs — geen XHR nodig in Capacitor
const audioCueData = ${JSON.stringify(data, null, 0)};
export default audioCueData;
`

writeFileSync(outFile, js)
console.log(`\n[build-audio-data] Klaar: ${voices.length} stemmen, ${(totalBytes / 1024).toFixed(0)}KB totaal → src/lib/audioCueData.js`)
