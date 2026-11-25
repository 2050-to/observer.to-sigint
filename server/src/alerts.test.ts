import assert from 'node:assert/strict'
import { alertShouldSend, alertText, criticalAlertText, criticalShouldSend, digestFromCatalog, findingKey, pendingCritical, underCriticalCap, ALERT_INTERVAL_MS, CRITICAL_DAILY_CAP } from './alerts.js'
import type { SiteRecord } from '../../shared/sites.js'
import { siteEventId, type Disposition } from '../../shared/disposition.js'
import type { CellRecord, DeviceRecord, NetworkRecord, OpenRow } from './types.js'

const now = Date.parse('2026-11-21T00:00:00Z')
assert.equal(alertShouldSend({ status: 'active', lastAlertAt: null, observationCount: 1, now }), true)
assert.equal(alertShouldSend({ status: 'active', lastAlertAt: null, observationCount: 0, now }), false)
assert.equal(alertShouldSend({ status: 'past_due', lastAlertAt: null, observationCount: 3, now }), false)
assert.equal(alertShouldSend({
  status: 'active',
  lastAlertAt: new Date(now - ALERT_INTERVAL_MS + 1000).toISOString(),
  observationCount: 2,
  now,
}), false)
assert.equal(alertShouldSend({
  status: 'active',
  lastAlertAt: new Date(now - ALERT_INTERVAL_MS - 1000).toISOString(),
  observationCount: 2,
  now,
}), true)

const network = {
  ssid: 'Cafe WiFi',
  hidden: false,
  bssid: 'aa:bb:cc:dd:ee:01',
  firstSeen: '2026-11-01T00:00:00Z',
  enrichment: {
    risk: { level: 'high', reasons: ['End of support in public records'] },
    queryTitle: 'Cafe radio',
  },
} as NetworkRecord
const device = {
  name: null,
  address: '11:22:33:44:55:66',
  firstSeen: '2026-10-01T00:00:00Z',
  enrichment: null,
} as DeviceRecord
const cell = { firstSeen: '2026-11-20T00:00:00Z' } as CellRecord
const openRow = {
  label: 'Cafe WiFi',
  security: 'open',
  lastSeen: '2026-11-20T00:00:00Z',
  address: '100 Main St',
  bssids: ['aa:bb:cc:dd:ee:01'],
} as OpenRow

const digest = digestFromCatalog({
  networks: [network],
  devices: [device],
  cells: [cell],
  openRows: [openRow],
  since: '2026-11-15T00:00:00Z',
})
assert.equal(digest.observationCount, 3)
assert.equal(digest.newAccessPoints, 0)
assert.equal(digest.newAdvertisers, 0)
assert.equal(digest.newCells, 1)
assert.equal(digest.openNetworks[0]?.place, '100 Main St')
assert.equal(digest.highRisk[0]?.name, 'Cafe WiFi')
assert.equal(digest.highRisk[0]?.reason, 'End of support in public records')
assert.equal(digest.siteFindings.length, 0)
assert.equal(digest.siteEvents.length, 0)
assert.equal(digest.ownedChanges.length, 0)

const closed: Disposition = { kind: 'ap', id: 'aa:bb:cc:dd:ee:01', status: 'patched', note: 'Updated' }
const queued = digestFromCatalog({
  networks: [network],
  devices: [device],
  cells: [cell],
  openRows: [openRow],
  since: '2026-11-15T00:00:00Z',
  dispositions: [closed],
})
assert.equal(queued.highRisk.length, 0)

const text = alertText(digest)
assert.match(text, /Observer\.to weekly review/)
assert.match(text, /Cafe WiFi/)
assert.match(text, /does not intercept protected Wi-Fi/)
assert.match(text, /Site findings/)
assert.match(text, /Site events/)
assert.match(text, /Owned-network changes/)
assert.equal(text.includes('aa:bb:cc:dd:ee:01'), false)
assert.equal(text.includes('11:22:33:44:55:66'), false)
assert.equal(text.includes('exploit'), false)

