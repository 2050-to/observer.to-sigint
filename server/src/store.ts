import { readFileSync } from 'node:fs'
import { Redis } from 'ioredis'
import pg from 'pg'
import { bssidHmac, decryptJson, encryptJson } from './crypto.js'
import { circleFor, snapshotFrom } from '../../shared/range.js'
import { cellKeyOf, collapseCells, collapseDevices, mergeCell, mergeDevice } from '../../shared/radios.js'
import { inferScene, pingFrom, stripPing, trimHistory } from '../../shared/scene.js'
import { DEFAULT_RADIUS_M, timingFor } from './dwell.js'
import { mergeRecord, collapseScan, normalizeBssid } from './merge.js'
import { openRows } from './security.js'
import type { CellRecord, DeviceRecord, Fix, NetworkRecord, OpenRow, PlaceInfo, RangeSnapshot, ScanAp, ScanCell, ScanDevice } from './types.js'

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

function completeSnapshot(snapshot: RangeSnapshot): RangeSnapshot {
  return {
    ...snapshot,
    rooms: snapshot.rooms ?? [],
    movers: snapshot.movers ?? [],
    history: snapshot.history ?? [],
  }
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
      for (const ap of collapsed) {
        const hmac = bssidHmac(ap.bssid)
        const existingRow = await client.query<{ payload: Buffer; nonce: Buffer }>(
          'SELECT payload, nonce FROM networks WHERE bssid_hmac = $1 FOR UPDATE',
          [hmac],
        )
        const existing = existingRow.rowCount ? asRecord(existingRow.rows[0]) : null
        const merged = mergeRecord(existing, ap, fix, seenAt)
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
        const merged = mergeDevice(existing, device, fix, seenAt)
        const sealed = encryptJson(merged)
        await client.query(
          `INSERT INTO devices (address_hmac, payload, nonce, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (address_hmac) DO UPDATE
           SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
          [hmac, sealed.payload, sealed.nonce],
        )
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
        ...snapshotFrom(heard, fix, scan.speedMps),
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
    if (cached) return unpack<RangeSnapshot>(cached)
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
    const result = await this.db.query<{ payload: Buffer; nonce: Buffer }>(
      'SELECT payload, nonce FROM networks ORDER BY updated_at DESC',
    )
    return result.rows.map(asRecord)
  }

  async devices(): Promise<DeviceRecord[]> {
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

  async saveNetworkPlace(bssid: string, place: PlaceInfo): Promise<NetworkRecord> {
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

  async savePhonePlace(place: PlaceInfo): Promise<void> {
    await this.redis.set('place:phone', pack(place), 'EX', 86_400)
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
      }
    }
    return completeSnapshot(decryptJson<RangeSnapshot>(result.rows[0].payload, result.rows[0].nonce))
  }
}
