import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { Redis } from 'ioredis'
import pg from 'pg'
import { deliverDueAlerts } from './alerts.js'
import { askAccount } from './ask.js'
import { loginToken } from './auth.js'
import { emailHmac } from './crypto.js'
import { Store, type ScanInput } from './store.js'

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

function scan(ssid: string, bssid: string): ScanInput {
  return {
    scanId: crypto.randomUUID(),
    observedAt: new Date().toISOString(),
    lat: 47.6205,
    lon: -122.3493,
    accuracy: 8,
    altitudeM: null,
    verticalAccuracyM: null,
    relativeM: null,
    speedMps: 1,
    networks: [{
      ssid,
      bssid,
      rssi: -42,
      capabilities: '[ESS]',
      frequencyMhz: 2437,
      channel: 6,
      band: '2.4',
      channelWidthMhz: 20,
      centerFreq0: 0,
      centerFreq1: 0,
      wifiStandard: 'legacy',
      securityTypes: [],
      passpoint: false,
      responder80211mc: false,
      responder80211az: false,
      twtResponder: false,
      secureHeLtf: false,
      rangingFrameProtection: false,
      apMldMac: null,
      apMloLinkId: null,
      affiliatedLinks: [],
      operatorName: null,
      venueName: null,
      countryCode: 'US',
      maxRateMbps: 54,
      stationCount: 1,
      channelUtilization: 10,
      admissionCapacity: 20,
      vendorOuis: [],
    }],
  }
}

const store = await Store.connect()
const redis = new Redis(process.env.REDIS_URL ?? '', {
  tls: { ca: readFileSync(process.env.REDIS_CA!), servername: 'localhost' },
  maxRetriesPerRequest: 1,
  lazyConnect: true,
})
await redis.connect()
const pool = new pg.Pool({
  connectionString: (process.env.DATABASE_URL ?? '').replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, ''),
  ssl: { ca: readFileSync(process.env.PGSSLROOTCERT!), rejectUnauthorized: true, servername: 'localhost' },
})
await store.migrate()
const stamp = crypto.randomUUID()
const userA = await store.upsertUser(`accounts-test-${stamp}-a@example.com`)
const userB = await store.upsertUser(`accounts-test-${stamp}-b@example.com`)
const createdIds = [userA.id, userB.id]

