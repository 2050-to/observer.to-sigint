import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import pg from 'pg'
import { askAccount } from './ask.js'
import { bssidHmac } from './crypto.js'
import { ApiError } from './http.js'
import { Store } from './store.js'
import { PRIVACY_VERSION, TOS_VERSION } from '../../shared/legal.js'

const root = fileURLToPath(new URL('../..', import.meta.url))
for (const line of readFileSync(resolve(root, '.env'), 'utf8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const split = trimmed.indexOf('=')
  if (split < 0) continue
  process.env[trimmed.slice(0, split)] ??= trimmed.slice(split + 1)
}
for (const key of ['PGSSLROOTCERT', 'REDIS_CA']) {
  const value = process.env[key]
  if (value && !value.startsWith('/')) process.env[key] = resolve(root, value)
}

const store = await Store.connect()
const pool = new pg.Pool({
  connectionString: (process.env.DATABASE_URL ?? '').replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, ''),
  ssl: { ca: readFileSync(process.env.PGSSLROOTCERT!), rejectUnauthorized: true, servername: 'localhost' },
})
await store.migrate()
const stamp = crypto.randomUUID()
const userA = await store.upsertUser(`scope-test-${stamp}-a@example.com`)
const userB = await store.upsertUser(`scope-test-${stamp}-b@example.com`)

async function activate(userId: string, customerId: string): Promise<void> {
  await store.saveStripeCustomer(userId, customerId)
  await store.applySubscription({
    customerId,
    subscriptionId: `sub_${customerId}`,
    status: 'active',
    currentPeriodEnd: null,
    overrideRisk: true,
  })
}

