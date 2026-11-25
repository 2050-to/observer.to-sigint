import { SAME_PLACE_M } from './accessPoints.js'
import { haversineMeters } from './geo.js'
import type { SecurityLabel } from './types.js'

export const SITE_WALK_GAP_MS = 30 * 60 * 1000
export const DEFAULT_SITE_RADIUS_M = 150
export const MIN_SITE_RADIUS_M = 50
export const MAX_SITE_RADIUS_M = 2000
export const MAX_WALK_POINTS = 500
export const WALK_POINT_GAP_M = 50
export const MIN_CORRIDOR_M = 50
export const MAX_CORRIDOR_M = 500
export const MAX_SITE_NAME = 80
export const MAX_CLAIMS = 500
export const MAX_HEARD = 2000
export const MAX_SITE_EVENTS = 200
export const DEFAULT_WALK_EVERY_DAYS = 7
export const MIN_WALK_EVERY_DAYS = 1
export const MAX_WALK_EVERY_DAYS = 90

export const SECURITY_RANK: Record<SecurityLabel, number> = {
  open: 0,
  wep: 1,
  owe: 2,
  wpa: 3,
  wpa2: 4,
  wpa3: 5,
  enterprise: 6,
}

export const SECURITY_LABELS: SecurityLabel[] = ['open', 'wep', 'owe', 'wpa', 'wpa2', 'wpa3', 'enterprise']

const SECURITY = new Set<SecurityLabel>(SECURITY_LABELS)

export interface SitePoint {
  lat: number
  lon: number
}

export type SiteBoundary =
  | { kind: 'radius'; lat: number; lon: number; radiusM: number }
  | { kind: 'walk'; points: SitePoint[]; corridorM: number }

export interface SiteClaim {
  ssid: string
  bssid: string | null
  baseline: SecurityLabel
}

export interface HeardBeacon {
  bssid: string
  ssid: string
  security: SecurityLabel
  channel?: number | null
}

export type SiteEventKind = 'arrived' | 'departed' | 'evil_twin' | 'channel' | 'open' | 'wep'
export type SiteSeverity = 'critical' | 'review'
export type SiteAlertKind = 'evil_twin' | 'channel' | 'open' | 'wep'

export interface SiteAlert {
  kind: SiteAlertKind
  episode: string
}

export interface SiteRadio {
  bssid: string
  ssid: string
  channel: number | null
  security: SecurityLabel
  firstSeen: string
  lastSeen: string
  baselineChannel: number | null
  misses: number
  departedAt: string | null
  alerts: SiteAlert[]
}

export interface SiteEvent {
  kind: SiteEventKind
  severity: SiteSeverity
  at: string
  bssid: string
  ssid: string
  channel: number | null
  detail: string
  episode: string
}

export interface EvilTwinNotice {
  site: string
  ssid: string
  bssid: string
  detail: string
}

export interface HeardAdvertiser {
  address: string
  name: string | null
}

export interface SiteWalk {
  startedAt: string
  walkedAt: string
  heard: HeardBeacon[]
  heardDevices: HeardAdvertiser[]
}

export interface SiteRecord {
  id: string
  name: string
  boundary: SiteBoundary
  claims: SiteClaim[]
  walkEveryDays?: number
  lastWalk: SiteWalk | null
  radios: SiteRadio[]
  events: SiteEvent[]
}

export interface SiteDraft {
  name: string
  boundary: SiteBoundary
  claims: SiteClaim[]
  walkEveryDays?: number
}

export interface SecurityChange {
  beacon: HeardBeacon
  baseline: SecurityLabel
}

export interface SiteDiff {
  heardAndExpected: HeardBeacon[]
  heardNotListed: HeardBeacon[]
  expectedMissing: SiteClaim[]
  securityChanges: SecurityChange[]
}

export interface SiteSighting {
  at: string
  lat: number | null
  lon: number | null
  heard: HeardBeacon[]
  heardDevices: HeardAdvertiser[]
}

export interface SiteFinding {
  site: string
  kind: 'not_listed' | 'missing' | 'security'
  label: string
  detail: string
}

