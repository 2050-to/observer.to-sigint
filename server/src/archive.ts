import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { bssidHmac, decryptJson, encryptJson } from './crypto.js'
import { compactScan, withoutTombstones, type CompactScan } from '../../shared/replay.js'
import { observationWindow, type ObservationWindow } from '../../shared/retention.js'
import type { ScanAp, ScanDevice } from './types.js'

type Db = Pick<pg.Pool | pg.PoolClient, 'query'>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function optionalUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null
}

export async function tombstoneSet(db: Db, userId: string): Promise<Set<string>> {
  const result = await db.query<{ subject_hmac: Buffer }>(
    'SELECT subject_hmac FROM tombstones WHERE user_id = $1',
    [userId],
  )
  return new Set(result.rows.map((row) => row.subject_hmac.toString('hex')))
}

export function isHidden(hidden: Set<string>, kind: 'ap' | 'adv', id: string): boolean {
  return hidden.has(bssidHmac(`${kind}:${id.trim().toLowerCase()}`).toString('hex'))
}

export async function rememberScanner(db: Db, userId: string, scannerId: string | null, label: string | null): Promise<void> {
  if (!scannerId) return
  const sealed = encryptJson({ label: label?.trim().slice(0, 80) || 'Scanner' })
  await db.query(
    `INSERT INTO scanners (user_id, scanner_id, payload, nonce, last_seen_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, scanner_id) DO UPDATE
     SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, last_seen_at = now()`,
    [userId, scannerId, sealed.payload, sealed.nonce],
  )
}

export async function saveCompactScan(db: Db, userId: string, scan: {
  scanId: string
  driveId?: string | null
  scannerId?: string | null
  scannerLabel?: string | null
  observedAt: string
  lat: number | null
  lon: number | null
  networks: ScanAp[]
  devices?: ScanDevice[]
}): Promise<void> {
  const compact = compactScan({
    scanId: scan.scanId,
    driveId: optionalUuid(scan.driveId),
    scannerId: optionalUuid(scan.scannerId),
    scannerLabel: scan.scannerLabel,
    observedAt: scan.observedAt,
    lat: scan.lat,
    lon: scan.lon,
    networks: scan.networks,
    devices: scan.devices,
  })
  const sealed = encryptJson(compact)
  await rememberScanner(db, userId, compact.scannerId, compact.scannerLabel)
  await db.query(
    `INSERT INTO scans (user_id, scan_id, drive_id, scanner_id, observed_at, payload, nonce)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, scan_id) DO NOTHING`,
    [userId, scan.scanId, compact.driveId, compact.scannerId, scan.observedAt, sealed.payload, sealed.nonce],
  )
}

export async function replayScans(db: Db, userId: string, from: string, to: string): Promise<CompactScan[]> {
  const hidden = await tombstoneSet(db, userId)
  const result = await db.query<{ payload: Buffer; nonce: Buffer }>(
    `SELECT payload, nonce FROM scans
     WHERE user_id = $1 AND observed_at >= $2 AND observed_at <= $3
     ORDER BY observed_at ASC
     LIMIT 500`,
    [userId, from, to],
  )
  return result.rows.flatMap((row) => {
    try {
      const scan = decryptJson<CompactScan>(row.payload, row.nonce)
      return [withoutTombstones(scan, (kind, id) => isHidden(hidden, kind, id))]
    } catch {
      return []
    }
  })
}

export async function deleteDrive(db: Db, userId: string, driveId: string): Promise<number> {
  const result = await db.query('DELETE FROM scans WHERE user_id = $1 AND drive_id = $2', [userId, driveId])
  return result.rowCount ?? 0
}

