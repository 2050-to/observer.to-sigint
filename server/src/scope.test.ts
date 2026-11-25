import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import pg from 'pg'
import { askAccount } from './ask.js'
import { bssidHmac, encryptJson } from './crypto.js'
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
const createdIds = [userA.id, userB.id]

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

  await insertPlace(userA.id, 'aa:bb:cc:dd:ee:41', 'Cafe Only A', 6, 47.62, -122.35, '98109')
  await insertPlace(userB.id, 'aa:bb:cc:dd:ee:42', 'Other Only B', 11, 47.61, -122.33, '98101')
  const found = await store.searchWifi(userA.id, { zip: '98109', state: 'WA', city: 'Seattle' })
  assert.deepEqual(found.map((row) => row.ssid), ['Cafe Only A'])
  assert.equal((await store.searchWifi(userB.id, { zip: '98109', state: null, city: null })).length, 0)
  assert.equal((await store.searchWifi(userA.id, { zip: null, state: 'CA', city: null })).length, 0)

  const emailColumn = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email'`,
  )
  assert.equal(emailColumn.rowCount, 0)

  await activate(userA.id, `cus_scope_a_${stamp.replace(/-/g, '').slice(0, 8)}`)
  await activate(userB.id, `cus_scope_b_${stamp.replace(/-/g, '').slice(0, 8)}`)
  const answerA = await askAccount(store, userA.id, { dataset: 'wifi', question: 'Where is Cafe?' }, async (_question, excerpt) => excerpt)
  const answerB = await askAccount(store, userB.id, { dataset: 'wifi', question: 'Where is Cafe?' }, async (_question, excerpt) => excerpt)
  assert.match(answerA.answer, /Cafe Only A/)
  assert.doesNotMatch(answerA.answer, /Other Only B/)
  assert.match(answerB.answer, /Other Only B/)
  assert.doesNotMatch(answerB.answer, /Cafe Only A/)

  const unpaid = await store.upsertUser(`scope-test-${stamp}-free@example.com`)
  createdIds.push(unpaid.id)
  await store.acceptLegal(unpaid.id, '1991-01-01', TOS_VERSION, PRIVACY_VERSION)
  await assert.rejects(
    () => askAccount(store, unpaid.id, { dataset: 'wifi', question: 'names' }, async () => 'no'),
    (error: unknown) => error instanceof ApiError && error.status === 402,
  )

  const sealedSpeaker = encryptJson({
    name: 'SecretSpeaker',
    lat: 47.61,
    lon: -122.33,
    city: 'Seattle',
    state: 'WA',
    zip: '98101',
  })
  await pool.query(
    `INSERT INTO bluetooth_places (user_id, address_hmac, payload, nonce, first_seen, last_seen)
     VALUES ($1, $2, $3, $4, now(), now())`,
    [userB.id, bssidHmac('bb:bb:bb:bb:bb:09'), sealedSpeaker.payload, sealedSpeaker.nonce],
  )
  const secretAsk = await askAccount(
    store,
    userA.id,
    { dataset: 'account', question: 'Where is SecretSpeaker?' },
    async (_question, excerpt) => excerpt,
  )
  assert.doesNotMatch(secretAsk.answer, /SecretSpeaker/)
  assert.match(secretAsk.answer, /Cafe Only A|No records/)

  const site = await store.createSite(userA.id, {
    name: 'Scope office',
    boundary: { kind: 'radius', lat: 47.62, lon: -122.35, radiusM: 150 },
    claims: [{ ssid: 'Cafe Only A', bssid: 'aa:bb:cc:dd:ee:41', baseline: 'wpa2' }],
  })
  assert.equal(site?.name, 'Scope office')
  assert.equal((await store.sites(userB.id)).length, 0)
  const disposition = await store.saveDisposition(userA.id, {
    kind: 'ap',
    id: 'aa:bb:cc:dd:ee:41',
    status: 'verified',
    note: 'Checked the label',
  })
  assert.equal(disposition?.status, 'verified')
  assert.equal((await store.dispositions(userB.id)).length, 0)
  await store.replaceLanInventory(userA.id, [{
    ip: '10.9.9.2', role: 'host', present: true, mac: null, name: 'printer', services: [], ports: [],
  }])
  const lanChanges = await store.replaceLanInventory(userA.id, [{
    ip: '10.9.9.4', role: 'host', present: true, mac: null, name: 'lobby camera', services: [], ports: [],
  }])
  assert.equal(lanChanges.some((change) => change.kind === 'recorder_appeared'), true)
  assert.equal((await store.lanChanges(userB.id)).length, 0)

  await store.wipe(userA.id)
  assert.equal((await store.searchWifi(userA.id, { zip: '98109', state: null, city: null })).length, 0)
  assert.equal((await store.sites(userA.id)).length, 0)
  assert.equal((await store.dispositions(userA.id)).length, 0)
  assert.equal((await store.lanChanges(userA.id)).length, 0)
  assert.equal((await store.searchWifi(userB.id, { zip: '98101', state: null, city: null })).length, 1)
  assert.deepEqual(await store.ownedConsentFor(userA.id), { addresses: false, details: false })
  assert.deepEqual(await store.saveOwnedConsent(userA.id, { addresses: true, details: true }), { addresses: true, details: true })
  assert.deepEqual(await store.saveOwnedConsent(userA.id, { addresses: false, details: true }), { addresses: false, details: false })
  await store.saveOwnedConsent(userA.id, { addresses: true, details: true })
  await store.wipe(userA.id)
  assert.deepEqual(await store.ownedConsentFor(userA.id), { addresses: false, details: false })
  assert.deepEqual(await store.ownedConsentFor(userB.id), { addresses: false, details: false })
} finally {
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdIds])
  await pool.end()
  await store.close()
}

async function insertPlace(
  userId: string,
  bssid: string,
  ssid: string,
  channel: number,
  lat: number,
  lon: number,
  zip: string,
): Promise<void> {
  const sealed = encryptJson({
    bssid,
    ssid,
    channel,
    security: 'wpa2',
    lat,
    lon,
    city: 'Seattle',
    state: 'WA',
    zip,
  })
  await pool.query(
    `INSERT INTO wifi_places (user_id, bssid_hmac, payload, nonce, first_seen, last_seen)
     VALUES ($1, $2, $3, $4, now(), now())`,
    [userId, bssidHmac(bssid), sealed.payload, sealed.nonce],
  )
}

console.log('scope checks passed')
