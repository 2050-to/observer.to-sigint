import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { bssidHmac, decryptJson, encryptJson } from './crypto.js'
import { consentMatches, isAdult } from '../../shared/legal.js'
import { cityName, isUnitedStates, stateCode, zipCode } from '../../shared/places.js'
import type { DeviceRecord, NetworkRecord } from './types.js'

type Db = Pick<pg.Pool | pg.PoolClient, 'query'>

export interface ConsentRow {
  accepted: boolean
  bornOn: string | null
  tosVersion: string | null
  privacyVersion: string | null
}

export interface WifiPlaceRow {
  bssid: string
  ssid: string
  channel: number | null
  security: string | null
  lat: number | null
  lon: number | null
  city: string | null
  state: string | null
  zip: string | null
  lastSeen: string
}

export interface UsPlace {
  city: string | null
  state: string | null
  zip: string | null
  countryCode: string | null
}

const DATASETS = new Set(['wifi', 'search', 'browsing'])

export function isAskDataset(value: unknown): value is 'wifi' | 'search' | 'browsing' {
  return typeof value === 'string' && DATASETS.has(value)
}

export async function consentFor(db: Db, userId: string): Promise<ConsentRow> {
  const result = await db.query<{
    born_payload: Buffer | null
    born_nonce: Buffer | null
    tos_version: string | null
    privacy_version: string | null
  }>(
    `SELECT born_payload, born_nonce, tos_version, privacy_version
     FROM users WHERE id = $1`,
    [userId],
  )
  const row = result.rows[0]
  if (!row) return { accepted: false, bornOn: null, tosVersion: null, privacyVersion: null }
  const consent = {
    bornOn: row.born_payload && row.born_nonce ? decryptJson<string>(row.born_payload, row.born_nonce) : null,
    tosVersion: row.tos_version,
    privacyVersion: row.privacy_version,
  }
  return { ...consent, accepted: consentMatches(consent) }
}

export async function acceptLegal(
  db: Db,
  userId: string,
  bornOn: string,
  tosVersion: string,
  privacyVersion: string,
): Promise<'ok' | 'underage'> {
  if (!isAdult(bornOn)) return 'underage'
  const sealed = encryptJson(bornOn)
  await db.query(
    `UPDATE users
     SET born_payload = $2,
         born_nonce = $3,
         tos_version = $4,
         tos_accepted_at = now(),
         privacy_version = $5,
         privacy_accepted_at = now()
     WHERE id = $1`,
    [userId, sealed.payload, sealed.nonce, tosVersion, privacyVersion],
  )
  return 'ok'
}

export async function deleteUser(db: Db, userId: string): Promise<void> {
  await db.query('DELETE FROM users WHERE id = $1', [userId])
}

export async function saveDeviceProfile(db: Db, userId: string, details: unknown): Promise<void> {
  const sealed = encryptJson(details)
  await db.query(
    `INSERT INTO device_profiles (user_id, payload, nonce, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE
     SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
    [userId, sealed.payload, sealed.nonce],
  )
}

export async function replaceLanHosts(db: Db, userId: string, hosts: { ip: string }[]): Promise<void> {
  await db.query('DELETE FROM lan_hosts WHERE user_id = $1', [userId])
  for (const host of hosts) {
    const sealed = encryptJson(host)
    await db.query(
      `INSERT INTO lan_hosts (user_id, host_hmac, payload, nonce)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, host_hmac) DO UPDATE
       SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
      [userId, bssidHmac(host.ip), sealed.payload, sealed.nonce],
    )
  }
}

export function usPlace(parts: {
  city: string | null
  state: string | null
  countryCode: string | null
  zip?: string | null
  postalCode?: string | null
} | null): UsPlace | null {
  if (!parts || !isUnitedStates(parts.countryCode)) return null
  return {
    city: cityName(parts.city),
    state: stateCode(parts.state),
    zip: zipCode(parts.zip ?? parts.postalCode ?? null),
    countryCode: 'US',
  }
}

interface WifiBody {
  bssid: string
  ssid: string
  channel: number | null
  security: string | null
  lat: number | null
  lon: number | null
  city: string | null
  state: string | null
  zip: string | null
}