export async function hideSubject(db: Db, userId: string, kind: 'ap' | 'adv', id: string): Promise<void> {
  const table = kind === 'ap' ? 'networks' : 'devices'
  const column = kind === 'ap' ? 'bssid_hmac' : 'address_hmac'
  const place = kind === 'ap' ? 'wifi_places' : 'bluetooth_places'
  const hmac = bssidHmac(id.trim().toLowerCase())
  const tomb = bssidHmac(`${kind}:${id.trim().toLowerCase()}`)
  await db.query(
    `INSERT INTO tombstones (user_id, subject_hmac, kind)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [userId, tomb, kind],
  )
  await db.query(`DELETE FROM ${table} WHERE user_id = $1 AND ${column} = $2`, [userId, hmac])
  await db.query(`DELETE FROM ${place} WHERE user_id = $1 AND ${column === 'bssid_hmac' ? 'bssid_hmac' : 'address_hmac'} = $2`, [userId, hmac])
}

export async function retentionFor(db: Db, userId: string): Promise<{ observationDays: number; reviewDays: number }> {
  const result = await db.query<{ observation_retention_days: number; review_retention_days: number }>(
    'SELECT observation_retention_days, review_retention_days FROM users WHERE id = $1',
    [userId],
  )
  return {
    observationDays: result.rows[0]?.observation_retention_days ?? 90,
    reviewDays: result.rows[0]?.review_retention_days ?? 365,
  }
}

export async function saveRetention(db: Db, userId: string, days: ObservationWindow): Promise<void> {
  await db.query('UPDATE users SET observation_retention_days = $2 WHERE id = $1', [userId, days])
}

export function parseObservationWindow(value: unknown): ObservationWindow | null {
  return observationWindow(value)
}

export async function pruneRetention(db: Db): Promise<void> {
  await db.query(
    `DELETE FROM scans USING users
     WHERE scans.user_id = users.id
       AND scans.observed_at < now() - make_interval(days => users.observation_retention_days)`,
  )
  await db.query(
    `DELETE FROM site_walks USING users
     WHERE site_walks.user_id = users.id
       AND site_walks.walked_at < now() - make_interval(days => users.observation_retention_days)`,
  )
  await db.query(
    `DELETE FROM lan_inventories USING users
     WHERE lan_inventories.user_id = users.id
       AND lan_inventories.observed_at < now() - make_interval(days => users.observation_retention_days)`,
  )
  await db.query(
    `DELETE FROM reviews USING users
     WHERE reviews.user_id = users.id
       AND reviews.built_at < now() - make_interval(days => users.review_retention_days)`,
  )
}

export interface StoredLabel {
  id: string
  name: string
}

export async function listLabels(db: Db, userId: string): Promise<StoredLabel[]> {
  const result = await db.query<{ payload: Buffer; nonce: Buffer }>(
    'SELECT payload, nonce FROM labels WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 500',
    [userId],
  )
  return result.rows.flatMap((row) => {
    try {
      const label = decryptJson<StoredLabel>(row.payload, row.nonce)
      if (!label.id || !label.name) return []
      return [{ id: label.id, name: label.name }]
    } catch {
      return []
    }
  })
}

export async function saveLabels(db: Db, userId: string, labels: StoredLabel[]): Promise<void> {
  for (const label of labels.slice(0, 500)) {
    const id = label.id.trim().toLowerCase()
    const name = label.name.trim().slice(0, 120)
    if (!id || id.length > 200) continue
    if (!name) {
      await db.query('DELETE FROM labels WHERE user_id = $1 AND subject_hmac = $2', [userId, bssidHmac(`label:${id}`)])
      continue
    }
    const sealed = encryptJson({ id, name })
    await db.query(
      `INSERT INTO labels (user_id, subject_hmac, payload, nonce, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, subject_hmac) DO UPDATE
       SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
      [userId, bssidHmac(`label:${id}`), sealed.payload, sealed.nonce],
    )
  }
}

export interface StoredQuestion {
  id: string
  askedAt: string
  question: string
  answer: string
  excerpt: string
}

export async function listQuestions(db: Db, userId: string): Promise<StoredQuestion[]> {
  const result = await db.query<{ question_id: string; asked_at: Date; payload: Buffer; nonce: Buffer }>(
    `SELECT question_id, asked_at, payload, nonce FROM questions
     WHERE user_id = $1
     ORDER BY asked_at ASC
     LIMIT 50`,
    [userId],
  )
  return result.rows.flatMap((row) => {
    try {
      const body = decryptJson<Omit<StoredQuestion, 'id' | 'askedAt'>>(row.payload, row.nonce)
      return [{
        id: row.question_id,
        askedAt: new Date(row.asked_at).toISOString(),
        question: body.question,
        answer: body.answer,
        excerpt: body.excerpt,
      }]
    } catch {
      return []
    }
  })
}

export async function saveQuestion(db: Db, userId: string, question: string, answer: string, excerpt: string): Promise<StoredQuestion> {
  const id = randomUUID()
  const body = { question, answer, excerpt }
  const sealed = encryptJson(body)
  const result = await db.query<{ asked_at: Date }>(
    `INSERT INTO questions (user_id, question_id, asked_at, payload, nonce)
     VALUES ($1, $2, now(), $3, $4)
     RETURNING asked_at`,
    [userId, id, sealed.payload, sealed.nonce],
  )
  return {
    id,
    askedAt: new Date(result.rows[0]?.asked_at ?? new Date()).toISOString(),
    question,
    answer,
    excerpt,
  }
}
