import { readFileSync } from 'node:fs'
import { Redis } from 'ioredis'
import pg from 'pg'
import { bssidHmac, decryptJson, encryptJson } from './crypto.js'
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
import { lookupPostalCode } from './geocode.js'
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
    rooms: snapshot.rooms ?? [],
    movers: snapshot.movers ?? [],
    history: snapshot.history ?? [],
    postalCodes: snapshot.postalCodes ?? [],
  }
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

export class Store {
  constructor(
    private readonly db: pg.Pool,
    private readonly redis: Redis,
  ) {}

  static async connect(): Promise<Store> {
    const caPath = process.env.PGSSLROOTCERT
    const redisCa = process.env.REDIS_CA
    if (!caPath || !redisCa) throw new Error('PGSSLROOTCERT and REDIS_CA are required')
    const ca = readFileSync(caPath)
    const connectionString = (process.env.DATABASE_URL ?? '').replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '')
    const db = new Pool({
      connectionString,
      ssl: {
        ca,
        rejectUnauthorized: true,
        servername: 'localhost',
      },
    })
    const redis = new Redis(process.env.REDIS_URL ?? '', {
      tls: { ca: readFileSync(redisCa), servername: 'localhost' },
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
    const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
    await this.db.query(sql)
    await this.redis.config('SET', 'save', '').catch(() => undefined)
    await this.redis.config('SET', 'appendonly', 'no').catch(() => undefined)
  }

  async close(): Promise<void> {
    await this.redis.quit()
    await this.db.end()
  }

  async ingest(scan: ScanInput): Promise<{ applied: boolean; snapshot: RangeSnapshot }> {
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
    const previous = await this.readSnapshot()
    const postalCode = await this.cachedPostalCode(scan.lat, scan.lon)
    const rawPing = pingFrom({ ...scan, devices, cells })
    const scene = inferScene(trimHistory([...previous.history, rawPing]))
    const history = trimHistory([...previous.history.map(stripPing), stripPing(rawPing)])
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      const inserted = await client.query(
        'INSERT INTO applied_scans (scan_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING scan_id',
        [scan.scanId],
      )
      if (inserted.rowCount === 0) {
        await client.query('ROLLBACK')
        const snapshot = await this.readSnapshot()
        return { applied: false, snapshot }
      }
      const heard: NetworkRecord[] = []
      const observedDevices: DeviceRecord[] = []
      for (const ap of collapsed) {
        const hmac = bssidHmac(ap.bssid)
        const existingRow = await client.query<{ payload: Buffer; nonce: Buffer }>(
          'SELECT payload, nonce FROM networks WHERE bssid_hmac = $1 FOR UPDATE',
          [hmac],
        )
        const existing = existingRow.rowCount ? asRecord(existingRow.rows[0]) : null
        const merged = { ...mergeRecord(existing, ap, fix, seenAt), postalCodes: addPostalCode(existing?.postalCodes, postalCode) }
        const sealed = encryptJson(merged)
        await client.query(
          `INSERT INTO networks (bssid_hmac, payload, nonce, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (bssid_hmac) DO UPDATE
           SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
          [hmac, sealed.payload, sealed.nonce],
        )
        heard.push(merged)
      }
      for (const device of devices) {
        const hmac = bssidHmac(device.address)
        const existingRow = await client.query<{ payload: Buffer; nonce: Buffer }>(
          'SELECT payload, nonce FROM devices WHERE address_hmac = $1 FOR UPDATE',
          [hmac],
        )
        const existing = existingRow.rowCount ? asDevice(existingRow.rows[0]) : null
        const merged = { ...mergeDevice(existing, device, fix, seenAt), postalCodes: addPostalCode(existing?.postalCodes, postalCode) }
        const sealed = encryptJson(merged)
        await client.query(
          `INSERT INTO devices (address_hmac, payload, nonce, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (address_hmac) DO UPDATE
           SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
          [hmac, sealed.payload, sealed.nonce],
        )
        observedDevices.push(merged)
      }
      for (const cell of cells) {
        const hmac = bssidHmac(cellKeyOf(cell))
        const existingRow = await client.query<{ payload: Buffer; nonce: Buffer }>(
          'SELECT payload, nonce FROM cells WHERE cell_hmac = $1 FOR UPDATE',
          [hmac],
        )
        const existing = existingRow.rowCount ? asCell(existingRow.rows[0]) : null
        const merged = mergeCell(existing, cell, fix, seenAt)
        const sealed = encryptJson(merged)
        await client.query(
          `INSERT INTO cells (cell_hmac, payload, nonce, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (cell_hmac) DO UPDATE
           SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
          [hmac, sealed.payload, sealed.nonce],
        )
      }
      const snapshot = {
        ...snapshotFrom(heard, fix, scan.speedMps, addPostalCode(previous.postalCodes, postalCode)),
        rooms: scene.rooms,
        movers: scene.movers,
        history,
      }
      const sealedSnapshot = encryptJson(snapshot)
      await client.query(
        `INSERT INTO range_snapshot (id, payload, nonce, updated_at)
         VALUES (1, $1, $2, now())
         ON CONFLICT (id) DO UPDATE
         SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
        [sealedSnapshot.payload, sealedSnapshot.nonce],
      )
      await client.query('COMMIT')
      await this.enqueueEnrichmentRecords(heard, observedDevices).catch(() => {
        console.error('failed to queue device enrichment')
      })
      await this.cacheRange(snapshot, heard)
      return { applied: true, snapshot }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async range(): Promise<RangeSnapshot> {
    const cached = await this.redis.get('range:heard')
    if (cached) return completeSnapshot(unpack<RangeSnapshot>(cached))
    const snapshot = await this.readSnapshot()
    await this.cacheRange(snapshot, snapshot.heard)
    return snapshot
  }

  async map(): Promise<{
    snapshot: RangeSnapshot
    circle: NetworkRecord[]
    networks: NetworkRecord[]
    devices: DeviceRecord[]
    cells: CellRecord[]
  }> {
    const networks = await this.catalog()
    const devices = await this.devices()
    const cells = await this.cells()
    const snapshot = await this.range()
    const cached = await this.redis.get('range:circle')
    const circle = cached ? unpack<NetworkRecord[]>(cached) : circleFor(networks, snapshot)
    if (!cached) {
      const ttl = Math.max(1, Math.ceil(snapshot.scanPeriodSeconds))
      await this.redis.set('range:circle', pack(circle), 'EX', ttl)
    }
    return { snapshot, circle, networks, devices, cells }
  }

  async open(): Promise<OpenRow[]> {
    return openRows(await this.catalog())
  }

  async catalog(): Promise<NetworkRecord[]> {
    const records = await this.rawCatalog()
    const enrichments = await this.enrichmentResultMap()
    return records.map((record) => {
      const input = inputForNetwork(record)
      const enrichment = input ? enrichments.get(enrichmentLookupHmac(input).toString('hex')) ?? null : null
      return { ...record, enrichment }
    })
  }

  private async rawCatalog(): Promise<NetworkRecord[]> {
    const result = await this.db.query<{ payload: Buffer; nonce: Buffer }>(
      'SELECT payload, nonce FROM networks ORDER BY updated_at DESC',
    )
    return result.rows.map(asRecord)
  }

  async devices(): Promise<DeviceRecord[]> {
    const records = await this.rawDevices()
    const enrichments = await this.enrichmentResultMap()
    return records.map((record) => {
      const input = inputForDevice(record)
      const enrichment = input ? enrichments.get(enrichmentLookupHmac(input).toString('hex')) ?? null : null
      return { ...record, enrichment }
    })
  }

  private async rawDevices(): Promise<DeviceRecord[]> {
    const result = await this.db.query<{ payload: Buffer; nonce: Buffer }>(
      'SELECT payload, nonce FROM devices ORDER BY updated_at DESC',
    )
    return result.rows.map(asDevice)
  }

  async cells(): Promise<CellRecord[]> {
    const result = await this.db.query<{ payload: Buffer; nonce: Buffer }>(
      'SELECT payload, nonce FROM cells ORDER BY updated_at DESC',
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
    const [networks, devices] = await Promise.all([this.rawCatalog(), this.rawDevices()])
    return this.enqueueEnrichmentRecords(networks, devices)
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

  async rememberPostalCode(lat: number, lon: number, code: string | null): Promise<void> {
    try {
      await this.redis.set(`postal:${postalCellKey(lat, lon)}`, code ?? '', 'EX', 30 * 24 * 60 * 60)
    } catch {
      return
    }
  }

  async appearanceCodes(bssid: string, lat: number, lon: number, postalCode: string | null): Promise<string[]> {
    let codes = addPostalCode([], postalCode)
    try {
      const record = await this.readNetwork(bssid)
      codes = addPostalCode(record?.postalCodes, postalCode)
      if (
        record?.lastLat != null
        && record.lastLon != null
        && !samePostalCell(lat, lon, record.lastLat, record.lastLon)
      ) {
        codes = addPostalCode(codes, await this.cachedPostalCode(record.lastLat, record.lastLon))
      }
    } catch {
      return codes
    }
    return codes
  }

  async saveNetworkPlace(bssid: string, place: PlaceInfo, postalCodes: string[]): Promise<NetworkRecord> {
    const hmac = bssidHmac(normalizeBssid(bssid))
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      const existingRow = await client.query<{ payload: Buffer; nonce: Buffer }>(
        'SELECT payload, nonce FROM networks WHERE bssid_hmac = $1 FOR UPDATE',
        [hmac],
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
        'UPDATE networks SET payload = $2, nonce = $3, updated_at = now() WHERE bssid_hmac = $1',
        [hmac, sealed.payload, sealed.nonce],
      )
      await client.query('COMMIT')
      await this.redis.set(`ap:${hmac.toString('hex')}`, pack(record), 'EX', 300)
      return record
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async savePhonePlace(place: PlaceInfo, postalCode: string | null): Promise<string[]> {
    await this.redis.set('place:phone', pack(place), 'EX', 86_400)
    const snapshot = await this.readSnapshot()
    const postalCodes = addPostalCode(snapshot.postalCodes, postalCode)
    if (postalCodes.join('\n') !== (snapshot.postalCodes ?? []).join('\n')) {
      const next = { ...snapshot, postalCodes }
      const sealed = encryptJson(next)
      await this.db.query(
        `INSERT INTO range_snapshot (id, payload, nonce, updated_at)
         VALUES (1, $1, $2, now())
         ON CONFLICT (id) DO UPDATE
         SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
        [sealed.payload, sealed.nonce],
      )
      await this.cacheRange(next, next.heard)
    }
    return postalCodes
  }

  private async readNetwork(bssid: string): Promise<NetworkRecord | null> {
    const hmac = bssidHmac(normalizeBssid(bssid))
    const existing = await this.db.query<{ payload: Buffer; nonce: Buffer }>(
      'SELECT payload, nonce FROM networks WHERE bssid_hmac = $1',
      [hmac],
    )
    if (!existing.rowCount) return null
    return asRecord(existing.rows[0])
  }

  private async cachedPostalCode(lat: number | null, lon: number | null): Promise<string | null> {
    if (lat == null || lon == null) return null
    const key = `postal:${postalCellKey(lat, lon)}`
    try {
      const cached = await this.redis.get(key)
      if (cached != null) return cached || null
      const result = await lookupPostalCode(lat, lon)
      if (!result.lookedUp) return null
      await this.redis.set(key, result.code ?? '', 'EX', 30 * 24 * 60 * 60)
      return result.code
    } catch {
      return null
    }
  }

  async wipe(): Promise<void> {
    await this.redis.flushdb()
    await this.db.query('TRUNCATE networks, devices, cells, applied_scans, range_snapshot, enrichment_jobs, enrichment_results')
  }

  async summary(): Promise<{
    count: number
    openCount: number
    snapshot: RangeSnapshot
  }> {
    const count = await this.db.query<{ count: string }>('SELECT count(*)::text AS count FROM networks')
    const snapshot = await this.range()
    const openCount = (await this.open()).length
    return { count: Number(count.rows[0]?.count ?? 0), openCount, snapshot }
  }

  private async cacheRange(snapshot: RangeSnapshot, heard: NetworkRecord[]): Promise<void> {
    const ttl = Math.max(1, Math.ceil(snapshot.scanPeriodSeconds))
    const networks = await this.catalog()
    const circle = circleFor(networks, snapshot)
    await this.redis.set('range:heard', pack(snapshot), 'EX', ttl)
    await this.redis.set('range:circle', pack(circle), 'EX', ttl)
    for (const network of heard) {
      const hmac = bssidHmac(network.bssid).toString('hex')
      await this.redis.set(`ap:${hmac}`, pack(network), 'EX', 300)
    }
  }

  private async readSnapshot(): Promise<RangeSnapshot> {
    const result = await this.db.query<{ payload: Buffer; nonce: Buffer }>(
      'SELECT payload, nonce FROM range_snapshot WHERE id = 1',
    )
    if (!result.rowCount) {
      const timing = timingFor(DEFAULT_RADIUS_M, null)
      return {
        heard: [],
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
