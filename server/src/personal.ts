import type pg from 'pg'
import { bssidHmac, decryptJson, encryptJson } from './crypto.js'
import { consentMatches, isAdult } from '../../shared/legal.js'
import { normalizeOwnedConsent, type OwnedConsent } from '../../shared/ownedNetwork.js'
import { cleanPostalCode } from '../../shared/postal.js'
import { indexedPlace, placeMatches, type IndexedPlace, type PlaceQuery, type StoredPlaceFields } from '../../shared/places.js'
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
  country?: string | null
  region?: string | null
  locality?: string | null
  postal?: string | null
  lastSeen: string
}

export interface UsPlace {
  city: string | null
  state: string | null
  zip: string | null
  countryCode: string | null
}

const DATASETS = new Set(['wifi', 'account'])

export function isAskDataset(value: unknown): value is 'wifi' | 'account' {
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

export async function ownedConsentFor(db: Db, userId: string): Promise<OwnedConsent> {
  const result = await db.query<{ owned_addresses: boolean | null; owned_details: boolean | null }>(
    `SELECT owned_addresses, owned_details FROM users WHERE id = $1`,
    [userId],
  )
  const row = result.rows[0]
  return normalizeOwnedConsent({
    addresses: row?.owned_addresses === true,
    details: row?.owned_details === true,
  })
}

export async function saveOwnedConsent(db: Db, userId: string, consent: OwnedConsent): Promise<OwnedConsent> {
  const next = normalizeOwnedConsent(consent)
  await db.query(
    `UPDATE users SET owned_addresses = $2, owned_details = $3 WHERE id = $1`,
    [userId, next.addresses, next.details],
  )
  return next
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
  const place = indexedPlace(parts, cleanPostalCode)
  if (!place || place.country !== 'US') return null
  return {
    city: place.locality,
    state: place.region,
    zip: place.postal,
    countryCode: 'US',
  }
}

export function worldPlace(parts: {
  city: string | null
  state: string | null
  countryCode: string | null
  zip?: string | null
  postalCode?: string | null
} | null): IndexedPlace | null {
  return indexedPlace(parts, cleanPostalCode)
}

interface WifiBody extends StoredPlaceFields {
  bssid: string
  ssid: string
  channel: number | null
  security: string | null
  lat: number | null
  lon: number | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  region: string | null
  locality: string | null
  postal: string | null
}

export async function upsertWifiPlaces(
  db: Db,
  userId: string,
  networks: NetworkRecord[],
  place: IndexedPlace | UsPlace | null,
): Promise<void> {
  const located = normalizeIndexed(place)
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
      city: located.locality ?? previous?.city ?? null,
      state: located.region ?? previous?.state ?? null,
      zip: located.postal ?? previous?.zip ?? null,
      country: located.country,
      region: located.region ?? previous?.region ?? previous?.state ?? null,
      locality: located.locality ?? previous?.locality ?? previous?.city ?? null,
      postal: located.postal ?? previous?.postal ?? previous?.zip ?? null,
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
  place: IndexedPlace | UsPlace | null,
): Promise<void> {
  const located = normalizeIndexed(place)
  if (!located) return
  for (const device of devices) {
    const hmac = bssidHmac(device.address)
    const existing = await db.query<{ payload: Buffer; nonce: Buffer }>(
      'SELECT payload, nonce FROM bluetooth_places WHERE user_id = $1 AND address_hmac = $2',
      [userId, hmac],
    )
    const previous = existing.rows[0]
      ? decryptJson<StoredPlaceFields & { name: string | null; lat: number | null; lon: number | null }>(existing.rows[0].payload, existing.rows[0].nonce)
      : null
    const sealed = encryptJson({
      name: (device.name ? device.name.slice(0, 200) : null) ?? previous?.name ?? null,
      lat: device.bestLat ?? device.lastLat ?? previous?.lat ?? null,
      lon: device.bestLon ?? device.lastLon ?? previous?.lon ?? null,
      city: located.locality ?? previous?.city ?? null,
      state: located.region ?? previous?.state ?? null,
      zip: located.postal ?? previous?.zip ?? null,
      country: located.country,
      region: located.region ?? previous?.region ?? previous?.state ?? null,
      locality: located.locality ?? previous?.locality ?? previous?.city ?? null,
      postal: located.postal ?? previous?.postal ?? previous?.zip ?? null,
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

function normalizeIndexed(place: IndexedPlace | UsPlace | null): IndexedPlace | null {
  if (!place) return null
  if ('country' in place) return place.country ? place : null
  return indexedPlace({
    countryCode: place.countryCode,
    state: place.state,
    city: place.city,
    zip: place.zip,
  }, cleanPostalCode)
}

export async function searchWifi(
  db: Db,
  userId: string,
  filter: PlaceQuery,
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
    if (!placeMatches(body, filter)) return []
    const place = {
      country: body.country ?? (body.city || body.state || body.zip ? 'US' : null),
      region: body.region ?? body.state,
      locality: body.locality ?? body.city,
      postal: body.postal ?? body.zip,
    }
    return [{
      bssid: body.bssid,
      ssid: body.ssid,
      channel: numberOrNull(body.channel),
      security: body.security,
      lat: numberOrNull(body.lat),
      lon: numberOrNull(body.lon),
      city: place.locality,
      state: place.region,
      zip: place.postal,
      country: place.country,
      region: place.region,
      locality: place.locality,
      postal: place.postal,
      lastSeen: new Date(row.last_seen).toISOString(),
    }]
  }).slice(0, 200)
}

export async function askExcerpt(
  db: Db,
  userId: string,
  _dataset: 'wifi',
  question: string,
): Promise<string> {
  const tokens = question.toLowerCase().split(/[^a-z0-9.-]+/).filter((token) => token.length > 2).slice(0, 8)
  const result = await db.query<{ payload: Buffer; nonce: Buffer }>(
    `SELECT payload, nonce FROM wifi_places
     WHERE user_id = $1
     ORDER BY last_seen DESC
     LIMIT 80`,
    [userId],
  )
  const rows = result.rows.map((row) => decryptJson<WifiBody>(row.payload, row.nonce))
  const matched = rows.filter((row) => {
    const blob = [row.ssid, row.country, row.region, row.locality, row.city, row.state, row.postal, row.zip, row.security].join(' ').toLowerCase()
    return tokens.some((token) => blob.includes(token))
  })
  const chosen = (matched.length > 0 ? matched : rows).slice(0, 40)
  return lines(chosen.map((row) => [row.ssid, row.country, row.region ?? row.state, row.locality ?? row.city, row.postal ?? row.zip, row.security, row.channel].filter(Boolean).join(' ')))
}

export async function wipePersonal(db: Db, userId: string): Promise<void> {
  await db.query(
    `UPDATE users SET owned_addresses = false, owned_details = false WHERE id = $1`,
    [userId],
  )
  for (const table of [
    'device_profiles',
    'lan_hosts',
    'dns_queries',
    'wifi_places',
    'bluetooth_places',
    'bookmarks',
    'sites',
    'dispositions',
    'reviews',
    'lan_previous',
    'lan_changes',
    'lan_saved',
    'lan_inventories',
    'critical_alerts',
    'scans',
    'scanners',
    'tombstones',
    'site_walks',
    'labels',
    'questions',
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

function lines(rows: string[]): string {
  if (rows.length === 0) return 'No records.'
  return rows.join('\n')
}
