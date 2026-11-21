import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import pg from 'pg'
import { Redis } from 'ioredis'
import { signSession } from './auth.js'
import { Store } from './store.js'

const root = fileURLToPath(new URL('../..', import.meta.url))
for (const line of readFileSync(resolve(root, '.env'), 'utf8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const split = trimmed.indexOf('=')
  if (split < 0) continue
  process.env[trimmed.slice(0, split)] ??= trimmed.slice(split + 1)
}
for (const key of ['PGSSLROOTCERT', 'REDIS_CA', 'TLS_CERT']) {
  const value = process.env[key]
  if (value && !value.startsWith('/')) process.env[key] = resolve(root, value)
}

const port = process.env.PORT
if (!port) throw new Error('missing server env')
const base = `https://127.0.0.1:${port}`
const ca = readFileSync(process.env.TLS_CERT!.replace('server.crt', 'ca.crt'))
const store = await Store.connect()
await store.migrate()
const user = await store.upsertUser(`integration-${crypto.randomUUID()}@example.com`)
const token = await signSession(user)

async function api(path: string, init: RequestInit = {}, auth = true): Promise<{ status: number; headers: Headers; body: string }> {
  const headers = new Headers(init.headers)
  if (auth) headers.set('Authorization', `Bearer ${token}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${base}${path}`, { ...init, headers })
  return { status: response.status, headers: response.headers, body: await response.text() }
}

const health = await api('/health', {}, false)
assert.equal(health.status, 200)
assert.match(health.headers.get('strict-transport-security') ?? '', /max-age=/)
const denied = await api('/api/summary', {}, false)
assert.equal(denied.status, 401)

const scanId = crypto.randomUUID()
const scan = {
  scanId,
  observedAt: new Date().toISOString(),
  lat: 47.6205,
  lon: -122.3493,
  accuracy: 8,
  speedMps: 44.704,
  networks: [
    { ssid: 'Cafe WiFi', bssid: 'aa:bb:cc:dd:ee:01', rssi: -80, capabilities: '[ESS]', frequencyMhz: 2437, channel: 6, band: '2.4', channelWidthMhz: 20, centerFreq0: 0, centerFreq1: 0, wifiStandard: 'legacy', securityTypes: [], passpoint: false, responder80211mc: false, responder80211az: false, twtResponder: false, secureHeLtf: false, rangingFrameProtection: false, apMldMac: null, apMloLinkId: null, affiliatedLinks: [], operatorName: null, venueName: null, countryCode: 'US', maxRateMbps: 54, stationCount: 1, channelUtilization: 10, admissionCapacity: 20, vendorOuis: [] },
    { ssid: 'Cafe WiFi', bssid: 'aa:bb:cc:dd:ee:01', rssi: -42, capabilities: '[ESS]', frequencyMhz: 2437, channel: 6, band: '2.4', channelWidthMhz: 20, centerFreq0: 0, centerFreq1: 0, wifiStandard: 'legacy', securityTypes: [], passpoint: false, responder80211mc: false, responder80211az: false, twtResponder: false, secureHeLtf: false, rangingFrameProtection: false, apMldMac: null, apMloLinkId: null, affiliatedLinks: [], operatorName: null, venueName: null, countryCode: 'US', maxRateMbps: 54, stationCount: 1, channelUtilization: 10, admissionCapacity: 20, vendorOuis: [] },
    { ssid: 'Home', bssid: 'aa:bb:cc:dd:ee:03', rssi: -60, capabilities: '[WPA2-PSK-CCMP][ESS]', frequencyMhz: 5180, channel: 36, band: '5', channelWidthMhz: 80, centerFreq0: 5210, centerFreq1: 0, wifiStandard: 'ax', securityTypes: ['PSK'], passpoint: false, responder80211mc: false, responder80211az: false, twtResponder: false, secureHeLtf: false, rangingFrameProtection: false, apMldMac: null, apMloLinkId: null, affiliatedLinks: [], operatorName: null, venueName: null, countryCode: 'US', maxRateMbps: 1200, stationCount: null, channelUtilization: null, admissionCapacity: null, vendorOuis: [] },
  ],
}
const first = await api('/api/scans', { method: 'POST', body: JSON.stringify(scan) })
assert.equal(first.status, 200, first.body)
const firstBody = JSON.parse(first.body) as { applied: boolean; heard: { bssid: string; bestRssi: number; seenCount: number }[]; scanPeriodSeconds: number; dwellSeconds: number }
assert.equal(firstBody.applied, true)
assert.equal(firstBody.heard.length, 2)
assert.equal(firstBody.heard.find((network) => network.bssid === 'aa:bb:cc:dd:ee:01')?.bestRssi, -42)
assert.equal(firstBody.scanPeriodSeconds, 30)
assert.ok(firstBody.dwellSeconds < 5)

const retry = await api('/api/scans', { method: 'POST', body: JSON.stringify(scan) })
const retryBody = JSON.parse(retry.body) as { applied: boolean; heard: { bssid: string; seenCount: number }[] }
assert.equal(retryBody.applied, false)
assert.deepEqual(
  retryBody.heard.map((network) => [network.bssid, network.seenCount]),
  firstBody.heard.map((network) => [network.bssid, network.seenCount]),
)

const open = await api('/api/open')
const openBody = JSON.parse(open.body) as { networks: { ssid: string; label: string }[] }
const openNames = openBody.networks.map((network) => network.ssid)
assert.ok(openNames.includes('Cafe WiFi'))
assert.equal(openNames.includes('Home'), false)

const redis = new Redis(process.env.REDIS_URL ?? '', {
  tls: { ca, servername: 'localhost' },
  maxRetriesPerRequest: 1,
  lazyConnect: true,
})
await redis.connect()
const cached = await redis.get(`u:${user.id}:range:heard`)
assert.ok(cached)
assert.equal(cached!.includes('Cafe WiFi'), false)
const persistence = await redis.info('persistence')
assert.match(persistence, /aof_enabled:0/)
await redis.quit()

const pool = new pg.Pool({
  connectionString: (process.env.DATABASE_URL ?? '').replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, ''),
  ssl: { ca: readFileSync(process.env.PGSSLROOTCERT!), rejectUnauthorized: true, servername: 'localhost' },
})
const rows = await pool.query('SELECT encode(payload, \'escape\') AS payload FROM networks')
for (const row of rows.rows as { payload: string }[]) {
  assert.equal(row.payload.includes('Cafe'), false)
}
await pool.query('DELETE FROM users WHERE id = $1', [user.id])
await pool.end()
await store.close()
console.log('integration checks passed')