export function ssidKey(ssid: string): string {
  return ssid.trim().toLowerCase()
}

export function securityRank(label: SecurityLabel): number {
  return SECURITY_RANK[label]
}

export function strongestSecurity(labels: SecurityLabel[]): SecurityLabel {
  return labels.reduce((best, label) => (securityRank(label) > securityRank(best) ? label : best), labels[0] ?? 'open')
}

export function baselineFor(claims: SiteClaim[], ssid: string): SecurityLabel | null {
  const key = ssidKey(ssid)
  if (!key) return null
  const matches = claims.filter((claim) => ssidKey(claim.ssid) === key)
  if (matches.length === 0) return null
  return strongestSecurity(matches.map((claim) => claim.baseline))
}

export function pointInSite(lat: number, lon: number, boundary: SiteBoundary): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
  if (boundary.kind === 'radius') {
    return haversineMeters(lat, lon, boundary.lat, boundary.lon) <= boundary.radiusM
  }
  return boundary.points.some((point) => haversineMeters(lat, lon, point.lat, point.lon) <= boundary.corridorM)
}

export function thinWalk(points: SitePoint[]): SitePoint[] {
  const kept: SitePoint[] = []
  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue
    if (point.lat < -90 || point.lat > 90 || point.lon < -180 || point.lon > 180) continue
    const last = kept[kept.length - 1]
    if (last && haversineMeters(last.lat, last.lon, point.lat, point.lon) < WALK_POINT_GAP_M) continue
    kept.push({ lat: point.lat, lon: point.lon })
    if (kept.length >= MAX_WALK_POINTS) break
  }
  return kept
}

export function walkBoundary(points: SitePoint[]): SiteBoundary | null {
  const thinned = thinWalk(points)
  if (thinned.length === 0) return null
  return { kind: 'walk', points: thinned, corridorM: SAME_PLACE_M }
}

export function siteDiff(site: SiteRecord): SiteDiff {
  const heard = site.lastWalk?.heard ?? []
  const bssidClaims = site.claims.filter((claim) => claim.bssid)
  const claimed = new Set(bssidClaims.map((claim) => claim.bssid))
  const heardIds = new Set(heard.map((beacon) => beacon.bssid))
  const heardNames = new Set(heard.map((beacon) => ssidKey(beacon.ssid)).filter((key) => key.length > 0))
  const heardAndExpected = heard.filter((beacon) => claimed.has(beacon.bssid))
  const heardNotListed = heard.filter((beacon) => !claimed.has(beacon.bssid))
  const expectedMissing = [
    ...bssidClaims.filter((claim) => claim.bssid && !heardIds.has(claim.bssid)),
    ...site.claims.filter((claim) => {
      if (claim.bssid) return false
      const key = ssidKey(claim.ssid)
      if (!key) return false
      if (bssidClaims.some((item) => ssidKey(item.ssid) === key)) return false
      return !heardNames.has(key)
    }),
  ]
  const securityChanges = heard.flatMap((beacon) => {
    const claimed = site.claims.find((claim) => claim.bssid === beacon.bssid)
    const baseline = claimed?.baseline ?? baselineFor(site.claims, beacon.ssid)
    if (!baseline || securityRank(beacon.security) >= securityRank(baseline)) return []
    return [{ beacon, baseline }]
  })
  return { heardAndExpected, heardNotListed, expectedMissing, securityChanges }
}

export function securityChangeText(change: SecurityChange): string {
  const name = change.beacon.ssid.trim() || 'Hidden network'
  if (change.beacon.security === 'open') return `${name} heard as open, baseline ${change.baseline}`
  if (change.beacon.security === 'wep') return `${name} heard as WEP, baseline ${change.baseline}`
  return `${name} heard as ${change.beacon.security}, weaker than ${change.baseline}`
}

function shortRadio(bssid: string): string {
  return bssid.replace(/:/g, '').slice(-4).toUpperCase()
}

