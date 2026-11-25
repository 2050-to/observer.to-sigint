import assert from 'node:assert/strict'
import {
  asSiteDraft,
  asStoredSite,
  observeSite,
  reviewSiteEvents,
  siteDiff,
  siteFindings,
  thinWalk,
  walkBoundary,
  type HeardBeacon,
  type SiteRecord,
} from '../../shared/sites.js'

const office: SiteRecord = {
  id: 'site-1',
  name: 'Office',
  boundary: { kind: 'radius', lat: 47.62, lon: -122.35, radiusM: 150 },
  claims: [
    { ssid: 'Office', bssid: 'aa:bb:cc:dd:ee:01', baseline: 'wpa2' },
    { ssid: 'Office', bssid: 'aa:bb:cc:dd:ee:02', baseline: 'wpa3' },
  ],
  lastWalk: null,
  radios: [],
  events: [],
}

const at = '2026-11-24T18:00:00.000Z'
const inside = observeSite(office, {
  at,
  lat: 47.6201,
  lon: -122.3501,
  heard: [
    { bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', security: 'wpa2' },
    { bssid: 'aa:bb:cc:dd:ee:10', ssid: 'Office', security: 'open' },
    { bssid: 'aa:bb:cc:dd:ee:11', ssid: 'Guest', security: 'wpa2' },
  ],
  heardDevices: [],
})
const diff = siteDiff(inside)
assert.deepEqual(diff.heardAndExpected.map((beacon) => beacon.bssid), ['aa:bb:cc:dd:ee:01'])
assert.deepEqual(diff.heardNotListed.map((beacon) => beacon.bssid), ['aa:bb:cc:dd:ee:10', 'aa:bb:cc:dd:ee:11'])
assert.deepEqual(diff.expectedMissing.map((claim) => claim.bssid), ['aa:bb:cc:dd:ee:02'])
assert.equal(diff.securityChanges.length, 1)
assert.equal(diff.securityChanges[0]?.beacon.security, 'open')
assert.match(siteFindings(inside).find((item) => item.kind === 'security')?.label ?? '', /heard as open/)

const stronger = observeSite(office, {
  at,
  lat: 47.62,
  lon: -122.35,
  heard: [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', security: 'wpa3' }],
  heardDevices: [],
})
assert.equal(siteDiff(stronger).securityChanges.length, 0)
assert.equal(siteDiff(stronger).heardAndExpected.length, 1)

const wep = observeSite({
  ...office,
  claims: [{ ssid: 'Office', bssid: 'aa:bb:cc:dd:ee:01', baseline: 'wpa2' }],
}, {
  at,
  lat: 47.62,
  lon: -122.35,
  heard: [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', security: 'wep' }],
  heardDevices: [],
})
assert.match(siteFindings(wep).find((item) => item.kind === 'security')?.label ?? '', /WEP/)

const away = observeSite(office, {
  at,
  lat: 47.7,
  lon: -122.35,
  heard: [{ bssid: 'bb:bb:cc:dd:ee:99', ssid: 'Office', security: 'open' }],
  heardDevices: [],
})
assert.equal(away, office)
assert.equal(siteDiff(away).securityChanges.length, 0)
assert.equal(siteDiff(away).heardNotListed.length, 0)
assert.equal(siteFindings(away).some((item) => item.detail === 'bb:bb:cc:dd:ee:99'), false)

const later = observeSite(inside, {
  at: '2026-11-24T18:40:00.000Z',
  lat: 47.62,
  lon: -122.35,
  heard: [{ bssid: 'aa:bb:cc:dd:ee:02', ssid: 'Office', security: 'wpa3' }],
  heardDevices: [{ address: '11:22:33:44:55:66', name: 'Badge' }],
})
assert.deepEqual(later.lastWalk?.heard.map((beacon) => beacon.bssid), ['aa:bb:cc:dd:ee:02'])
assert.equal(later.lastWalk?.heardDevices[0]?.name, 'Badge')
assert.equal(siteDiff(later).heardAndExpected[0]?.bssid, 'aa:bb:cc:dd:ee:02')

const continued = observeSite(inside, {
  at: '2026-11-24T18:10:00.000Z',
  lat: 47.62,
  lon: -122.35,
  heard: [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', security: 'wpa' }],
  heardDevices: [],
})
assert.equal(continued.lastWalk?.heard.find((beacon) => beacon.bssid === 'aa:bb:cc:dd:ee:01')?.security, 'wpa')
assert.equal(continued.lastWalk?.startedAt, inside.lastWalk?.startedAt)

const nameOnly: SiteRecord = {
  ...office,
  claims: [{ ssid: 'Lobby', bssid: null, baseline: 'wpa2' }],
  lastWalk: {
    startedAt: at,
    walkedAt: at,
    heard: [{ bssid: 'aa:bb:cc:dd:ee:20', ssid: 'Cafe', security: 'open' }],
    heardDevices: [],
  },
}
const nameDiff = siteDiff(nameOnly)
assert.equal(nameDiff.expectedMissing.length, 1)
assert.equal(nameDiff.expectedMissing[0]?.ssid, 'Lobby')
assert.equal(nameDiff.heardNotListed.length, 1)

const walked = walkBoundary([
  { lat: 47.62, lon: -122.35 },
  { lat: 47.62001, lon: -122.35 },
  { lat: 47.63, lon: -122.35 },
])
assert.equal(walked?.kind, 'walk')
assert.equal(walked?.kind === 'walk' ? walked.points.length : 0, 2)
assert.equal(thinWalk(Array.from({ length: 600 }, (_, index) => ({ lat: 47 + index * 0.01, lon: -122 }))).length, 500)

const corridor: SiteRecord = {
  ...office,
  boundary: walked ?? office.boundary,
}
assert.notEqual(observeSite(corridor, {
  at,
  lat: 47.62,
  lon: -122.35,
  heard: [],
  heardDevices: [],
}), corridor)
assert.equal(observeSite(corridor, {
  at,
  lat: 47.7,
  lon: -122.35,
  heard: [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', security: 'open' }],
  heardDevices: [],
}), corridor)

assert.equal(asSiteDraft({ name: '  ', boundary: office.boundary, claims: [] }), null)
assert.equal(asSiteDraft({
  name: 'Lab',
  boundary: { kind: 'radius', lat: 10, lon: 10, radiusM: 10 },
  claims: [],
}), null)
assert.equal(asSiteDraft({
  name: 'Lab',
  boundary: office.boundary,
  claims: [{ ssid: 'Lab', bssid: 'aa:bb:cc:dd:ee:01', baseline: 'wpa2' }],
})?.claims.length, 1)

function minutesLater(minutes: number): string {
  return new Date(Date.parse(at) + minutes * 60 * 1000).toISOString()
}

function visit(site: SiteRecord, minutes: number, heard: HeardBeacon[]): SiteRecord {
  return observeSite(site, {
    at: minutesLater(minutes),
    lat: 47.62,
    lon: -122.35,
    heard,
    heardDevices: [],
  })
}

const claimed = visit(office, 0, [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', security: 'wpa2', channel: 6 }])
const claimedRadio = claimed.radios.find((radio) => radio.bssid === 'aa:bb:cc:dd:ee:01')
assert.equal(claimedRadio?.firstSeen, at)
assert.equal(claimedRadio?.lastSeen, at)
assert.equal(claimedRadio?.baselineChannel, 6)
assert.equal(claimed.events.some((event) => event.kind === 'channel'), false)
assert.equal(reviewSiteEvents(claimed, null).some((event) => event.bssid === 'aa:bb:cc:dd:ee:01' && event.kind === 'arrived'), false)

const stayed = visit(claimed, 10, [{ bssid: 'aa:bb:cc:dd:ee:02', ssid: 'Office', security: 'wpa3' }])
assert.equal(stayed.radios.find((radio) => radio.bssid === 'aa:bb:cc:dd:ee:01')?.departedAt, null)
assert.equal(stayed.radios.find((radio) => radio.bssid === 'aa:bb:cc:dd:ee:01')?.misses, 0)

const stranger = visit(office, 0, [
  { bssid: 'aa:bb:cc:dd:ee:10', ssid: 'Office', security: 'open', channel: 1 },
  { bssid: 'aa:bb:cc:dd:ee:11', ssid: 'Guest', security: 'wpa2', channel: 11 },
])
const twin = stranger.events.find((event) => event.kind === 'evil_twin')
assert.equal(twin?.severity, 'critical')
assert.equal(twin?.bssid, 'aa:bb:cc:dd:ee:10')
assert.equal(stranger.events.some((event) => event.kind === 'evil_twin' && event.bssid === 'aa:bb:cc:dd:ee:11'), false)
assert.equal(stranger.events.some((event) => event.kind === 'open' && event.bssid === 'aa:bb:cc:dd:ee:10'), true)
assert.equal(reviewSiteEvents(stranger, null).some((event) => event.kind === 'arrived' && event.bssid === 'aa:bb:cc:dd:ee:11'), true)

const hidden = visit(office, 0, [{ bssid: 'aa:bb:cc:dd:ee:12', ssid: '', security: 'wpa2' }])
assert.equal(hidden.events.some((event) => event.kind === 'evil_twin'), false)

const named = visit({
  ...office,
  claims: [{ ssid: 'Lobby', bssid: null, baseline: 'wpa2' }],
}, 0, [{ bssid: 'aa:bb:cc:dd:ee:20', ssid: 'Lobby', security: 'wpa2' }])
assert.equal(named.events.some((event) => event.kind === 'evil_twin'), false)
assert.equal(named.events.some((event) => event.kind === 'arrived'), true)

const shifted = visit(claimed, 10, [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', security: 'wpa2', channel: 11 }])
assert.equal(shifted.events.some((event) => event.kind === 'channel' && event.bssid === 'aa:bb:cc:dd:ee:01'), true)
const held = visit(shifted, 12, [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', security: 'wpa2', channel: 11 }])
assert.equal(held.events.filter((event) => event.kind === 'channel').length, 1)

const weaker = visit(claimed, 10, [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', security: 'wpa', channel: 6 }])
assert.equal(weaker.events.some((event) => event.severity === 'critical'), false)
assert.equal(siteDiff(weaker).securityChanges.length, 1)

const opened = visit(claimed, 10, [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', security: 'open', channel: 6 }])
assert.equal(opened.events.some((event) => event.kind === 'open' && event.severity === 'critical'), true)
const secured = visit(opened, 12, [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', security: 'wpa2', channel: 6 }])
assert.equal(secured.radios.find((radio) => radio.bssid === 'aa:bb:cc:dd:ee:01')?.alerts.some((alert) => alert.kind === 'open'), false)
const reopened = visit(secured, 14, [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', security: 'wep', channel: 6 }])
assert.equal(reopened.events.filter((event) => event.kind === 'wep').length, 1)

let presence = visit(office, 0, [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', security: 'wpa2', channel: 6 }])
presence = visit(presence, 31, [])
presence = visit(presence, 62, [])
assert.equal(presence.radios.find((radio) => radio.bssid === 'aa:bb:cc:dd:ee:01')?.departedAt, null)
assert.equal(presence.radios.find((radio) => radio.bssid === 'aa:bb:cc:dd:ee:01')?.misses, 1)
presence = visit(presence, 93, [])
const left = presence.radios.find((radio) => radio.bssid === 'aa:bb:cc:dd:ee:01')
assert.equal(left?.departedAt, at)
assert.equal(presence.events.some((event) => event.kind === 'departed' && event.bssid === 'aa:bb:cc:dd:ee:01'), true)
assert.equal(reviewSiteEvents(presence, null).some((event) => event.kind === 'departed'), true)

const returned = visit(presence, 124, [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', security: 'wpa2', channel: 6 }])
const back = returned.radios.find((radio) => radio.bssid === 'aa:bb:cc:dd:ee:01')
assert.equal(back?.departedAt, null)
assert.equal(back?.firstSeen, at)
assert.equal(returned.events.some((event) => event.kind === 'arrived' && event.detail === 'Heard again after leaving'), true)
assert.equal(reviewSiteEvents(returned, null).some((event) => event.detail === 'Heard again after leaving'), true)

let neighbor = visit(office, 0, [{ bssid: 'aa:bb:cc:dd:ee:11', ssid: 'Guest', security: 'wpa2' }])
neighbor = visit(neighbor, 31, [])
neighbor = visit(neighbor, 62, [])
neighbor = visit(neighbor, 93, [])
assert.equal(neighbor.events.some((event) => event.kind === 'departed'), true)
assert.equal(reviewSiteEvents(neighbor, null).some((event) => event.kind === 'departed'), false)

const parsed = asStoredSite('site-1', { name: office.name, boundary: office.boundary, claims: office.claims, lastWalk: null })
assert.deepEqual(parsed?.radios, [])
assert.deepEqual(parsed?.events, [])
const roundTrip = asStoredSite(stranger.id, JSON.parse(JSON.stringify(stranger)) as unknown)
assert.equal(roundTrip?.events.some((event) => event.kind === 'evil_twin'), true)

console.log('site checks passed')