try {
  const minor = await store.upsertUser(`scope-test-${stamp}-minor@example.com`)
  assert.equal(await store.acceptLegal(minor.id, '2015-01-01', TOS_VERSION, PRIVACY_VERSION), 'underage')
  await store.deleteAccount(minor.id)
  assert.equal(await store.userById(minor.id), null)

  assert.equal(await store.acceptLegal(userA.id, '1990-04-02', TOS_VERSION, PRIVACY_VERSION), 'ok')
  assert.equal((await store.consentFor(userA.id)).accepted, true)
  await pool.query('UPDATE users SET tos_version = $2 WHERE id = $1', [userA.id, '1999-01-01'])
  assert.equal((await store.consentFor(userA.id)).accepted, false)
  await store.acceptLegal(userA.id, '1990-04-02', TOS_VERSION, PRIVACY_VERSION)
  await store.acceptLegal(userB.id, '1988-08-08', TOS_VERSION, PRIVACY_VERSION)

  await pool.query(
    `INSERT INTO wifi_places (
       user_id, bssid_hmac, bssid, ssid, channel, security, lat, lon, city, state, zip, first_seen, last_seen
     ) VALUES ($1, $2, $3, $4, 6, 'wpa2', 47.62, -122.35, 'Seattle', 'WA', '98109', now(), now())`,
    [userA.id, bssidHmac('aa:bb:cc:dd:ee:41'), 'aa:bb:cc:dd:ee:41', 'Cafe Only A'],
  )
  await pool.query(
    `INSERT INTO wifi_places (
       user_id, bssid_hmac, bssid, ssid, channel, security, lat, lon, city, state, zip, first_seen, last_seen
     ) VALUES ($1, $2, $3, $4, 11, 'wpa2', 47.61, -122.33, 'Seattle', 'WA', '98101', now(), now())`,
    [userB.id, bssidHmac('aa:bb:cc:dd:ee:42'), 'aa:bb:cc:dd:ee:42', 'Other Only B'],
  )
  const found = await store.searchWifi(userA.id, { zip: '98109', state: 'WA', city: 'Seattle' })
  assert.deepEqual(found.map((row) => row.ssid), ['Cafe Only A'])
  assert.equal((await store.searchWifi(userB.id, { zip: '98109', state: null, city: null })).length, 0)
  assert.equal((await store.searchWifi(userA.id, { zip: null, state: 'CA', city: null })).length, 0)

  await store.insertDns(userA.id, [{ observedAt: '2026-11-23T15:04:00.000Z', name: 'only-a.example', type: 'A', rcode: null }])
  await store.insertDns(userB.id, [{ observedAt: '2026-11-23T15:04:00.000Z', name: 'only-b.example', type: 'A', rcode: null }])
  const dnsA = await store.dnsWindow(userA.id, '2026-11-23T00:00:00.000Z', '2026-11-24T00:00:00.000Z')
  assert.deepEqual(dnsA.map((row) => row.name), ['only-a.example'])

  await store.saveBookmarks(userA.id, [{ title: 'A bookmark', url: 'https://a.example/path' }])
  await store.saveBookmarks(userB.id, [{ title: 'B bookmark', url: 'https://b.example/path' }])
  assert.deepEqual((await store.listBookmarks(userA.id, 'a.example')).map((row) => row.url), ['https://a.example/path'])
  assert.equal((await store.listBookmarks(userB.id, 'a.example')).length, 0)

  await store.saveSearches(userA.id, [{ query: 'secret phrase a', engine: 'Google', queriedAt: '2026-11-20T00:00:00.000Z' }])
  await store.saveVisits(userA.id, [{ url: 'https://private-a.example/page', title: 'Private A', visitedAt: '2026-11-20T00:00:00.000Z' }])
  await store.saveSearches(userB.id, [{ query: 'secret phrase b', engine: 'Google', queriedAt: '2026-11-20T00:00:00.000Z' }])
  await store.saveVisits(userB.id, [{ url: 'https://private-b.example/page', title: 'Private B', visitedAt: '2026-11-20T00:00:00.000Z' }])

  await activate(userA.id, `cus_scope_a_${stamp.replace(/-/g, '').slice(0, 8)}`)
  await activate(userB.id, `cus_scope_b_${stamp.replace(/-/g, '').slice(0, 8)}`)
  const answerA = await askAccount(store, userA.id, { dataset: 'wifi', question: 'Where is Cafe?' }, async (_question, excerpt) => excerpt)
  const answerB = await askAccount(store, userB.id, { dataset: 'wifi', question: 'Where is Cafe?' }, async (_question, excerpt) => excerpt)
  assert.match(answerA.answer, /Cafe Only A/)
  assert.doesNotMatch(answerA.answer, /Other Only B/)
  assert.match(answerB.answer, /Other Only B/)
  assert.doesNotMatch(answerB.answer, /Cafe Only A/)
  const dnsAnswer = await askAccount(store, userB.id, { dataset: 'dns', question: 'only-a' }, async (_question, excerpt) => excerpt)
  assert.doesNotMatch(dnsAnswer.answer, /only-a\.example/)
  const searchAnswer = await askAccount(store, userB.id, { dataset: 'search', question: 'secret phrase a' }, async (_question, excerpt) => excerpt)
  assert.doesNotMatch(searchAnswer.answer, /secret phrase a/)
  const visitAnswer = await askAccount(store, userA.id, { dataset: 'browsing', question: 'private-b' }, async (_question, excerpt) => excerpt)
  assert.doesNotMatch(visitAnswer.answer, /private-b\.example/)

  const unpaid = await store.upsertUser(`scope-test-${stamp}-free@example.com`)
  await store.acceptLegal(unpaid.id, '1991-01-01', TOS_VERSION, PRIVACY_VERSION)
  await assert.rejects(
    () => askAccount(store, unpaid.id, { dataset: 'dns', question: 'names' }, async () => 'no'),
    (error: unknown) => error instanceof ApiError && error.status === 402,
  )

  await store.wipe(userA.id)
  assert.equal((await store.searchWifi(userA.id, { zip: '98109', state: null, city: null })).length, 0)
  assert.equal((await store.dnsWindow(userA.id, '2026-11-23T00:00:00.000Z', '2026-11-24T00:00:00.000Z')).length, 0)
  assert.equal((await store.searchWifi(userB.id, { zip: '98101', state: null, city: null })).length, 1)
} finally {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`scope-test-${stamp}-%@example.com`])
  await pool.end()
  await store.close()
}

console.log('scope checks passed')