export function siteFindings(site: SiteRecord, diff: SiteDiff = siteDiff(site)): SiteFinding[] {
  const findings: SiteFinding[] = []
  for (const beacon of diff.heardNotListed) {
    const name = beacon.ssid.trim() || `Hidden ${shortRadio(beacon.bssid)}`
    findings.push({
      site: site.name,
      kind: 'not_listed',
      label: `${name} is not on the list`,
      detail: beacon.bssid,
    })
  }
  for (const claim of diff.expectedMissing) {
    const name = claim.ssid.trim() || (claim.bssid ? `Radio ${shortRadio(claim.bssid)}` : 'Claimed network')
    findings.push({
      site: site.name,
      kind: 'missing',
      label: `${name} was expected and missing`,
      detail: claim.bssid ?? claim.ssid,
    })
  }
  for (const change of diff.securityChanges) {
    findings.push({
      site: site.name,
      kind: 'security',
      label: securityChangeText(change),
      detail: change.beacon.bssid,
    })
  }
  return findings
}

export function boundaryLabel(boundary: SiteBoundary): string {
  if (boundary.kind === 'radius') return `Radius ${Math.round(boundary.radiusM)} m`
  return `Walk of ${boundary.points.length} point${boundary.points.length === 1 ? '' : 's'}`
}

const BSSID = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i
const ALERT_KINDS = new Set<SiteAlertKind>(['evil_twin', 'channel', 'open', 'wep'])

export function observeSite(site: SiteRecord, sighting: SiteSighting): SiteRecord {
  if (sighting.lat == null || sighting.lon == null) return site
  if (!pointInSite(sighting.lat, sighting.lon, site.boundary)) return site
  const at = new Date(sighting.at)
  if (Number.isNaN(at.getTime())) return site
  const atIso = at.toISOString()
  const previous = site.lastWalk
  const gap = !previous || at.getTime() - Date.parse(previous.walkedAt) > SITE_WALK_GAP_MS
  let radios = site.radios ?? []
  let events = site.events ?? []
  if (gap && previous) {
    const closed = closeWalk(radios, events, previous, atIso)
    radios = closed.radios
    events = closed.events
  }
  for (const beacon of sighting.heard) {
    const applied = applyBeacon(radios, events, site.claims, beacon, atIso)
    radios = applied.radios
    events = applied.events
  }
  const heard = gap ? mergeBeacons([], sighting.heard) : mergeBeacons(previous.heard, sighting.heard)
  const heardDevices = gap ? mergeAdvertisers([], sighting.heardDevices) : mergeAdvertisers(previous.heardDevices, sighting.heardDevices)
  const lastWalk: SiteWalk = {
    startedAt: gap || !previous ? atIso : previous.startedAt,
    walkedAt: atIso,
    heard,
    heardDevices,
  }
  return { ...site, lastWalk, radios, events }
}

export function reviewSiteEvents(site: SiteRecord, since: string | null): SiteEvent[] {
  const claimed = new Set(site.claims.flatMap((claim) => claim.bssid ? [claim.bssid] : []))
  const sinceMs = since ? Date.parse(since) : Number.NaN
  return (site.events ?? []).filter((event) => {
    if (Number.isFinite(sinceMs) && Date.parse(event.at) <= sinceMs) return false
    if (event.severity === 'critical') return true
    if (event.kind === 'arrived') {
      const radio = (site.radios ?? []).find((item) => item.bssid === event.bssid)
      const first = !radio || radio.firstSeen === event.at
      if (first && claimed.has(event.bssid)) return false
      return true
    }
    if (event.kind === 'departed') return claimed.has(event.bssid)
    return false
  })
}

export function evilTwinNotices(before: SiteRecord, after: SiteRecord): EvilTwinNotice[] {
  const prior = new Set((before.events ?? []).map(eventIdentity))
  return (after.events ?? []).flatMap((event) => {
    if (event.kind !== 'evil_twin' || prior.has(eventIdentity(event))) return []
    return [{ site: after.name, ssid: event.ssid, bssid: event.bssid, detail: event.detail }]
  })
}

function eventIdentity(event: SiteEvent): string {
  return `${event.kind}:${event.bssid}:${event.episode}`
}

