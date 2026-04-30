#!/usr/bin/env node

const rawUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const timeoutMs = Number(process.env.KEEPALIVE_TIMEOUT_MS ?? 10_000)

if (!rawUrl || !anonKey) {
  console.error('Missing SUPABASE_URL and/or SUPABASE_ANON_KEY.')
  console.error('Set them as environment variables before running this keepalive script.')
  process.exit(1)
}

const baseUrl = rawUrl.replace(/\/+$/, '')
const endpoints = [
  '/auth/v1/settings',
  '/storage/v1/version',
]

for (const path of endpoints) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      const bodyText = await response.text()
      throw new Error(`Supabase keepalive failed for ${path} (${response.status}): ${bodyText}`)
    }

    console.log(`Supabase keepalive ok: ${path} (${response.status})`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exit(1)
  } finally {
    clearTimeout(timeout)
  }
}