export async function upsertWifiPlaces(
  db: Db,
  userId: string,
  networks: NetworkRecord[],
  place: UsPlace | null,
): Promise<void> {
  const located = usPlace(place)
  if (!located) return
  for (const network of networks) {
    const hmac = bssidHmac(network.bssid)
    const existing = await db.query<{ payload: Buffer; nonce: Buffer }>(
      'SELECT payload, nonce FROM wifi_places WHERE user_id = $1 AND bssid_hmac = $2',
      [userId, hmac],
    )
    const previous = existing.rows[0] ? decryptJson<WifiBody>(existing.rows[0].payload, existing.rows[0].nonce) : null
    const lat = network.bestLat ?? network.lastLat
    const lon = network.bestLon ?? network.lastLon
    const sealed = encryptJson({
      bssid: network.bssid,
      ssid: (network.ssid || 'Hidden').slice(0, 200),
      channel: network.channel,
      security: network.security,
      lat: lat ?? previous?.lat ?? null,
      lon: lon ?? previous?.lon ?? null,
      city: located.city ?? previous?.city ?? null,
      state: located.state ?? previous?.state ?? null,
      zip: located.zip ?? previous?.zip ?? null,
    } satisfies WifiBody)
    await db.query(
      `INSERT INTO wifi_places (user_id, bssid_hmac, payload, nonce, first_seen, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, bssid_hmac) DO UPDATE SET
         payload = EXCLUDED.payload,
         nonce = EXCLUDED.nonce,
         first_seen = LEAST(wifi_places.first_seen, EXCLUDED.first_seen),
         last_seen = GREATEST(wifi_places.last_seen, EXCLUDED.last_seen)`,
      [userId, hmac, sealed.payload, sealed.nonce, network.firstSeen, network.lastSeen],
    )
  }
}

export async function upsertBluetoothPlaces(
  db: Db,
  userId: string,
  devices: DeviceRecord[],
  place: UsPlace | null,
): Promise<void> {
  const located = usPlace(place)
  if (!located) return
  for (const device of devices) {
    const hmac = bssidHmac(device.address)
    const existing = await db.query<{ payload: Buffer; nonce: Buffer }>(
      'SELECT payload, nonce FROM bluetooth_places WHERE user_id = $1 AND address_hmac = $2',
      [userId, hmac],
    )
    const previous = existing.rows[0]
      ? decryptJson<{ name: string | null; lat: number | null; lon: number | null; city: string | null; state: string | null; zip: string | null }>(existing.rows[0].payload, existing.rows[0].nonce)
      : null
    const sealed = encryptJson({
      name: (device.name ? device.name.slice(0, 200) : null) ?? previous?.name ?? null,
      lat: device.bestLat ?? device.lastLat ?? previous?.lat ?? null,
      lon: device.bestLon ?? device.lastLon ?? previous?.lon ?? null,
      city: located.city ?? previous?.city ?? null,
      state: located.state ?? previous?.state ?? null,
      zip: located.zip ?? previous?.zip ?? null,
    })
    await db.query(
      `INSERT INTO bluetooth_places (user_id, address_hmac, payload, nonce, first_seen, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, address_hmac) DO UPDATE SET
         payload = EXCLUDED.payload,
         nonce = EXCLUDED.nonce,
         first_seen = LEAST(bluetooth_places.first_seen, EXCLUDED.first_seen),
         last_seen = GREATEST(bluetooth_places.last_seen, EXCLUDED.last_seen)`,
      [userId, hmac, sealed.payload, sealed.nonce, device.firstSeen, device.lastSeen],
    )
  }
}

export async function searchWifi(
  db: Db,
  userId: string,
  filter: { zip: string | null; state: string | null; city: string | null },
): Promise<WifiPlaceRow[]> {
  const result = await db.query<{ payload: Buffer; nonce: Buffer; last_seen: Date }>(
    `SELECT payload, nonce, last_seen
     FROM wifi_places
     WHERE user_id = $1
     ORDER BY last_seen DESC`,
    [userId],
  )
  return result.rows.flatMap((row) => {
    const body = decryptJson<WifiBody>(row.payload, row.nonce)
    if (filter.zip && body.zip !== filter.zip) return []
    if (filter.state && body.state !== filter.state) return []
    if (filter.city && (body.city ?? '').toLowerCase() !== filter.city.toLowerCase()) return []
    return [{
      bssid: body.bssid,
      ssid: body.ssid,
      channel: numberOrNull(body.channel),
      security: body.security,
      lat: numberOrNull(body.lat),
      lon: numberOrNull(body.lon),
      city: body.city,
      state: body.state,
      zip: body.zip,
      lastSeen: new Date(row.last_seen).toISOString(),
    }]
  }).slice(0, 200)
}

