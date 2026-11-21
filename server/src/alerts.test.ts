import assert from 'node:assert/strict'
import { alertShouldSend, alertText, digestFromCatalog, ALERT_INTERVAL_MS } from './alerts.js'
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
assert.equal(digest.newNetworks, 0)
assert.equal(digest.newDevices, 0)
assert.equal(digest.newCells, 1)
assert.equal(digest.openNetworks[0]?.place, '100 Main St')
assert.equal(digest.highRisk[0]?.name, 'Cafe WiFi')
assert.equal(digest.highRisk[0]?.reason, 'End of support in public records')

const text = alertText(digest)
assert.match(text, /Observer\.to weekly review/)
assert.match(text, /Cafe WiFi/)
assert.match(text, /does not intercept protected Wi-Fi/)
assert.equal(text.includes('aa:bb:cc:dd:ee:01'), false)
assert.equal(text.includes('11:22:33:44:55:66'), false)
assert.equal(text.includes('exploit'), false)

console.log('alert checks passed')
