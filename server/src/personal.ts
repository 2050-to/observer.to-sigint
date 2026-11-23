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

export interface DnsQueryRow {
  observedAt: string
  name: string
  type: string
  rcode: string | null
}

export interface UsPlace {
  city: string | null
  state: string | null
  zip: string | null
  countryCode: string | null
}

const DATASETS = new Set(['dns', 'wifi', 'bookmarks', 'search', 'browsing'])

export function isAskDataset(value: unknown): value is 'dns' | 'wifi' | 'bookmarks' | 'search' | 'browsing' {
  return typeof value === 'string' && DATASETS.has(value)
}

export async function consentFor(db: Db, userId: string): Promise<ConsentRow> {
  const result = await db.query<{
    born_on: string | null
    tos_version: string | null
    privacy_version: string | null
  }>(
    `SELECT born_on::text AS born_on, tos_version, privacy_version
     FROM users WHERE id = $1`,
    [userId],
  )
  const row = result.rows[0]
  if (!row) return { accepted: false, bornOn: null, tosVersion: null, privacyVersion: null }
  const consent = {
    bornOn: row.born_on,
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
  await db.query(
    `UPDATE users
     SET born_on = $2::date,
         tos_version = $3,
         tos_accepted_at = now(),
         privacy_version = $4,
         privacy_accepted_at = now()
     WHERE id = $1`,
    [userId, bornOn, tosVersion, privacyVersion],
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

export async function insertDns(db: Db, userId: string, queries: DnsQueryRow[]): Promise<number> {
  let count = 0
  for (const query of queries.slice(0, 200)) {
    if (!query.name || query.name.length > 253) continue
    const observedAt = new Date(query.observedAt)
    if (Number.isNaN(observedAt.getTime())) continue
    const sealed = encryptJson({
      name: query.name.toLowerCase(),
      type: query.type.slice(0, 16),
      rcode: query.rcode ? query.rcode.slice(0, 32) : null,
    })
    await db.query(
      `INSERT INTO dns_queries (id, user_id, observed_at, payload, nonce)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), userId, observedAt.toISOString(), sealed.payload, sealed.nonce],
    )
    count += 1
  }
  return count
}

export async function dnsWindow(db: Db, userId: string, from: string, to: string): Promise<DnsQueryRow[]> {
  const result = await db.query<{ observed_at: Date; payload: Buffer; nonce: Buffer }>(
    `SELECT observed_at, payload, nonce
     FROM dns_queries
     WHERE user_id = $1 AND observed_at >= $2 AND observed_at < $3
     ORDER BY observed_at
     LIMIT 5000`,
    [userId, from, to],
  )
  return result.rows.map((row) => {
    const body = decryptJson<{ name: string; type: string; rcode: string | null }>(row.payload, row.nonce)
    return {
      observedAt: new Date(row.observed_at).toISOString(),
      name: body.name,
      type: body.type,
      rcode: body.rcode,
    }
  })
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

export async function upsertWifiPlaces(
  db: Db,
  userId: string,
  networks: NetworkRecord[],
  place: UsPlace | null,
): Promise<void> {
  const located = usPlace(place)
  if (!located) return
  for (const network of networks) {
    const lat = network.bestLat ?? network.lastLat
    const lon = network.bestLon ?? network.lastLon
    await db.query(
      `INSERT INTO wifi_places (
         user_id, bssid_hmac, bssid, ssid, channel, security, lat, lon, city, state, zip, first_seen, last_seen
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (user_id, bssid_hmac) DO UPDATE SET
         bssid = EXCLUDED.bssid,
         ssid = EXCLUDED.ssid,
         channel = EXCLUDED.channel,
         security = EXCLUDED.security,
         lat = COALESCE(EXCLUDED.lat, wifi_places.lat),
         lon = COALESCE(EXCLUDED.lon, wifi_places.lon),
         city = COALESCE(EXCLUDED.city, wifi_places.city),
         state = COALESCE(EXCLUDED.state, wifi_places.state),
         zip = COALESCE(EXCLUDED.zip, wifi_places.zip),
         first_seen = LEAST(wifi_places.first_seen, EXCLUDED.first_seen),
         last_seen = GREATEST(wifi_places.last_seen, EXCLUDED.last_seen)`,
      [
        userId,
        bssidHmac(network.bssid),
        network.bssid,
        (network.ssid || 'Hidden').slice(0, 200),
        network.channel,
        network.security,
        lat,
        lon,
        located.city,
        located.state,
        located.zip,
        network.firstSeen,
        network.lastSeen,
      ],
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
    await db.query(
      `INSERT INTO bluetooth_places (
         user_id, address_hmac, name, lat, lon, city, state, zip, first_seen, last_seen
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (user_id, address_hmac) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, bluetooth_places.name),
         lat = COALESCE(EXCLUDED.lat, bluetooth_places.lat),
         lon = COALESCE(EXCLUDED.lon, bluetooth_places.lon),
         city = COALESCE(EXCLUDED.city, bluetooth_places.city),
         state = COALESCE(EXCLUDED.state, bluetooth_places.state),
         zip = COALESCE(EXCLUDED.zip, bluetooth_places.zip),
         first_seen = LEAST(bluetooth_places.first_seen, EXCLUDED.first_seen),
         last_seen = GREATEST(bluetooth_places.last_seen, EXCLUDED.last_seen)`,
      [
        userId,
        bssidHmac(device.address),
        device.name ? device.name.slice(0, 200) : null,
        device.bestLat ?? device.lastLat,
        device.bestLon ?? device.lastLon,
        located.city,
        located.state,
        located.zip,
        device.firstSeen,
        device.lastSeen,
      ],
    )
  }
}

export async function searchWifi(
  db: Db,
  userId: string,
  filter: { zip: string | null; state: string | null; city: string | null },
): Promise<WifiPlaceRow[]> {
  const result = await db.query<{
    bssid: string
    ssid: string
    channel: number | null
    security: string | null
    lat: number | null
    lon: number | null
    city: string | null
    state: string | null
    zip: string | null
    last_seen: Date
  }>(
    `SELECT bssid, ssid, channel, security, lat, lon, city, state, zip, last_seen
     FROM wifi_places
     WHERE user_id = $1
       AND ($2::text IS NULL OR zip = $2)
       AND ($3::text IS NULL OR state = $3)
       AND ($4::text IS NULL OR lower(city) = lower($4))
     ORDER BY last_seen DESC
     LIMIT 200`,
    [userId, filter.zip, filter.state, filter.city],
  )
  return result.rows.map((row) => ({
    bssid: row.bssid,
    ssid: row.ssid,
    channel: row.channel,
    security: row.security,
    lat: row.lat,
    lon: row.lon,
    city: row.city,
    state: row.state,
    zip: row.zip,
    lastSeen: new Date(row.last_seen).toISOString(),
  }))
}

export async function saveBookmarks(db: Db, userId: string, items: { title: string; url: string }[]): Promise<number> {
  let count = 0
  for (const item of items.slice(0, 2000)) {
    await db.query(
      `INSERT INTO bookmarks (user_id, url_hmac, title, url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, url_hmac) DO UPDATE
       SET title = EXCLUDED.title, url = EXCLUDED.url, added_at = now()`,
      [userId, bssidHmac(item.url), item.title, item.url],
    )
    count += 1
  }
  return count
}

export async function listBookmarks(db: Db, userId: string, q: string): Promise<{ title: string; url: string }[]> {
  const needle = q.trim()
  const result = await db.query<{ title: string; url: string }>(
    `SELECT title, url FROM bookmarks
     WHERE user_id = $1
       AND ($2::text = '' OR title ILIKE $3 OR url ILIKE $3)
     ORDER BY added_at DESC
     LIMIT 200`,
    [userId, needle, `%${needle.replace(/[%_\\]/g, '')}%`],
  )
  return result.rows
}

export async function saveSearches(
  db: Db,
  userId: string,
  items: { query: string; engine: string | null; queriedAt: string }[],
): Promise<number> {
  let count = 0
  for (const item of items.slice(0, 2000)) {
    await db.query(
      `INSERT INTO search_queries (id, user_id, query, engine, queried_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), userId, item.query, item.engine, item.queriedAt],
    )
    count += 1
  }
  return count
}

export async function listSearches(db: Db, userId: string, q: string): Promise<{ query: string; engine: string | null; queriedAt: string }[]> {
  const needle = q.trim()
  const result = await db.query<{ query: string; engine: string | null; queried_at: Date }>(
    `SELECT query, engine, queried_at FROM search_queries
     WHERE user_id = $1
       AND ($2::text = '' OR query ILIKE $3)
     ORDER BY queried_at DESC
     LIMIT 200`,
    [userId, needle, `%${needle.replace(/[%_\\]/g, '')}%`],
  )
  return result.rows.map((row) => ({
    query: row.query,
    engine: row.engine,
    queriedAt: new Date(row.queried_at).toISOString(),
  }))
}

export async function saveVisits(
  db: Db,
  userId: string,
  items: { url: string; title: string | null; visitedAt: string }[],
): Promise<number> {
  let count = 0
  for (const item of items.slice(0, 2000)) {
    const host = hostOf(item.url)
    await db.query(
      `INSERT INTO page_visits (id, user_id, url, title, host, visited_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), userId, item.url, item.title, host, item.visitedAt],
    )
    count += 1
  }
  return count
}

export async function listVisits(db: Db, userId: string, q: string): Promise<{ url: string; title: string | null; visitedAt: string }[]> {
  const needle = q.trim()
  const result = await db.query<{ url: string; title: string | null; visited_at: Date }>(
    `SELECT url, title, visited_at FROM page_visits
     WHERE user_id = $1
       AND ($2::text = '' OR url ILIKE $3 OR COALESCE(title, '') ILIKE $3 OR COALESCE(host, '') ILIKE $3)
     ORDER BY visited_at DESC
     LIMIT 200`,
    [userId, needle, `%${needle.replace(/[%_\\]/g, '')}%`],
  )
  return result.rows.map((row) => ({
    url: row.url,
    title: row.title,
    visitedAt: new Date(row.visited_at).toISOString(),
  }))
}

export async function askExcerpt(
  db: Db,
  userId: string,
  dataset: 'dns' | 'wifi' | 'bookmarks' | 'search' | 'browsing',
  question: string,
): Promise<string> {
  const tokens = question.toLowerCase().split(/[^a-z0-9.-]+/).filter((token) => token.length > 2).slice(0, 8)
  if (dataset === 'dns') {
    const rows = await dnsWindow(db, userId, new Date(Date.now() - 7 * 86400000).toISOString(), new Date(Date.now() + 60000).toISOString())
    const matched = tokens.length === 0
      ? rows
      : rows.filter((row) => tokens.some((token) => row.name.includes(token)))
    return lines((matched.length > 0 ? matched : rows).slice(-40).map((row) => `${row.observedAt} ${row.type} ${row.name}`))
  }
  if (dataset === 'wifi') {
    const result = await db.query<{ ssid: string; city: string | null; state: string | null; zip: string | null; channel: number | null; security: string | null }>(
      `SELECT ssid, city, state, zip, channel, security FROM wifi_places
       WHERE user_id = $1
       ORDER BY last_seen DESC
       LIMIT 80`,
      [userId],
    )
    const matched = result.rows.filter((row) => {
      const blob = [row.ssid, row.city, row.state, row.zip, row.security].join(' ').toLowerCase()
      return tokens.some((token) => blob.includes(token))
    })
    const chosen = (matched.length > 0 ? matched : result.rows).slice(0, 40)
    return lines(chosen.map((row) => [row.ssid, row.city, row.state, row.zip, row.security, row.channel].filter(Boolean).join(' ')))
  }
  if (dataset === 'bookmarks') {
    const rows = await listBookmarks(db, userId, tokens[0] ?? '')
    return lines(rows.slice(0, 40).map((row) => `${row.title} ${row.url}`))
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
