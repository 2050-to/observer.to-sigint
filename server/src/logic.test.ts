import assert from 'node:assert/strict'
import { emptyCatalog, foldScans, reconcileCatalog, scanHearsSaved } from '../../shared/catalog.js'
import { catalogCsv } from '../../shared/csv.js'
import { decryptJson, encryptJson, bssidHmac } from './crypto.js'
import { timingFor } from './dwell.js'
import { eastNorthMeters, plottedHeight } from './height.js'
import { collapseScan, mergeRecord } from './merge.js'
import { classifySecurity, openRows } from './security.js'
import type { NetworkRecord, ScanAp } from './types.js'

process.env.DATA_KEY = Buffer.alloc(32, 7).toString('base64')
process.env.HMAC_KEY = Buffer.alloc(32, 9).toString('base64')

function ap(partial: Partial<ScanAp> & Pick<ScanAp, 'ssid' | 'bssid' | 'rssi' | 'capabilities'>): ScanAp {
  return {
    frequencyMhz: 2412,
    channel: 1,
    band: '2.4',
    channelWidthMhz: 20,
    centerFreq0: 0,
    centerFreq1: 0,
    wifiStandard: 'legacy',
    securityTypes: [],
    passpoint: false,
    responder80211mc: false,
    responder80211az: false,
    twtResponder: false,
    secureHeLtf: false,
    rangingFrameProtection: false,
    apMldMac: null,
    apMloLinkId: null,
    affiliatedLinks: [],
    operatorName: null,
    venueName: null,
    countryCode: 'US',
    maxRateMbps: 54,
    stationCount: null,
    channelUtilization: null,
    admissionCapacity: null,
    vendorOuis: [],
    ...partial,
  }
}

const fix = { lat: 47.62, lon: -122.35, accuracy: 5, altitudeM: 30, verticalAccuracyM: 3, relativeM: 0 }

const sealed = encryptJson({ ssid: 'Cafe' })
const opened = decryptJson<{ ssid: string }>(sealed.payload, sealed.nonce)
assert.equal(opened.ssid, 'Cafe')
assert.throws(() => decryptJson(Buffer.concat([sealed.payload.subarray(0, 4), Buffer.from([0]), sealed.payload.subarray(5)]), sealed.nonce))

const hmacA = bssidHmac('AA:BB:CC:DD:EE:FF')
const hmacB = bssidHmac('aa:bb:cc:dd:ee:ff')
assert.equal(hmacA.equals(hmacB), true)

const collapsed = collapseScan([
  ap({ ssid: 'Cafe', bssid: 'aa:bb:cc:dd:ee:01', rssi: -80, capabilities: '[ESS]' }),
  ap({ ssid: 'Cafe', bssid: 'AA:BB:CC:DD:EE:01', rssi: -40, capabilities: '[ESS]' }),
])
assert.equal(collapsed.length, 1)
assert.equal(collapsed[0].rssi, -40)

const first = mergeRecord(null, ap({ ssid: 'Cafe', bssid: 'aa:bb:cc:dd:ee:01', rssi: -40, capabilities: '[ESS]', channel: 6 }), fix, '2026-01-01T00:00:00.000Z')
const second = mergeRecord(first, ap({ ssid: '<unknown ssid>', bssid: 'aa:bb:cc:dd:ee:01', rssi: -70, capabilities: '[ESS]', channel: 11 }), { lat: 47.63, lon: -122.35, accuracy: 8, altitudeM: 42, verticalAccuracyM: 4, relativeM: 12 }, '2026-01-01T00:05:00.000Z')
assert.equal(second.ssid, 'Cafe')
assert.equal(second.hidden, false)
assert.equal(second.bestRssi, -40)
assert.equal(second.lastRssi, -70)
assert.equal(second.bestLat, 47.62)
assert.equal(second.lastLat, 47.63)
assert.equal(second.bestRelativeM, 0)
assert.equal(second.lastRelativeM, 12)
assert.equal(second.bestAltitudeM, 30)
assert.equal(second.lastAltitudeM, 42)
const climbed = mergeRecord(second, ap({ ssid: 'Cafe', bssid: 'aa:bb:cc:dd:ee:01', rssi: -30, capabilities: '[ESS]' }), { lat: 47.62, lon: -122.35, accuracy: 5, altitudeM: 42, verticalAccuracyM: 3, relativeM: 12 }, '2026-01-01T00:06:00.000Z')
assert.equal(climbed.bestRelativeM, 12)
assert.equal(plottedHeight({ altitudeM: 42, verticalAccuracyM: 3, relativeM: 0 }, 30)?.floor, 0)
assert.equal(plottedHeight({ altitudeM: 42, verticalAccuracyM: 3, relativeM: 12 }, 30)?.floor, 4)
assert.equal(plottedHeight({ altitudeM: 52, verticalAccuracyM: 20, relativeM: null }, 40)?.floor, null)
assert.equal(plottedHeight({ altitudeM: 52, verticalAccuracyM: 20, relativeM: null }, 40)?.uncertain, true)
assert.equal(plottedHeight({ altitudeM: 52, verticalAccuracyM: 8, relativeM: null }, 40)?.floor, 4)
const offset = eastNorthMeters(47.62, -122.35, 47.6216, -122.3493)
assert.ok(Math.abs(offset.north - 176.864) < 0.01)
assert.ok(Math.abs(offset.east - 52.52) < 0.05)
assert.equal(second.seenCount, 2)
assert.deepEqual(second.channels, [6, 11])
assert.equal(second.firstSeen, '2026-01-01T00:00:00.000Z')