const site: SiteRecord = {
  id: 'site-1',
  name: 'Office',
  boundary: { kind: 'radius', lat: 47.62, lon: -122.35, radiusM: 150 },
  claims: [{ ssid: 'Office', bssid: 'aa:bb:cc:dd:ee:01', baseline: 'wpa2' }],
  lastWalk: null,
  radios: [],
  events: [
    {
      kind: 'arrived',
      severity: 'review',
      at: '2026-11-20T00:00:00.000Z',
      bssid: 'aa:bb:cc:dd:ee:11',
      ssid: 'Guest',
      channel: 6,
      detail: 'First heard at this site',
      episode: '2026-11-20T00:00:00.000Z',
    },
    {
      kind: 'evil_twin',
      severity: 'critical',
      at: '2026-11-20T00:00:00.000Z',
      bssid: 'aa:bb:cc:dd:ee:10',
      ssid: 'Office',
      channel: 6,
      detail: 'Office heard on a radio that is not claimed',
      episode: '2026-11-20T00:00:00.000Z',
    },
    {
      kind: 'departed',
      severity: 'review',
      at: '2026-11-18T00:00:00.000Z',
      bssid: 'aa:bb:cc:dd:ee:11',
      ssid: 'Guest',
      channel: 6,
      detail: 'Last heard earlier',
      episode: '2026-11-18T00:00:00.000Z',
    },
  ],
}
const reviewed = digestFromCatalog({
  networks: [network],
  devices: [device],
  cells: [cell],
  openRows: [openRow],
  since: '2026-11-15T00:00:00Z',
  sites: [site],
})
assert.equal(reviewed.siteEvents.some((event) => event.kind === 'evil_twin' && event.site === 'Office'), true)
assert.equal(reviewed.siteEvents.some((event) => event.kind === 'arrived'), true)
assert.equal(reviewed.siteEvents.some((event) => event.kind === 'departed'), false)
assert.match(alertText(reviewed), /Office heard on a radio that is not claimed/)
assert.equal(alertText(reviewed).includes('aa:bb:cc:dd:ee:10'), false)
assert.equal(digest.newRadios.some((radio) => radio.kind === 'cell' && radio.label === 'Tower'), true)
assert.match(text, /Tower/)
assert.equal(text.includes('aa:bb:cc:dd:ee:01'), false)

const closedRadio = digestFromCatalog({
  networks: [network],
  devices: [device],
  cells: [cell],
  openRows: [openRow],
  since: '2026-11-15T00:00:00Z',
  sites: [site],
  dispositions: [{ kind: 'ap', id: 'aa:bb:cc:dd:ee:10', status: 'accepted', note: '' }],
})
assert.equal(closedRadio.siteEvents.some((event) => event.bssid === 'aa:bb:cc:dd:ee:10'), false)
assert.equal(closedRadio.siteEvents.some((event) => event.kind === 'arrived'), true)

const closedEvent = digestFromCatalog({
  networks: [network],
  devices: [device],
  cells: [cell],
  openRows: [openRow],
  since: '2026-11-15T00:00:00Z',
  sites: [site],
  dispositions: [{
    kind: 'site_event',
    id: siteEventId(site.id, site.events[0]),
    status: 'false_match',
    note: '',
  }],
})
assert.equal(closedEvent.siteEvents.some((event) => event.kind === 'arrived'), false)

const walked: SiteRecord = {
  ...site,
  id: 'site-2',
  claims: [],
  events: [],
  lastWalk: {
    startedAt: '2026-11-20T00:00:00.000Z',
    walkedAt: '2026-11-20T00:00:00.000Z',
    heard: [{ ssid: 'Guest', bssid: 'aa:bb:cc:dd:ee:10', security: 'wpa2', channel: 6 }],
    heardDevices: [],
  },
}
const openFinding = digestFromCatalog({
  networks: [],
  devices: [],
  cells: [],
  openRows: [],
  since: null,
  sites: [walked],
})
assert.equal(openFinding.siteFindings.some((finding) => finding.detail === 'aa:bb:cc:dd:ee:10'), true)
const hiddenFinding = digestFromCatalog({
  networks: [],
  devices: [],
  cells: [],
  openRows: [],
  since: null,
  sites: [walked],
  dispositions: [{ kind: 'ap', id: 'aa:bb:cc:dd:ee:10', status: 'patched', note: '' }],
})
assert.equal(hiddenFinding.siteFindings.some((finding) => finding.detail === 'aa:bb:cc:dd:ee:10'), false)

const episode = site.events[1]
assert.ok(episode)
const key = findingKey(site.id, episode)
const firstPass = pendingCritical(site.id, site.events, new Set())
assert.deepEqual(firstPass.map((event) => event.kind), ['evil_twin'])
assert.equal(pendingCritical(site.id, site.events, new Set([key])).length, 0)
assert.equal(criticalShouldSend('active'), true)
assert.equal(criticalShouldSend('none'), false)
assert.equal(criticalShouldSend('past_due'), false)
assert.equal(alertShouldSend({
  status: 'active',
  lastAlertAt: new Date(now).toISOString(),
  observationCount: 2,
  now,
}), false)
assert.equal(underCriticalCap(CRITICAL_DAILY_CAP - 1), true)
assert.equal(underCriticalCap(CRITICAL_DAILY_CAP), false)
const critical = criticalAlertText([{ site: 'Office', detail: 'Office heard on a radio that is not claimed' }])
assert.match(critical, /Observer\.to site alert/)
assert.match(critical, /does not intercept protected Wi-Fi/)
assert.equal(critical.includes('aa:bb:cc:dd:ee:10'), false)

console.log('alert checks passed')