function closeWalk(radios: SiteRadio[], events: SiteEvent[], walk: SiteWalk, at: string): { radios: SiteRadio[]; events: SiteEvent[] } {
  const heardIds = new Set(walk.heard.map((beacon) => beacon.bssid))
  let nextEvents = events
  const nextRadios = radios.map((radio) => {
    if (radio.departedAt) return radio
    if (heardIds.has(radio.bssid)) return radio.misses === 0 ? radio : { ...radio, misses: 0 }
    const misses = radio.misses + 1
    if (misses < 2) return { ...radio, misses }
    nextEvents = pushEvent(nextEvents, {
      kind: 'departed',
      severity: 'review',
      at,
      bssid: radio.bssid,
      ssid: radio.ssid,
      channel: radio.channel,
      detail: `Last heard ${radio.lastSeen}`,
      episode: at,
    })
    return { ...radio, misses, departedAt: radio.lastSeen, alerts: [] }
  })
  return { radios: nextRadios, events: nextEvents }
}

function applyBeacon(
  radios: SiteRadio[],
  events: SiteEvent[],
  claims: SiteClaim[],
  beacon: HeardBeacon,
  at: string,
): { radios: SiteRadio[]; events: SiteEvent[] } {
  const bssid = beacon.bssid.trim().toLowerCase()
  if (!BSSID.test(bssid)) return { radios, events }
  const channel = asChannel(beacon.channel)
  const ssid = beacon.ssid.trim()
  const claimed = claims.some((claim) => claim.bssid === bssid)
  const existing = radios.find((radio) => radio.bssid === bssid)
  let radio: SiteRadio
  let nextEvents = events
  if (!existing) {
    radio = {
      bssid,
      ssid,
      channel,
      security: beacon.security,
      firstSeen: at,
      lastSeen: at,
      baselineChannel: claimed ? channel : null,
      misses: 0,
      departedAt: null,
      alerts: [],
    }
    nextEvents = pushEvent(nextEvents, {
      kind: 'arrived',
      severity: 'review',
      at,
      bssid,
      ssid,
      channel,
      detail: 'First heard at this site',
      episode: at,
    })
  } else if (existing.departedAt) {
    radio = {
      ...existing,
      ssid: ssid || existing.ssid,
      channel: channel ?? existing.channel,
      security: beacon.security,
      lastSeen: at,
      misses: 0,
      departedAt: null,
      baselineChannel: existing.baselineChannel ?? (claimed ? channel : null),
      alerts: [],
    }
    nextEvents = pushEvent(nextEvents, {
      kind: 'arrived',
      severity: 'review',
      at,
      bssid,
      ssid: radio.ssid,
      channel: radio.channel,
      detail: 'Heard again after leaving',
      episode: at,
    })
  } else {
    radio = {
      ...existing,
      ssid: ssid || existing.ssid,
      channel: channel ?? existing.channel,
      security: beacon.security,
      lastSeen: at,
      misses: 0,
      baselineChannel: existing.baselineChannel ?? (claimed ? channel ?? existing.channel : existing.baselineChannel),
    }
  }
  const synced = syncCritical(radio, nextEvents, claims, beacon, channel, at)
  return { radios: writeRadio(radios, synced.radio), events: synced.events }
}