assert.equal(classifySecurity('[WPA2-PSK-CCMP][ESS]', []), 'wpa2')
assert.equal(classifySecurity('[WPA2-EAP-CCMP][ESS]', []), 'enterprise')
assert.equal(classifySecurity('[OWE][ESS]', []), 'owe')
assert.equal(classifySecurity('[ESS]', []), 'open')

const drone = timingFor(91.4, 44.704)
assert.ok(Math.abs(drone.dwellSeconds - 4.088) < 0.01)
assert.equal(drone.scanPeriodSeconds, 30)
const walk = timingFor(91.4, 0.82)
assert.ok(Math.abs(walk.dwellSeconds - 222.93) < 0.1)
assert.ok(walk.scanPeriodSeconds > 200)
assert.equal(timingFor(91.4, null).scanPeriodSeconds, 30)

const records = [first, mergeRecord(null, ap({ ssid: 'Cafe', bssid: 'aa:bb:cc:dd:ee:02', rssi: -55, capabilities: '[ESS]' }), fix, '2026-01-01T00:00:00.000Z'), mergeRecord(null, ap({ ssid: 'Home', bssid: 'aa:bb:cc:dd:ee:03', rssi: -50, capabilities: '[WPA2-PSK-CCMP][ESS]' }), fix, '2026-01-01T00:00:00.000Z'), mergeRecord(null, ap({ ssid: '', bssid: 'aa:bb:cc:dd:ee:04', rssi: -65, capabilities: '[ESS]' }), fix, '2026-01-01T00:00:00.000Z')] as NetworkRecord[]
const rows = openRows(records)
assert.equal(rows.length, 2)
assert.equal(rows.find((row) => row.ssid === 'Cafe')?.bssidCount, 2)
assert.equal(rows.some((row) => row.ssid === 'Home'), false)
assert.equal(rows.find((row) => row.hidden)?.label, 'Hidden EE04')

const scanA = {
  scanId: '11111111-1111-4111-8111-111111111111',
  observedAt: '2026-01-01T00:00:00.000Z',
  lat: 47.62,
  lon: -122.35,
  accuracy: 5,
  altitudeM: 30,
  verticalAccuracyM: 3,
  relativeM: 0,
  speedMps: 1,
  networks: [ap({ ssid: 'Cafe', bssid: 'AA:BB:CC:DD:EE:01', rssi: -42, capabilities: '[ESS]' })],
}
const folded = foldScans(emptyCatalog(), [scanA, scanA])
assert.equal(folded.networks.length, 1)
assert.equal(folded.networks[0]?.seenCount, 1)
assert.equal(folded.networks[0]?.bestRssi, -42)
assert.equal(folded.syncedBssids.length, 0)
assert.equal(folded.foldedScanIds.length, 1)
const weaker = foldScans(folded, [{
  ...scanA,
  scanId: '22222222-2222-4222-8222-222222222222',
  networks: [ap({ ssid: '', bssid: 'aa:bb:cc:dd:ee:01', rssi: -70, capabilities: '[ESS]' })],
}])
assert.equal(weaker.networks[0]?.ssid, 'Cafe')
assert.equal(weaker.networks[0]?.bestRssi, -42)
assert.equal(weaker.networks[0]?.lastRssi, -70)
assert.equal(weaker.networks[0]?.seenCount, 2)
assert.equal(scanHearsSaved(weaker.networks, weaker.syncedBssids), false)
assert.equal(scanHearsSaved([{ bssid: 'aa:bb:cc:dd:ee:09' }], ['aa:bb:cc:dd:ee:01']), false)
assert.equal(scanHearsSaved([{ bssid: 'AA:BB:CC:DD:EE:01' }], ['aa:bb:cc:dd:ee:01']), true)
const pending = {
  ...scanA,
  scanId: '33333333-3333-4333-8333-333333333333',
  uploaded: false,
  networks: [ap({ ssid: 'New', bssid: 'aa:bb:cc:dd:ee:09', rssi: -40, capabilities: '[ESS]' })],
}
const reconciled = reconcileCatalog(
  { ...weaker, syncedBssids: ['aa:bb:cc:dd:ee:01'] },
  [{ ...scanA, uploaded: true }, pending],
  {
    networks: weaker.networks,
    snapshot: {
      heard: weaker.networks,
      radiusM: 91.4,
      phone: weaker.phone,
      speedMps: weaker.speedMps,
      dwellSeconds: 1,
      scanPeriodSeconds: 30,
    },
  },
)
assert.equal(reconciled.networks.find((network) => network.bssid === 'aa:bb:cc:dd:ee:09')?.ssid, 'New')
assert.equal(reconciled.syncedBssids.includes('aa:bb:cc:dd:ee:09'), false)
assert.equal(reconciled.networks.find((network) => network.bssid === 'aa:bb:cc:dd:ee:01')?.seenCount, 2)
assert.equal(catalogCsv(reconciled.networks).split('\n')[0], 'last_seen,best_rssi,lat,lon,ssid,bssid,channel,security,altitude_m,floor')

console.log('logic tests passed')