export async function saveSearches(
  db: Db,
  userId: string,
  items: { query: string; engine: string | null; queriedAt: string }[],
  replace = false,
): Promise<number> {
  if (replace) await db.query('DELETE FROM search_queries WHERE user_id = $1', [userId])
  let count = 0
  for (const item of items.slice(0, 2000)) {
    const sealed = encryptJson({ query: item.query, engine: item.engine })
    await db.query(
      `INSERT INTO search_queries (id, user_id, payload, nonce, queried_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), userId, sealed.payload, sealed.nonce, item.queriedAt],
    )
    count += 1
  }
  return count
}

export async function listSearches(db: Db, userId: string, q: string): Promise<{ query: string; engine: string | null; queriedAt: string }[]> {
  const needle = q.trim().toLowerCase()
  const result = await db.query<{ payload: Buffer; nonce: Buffer; queried_at: Date }>(
    `SELECT payload, nonce, queried_at FROM search_queries
     WHERE user_id = $1
     ORDER BY queried_at DESC`,
    [userId],
  )
  return result.rows.flatMap((row) => {
    const body = decryptJson<{ query: string; engine: string | null }>(row.payload, row.nonce)
    if (needle && !body.query.toLowerCase().includes(needle)) return []
    return [{
      query: body.query,
      engine: body.engine,
      queriedAt: new Date(row.queried_at).toISOString(),
    }]
  }).slice(0, 200)
}

export async function saveVisits(
  db: Db,
  userId: string,
  items: { url: string; title: string | null; visitedAt: string }[],
  replace = false,
): Promise<number> {
  if (replace) await db.query('DELETE FROM page_visits WHERE user_id = $1', [userId])
  let count = 0
  for (const item of items.slice(0, 2000)) {
    const sealed = encryptJson({ url: item.url, title: item.title, host: hostOf(item.url) })
    await db.query(
      `INSERT INTO page_visits (id, user_id, payload, nonce, visited_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), userId, sealed.payload, sealed.nonce, item.visitedAt],
    )
    count += 1
  }
  return count
}

export async function listVisits(db: Db, userId: string, q: string): Promise<{ url: string; title: string | null; visitedAt: string }[]> {
  const needle = q.trim().toLowerCase()
  const result = await db.query<{ payload: Buffer; nonce: Buffer; visited_at: Date }>(
    `SELECT payload, nonce, visited_at FROM page_visits
     WHERE user_id = $1
     ORDER BY visited_at DESC`,
    [userId],
  )
  return result.rows.flatMap((row) => {
    const body = decryptJson<{ url: string; title: string | null; host: string | null }>(row.payload, row.nonce)
    const haystack = `${body.url} ${body.title ?? ''} ${body.host ?? ''}`.toLowerCase()
    if (needle && !haystack.includes(needle)) return []
    return [{
      url: body.url,
      title: body.title,
      visitedAt: new Date(row.visited_at).toISOString(),
    }]
  }).slice(0, 200)
}

export async function askExcerpt(
  db: Db,
  userId: string,
  dataset: 'wifi' | 'search' | 'browsing',
  question: string,
): Promise<string> {
  const tokens = question.toLowerCase().split(/[^a-z0-9.-]+/).filter((token) => token.length > 2).slice(0, 8)
  if (dataset === 'wifi') {
    const result = await db.query<{ payload: Buffer; nonce: Buffer }>(
      `SELECT payload, nonce FROM wifi_places
       WHERE user_id = $1
       ORDER BY last_seen DESC
       LIMIT 80`,
      [userId],
    )
    const rows = result.rows.map((row) => decryptJson<WifiBody>(row.payload, row.nonce))
    const matched = rows.filter((row) => {
      const blob = [row.ssid, row.city, row.state, row.zip, row.security].join(' ').toLowerCase()
      return tokens.some((token) => blob.includes(token))
    })
    const chosen = (matched.length > 0 ? matched : rows).slice(0, 40)
    return lines(chosen.map((row) => [row.ssid, row.city, row.state, row.zip, row.security, row.channel].filter(Boolean).join(' ')))
  }
  if (dataset === 'search') {
    const rows = await listSearches(db, userId, tokens[0] ?? '')
    return lines(rows.slice(0, 40).map((row) => `${row.queriedAt} ${row.engine ?? ''} ${row.query}`))
  }
  const rows = await listVisits(db, userId, tokens[0] ?? '')
  return lines(rows.slice(0, 40).map((row) => `${row.visitedAt} ${row.title ?? ''} ${row.url}`))
}

export async function wipePersonal(db: Db, userId: string): Promise<void> {
  for (const table of [
    'device_profiles',
    'lan_hosts',
    'dns_queries',
    'wifi_places',
    'bluetooth_places',
    'bookmarks',
    'search_queries',
    'page_visits',
  ]) {
    await db.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId])
  }
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.slice(0, 253)
  } catch {
    return null
  }
}

function lines(rows: string[]): string {
  if (rows.length === 0) return 'No records.'
  return rows.join('\n')
}