try {
  const applied = await store.ingest(userA.id, scan('Cafe WiFi', 'aa:bb:cc:dd:ee:91'))
  assert.equal(applied.applied, true)
  await store.ingest(userB.id, scan('Other Cafe', 'aa:bb:cc:dd:ee:91'))
  const catalogA = await store.catalog(userA.id)
  const catalogB = await store.catalog(userB.id)
  assert.deepEqual(catalogA.map((network) => network.ssid), ['Cafe WiFi'])
  assert.deepEqual(catalogB.map((network) => network.ssid), ['Other Cafe'])
  assert.equal((await store.open(userA.id)).some((row) => row.ssid === 'Other Cafe'), false)

  const cached = await redis.get(`u:${userA.id}:range:heard`)
  assert.ok(cached)
  assert.equal(cached!.includes('Cafe WiFi'), false)
  assert.equal(await redis.get('range:heard'), null)

  await store.wipe(userB.id)
  assert.equal((await store.catalog(userB.id)).length, 0)
  assert.equal((await store.catalog(userA.id)).length, 1)
  assert.equal((await store.range(userA.id)).heard.length, 1)

  const link = loginToken()
  await store.saveLoginToken(userA.id, link.hmac, new Date(Date.now() + 60_000))
  assert.equal((await store.consumeLoginToken(link.hmac))?.id, userA.id)
  assert.equal(await store.consumeLoginToken(link.hmac), null)
  const expired = loginToken()
  await store.saveLoginToken(userA.id, expired.hmac, new Date(Date.now() - 1000))
  assert.equal(await store.consumeLoginToken(expired.hmac), null)

  await store.saveStripeCustomer(userA.id, `cus_${stamp.replace(/-/g, '').slice(0, 14)}`)
  await store.saveStripeCustomer(userB.id, `cus_b${stamp.replace(/-/g, '').slice(0, 12)}`)
  const customerA = (await store.subscriptionFor(userA.id)).stripeCustomerId
  const customerB = (await store.subscriptionFor(userB.id)).stripeCustomerId
  assert.ok(customerA && customerB)
  await store.applySubscription({
    customerId: customerA,
    subscriptionId: 'sub_a',
    status: 'active',
    currentPeriodEnd: new Date('2026-12-21T00:00:00Z'),
  })
  await store.applySubscription({
    customerId: customerA,
    subscriptionId: 'sub_a',
    status: 'disputed',
    currentPeriodEnd: null,
  })
  await store.applySubscription({
    customerId: customerA,
    subscriptionId: 'sub_a',
    status: 'active',
    currentPeriodEnd: null,
  })
  assert.equal((await store.subscriptionFor(userA.id)).status, 'disputed')
  await store.applySubscription({
    customerId: customerA,
    subscriptionId: 'sub_new',
    status: 'active',
    currentPeriodEnd: null,
    overrideRisk: true,
  })
  assert.equal((await store.subscriptionFor(userA.id)).status, 'active')
  assert.equal((await store.subscriptionFor(userA.id)).stripeSubscriptionId, 'sub_new')
  await store.applySubscription({
    customerId: customerB,
    subscriptionId: 'sub_b',
    status: 'active',
    currentPeriodEnd: null,
  })

  const sent: string[] = []
  const first = await deliverDueAlerts(store, async (message) => {
    sent.push(message.to)
    assert.equal(message.text.includes('aa:bb:cc:dd:ee:91'), false)
    assert.match(message.text, /Cafe WiFi/)
  })
  assert.equal(first, 1)
  assert.deepEqual(sent, [userA.email])
  assert.equal(await deliverDueAlerts(store, async () => {
    throw new Error('should not send twice')
  }), 0)

  await store.restoreAlert(userA.id, null)
  let failed = false
  await deliverDueAlerts(store, async () => {
    failed = true
    throw new Error('delivery failed')
  })
  assert.equal(failed, true)
  assert.equal((await store.alertCandidates()).some((user) => user.id === userA.id), true)

  await store.wipe(userA.id)
  const afterWipe = await deliverDueAlerts(store, async (message) => {
    assert.notEqual(message.to, userA.email)
  })
  assert.equal(afterWipe, 0)
  assert.equal((await store.catalog(userA.id)).length, 0)

  const compEmail = 'ben@2050.to'
  const priorComp = await pool.query<{ id: string; last_alert_at: Date | null }>(
    'SELECT id, last_alert_at FROM users WHERE email_hmac = $1',
    [emailHmac(compEmail)],
  )
  const existingComp = priorComp.rows[0]
  const createdComp = !existingComp
  const compId = existingComp ? existingComp.id : (await store.upsertUser(compEmail)).id
  try {
    const comp = await store.subscriptionFor(compId)
    assert.equal(comp.status, 'active')
    const plain = await store.upsertUser(`accounts-test-${stamp}-plain@example.com`)
    createdIds.push(plain.id)
    assert.equal((await store.subscriptionFor(plain.id)).status, 'none')
    const due = await store.alertCandidates()
    if (!due.some((user) => user.id === compId)) {
      const last = existingComp?.last_alert_at
      assert.ok(last && Date.now() - last.getTime() < 7 * 24 * 60 * 60 * 1000)
    }
    if (createdComp) {
      assert.equal(comp.stripeCustomerId, null)
      const answer = await askAccount(store, compId, { dataset: 'wifi', question: 'anything' }, async () => 'comp answer')
      assert.equal(answer.answer, 'comp answer')
    }
  } finally {
    if (createdComp) await pool.query('DELETE FROM users WHERE id = $1', [compId])
  }
} finally {
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdIds])
  await redis.quit()
  await pool.end()
  await store.close()
}

console.log('account checks passed')
