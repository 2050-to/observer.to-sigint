import assert from 'node:assert/strict'
import { siteReportMarkdown, type SiteReport } from '../../shared/siteReport.js'
import type { SiteRecord } from '../../shared/sites.js'

const site: SiteRecord = {
  id: 'site-1',
  name: 'Office',
  boundary: { kind: 'radius', lat: 47.62, lon: -122.35, radiusM: 150 },
  claims: [{ ssid: 'Office', bssid: 'aa:bb:cc:dd:ee:01', baseline: 'wpa2' }],
  lastWalk: {
    startedAt: '2026-11-24T18:00:00.000Z',
    walkedAt: '2026-11-24T18:05:00.000Z',
    heard: [
      { bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', security: 'open' },
      { bssid: 'aa:bb:cc:dd:ee:09', ssid: 'Guest', security: 'open' },
    ],
    heardDevices: [],
  },
  radios: [{
    bssid: 'aa:bb:cc:dd:ee:10',
    ssid: 'Office',
    channel: 6,
    security: 'open',
    firstSeen: '2026-11-24T18:00:00.000Z',
    lastSeen: '2026-11-24T18:05:00.000Z',
    baselineChannel: null,
    misses: 0,
    departedAt: null,
    alerts: [{ kind: 'evil_twin', episode: '2026-11-24T18:00:00.000Z' }],
  }],
  events: [{
    kind: 'evil_twin',
    severity: 'critical',
    at: '2026-11-24T18:00:00.000Z',
    bssid: 'aa:bb:cc:dd:ee:10',
    ssid: 'Office',
    channel: 6,
    detail: 'Office heard on a radio that is not claimed',
    episode: '2026-11-24T18:00:00.000Z',
  }],
}

const report: SiteReport = {
  generatedAt: '2026-11-24T19:00:00.000Z',
  site,
  openNetworks: [{ label: 'Guest', security: 'open' }],
  highRisk: [{ name: 'Office', reason: 'End of support', status: 'verified', note: 'Checked the model' }],
  dispositions: [{ name: 'Office', status: 'verified', note: 'Checked the model' }],
  ownedChanges: [{ kind: 'recorder_appeared', ip: '10.0.0.4', name: 'lobby camera', previousName: null }],
}

const markdown = siteReportMarkdown(report)
assert.match(markdown, /Walk coverage/)
assert.match(markdown, /## Events/)
assert.match(markdown, /not claimed/)
assert.match(markdown, /first seen 2026-11-24T18:00:00.000Z/)
assert.match(markdown, /Heard and not on the list/)
assert.match(markdown, /Guest/)
assert.match(markdown, /heard as open/)
assert.match(markdown, /High-risk research/)
assert.match(markdown, /Recorder name appeared: lobby camera/)
assert.match(markdown, /does not grant access to another account/)
assert.equal(markdown.includes('share token'), false)

console.log('site report checks passed')
