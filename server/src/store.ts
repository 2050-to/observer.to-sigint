import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Redis } from 'ioredis'
import pg from 'pg'
import { COMP_EMAILS, entitledStatus } from './comp.js'
import { sealPlaintextColumns } from './atRest.js'
import { bssidHmac, decryptJson, emailHmac, encryptJson } from './crypto.js'
import { circleFor, snapshotFrom } from '../../shared/range.js'
import { cellKeyOf, collapseCells, collapseDevices, mergeCell, mergeDevice } from '../../shared/radios.js'
import { inferScene, pingFrom, stripPing, trimHistory } from '../../shared/scene.js'
import { DEFAULT_RADIUS_M, timingFor } from './dwell.js'
import {
  enrichmentLookupHmac,
  inputForDevice,
  inputForNetwork,
  isEnrichmentInput,
  type EnrichmentInput,
} from './enrichment/input.js'
import { lookupPlaceParts, type PlaceParts } from './geocode.js'
import {
  acceptLegal,
  askExcerpt,
  consentFor,
  deleteUser,
  listSearches,
  listVisits,
  ownedConsentFor,
  replaceLanHosts,
  saveDeviceProfile,
  saveOwnedConsent,
  saveSearches,
  saveVisits,
  searchWifi,
  upsertBluetoothPlaces,
  upsertWifiPlaces,
  usPlace,
  wipePersonal,
} from './personal.js'
import { mergeRecord, collapseScan, normalizeBssid } from './merge.js'
import { addPostalCode, postalCellKey, samePostalCell } from '../../shared/postal.js'
import { openRows } from './security.js'
import type {
  CellRecord,
  DeviceEnrichment,
  DeviceRecord,
  EnrichmentQueueStatus,
  Fix,
  NetworkRecord,
  OpenRow,
  PlaceInfo,
  RangeSnapshot,
  ScanAp,
  ScanCell,
  ScanDevice,
} from './types.js'

const { Pool } = pg

export interface ScanInput {
  scanId: string
  observedAt: string
  lat: number | null
  lon: number | null
  accuracy: number | null
  altitudeM: number | null
  verticalAccuracyM: number | null
  relativeM: number | null
  speedMps: number | null
  wifiOn?: boolean
  bluetoothOn?: boolean
  cellOn?: boolean
  networks: ScanAp[]
  devices?: ScanDevice[]
  cells?: ScanCell[]
}

export interface ClaimedEnrichmentJob {
  lookupHmac: Buffer
  input: EnrichmentInput
  attempts: number
}

function pack(value: unknown): string {
  const sealed = encryptJson(value)
  return JSON.stringify({
    payload: sealed.payload.toString('base64'),
    nonce: sealed.nonce.toString('base64'),
  })
}

function unpack<T>(raw: string): T {
  const sealed = JSON.parse(raw) as { payload: string; nonce: string }
  return decryptJson<T>(Buffer.from(sealed.payload, 'base64'), Buffer.from(sealed.nonce, 'base64'))
}

function asRecord(row: { payload: Buffer; nonce: Buffer }): NetworkRecord {
  return decryptJson<NetworkRecord>(row.payload, row.nonce)
}

function asDevice(row: { payload: Buffer; nonce: Buffer }): DeviceRecord {
  return decryptJson<DeviceRecord>(row.payload, row.nonce)
}

function asCell(row: { payload: Buffer; nonce: Buffer }): CellRecord {
  return decryptJson<CellRecord>(row.payload, row.nonce)
}

function asEnrichment(row: { payload: Buffer; nonce: Buffer }): DeviceEnrichment {
  return decryptJson<DeviceEnrichment>(row.payload, row.nonce)
}

function completeSnapshot(snapshot: RangeSnapshot): RangeSnapshot {
  return {
    ...snapshot,
    heardDevices: snapshot.heardDevices ?? [],
    rooms: snapshot.rooms ?? [],
    movers: snapshot.movers ?? [],
    history: snapshot.history ?? [],
    postalCodes: snapshot.postalCodes ?? [],
  }
}

function userKey(userId: string, suffix: string): string {
  return `u:${userId}:${suffix}`
}

function enrichmentErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const status = /DeepSeek request failed \((\d{3})\)/.exec(message)
  if (status) return `DeepSeek request failed (${status[1]})`
  if (/no structured output/i.test(message)) return 'DeepSeek returned no structured output'
  if (/invalid JSON/i.test(message)) return 'DeepSeek returned invalid JSON'
  if (/no evidence/i.test(message)) return 'DeepSeek search returned no evidence'
  return 'device enrichment failed'
}