function syncCritical(
  radio: SiteRadio,
  events: SiteEvent[],
  claims: SiteClaim[],
  beacon: HeardBeacon,
  channel: number | null,
  at: string,
): { radio: SiteRadio; events: SiteEvent[] } {
  const owned = claimedBssids(claims, beacon.ssid)
  let next = syncAlert(radio, events, 'evil_twin', owned != null && !owned.includes(radio.bssid), at, channel, `${radio.ssid || 'Network'} heard on a radio that is not claimed`)
  const claimed = claims.some((claim) => claim.bssid === radio.bssid)
  if (claimed && next.radio.baselineChannel == null && (channel ?? next.radio.channel) != null) {
    next = { ...next, radio: { ...next.radio, baselineChannel: channel ?? next.radio.channel } }
  }
  const baselineChannel = next.radio.baselineChannel
  const shifted = claimed && baselineChannel != null && channel != null && channel !== baselineChannel
  next = syncAlert(next.radio, next.events, 'channel', shifted, at, channel, `${radio.ssid || 'Claimed radio'} heard on channel ${channel}, baseline ${baselineChannel}`)
  const baseline = claimBaseline(claims, beacon)
  const weaker = baseline != null && securityRank(beacon.security) < securityRank(baseline)
  next = syncAlert(next.radio, next.events, 'open', weaker && beacon.security === 'open', at, channel, `${radio.ssid || 'Hidden network'} heard as open, baseline ${baseline}`)
  next = syncAlert(next.radio, next.events, 'wep', weaker && beacon.security === 'wep', at, channel, `${radio.ssid || 'Hidden network'} heard as WEP, baseline ${baseline}`)
  return next
}

function claimedBssids(claims: SiteClaim[], ssid: string): string[] | null {
  const key = ssidKey(ssid)
  if (!key) return null
  const matches = claims.flatMap((claim) => ssidKey(claim.ssid) === key && claim.bssid ? [claim.bssid] : [])
  return matches.length > 0 ? matches : null
}

function claimBaseline(claims: SiteClaim[], beacon: HeardBeacon): SecurityLabel | null {
  const claimed = claims.find((claim) => claim.bssid === beacon.bssid.trim().toLowerCase())
  if (claimed) return claimed.baseline
  return baselineFor(claims, beacon.ssid)
}

function syncAlert(
  radio: SiteRadio,
  events: SiteEvent[],
  kind: SiteAlertKind,
  active: boolean,
  at: string,
  channel: number | null,
  detail: string,
): { radio: SiteRadio; events: SiteEvent[] } {
  const open = radio.alerts.some((alert) => alert.kind === kind)
  if (active) {
    if (open) return { radio, events }
    return {
      radio: { ...radio, alerts: [...radio.alerts, { kind, episode: at }] },
      events: pushEvent(events, {
        kind,
        severity: 'critical',
        at,
        bssid: radio.bssid,
        ssid: radio.ssid,
        channel,
        detail,
        episode: at,
      }),
    }
  }
  if (!open) return { radio, events }
  return { radio: { ...radio, alerts: radio.alerts.filter((alert) => alert.kind !== kind) }, events }
}

function writeRadio(radios: SiteRadio[], radio: SiteRadio): SiteRadio[] {
  const index = radios.findIndex((item) => item.bssid === radio.bssid)
  const next = radios.slice()
  if (index < 0) next.push(radio)
  else next[index] = radio
  return capRadios(next)
}

function capRadios(radios: SiteRadio[]): SiteRadio[] {
  if (radios.length <= MAX_HEARD) return radios
  const drop = new Set<string>()
  let extra = radios.length - MAX_HEARD
  const departed = radios.filter((radio) => radio.departedAt).sort((a, b) => Date.parse(a.lastSeen) - Date.parse(b.lastSeen))
  for (const radio of departed) {
    if (extra <= 0) break
    drop.add(radio.bssid)
    extra -= 1
  }
  if (extra > 0) {
    const rest = radios.filter((radio) => !drop.has(radio.bssid)).sort((a, b) => Date.parse(a.lastSeen) - Date.parse(b.lastSeen))
    for (const radio of rest) {
      if (extra <= 0) break
      drop.add(radio.bssid)
      extra -= 1
    }
  }
  return radios.filter((radio) => !drop.has(radio.bssid))
}

function pushEvent(events: SiteEvent[], event: SiteEvent): SiteEvent[] {
  const next = [...events, event]
  return next.length > MAX_SITE_EVENTS ? next.slice(next.length - MAX_SITE_EVENTS) : next
}

