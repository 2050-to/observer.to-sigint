import assert from 'node:assert/strict'
import { readSession, signSession, verifySession } from './auth.js'
import { chooseLanSite } from '../../shared/lanSite.js'
import { placeMatches, storedPlace } from '../../shared/places.js'
import { compactScan, withoutTombstones } from '../../shared/replay.js'
import { reviewMarkdown } from '../../shared/reviewExport.js'
import { emptyReview } from '../../shared/review.js'
import { observationWindow } from '../../shared/retention.js'
import { shownReasons } from '../../shared/disposition.js'
import { walkDue } from '../../shared/sites.js'

process.env.JWT_SECRET ??= 'test-jwt-secret'

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'ada@example.com' }
const token = await signSession(user, '1h', '22222222-2222-4222-8222-222222222222')
assert.deepEqual(await verifySession(`Bearer ${token}`), user)
const claims = await readSession(`Bearer ${token}`)
assert.equal(claims?.sid, '22222222-2222-4222-8222-222222222222')
assert.equal(claims?.email, user.email)

const older = storedPlace({ city: 'Seattle', state: 'WA', zip: '98109' })
assert.equal(older.country, 'US')
assert.equal(placeMatches({ city: 'Seattle', state: 'WA', zip: '98109' }, { zip: '98109-1234', state: 'Washington' }), true)
assert.equal(placeMatches({ city: 'Seattle', state: 'WA', zip: '98109' }, { country: 'FR' }), false)
assert.equal(placeMatches({
  country: 'FR',
  region: 'Île-de-France',
  locality: 'Paris',
  postal: '75001',
}, { country: 'FR', region: 'Île-de-France', locality: 'Paris', postal: '75001' }), true)

const scan = compactScan({
  scanId: 'scan',
  observedAt: '2026-11-25T00:00:00Z',
  lat: 48.8,
  lon: 2.3,
  networks: [{
    ssid: 'Cafe',
    bssid: 'AA:BB:CC:DD:EE:10',
    rssi: -40,
    frequencyMhz: 2412,
    channel: 1,
    band: '2.4',
    channelWidthMhz: 20,
    centerFreq0: 2412,
    centerFreq1: 0,
    wifiStandard: 'n',
    capabilities: 'WPA2',
    securityTypes: ['PSK'],
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
    countryCode: 'FR',
    maxRateMbps: null,
    stationCount: 3,
    channelUtilization: 128,
    admissionCapacity: 10,
    vendorOuis: [],
  }],
  devices: [{ address: '11:22:33:44:55:66', addressType: 'public', name: 'Speaker', rssi: -50, txPower: null, serviceUuids: [] }],
})
assert.equal(scan.wifi[0]?.bssid, 'aa:bb:cc:dd:ee:10')
assert.equal(scan.wifi[0]?.stationCount, 3)
const hidden = withoutTombstones(scan, (kind, id) => kind === 'ap' && id === 'aa:bb:cc:dd:ee:10')
assert.equal(hidden.wifi.length, 0)
assert.equal(hidden.bluetooth.length, 1)

assert.equal(chooseLanSite(['a', 'b'], 'b', ['a']), 'b')
assert.equal(chooseLanSite(['a', 'b'], null, ['a']), 'a')
assert.equal(chooseLanSite(['a'], null, []), 'a')
assert.equal(chooseLanSite(['a', 'b'], null, []), null)
assert.equal(observationWindow(30), 30)
assert.equal(observationWindow(14), null)

const due = walkDue({ walkEveryDays: 7, lastWalk: null }, Date.parse('2026-11-25T00:00:00Z'))
assert.equal(due.overdue, true)

const reasons = shownReasons(
  ['This CVE is potentially applicable until verified'],
  { kind: 'ap', id: 'aa:bb:cc:dd:ee:10', status: 'verified', note: '', model: 'AP-1', firmware: '1.2.3', updatedAt: '2026-11-25' },
)
assert.match(reasons[0] ?? '', /Recorded model AP-1, firmware 1.2.3/)
assert.equal(reasons.some((reason) => /potentially applicable/i.test(reason)), false)

const markdown = reviewMarkdown({
  email: user.email,
  builtAt: '2026-11-25T00:00:00Z',
  reviewId: 'review-1',
  digest: {
    ...emptyReview(),
    newRadios: [{ kind: 'ap', id: 'aa:bb:cc:dd:ee:10', label: 'Cafe', firstSeen: '2026-11-25T00:00:00Z', lat: 1, lon: 2 }],
  },
})
assert.match(markdown, /ada@example.com/)
assert.match(markdown, /review-1/)
assert.match(markdown, /aa:bb:cc:dd:ee:10/)
assert.match(markdown, /not a shared link/)

console.log('evidence checks passed')
