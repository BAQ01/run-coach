#!/usr/bin/env node
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function sh(cmd, options = {}) {
  return execSync(cmd, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...options,
  }).trim()
}

function escapeForDoubleQuotes(value) {
  return value.replace(/(["\\$`])/g, '\\$1')
}

const projectDir = process.cwd()
const projectName = path.basename(projectDir)
const parentDir = path.dirname(projectDir)

const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const stamp = [
  now.getFullYear(),
  pad(now.getMonth() + 1),
  pad(now.getDate()),
].join('-') + '_' + [pad(now.getHours()), pad(now.getMinutes())].join('')

const zipName = `${projectName}_backup_safe_${stamp}.zip`
const zipPath = path.join(parentDir, zipName)

if (!fs.existsSync(path.join(projectDir, 'package.json'))) {
  console.error('Geen package.json gevonden. Run dit script vanuit de project-root.')
  process.exit(1)
}

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath)
}

const excludes = [
  '*/.git/*',
  '.git/*',
  '*/node_modules/*',
  'node_modules/*',
  '*/dist/*',
  'dist/*',
  '*/build/*',
  'build/*',
  '*/.next/*',
  '.next/*',
  '*/coverage/*',
  'coverage/*',
  '*/.vite/*',
  '.vite/*',
  '*/Pods/*',
  'Pods/*',
  '*/DerivedData/*',
  'DerivedData/*',
  '*/.env',
  '.env',
  '*/.env.local',
  '.env.local',
  '*/.env.production',
  '.env.production',
  '*/.env.development.local',
  '.env.development.local',
  '*/.env.test.local',
  '.env.test.local',
  '*/.env.production.local',
  '.env.production.local',
  '*/.claude/*',
  '.claude/*',
  '*/.DS_Store',
  '.DS_Store',
  '*/run-coach_backup*.zip',
  '*/backup_safe_*.zip',
]

const excludeArgs = excludes
  .map((pattern) => `-x "${escapeForDoubleQuotes(pattern)}"`)
  .join(' ')

const zipCmd = `zip -r "${escapeForDoubleQuotes(zipPath)}" . ${excludeArgs}`

console.log(`Project: ${projectDir}`)
console.log(`Output : ${zipPath}`)
console.log('Backup maken...')

try {
  sh(zipCmd, { cwd: projectDir })
} catch (error) {
  console.error('Zip maken mislukt.')
  console.error(error.stderr || error.message)
  process.exit(1)
}

console.log('Backup gemaakt.\n')
console.log('Controle op gevoelige paden...')

let zipList = ''
try {
  zipList = sh(`unzip -l "${escapeForDoubleQuotes(zipPath)}"`, { cwd: projectDir })
} catch (error) {
  console.error('Kon zip-inhoud niet controleren.')
  console.error(error.stderr || error.message)
  process.exit(1)
}

const forbiddenPatterns = [
  /\.env(?!\.example)(\/|$|\.)/i,
  /\.claude\//i,
  /\.git\//i,
  /node_modules\//i,
  /Pods\//i,
  /DerivedData\//i,
]

const badLines = zipList
  .split('\n')
  .filter((line) => forbiddenPatterns.some((rx) => rx.test(line)))

if (badLines.length > 0) {
  console.error('WAARSCHUWING: gevoelige of uitgesloten bestanden gevonden in de zip:\n')
  for (const line of badLines.slice(0, 20)) {
    console.error(line)
  }
  if (badLines.length > 20) {
    console.error(`... en nog ${badLines.length - 20} regels`)
  }
  process.exit(1)
}

console.log('OK: geen .env/.claude/.git/node_modules/Pods/DerivedData gevonden.')
console.log(`\nKlaar: ${zipPath}`)