function mergeBeacons(current: HeardBeacon[], incoming: HeardBeacon[]): HeardBeacon[] {
  const byBssid = new Map(current.map((beacon) => [beacon.bssid.trim().toLowerCase(), beacon]))
  for (const beacon of incoming) {
    const bssid = beacon.bssid.trim().toLowerCase()
    if (!BSSID.test(bssid)) continue
    const previous = byBssid.get(bssid)
    if (!previous) {
      byBssid.set(bssid, normalizeBeacon(beacon))
      continue
    }
    byBssid.set(bssid, {
      bssid: beacon.bssid,
      ssid: beacon.ssid.trim() || previous.ssid,
      security: securityRank(beacon.security) < securityRank(previous.security) ? beacon.security : previous.security,
      channel: asChannel(beacon.channel) ?? previous.channel ?? null,
    })
  }
  return [...byBssid.values()]
}

function normalizeBeacon(beacon: HeardBeacon): HeardBeacon {
  return {
    bssid: beacon.bssid.trim().toLowerCase(),
    ssid: beacon.ssid.trim(),
    security: beacon.security,
    channel: asChannel(beacon.channel),
  }
}

function mergeAdvertisers(current: HeardAdvertiser[], incoming: HeardAdvertiser[]): HeardAdvertiser[] {
  const byAddress = new Map(current.map((device) => [device.address, device]))
  for (const device of incoming) {
    if (!device.address) continue
    const previous = byAddress.get(device.address)
    byAddress.set(device.address, {
      address: device.address,
      name: device.name?.trim() || previous?.name || null,
    })
  }
  return [...byAddress.values()]
}

function finite(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

function asChannel(value: unknown): number | null {
  const parsed = finite(value)
  if (parsed == null || !Number.isInteger(parsed) || parsed < 1 || parsed > 233) return null
  return parsed
}

function asPoint(value: unknown): SitePoint | null {
  if (!value || typeof value !== 'object') return null
  const point = value as { lat?: unknown; lon?: unknown }
  const lat = finite(point.lat)
  const lon = finite(point.lon)
  if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { lat, lon }
}

export function asBoundary(value: unknown): SiteBoundary | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { kind?: unknown; lat?: unknown; lon?: unknown; radiusM?: unknown; points?: unknown; corridorM?: unknown }
  if (record.kind === 'radius') {
    const lat = finite(record.lat)
    const lon = finite(record.lon)
    const radiusM = finite(record.radiusM)
    if (lat == null || lon == null || radiusM == null) return null
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
    if (radiusM < MIN_SITE_RADIUS_M || radiusM > MAX_SITE_RADIUS_M) return null
    return { kind: 'radius', lat, lon, radiusM }
  }
  if (record.kind === 'walk') {
    if (!Array.isArray(record.points) || record.points.length === 0 || record.points.length > MAX_WALK_POINTS) return null
    const points: SitePoint[] = []
    for (const item of record.points) {
      const point = asPoint(item)
      if (!point) return null
      points.push(point)
    }
    const corridorM = record.corridorM == null ? SAME_PLACE_M : finite(record.corridorM)
    if (corridorM == null || corridorM < MIN_CORRIDOR_M || corridorM > MAX_CORRIDOR_M) return null
    return { kind: 'walk', points, corridorM }
  }
  return null
}

export function asClaims(value: unknown): SiteClaim[] | null {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > MAX_CLAIMS) return null
  const claims: SiteClaim[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const claim = asClaim(item)
    if (!claim) return null
    const key = claim.bssid ?? `ssid:${ssidKey(claim.ssid)}`
    if (seen.has(key)) continue
    seen.add(key)
    claims.push(claim)
  }
  return claims
}

function asClaim(value: unknown): SiteClaim | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { ssid?: unknown; bssid?: unknown; baseline?: unknown }
  if (typeof record.ssid !== 'string' || record.ssid.trim().length > 200) return null
  if (typeof record.baseline !== 'string' || !SECURITY.has(record.baseline as SecurityLabel)) return null
  const ssid = record.ssid.trim()
  let bssid: string | null = null
  if (record.bssid != null) {
    if (typeof record.bssid !== 'string' || !/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(record.bssid.trim())) return null
    bssid = record.bssid.trim().toLowerCase()
  }
  if (!ssid && !bssid) return null
  return { ssid, bssid, baseline: record.baseline as SecurityLabel }
}