async function withTransaction<T>(db: pg.Pool, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const value = await run(client)
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export class Store {
  constructor(
    private readonly db: pg.Pool,
    private readonly redis: Redis,
  ) {}

  static async connect(): Promise<Store> {
    const connectionString = process.env.DATABASE_URL ?? ''
    const redisUrl = process.env.REDIS_URL ?? ''
    if (!connectionString) throw new Error('DATABASE_URL is required')
    if (!redisUrl) throw new Error('REDIS_URL is required')
    const caPath = process.env.PGSSLROOTCERT
    const redisCa = process.env.REDIS_CA
    if (Boolean(caPath) !== Boolean(redisCa)) throw new Error('PGSSLROOTCERT and REDIS_CA must be set together')
    const db = new Pool(caPath
      ? {
          connectionString: connectionString.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, ''),
          ssl: {
            ca: readFileSync(caPath),
            rejectUnauthorized: true,
            servername: 'localhost',
          },
        }
      : { connectionString })
    db.on('error', (error: Error) => {
      console.error(error.message || 'database connection dropped')
    })
    const redis = new Redis(redisUrl, {
      ...(redisCa ? { tls: { ca: readFileSync(redisCa), servername: 'localhost' } } : {}),
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    })
    const store = new Store(db, redis)
    await store.ready()
    return store
  }

  private async ready(): Promise<void> {
    let last: unknown
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await this.db.query('SELECT 1')
        if (this.redis.status === 'wait' || this.redis.status === 'end') await this.redis.connect()
        await this.redis.ping()
        return
      } catch (error) {
        last = error
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
    throw last
  }

  async migrate(): Promise<void> {
    const legacy = await this.db.query<{ legacy: number; scoped: number }>(`
      SELECT
        (SELECT count(*)::int FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'networks' AND column_name = 'bssid_hmac') AS legacy,
        (SELECT count(*)::int FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'networks' AND column_name = 'user_id') AS scoped
    `)
    if ((legacy.rows[0]?.legacy ?? 0) > 0 && (legacy.rows[0]?.scoped ?? 0) === 0) {
      await this.db.query('DROP TABLE IF EXISTS networks, devices, cells, applied_scans, range_snapshot CASCADE')
      await this.deleteLegacyRedis()
    }
    const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
    await this.db.query(sql)
    await sealPlaintextColumns(this.db)
    await this.redis.config('SET', 'save', '').catch(() => undefined)
    await this.redis.config('SET', 'appendonly', 'no').catch(() => undefined)
  }

  private async deleteLegacyRedis(): Promise<void> {
    await this.redis.del('range:heard', 'range:circle', 'place:phone')
    for (const pattern of ['ap:*', 'postal:*']) {
      let cursor = '0'
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
        cursor = next
        if (keys.length) await this.redis.del(...keys)
      } while (cursor !== '0')
    }
  }

  async close(): Promise<void> {
    await this.redis.quit()
    await this.db.end()
  }

  async ingest(userId: string, scan: ScanInput): Promise<{ applied: boolean; snapshot: RangeSnapshot }> {
    const seenAt = new Date(scan.observedAt).toISOString()
    const fix: Fix = {
      lat: scan.lat,
      lon: scan.lon,
      accuracy: scan.accuracy,
      altitudeM: scan.altitudeM,
      verticalAccuracyM: scan.verticalAccuracyM,
      relativeM: scan.relativeM,
    }
    const collapsed = collapseScan(scan.networks)
    const devices = collapseDevices(scan.devices ?? [])
    const cells = collapseCells(scan.cells ?? [])
    const previous = await this.readSnapshot(userId)
    const placeParts = await this.cachedPlaceParts(userId, scan.lat, scan.lon)
    const postalCode = placeParts?.postalCode ?? null
    const bestCodes = new Map<string, Promise<string | null>>()
      const bestPostalCode = (lat: number | null, lon: number | null): Promise<string | null> => {
      if (lat == null || lon == null) return Promise.resolve(null)
      if (scan.lat != null && scan.lon != null && samePostalCell(scan.lat, scan.lon, lat, lon)) return Promise.resolve(postalCode)
      const key = postalCellKey(lat, lon)
      const pending = bestCodes.get(key)
      if (pending) return pending
      const lookup = this.cachedPlaceParts(userId, lat, lon).then((parts) => parts?.postalCode ?? null)
      bestCodes.set(key, lookup)
      return lookup
    }
    const codesFor = async (existing: string[] | null | undefined, bestLat: number | null, bestLon: number | null) =>
      addPostalCode(addPostalCode(existing, postalCode), await bestPostalCode(bestLat, bestLon))
    const rawPing = pingFrom({ ...scan, devices, cells })
    const scene = inferScene(trimHistory([...previous.history, rawPing]))
    const history = trimHistory([...previous.history.map(stripPing), stripPing(rawPing)])
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      const inserted = await client.query(
        'INSERT INTO applied_scans (user_id, scan_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING scan_id',
        [userId, scan.scanId],
      )
      if (inserted.rowCount === 0) {
        await client.query('ROLLBACK')
        const snapshot = await this.readSnapshot(userId)
        return { applied: false, snapshot }
      }
      const heard: NetworkRecord[] = []
      const observedDevices: DeviceRecord[] = []
      for (const ap of collapsed) {
        const hmac = bssidHmac(ap.bssid)
        const existingRow = await client.query<{ payload: Buffer; nonce: Buffer }>(
          'SELECT payload, nonce FROM networks WHERE user_id = $1 AND bssid_hmac = $2 FOR UPDATE',
          [userId, hmac],
        )
        const existing = existingRow.rowCount ? asRecord(existingRow.rows[0]) : null
        const mergedRecord = mergeRecord(existing, ap, fix, seenAt)
        const merged = { ...mergedRecord, postalCodes: await codesFor(existing?.postalCodes, mergedRecord.bestLat, mergedRecord.bestLon) }
        const sealed = encryptJson(merged)
        await client.query(
          `INSERT INTO networks (user_id, bssid_hmac, payload, nonce, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (user_id, bssid_hmac) DO UPDATE
           SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
          [userId, hmac, sealed.payload, sealed.nonce],
        )
        heard.push(merged)
      }
      for (const device of devices) {
        const hmac = bssidHmac(device.address)
        const existingRow = await client.query<{ payload: Buffer; nonce: Buffer }>(
          'SELECT payload, nonce FROM devices WHERE user_id = $1 AND address_hmac = $2 FOR UPDATE',
          [userId, hmac],
        )
        const existing = existingRow.rowCount ? asDevice(existingRow.rows[0]) : null
        const mergedDevice = mergeDevice(existing, device, fix, seenAt)
        const merged = { ...mergedDevice, postalCodes: await codesFor(existing?.postalCodes, mergedDevice.bestLat, mergedDevice.bestLon) }
        const sealed = encryptJson(merged)
        await client.query(
          `INSERT INTO devices (user_id, address_hmac, payload, nonce, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (user_id, address_hmac) DO UPDATE
           SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
          [userId, hmac, sealed.payload, sealed.nonce],
        )
        observedDevices.push(merged)
      }
      await upsertWifiPlaces(client, userId, heard, usPlace(placeParts))
      await upsertBluetoothPlaces(client, userId, observedDevices, usPlace(placeParts))
      for (const cell of cells) {
        const hmac = bssidHmac(cellKeyOf(cell))
        const existingRow = await client.query<{ payload: Buffer; nonce: Buffer }>(
          'SELECT payload, nonce FROM cells WHERE user_id = $1 AND cell_hmac = $2 FOR UPDATE',
          [userId, hmac],
        )
        const existing = existingRow.rowCount ? asCell(existingRow.rows[0]) : null
        const merged = mergeCell(existing, cell, fix, seenAt)
        const sealed = encryptJson(merged)
        await client.query(
          `INSERT INTO cells (user_id, cell_hmac, payload, nonce, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (user_id, cell_hmac) DO UPDATE
           SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
          [userId, hmac, sealed.payload, sealed.nonce],
        )
      }
      const snapshot = {
        ...snapshotFrom(heard, fix, scan.speedMps, addPostalCode(previous.postalCodes, postalCode)),
        heardDevices: observedDevices,
        rooms: scene.rooms,
        movers: scene.movers,
        history,
      }
      const sealedSnapshot = encryptJson(snapshot)
      await client.query(
        `INSERT INTO range_snapshot (user_id, payload, nonce, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id) DO UPDATE
         SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
        [userId, sealedSnapshot.payload, sealedSnapshot.nonce],
      )
      await client.query('COMMIT')
      await this.enqueueEnrichmentRecords(heard, observedDevices).catch(() => {
        console.error('failed to queue device enrichment')
      })
      await this.cacheRange(userId, snapshot, heard)
      return { applied: true, snapshot }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async range(userId: string): Promise<RangeSnapshot> {
    const cached = await this.redis.get(userKey(userId, 'range:heard'))
    if (cached) return completeSnapshot(unpack<RangeSnapshot>(cached))
    const snapshot = await this.readSnapshot(userId)
    await this.cacheRange(userId, snapshot, snapshot.heard)
    return snapshot
  }

  async map(userId: string): Promise<{
    snapshot: RangeSnapshot
    circle: NetworkRecord[]
    networks: NetworkRecord[]
    devices: DeviceRecord[]
    cells: CellRecord[]
  }> {
    const networks = await this.catalog(userId)
    const devices = await this.devices(userId)
    const cells = await this.cells(userId)
    const snapshot = await this.range(userId)
    const circleKey = userKey(userId, 'range:circle')
    const cached = await this.redis.get(circleKey)
    const circle = cached ? unpack<NetworkRecord[]>(cached) : circleFor(networks, snapshot)
    if (!cached) {
      const ttl = Math.max(1, Math.ceil(snapshot.scanPeriodSeconds))
      await this.redis.set(circleKey, pack(circle), 'EX', ttl)
    }
    return { snapshot, circle, networks, devices, cells }
  }

  async open(userId: string): Promise<OpenRow[]> {
    return openRows(await this.catalog(userId))
  }

  async catalog(userId: string): Promise<NetworkRecord[]> {
    const records = await this.rawCatalog(userId)
    const enrichments = await this.enrichmentResultMap()
    return records.map((record) => {
      const input = inputForNetwork(record)
      const enrichment = input ? enrichments.get(enrichmentLookupHmac(input).toString('hex')) ?? null : null
      return { ...record, enrichment }
    })
  }

  private async rawCatalog(userId: string): Promise<NetworkRecord[]> {
    const result = await this.db.query<{ payload: Buffer; nonce: Buffer }>(
      'SELECT payload, nonce FROM networks WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId],
    )
    return result.rows.map(asRecord)
  }

  async devices(userId: string): Promise<DeviceRecord[]> {
    const records = await this.rawDevices(userId)
    const enrichments = await this.enrichmentResultMap()
    return records.map((record) => {
      const input = inputForDevice(record)
      const enrichment = input ? enrichments.get(enrichmentLookupHmac(input).toString('hex')) ?? null : null
      return { ...record, enrichment }
    })
  }

  private async rawDevices(userId: string): Promise<DeviceRecord[]> {
    const result = await this.db.query<{ payload: Buffer; nonce: Buffer }>(
      'SELECT payload, nonce FROM devices WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId],
    )
    return result.rows.map(asDevice)
  }

  async cells(userId: string): Promise<CellRecord[]> {
    const result = await this.db.query<{ payload: Buffer; nonce: Buffer }>(
      'SELECT payload, nonce FROM cells WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId],
    )
    return result.rows.map(asCell)
  }

  private async enrichmentResultMap(): Promise<Map<string, DeviceEnrichment>> {
    const result = await this.db.query<{ lookup_hmac: Buffer; payload: Buffer; nonce: Buffer }>(
      'SELECT lookup_hmac, payload, nonce FROM enrichment_results',
    )
    const values = new Map<string, DeviceEnrichment>()
    for (const row of result.rows) {
      try {
        values.set(row.lookup_hmac.toString('hex'), asEnrichment(row))
      } catch {
        console.error('failed to decrypt an enrichment result')
      }
    }
    return values
  }

  async enqueueEnrichmentRecords(networks: NetworkRecord[], devices: DeviceRecord[]): Promise<number> {
    const inputs = [
      ...networks.map(inputForNetwork),
      ...devices.map(inputForDevice),
    ].filter((input): input is EnrichmentInput => input != null)
    const unique = new Map(inputs.map((input) => [enrichmentLookupHmac(input).toString('hex'), input]))
    let queued = 0
    for (const input of unique.values()) {
      if (await this.enqueueEnrichmentInput(input)) queued += 1
    }
    return queued
  }

  async enqueueEnrichmentBackfill(): Promise<number> {
    const [networks, devices] = await Promise.all([
      this.db.query<{ payload: Buffer; nonce: Buffer }>('SELECT payload, nonce FROM networks'),
      this.db.query<{ payload: Buffer; nonce: Buffer }>('SELECT payload, nonce FROM devices'),
    ])
    return this.enqueueEnrichmentRecords(networks.rows.map(asRecord), devices.rows.map(asDevice))
  }

  private async enqueueEnrichmentInput(input: EnrichmentInput): Promise<boolean> {
    const lookupHmac = enrichmentLookupHmac(input)
    const sealed = encryptJson(input)
    const result = await this.db.query(
      `INSERT INTO enrichment_jobs (
         lookup_hmac, payload, nonce, status, attempts, available_at, locked_at, last_error, created_at, updated_at
       )
       SELECT $1, $2, $3, 'pending', 0, now(), NULL, NULL, now(), now()
       WHERE NOT EXISTS (
         SELECT 1 FROM enrichment_results
         WHERE lookup_hmac = $1 AND refresh_after > now()
       )
       ON CONFLICT (lookup_hmac) DO UPDATE
       SET payload = EXCLUDED.payload,
           nonce = EXCLUDED.nonce,
           status = 'pending',
           attempts = 0,
           available_at = now(),
           locked_at = NULL,
           last_error = NULL,
           updated_at = now()
       WHERE enrichment_jobs.status = 'failed'
         AND enrichment_jobs.updated_at < now() - interval '1 day'`,
      [lookupHmac, sealed.payload, sealed.nonce],
    )
    return (result.rowCount ?? 0) > 0
  }

  async claimEnrichmentJob(): Promise<ClaimedEnrichmentJob | null> {
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<{
        lookup_hmac: Buffer
        payload: Buffer
        nonce: Buffer
        attempts: number
      }>(
        `SELECT lookup_hmac, payload, nonce, attempts
         FROM enrichment_jobs
         WHERE (status = 'pending' AND available_at <= now())
            OR (status = 'failed' AND available_at <= now())
            OR (status = 'processing' AND locked_at < now() - interval '30 minutes')
         ORDER BY available_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
      )
      if (!result.rowCount) {
        await client.query('COMMIT')
        return null
      }
      const row = result.rows[0]
      const attempts = row.attempts + 1
      let input: unknown
      try {
        input = decryptJson<unknown>(row.payload, row.nonce)
      } catch {
        input = null
      }
      if (!isEnrichmentInput(input)) {
        await client.query(
          `UPDATE enrichment_jobs
           SET status = 'failed',
               attempts = $2,
               available_at = now() + interval '1 day',
               locked_at = NULL,
               last_error = 'invalid encrypted enrichment job payload',
               updated_at = now()
           WHERE lookup_hmac = $1`,
          [row.lookup_hmac, attempts],
        )
        await client.query('COMMIT')
        return null
      }
      await client.query(
        `UPDATE enrichment_jobs
         SET status = 'processing', attempts = $2, locked_at = now(), updated_at = now()
         WHERE lookup_hmac = $1`,
        [row.lookup_hmac, attempts],
      )
      await client.query('COMMIT')
      return {
        lookupHmac: row.lookup_hmac,
        input,
        attempts,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async completeEnrichmentJob(
    lookupHmac: Buffer,
    enrichment: DeviceEnrichment,
    refreshDays = 30,
  ): Promise<void> {
    const days = Number.isFinite(refreshDays) ? Math.max(1, Math.min(365, Math.round(refreshDays))) : 30
    const refreshAfter = new Date(Date.now() + days * 86_400_000)
    const sealed = encryptJson(enrichment)
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO enrichment_results (lookup_hmac, payload, nonce, refreshed_at, refresh_after)
         VALUES ($1, $2, $3, now(), $4)
         ON CONFLICT (lookup_hmac) DO UPDATE
         SET payload = EXCLUDED.payload,
             nonce = EXCLUDED.nonce,
             refreshed_at = now(),
             refresh_after = EXCLUDED.refresh_after`,
        [lookupHmac, sealed.payload, sealed.nonce, refreshAfter],
      )
      await client.query('DELETE FROM enrichment_jobs WHERE lookup_hmac = $1', [lookupHmac])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async failEnrichmentJob(
    lookupHmac: Buffer,
    attempts: number,
    error: unknown,
    maxAttempts = 4,
  ): Promise<void> {
    const message = enrichmentErrorMessage(error)
    if (attempts >= maxAttempts) {
      await this.db.query(
        `UPDATE enrichment_jobs
         SET status = 'failed',
             available_at = now() + interval '1 day',
             locked_at = NULL,
             last_error = $2,
             updated_at = now()
         WHERE lookup_hmac = $1`,
        [lookupHmac, message],
      )
      return
    }
    const delaySeconds = Math.min(3600, 15 * (2 ** Math.max(0, attempts - 1)))
    const availableAt = new Date(Date.now() + delaySeconds * 1000)
    await this.db.query(
      `UPDATE enrichment_jobs
       SET status = 'pending',
           available_at = $2,
           locked_at = NULL,
           last_error = $3,
           updated_at = now()
       WHERE lookup_hmac = $1`,
      [lookupHmac, availableAt, message],
    )
  }

  async enrichmentStatus(enabled: boolean): Promise<EnrichmentQueueStatus> {
    const [jobs, complete] = await Promise.all([
      this.db.query<{ status: 'pending' | 'processing' | 'failed'; count: string }>(
        'SELECT status, count(*)::text AS count FROM enrichment_jobs GROUP BY status',
      ),
      this.db.query<{ count: string }>('SELECT count(*)::text AS count FROM enrichment_results'),
    ])
    const counts = { pending: 0, processing: 0, failed: 0 }
    for (const row of jobs.rows) counts[row.status] = Number(row.count)
    return {
      enabled,
      ...counts,
      complete: Number(complete.rows[0]?.count ?? 0),
    }
  }

  async rememberPostalCode(userId: string, lat: number, lon: number, code: string | null): Promise<void> {
    try {
      await this.redis.set(userKey(userId, `postal:${postalCellKey(lat, lon)}`), pack({ code }), 'EX', 30 * 24 * 60 * 60)
    } catch {
      return
    }
  }

  async postalCodeFor(userId: string, lat: number, lon: number): Promise<string | null> {
    return this.cachedPostalCode(userId, lat, lon)
  }

  async appearanceCodes(userId: string, bssid: string, lat: number, lon: number, postalCode: string | null): Promise<string[]> {
    let codes = addPostalCode([], postalCode)
    try {
      const record = await this.readNetwork(userId, bssid)
      codes = addPostalCode(record?.postalCodes, postalCode)
      const points = [
        [record?.bestLat, record?.bestLon],
        [record?.lastLat, record?.lastLon],
      ] as const
      const seen = new Set<string>()
      for (const [pointLat, pointLon] of points) {
        if (pointLat == null || pointLon == null || samePostalCell(lat, lon, pointLat, pointLon)) continue
        const key = postalCellKey(pointLat, pointLon)
        if (seen.has(key)) continue
        seen.add(key)
        codes = addPostalCode(codes, await this.cachedPostalCode(userId, pointLat, pointLon))
      }
    } catch {
      return codes
    }
    return codes
  }

  async saveNetworkPlace(userId: string, bssid: string, place: PlaceInfo, postalCodes: string[]): Promise<NetworkRecord> {
    const hmac = bssidHmac(normalizeBssid(bssid))
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      const existingRow = await client.query<{ payload: Buffer; nonce: Buffer }>(
        'SELECT payload, nonce FROM networks WHERE user_id = $1 AND bssid_hmac = $2 FOR UPDATE',
        [userId, hmac],
      )
      if (!existingRow.rowCount) {
        await client.query('ROLLBACK')
        throw new Error('unknown network')
      }
      const record = asRecord(existingRow.rows[0])
      record.place = place
      record.postalCodes = postalCodes.reduce<string[]>((codes, code) => addPostalCode(codes, code), record.postalCodes ?? [])
      const sealed = encryptJson(record)
      await client.query(
        'UPDATE networks SET payload = $2, nonce = $3, updated_at = now() WHERE user_id = $4 AND bssid_hmac = $1',
        [hmac, sealed.payload, sealed.nonce, userId],
      )
      await client.query('COMMIT')
      await this.redis.set(userKey(userId, `ap:${hmac.toString('hex')}`), pack(record), 'EX', 300)
      return record
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async savePhonePlace(userId: string, place: PlaceInfo, postalCode: string | null): Promise<string[]> {
    await this.redis.set(userKey(userId, 'place:phone'), pack(place), 'EX', 86_400)
    const snapshot = await this.readSnapshot(userId)
    const postalCodes = addPostalCode(snapshot.postalCodes, postalCode)
    if (postalCodes.join('\n') !== (snapshot.postalCodes ?? []).join('\n')) {
      const next = { ...snapshot, postalCodes }
      const sealed = encryptJson(next)
      await this.db.query(
        `INSERT INTO range_snapshot (user_id, payload, nonce, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id) DO UPDATE
         SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
        [userId, sealed.payload, sealed.nonce],
      )
      await this.cacheRange(userId, next, next.heard)
    }
    return postalCodes
  }

  async upsertUser(email: string): Promise<{ id: string; email: string }> {
    const normalized = email.trim().toLowerCase()
    const sealed = encryptJson(normalized)
    const result = await this.db.query<{ id: string; email_payload: Buffer; email_nonce: Buffer }>(
      `INSERT INTO users (id, email_hmac, email_payload, email_nonce)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email_hmac) DO UPDATE SET email_hmac = users.email_hmac
       RETURNING id, email_payload, email_nonce`,
      [randomUUID(), emailHmac(normalized), sealed.payload, sealed.nonce],
    )
    const row = result.rows[0]
    return { id: row.id, email: decryptJson<string>(row.email_payload, row.email_nonce) }
  }

  async userById(id: string): Promise<{ id: string; email: string } | null> {
    const result = await this.db.query<{ id: string; email_payload: Buffer; email_nonce: Buffer }>(
      'SELECT id, email_payload, email_nonce FROM users WHERE id = $1',
      [id],
    )
    const row = result.rows[0]
    if (!row) return null
    return { id: row.id, email: decryptJson<string>(row.email_payload, row.email_nonce) }
  }

  async saveLoginToken(userId: string, tokenHmac: Buffer, expiresAt: Date): Promise<void> {
    await this.db.query(
      'INSERT INTO login_tokens (token_hmac, user_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHmac, userId, expiresAt],
    )
  }

  async consumeLoginToken(tokenHmac: Buffer): Promise<{ id: string; email: string } | null> {
    const result = await this.db.query<{ id: string; email_payload: Buffer; email_nonce: Buffer }>(
      `UPDATE login_tokens AS token
       SET used_at = now()
       FROM users
       WHERE token.token_hmac = $1
         AND token.user_id = users.id
         AND token.used_at IS NULL
         AND token.expires_at > now()
       RETURNING users.id, users.email_payload, users.email_nonce`,
      [tokenHmac],
    )
    const row = result.rows[0]
    if (!row) return null
    return { id: row.id, email: decryptJson<string>(row.email_payload, row.email_nonce) }
  }

  async subscriptionFor(userId: string): Promise<{
    status: string
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
    currentPeriodEnd: string | null
  }> {
    const result = await this.db.query<{
      email_payload: Buffer
      email_nonce: Buffer
      status: string | null
      stripe_customer_id: string | null
      stripe_subscription_id: string | null
      current_period_end: Date | null
    }>(
      `SELECT users.email_payload,
              users.email_nonce,
              subscriptions.status,
              subscriptions.stripe_customer_id,
              subscriptions.stripe_subscription_id,
              subscriptions.current_period_end
       FROM users
       LEFT JOIN subscriptions ON subscriptions.user_id = users.id
       WHERE users.id = $1`,
      [userId],
    )
    const row = result.rows[0]
    if (!row) {
      return { status: 'none', stripeCustomerId: null, stripeSubscriptionId: null, currentPeriodEnd: null }
    }
    return {
      status: entitledStatus(decryptJson<string>(row.email_payload, row.email_nonce), row.status),
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
    }
  }

  async saveStripeCustomer(userId: string, customerId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO subscriptions (user_id, stripe_customer_id, status)
       VALUES ($1, $2, 'none')
       ON CONFLICT (user_id) DO UPDATE
       SET stripe_customer_id = COALESCE(subscriptions.stripe_customer_id, EXCLUDED.stripe_customer_id),
           updated_at = now()`,
      [userId, customerId],
    )
  }

  async applySubscription(effect: {
    customerId: string
    subscriptionId: string | null
    status: string
    currentPeriodEnd: Date | null
    overrideRisk?: boolean
  }): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE subscriptions
       SET status = $2,
           stripe_subscription_id = COALESCE($3, stripe_subscription_id),
           current_period_end = COALESCE($4, current_period_end),
           updated_at = now()
       WHERE stripe_customer_id = $1
         AND (
           $5::boolean
           OR status NOT IN ('disputed', 'refunded', 'fraud_warning')
           OR $2 IN ('canceled', 'disputed', 'refunded', 'fraud_warning')
         )`,
      [effect.customerId, effect.status, effect.subscriptionId, effect.currentPeriodEnd, effect.overrideRisk === true],
    )
    return (result.rowCount ?? 0) > 0
  }

  async alertCandidates(): Promise<{ id: string; email: string; lastAlertAt: string | null }[]> {
    const hmacs = COMP_EMAILS.map((email) => emailHmac(email))
    const comp = hmacs.map((_, index) => `users.email_hmac = $${index + 1}`).join(' OR ')
    const result = await this.db.query<{
      id: string
      email_payload: Buffer
      email_nonce: Buffer
      last_alert_at: Date | null
    }>(
      `SELECT users.id, users.email_payload, users.email_nonce, users.last_alert_at
       FROM users
       LEFT JOIN subscriptions ON subscriptions.user_id = users.id
       WHERE (
         subscriptions.status = 'active'
         OR ${comp}
       )
         AND (users.last_alert_at IS NULL OR users.last_alert_at < now() - interval '7 days')
       ORDER BY users.last_alert_at NULLS FIRST
       LIMIT 50`,
      hmacs,
    )
    return result.rows.map((row) => ({
      id: row.id,
      email: decryptJson<string>(row.email_payload, row.email_nonce),
      lastAlertAt: row.last_alert_at ? new Date(row.last_alert_at).toISOString() : null,
    }))
  }

  async claimAlert(userId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE users
       SET last_alert_at = now()
       WHERE id = $1
         AND (last_alert_at IS NULL OR last_alert_at < now() - interval '7 days')`,
      [userId],
    )
    return (result.rowCount ?? 0) > 0
  }

  async restoreAlert(userId: string, lastAlertAt: string | null): Promise<void> {
    await this.db.query('UPDATE users SET last_alert_at = $2 WHERE id = $1', [userId, lastAlertAt])
  }

  private async readNetwork(userId: string, bssid: string): Promise<NetworkRecord | null> {
    const hmac = bssidHmac(normalizeBssid(bssid))
    const existing = await this.db.query<{ payload: Buffer; nonce: Buffer }>(
      'SELECT payload, nonce FROM networks WHERE user_id = $1 AND bssid_hmac = $2',
      [userId, hmac],
    )
    if (!existing.rowCount) return null
    return asRecord(existing.rows[0])
  }

  private async cachedPostalCode(userId: string, lat: number | null, lon: number | null): Promise<string | null> {
    const parts = await this.cachedPlaceParts(userId, lat, lon)
    return parts?.postalCode ?? null
  }

  private async cachedPlaceParts(userId: string, lat: number | null, lon: number | null): Promise<PlaceParts | null> {
    if (lat == null || lon == null) return null
    const key = userKey(userId, `geo:${postalCellKey(lat, lon)}`)
    try {
      const cached = await this.redis.get(key)
      if (cached != null) {
        try {
          return unpack<PlaceParts>(cached)
        } catch {
          await this.redis.del(key)
        }
      }
      const parts = await lookupPlaceParts(lat, lon)
      await this.redis.set(key, pack(parts), 'EX', 30 * 24 * 60 * 60)
      return parts
    } catch {
      return null
    }
  }

  async wipe(userId: string): Promise<void> {
    let cursor = '0'
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', userKey(userId, '*'), 'COUNT', 200)
      cursor = next
      if (keys.length) await this.redis.del(...keys)
    } while (cursor !== '0')
    await this.db.query('DELETE FROM networks WHERE user_id = $1', [userId])
    await this.db.query('DELETE FROM devices WHERE user_id = $1', [userId])
    await this.db.query('DELETE FROM cells WHERE user_id = $1', [userId])
    await this.db.query('DELETE FROM applied_scans WHERE user_id = $1', [userId])
    await this.db.query('DELETE FROM range_snapshot WHERE user_id = $1', [userId])
    await wipePersonal(this.db, userId)
  }

  async consentFor(userId: string) {
    return consentFor(this.db, userId)
  }

  async acceptLegal(userId: string, bornOn: string, tosVersion: string, privacyVersion: string) {
    return acceptLegal(this.db, userId, bornOn, tosVersion, privacyVersion)
  }

  async deleteAccount(userId: string): Promise<void> {
    await this.wipe(userId)
    await deleteUser(this.db, userId)
  }

  async saveDeviceProfile(userId: string, details: unknown): Promise<void> {
    await saveDeviceProfile(this.db, userId, details)
  }

  async replaceLanHosts(userId: string, hosts: { ip: string }[]): Promise<void> {
    await replaceLanHosts(this.db, userId, hosts)
  }

  async ownedConsentFor(userId: string) {
    return ownedConsentFor(this.db, userId)
  }

  async saveOwnedConsent(userId: string, consent: { addresses: boolean; details: boolean }) {
    return saveOwnedConsent(this.db, userId, consent)
  }

  async searchWifi(userId: string, filter: { zip: string | null; state: string | null; city: string | null }) {
    return searchWifi(this.db, userId, filter)
  }

  async saveSearches(userId: string, items: { query: string; engine: string | null; queriedAt: string }[], replace = false) {
    if (!replace) return saveSearches(this.db, userId, items)
    return withTransaction(this.db, (client) => saveSearches(client, userId, items, true))
  }

  async listSearches(userId: string, q: string) {
    return listSearches(this.db, userId, q)
  }

  async saveVisits(userId: string, items: { url: string; title: string | null; visitedAt: string }[], replace = false) {
    if (!replace) return saveVisits(this.db, userId, items)
    return withTransaction(this.db, (client) => saveVisits(client, userId, items, true))
  }

  async listVisits(userId: string, q: string) {
    return listVisits(this.db, userId, q)
  }

  async askExcerpt(userId: string, dataset: 'wifi' | 'search' | 'browsing', question: string) {
    return askExcerpt(this.db, userId, dataset, question)
  }

  async summary(userId: string): Promise<{
    count: number
    openCount: number
    snapshot: RangeSnapshot
  }> {
    const count = await this.db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM networks WHERE user_id = $1',
      [userId],
    )
    const snapshot = await this.range(userId)
    const openCount = (await this.open(userId)).length
    return { count: Number(count.rows[0]?.count ?? 0), openCount, snapshot }
  }

  private async cacheRange(userId: string, snapshot: RangeSnapshot, heard: NetworkRecord[]): Promise<void> {
    const ttl = Math.max(1, Math.ceil(snapshot.scanPeriodSeconds))
    const networks = await this.catalog(userId)
    const circle = circleFor(networks, snapshot)
    await this.redis.set(userKey(userId, 'range:heard'), pack(snapshot), 'EX', ttl)
    await this.redis.set(userKey(userId, 'range:circle'), pack(circle), 'EX', ttl)
    for (const network of heard) {
      const hmac = bssidHmac(network.bssid).toString('hex')
      await this.redis.set(userKey(userId, `ap:${hmac}`), pack(network), 'EX', 300)
    }
  }

  private async readSnapshot(userId: string): Promise<RangeSnapshot> {
    const result = await this.db.query<{ payload: Buffer; nonce: Buffer }>(
      'SELECT payload, nonce FROM range_snapshot WHERE user_id = $1',
      [userId],
    )
    if (!result.rowCount) {
      const timing = timingFor(DEFAULT_RADIUS_M, null)
      return {
        heard: [],
        heardDevices: [],
        radiusM: DEFAULT_RADIUS_M,
        phone: { lat: null, lon: null, accuracy: null, altitudeM: null, verticalAccuracyM: null, relativeM: null },
        speedMps: null,
        dwellSeconds: timing.dwellSeconds,
        scanPeriodSeconds: timing.scanPeriodSeconds,
        rooms: [],
        movers: [],
        history: [],
        postalCodes: [],
      }
    }
    return completeSnapshot(decryptJson<RangeSnapshot>(result.rows[0].payload, result.rows[0].nonce))
  }
}
