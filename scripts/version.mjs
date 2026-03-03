#!/usr/bin/env node
/**
 * Versie beheer script.
 * Gebruik: node scripts/version.mjs [versie]
 * Voorbeelden:
 *   node scripts/version.mjs          → bumpt patch (0.5.1 → 0.5.2)
 *   node scripts/version.mjs 0.6.0    → stelt exacte versie in
 *   npm run version                   → bumpt patch
 *   npm run version -- 1.0.0          → stelt exacte versie in
 *
 * Werkt bij:
 *   - package.json (version)
 *   - ios/App/App.xcodeproj/project.pbxproj (MARKETING_VERSION, CURRENT_PROJECT_VERSION)
 */

import { readFileSync, writeFileSync } from 'fs'

// ── package.json ─────────────────────────────────────────────────────────────
const pkgPath = 'package.json'
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)

const newVersion = process.argv[2] ?? `${major}.${minor}.${patch + 1}`
const prevVersion = pkg.version
pkg.version = newVersion
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// ── iOS project.pbxproj ───────────────────────────────────────────────────────
const pbxPath = 'ios/App/App.xcodeproj/project.pbxproj'
let pbxproj = readFileSync(pbxPath, 'utf8')

pbxproj = pbxproj.replace(
  /MARKETING_VERSION = [^;]+;/g,
  `MARKETING_VERSION = ${newVersion};`
)
pbxproj = pbxproj.replace(
  /CURRENT_PROJECT_VERSION = (\d+);/g,
  (_, n) => `CURRENT_PROJECT_VERSION = ${parseInt(n) + 1};`
)

writeFileSync(pbxPath, pbxproj)

// ── Samenvatting ──────────────────────────────────────────────────────────────
const newBuild = pbxproj.match(/CURRENT_PROJECT_VERSION = (\d+);/)?.[1]
console.log(`✓ ${prevVersion} → ${newVersion} (build ${newBuild})`)