function asHeard(value: unknown): HeardBeacon[] | null {
  if (!Array.isArray(value) || value.length > MAX_HEARD) return null
  const heard: HeardBeacon[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const beacon = item as { bssid?: unknown; ssid?: unknown; security?: unknown }
    if (typeof beacon.bssid !== 'string' || !/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(beacon.bssid.trim())) return null
    if (typeof beacon.ssid !== 'string' || beacon.ssid.length > 200) return null
    if (typeof beacon.security !== 'string' || !SECURITY.has(beacon.security as SecurityLabel)) return null
    heard.push({
      bssid: beacon.bssid.trim().toLowerCase(),
      ssid: beacon.ssid.trim(),
      security: beacon.security as SecurityLabel,
      channel: asChannel((beacon as { channel?: unknown }).channel),
    })
  }
  return heard
}

function asAdvertisers(value: unknown): HeardAdvertiser[] | null {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > MAX_HEARD) return null
  const devices: HeardAdvertiser[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const device = item as { address?: unknown; name?: unknown }
    if (typeof device.address !== 'string' || !device.address.trim() || device.address.length > 80) return null
    if (device.name != null && typeof device.name !== 'string') return null
    devices.push({
      address: device.address.trim().toLowerCase(),
      name: typeof device.name === 'string' && device.name.trim() ? device.name.trim().slice(0, 120) : null,
    })
  }
  return devices
}

export function walkEveryDays(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isInteger(parsed) || parsed < MIN_WALK_EVERY_DAYS || parsed > MAX_WALK_EVERY_DAYS) return null
  return parsed
}

export function walkIntervalDays(site: Pick<SiteRecord, 'walkEveryDays'>): number {
  return site.walkEveryDays ?? DEFAULT_WALK_EVERY_DAYS
}

export function walkDue(site: Pick<SiteRecord, 'walkEveryDays' | 'lastWalk'>, now = Date.now()): { dueAt: string; overdue: boolean } {
  const days = walkIntervalDays(site)
  if (!site.lastWalk) return { dueAt: new Date(now).toISOString(), overdue: true }
  const due = Date.parse(site.lastWalk.walkedAt) + days * 86_400_000
  return { dueAt: new Date(due).toISOString(), overdue: Number.isFinite(due) && now > due }
}

export function asSiteDraft(value: unknown): SiteDraft | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { name?: unknown; boundary?: unknown; claims?: unknown; walkEveryDays?: unknown }
  if (typeof record.name !== 'string') return null
  const name = record.name.trim()
  if (!name || name.length > MAX_SITE_NAME) return null
  const boundary = asBoundary(record.boundary)
  const claims = asClaims(record.claims)
  if (!boundary || !claims) return null
  if (record.walkEveryDays == null || record.walkEveryDays === '') return { name, boundary, claims }
  const every = walkEveryDays(record.walkEveryDays)
  if (every == null) return null
  return { name, boundary, claims, walkEveryDays: every }
}

function asRadios(value: unknown): SiteRadio[] {
  if (value == null) return []
  if (!Array.isArray(value)) return []
  const radios: SiteRadio[] = []
  for (const item of value) {
    const radio = asRadio(item)
    if (radio) radios.push(radio)
    if (radios.length >= MAX_HEARD) break
  }
  return radios
}

function asRadio(value: unknown): SiteRadio | null {
  if (!value || typeof value !== 'object') return null
  const radio = value as Partial<SiteRadio>
  if (typeof radio.bssid !== 'string' || !BSSID.test(radio.bssid.trim())) return null
  if (typeof radio.ssid !== 'string' || radio.ssid.length > 200) return null
  if (typeof radio.security !== 'string' || !SECURITY.has(radio.security as SecurityLabel)) return null
  if (typeof radio.firstSeen !== 'string' || Number.isNaN(Date.parse(radio.firstSeen))) return null
  if (typeof radio.lastSeen !== 'string' || Number.isNaN(Date.parse(radio.lastSeen))) return null
  return {
    bssid: radio.bssid.trim().toLowerCase(),
    ssid: radio.ssid.trim(),
    channel: asChannel(radio.channel),
    security: radio.security as SecurityLabel,
    firstSeen: radio.firstSeen,
    lastSeen: radio.lastSeen,
    baselineChannel: asChannel(radio.baselineChannel),
    misses: typeof radio.misses === 'number' && radio.misses > 0 ? Math.floor(radio.misses) : 0,
    departedAt: typeof radio.departedAt === 'string' && !Number.isNaN(Date.parse(radio.departedAt)) ? radio.departedAt : null,
    alerts: asAlerts(radio.alerts),
  }
}

