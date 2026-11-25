import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDueReviews, deliverCriticalAlerts, deliverDueAlerts } from './alerts.js'
import { Store } from './store.js'

function loadEnv(path: string): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const split = trimmed.indexOf('=')
    if (split < 0) continue
    const key = trimmed.slice(0, split)
    if (process.env[key] == null) process.env[key] = trimmed.slice(split + 1)
  }
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
loadEnv(resolve(repoRoot, '.env'))
for (const key of ['PGSSLROOTCERT', 'REDIS_CA']) {
  const value = process.env[key]
  if (value && !value.startsWith('/')) process.env[key] = resolve(repoRoot, value)
}

const store = await Store.connect()
try {
  await store.migrate()
  const reviews = await buildDueReviews(store)
  const sent = await deliverDueAlerts(store)
  const critical = await deliverCriticalAlerts(store)
  console.log(`reviews ${reviews} emails ${sent} critical ${critical}`)
} finally {
  await store.close()
}