function asAlerts(value: unknown): SiteAlert[] {
  if (!Array.isArray(value)) return []
  const alerts: SiteAlert[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const alert = item as { kind?: unknown; episode?: unknown }
    if (typeof alert.kind !== 'string' || !ALERT_KINDS.has(alert.kind as SiteAlertKind)) continue
    if (typeof alert.episode !== 'string' || !alert.episode || alert.episode.length > 80) continue
    alerts.push({ kind: alert.kind as SiteAlertKind, episode: alert.episode })
  }
  return alerts
}

function asEvents(value: unknown): SiteEvent[] {
  if (value == null || !Array.isArray(value)) return []
  const events: SiteEvent[] = []
  for (const item of value) {
    const event = asEvent(item)
    if (event) events.push(event)
  }
  return events.length > MAX_SITE_EVENTS ? events.slice(events.length - MAX_SITE_EVENTS) : events
}

function asEvent(value: unknown): SiteEvent | null {
  if (!value || typeof value !== 'object') return null
  const event = value as Partial<SiteEvent>
  if (event.kind !== 'arrived' && event.kind !== 'departed' && event.kind !== 'evil_twin' && event.kind !== 'channel' && event.kind !== 'open' && event.kind !== 'wep') return null
  if (event.severity !== 'critical' && event.severity !== 'review') return null
  if (typeof event.at !== 'string' || Number.isNaN(Date.parse(event.at))) return null
  if (typeof event.bssid !== 'string' || !BSSID.test(event.bssid.trim())) return null
  if (typeof event.ssid !== 'string' || event.ssid.length > 200) return null
  if (typeof event.detail !== 'string' || event.detail.length > 400) return null
  if (typeof event.episode !== 'string' || !event.episode || event.episode.length > 80) return null
  return {
    kind: event.kind,
    severity: event.severity,
    at: event.at,
    bssid: event.bssid.trim().toLowerCase(),
    ssid: event.ssid.trim(),
    channel: asChannel(event.channel),
    detail: event.detail,
    episode: event.episode,
  }
}

export function asStoredSite(id: string, value: unknown): SiteRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { name?: unknown; boundary?: unknown; claims?: unknown; walkEveryDays?: unknown; lastWalk?: unknown; radios?: unknown; events?: unknown }
  const draft = asSiteDraft({
    name: record.name,
    boundary: record.boundary,
    claims: record.claims,
    walkEveryDays: record.walkEveryDays,
  })
  if (!draft) return null
  const radios = asRadios(record.radios)
  const events = asEvents(record.events)
  if (record.lastWalk == null) return { id, ...draft, lastWalk: null, radios, events }
  if (!record.lastWalk || typeof record.lastWalk !== 'object') return null
  const walk = record.lastWalk as { startedAt?: unknown; walkedAt?: unknown; heard?: unknown; heardDevices?: unknown }
  if (typeof walk.startedAt !== 'string' || typeof walk.walkedAt !== 'string') return null
  if (Number.isNaN(Date.parse(walk.startedAt)) || Number.isNaN(Date.parse(walk.walkedAt))) return null
  const heard = asHeard(walk.heard)
  const heardDevices = asAdvertisers(walk.heardDevices)
  if (!heard || !heardDevices) return null
  return {
    id,
    ...draft,
    radios,
    events,
    lastWalk: { startedAt: walk.startedAt, walkedAt: walk.walkedAt, heard, heardDevices },
  }
}
