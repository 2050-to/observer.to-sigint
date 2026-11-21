import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { emptyCatalog, foldScans, reconcileCatalog, scanHearsSaved, stampFixPostalCode } from '../../shared/catalog.js'
import { catalogBundleCsv, catalogCsv } from '../../shared/csv.js'
import { catalogForensicsMarkdown } from '../../shared/forensics.js'
import { haversineMeters } from '../../shared/geo.js'
import { distanceFromRssi } from '../../shared/pathloss.js'
import { collapseDevices, mergeCell, mergeDevice } from '../../shared/radios.js'
import { findRotatingAddresses } from '../../shared/rotation.js'
import { inferScene, stripPing } from '../../shared/scene.js'
import { segmentSignals, stackSignals } from '../../shared/sources.js'
import { estimateBuildings } from '../../shared/structure.js'
import { decryptJson, encryptJson, bssidHmac } from './crypto.js'
import { timingFor } from './dwell.js'
import { eastNorthMeters, plottedHeight } from './height.js'
import { collapseScan, mergeRecord } from './merge.js'
import { classifySecurity, openRows } from './security.js'
import type { DeviceEnrichment, NetworkRecord, Room, ScanAp, ScanCell, ScanDevice, ScenePing } from './types.js'

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
assert.deepEqual(second.postalCodes, [])
assert.equal(second.firstSeen, '2026-01-01T00:00:00.000Z')
const keptZip = mergeRecord({ ...second, postalCodes: ['98109'] }, ap({ ssid: 'Cafe', bssid: 'aa:bb:cc:dd:ee:01', rssi: -80, capabilities: '[ESS]' }), fix, '2026-01-01T00:07:00.000Z')
assert.deepEqual(keptZip.postalCodes, ['98109'])
const beacon = mergeDevice(null, {
  address: 'aa:bb:cc:00:00:10',
  addressType: 'public',
  name: 'Handset',
  rssi: -50,
  txPower: null,
  serviceUuids: [],
}, fix, '2026-01-01T00:00:00.000Z')
const beaconAgain = mergeDevice({ ...beacon, postalCodes: ['98109'] }, {
  address: 'aa:bb:cc:00:00:10',
  addressType: 'public',
  name: 'Handset',
  rssi: -60,
  txPower: null,
  serviceUuids: [],
}, fix, '2026-01-01T00:01:00.000Z')
assert.deepEqual(beaconAgain.postalCodes, ['98109'])

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
const elevated = {
  ...first,
  place: {
    address: '1 Pike St Seattle',
    crossStreets: ['Pike St'],
    elevationM: 56.1,
    fetchedAt: '2026-01-01T00:00:00.000Z',
  },
  postalCodes: ['98109'],
}
const otherZip = {
  ...mergeRecord(null, ap({ ssid: 'Cafe', bssid: 'aa:bb:cc:dd:ee:02', rssi: -60, capabilities: '[ESS]' }), fix, '2026-01-01T00:00:00.000Z'),
  postalCodes: ['98107'],
}
const elevatedRows = openRows([elevated, otherZip])
assert.equal(elevatedRows[0]?.elevationM, 56.1)
assert.deepEqual(elevatedRows[0]?.postalCodes, ['98109', '98107'])
const exported = catalogCsv([elevated])
assert.ok(exported.includes('56.1,98109'))
const deviceExport = catalogBundleCsv([elevated], { devices: [beaconAgain] })
assert.ok(deviceExport.includes('postal_codes'))
assert.ok(deviceExport.includes('98109'))

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
assert.deepEqual(foldScans({ ...emptyCatalog(), postalCodes: ['98101'] }, []).postalCodes, ['98101'])
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
      rooms: [],
      movers: [],
      history: [],
      postalCodes: ['98104'],
    },
  },
)
assert.equal(reconciled.networks.find((network) => network.bssid === 'aa:bb:cc:dd:ee:09')?.ssid, 'New')
assert.equal(reconciled.syncedBssids.includes('aa:bb:cc:dd:ee:09'), false)
assert.equal(reconciled.networks.find((network) => network.bssid === 'aa:bb:cc:dd:ee:01')?.seenCount, 2)
assert.deepEqual(reconciled.postalCodes, ['98104'])
const hereFix = { lat: 47.6204, lon: -122.3494, accuracy: 5, altitudeM: null, verticalAccuracyM: null, relativeM: null }
const awayFix = { lat: 47.63, lon: -122.3494, accuracy: 5, altitudeM: null, verticalAccuracyM: null, relativeM: null }
const inCell = { ...mergeRecord(null, ap({ ssid: 'Here', bssid: 'aa:bb:cc:dd:ee:21', rssi: -40, capabilities: '[ESS]' }), hereFix, '2026-01-01T00:00:00.000Z'), postalCodes: ['98109'] }
const outCell = { ...mergeRecord(null, ap({ ssid: 'Away', bssid: 'aa:bb:cc:dd:ee:22', rssi: -40, capabilities: '[ESS]' }), awayFix, '2026-01-01T00:00:00.000Z'), postalCodes: ['98109'] }
const awayDevice = mergeDevice(null, radio('aa:bb:cc:00:00:21', -40), awayFix, '2026-01-01T00:00:00.000Z')
const movedDevice = mergeDevice({ ...awayDevice, postalCodes: ['98109'] }, radio('aa:bb:cc:00:00:21', -70), hereFix, '2026-01-01T00:01:00.000Z')
const postalCatalog = { ...emptyCatalog(), postalCodes: ['98109'], phone: hereFix, networks: [inCell, outCell], devices: [movedDevice] }
const stamped = stampFixPostalCode(postalCatalog, hereFix.lat, hereFix.lon, '98107')
assert.deepEqual(stamped.postalCodes, ['98109', '98107'])
assert.deepEqual(stamped.networks[0]?.postalCodes, ['98109', '98107'])
assert.deepEqual(stamped.networks[1]?.postalCodes, ['98109'])
assert.deepEqual(stamped.devices[0]?.postalCodes, ['98109', '98107'])
assert.equal(stampFixPostalCode(postalCatalog, hereFix.lat, hereFix.lon, null), postalCatalog)
assert.equal(stampFixPostalCode(postalCatalog, hereFix.lat, hereFix.lon, '   '), postalCatalog)
const csvHeader = catalogCsv(reconciled.networks).split('\n')[0]
assert.ok(csvHeader.startsWith('last_seen,best_rssi,lat,lon,ssid,bssid,channel,security,altitude_m,floor,ground_elevation_m,postal_codes,manufacturer,model,category,tags'))
assert.ok(csvHeader.includes('vulnerability_ids'))
assert.ok(csvHeader.includes('remediation_prompt'))

assert.ok(Math.abs(distanceFromRssi(-59, -59) - 1) < 0.01)
assert.ok(Math.abs(distanceFromRssi(-81, -59) - 10) < 0.05)
assert.equal(distanceFromRssi(-120, -59), 30)

function rssiFor(distance: number): number {
  return -59 - 22 * Math.log10(distance)
}

function radio(address: string, rssi: number, addressType: 'public' | 'random' = 'random', extra: Partial<ScanDevice> = {}): ScanDevice {
  return {
    address,
    addressType,
    name: extra.name ?? null,
    rssi,
    txPower: -59,
    serviceUuids: [],
    ...extra,
  }
}

function ping(partial: Partial<ScenePing> & Pick<ScenePing, 'observedAt'>): ScenePing {
  return {
    lat: 47.62,
    lon: -122.35,
    speedMps: 0,
    wifiOn: false,
    bluetoothOn: false,
    cellOn: false,
    networks: [],
    devices: [],
    cells: [],
    ...partial,
  }
}

const cafeRoom = inferScene([
  ping({ observedAt: '2026-01-01T00:00:00.000Z', devices: [radio('b0:00:00:00:00:01', -50, 'public', { name: 'Beacon' })], networks: [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Cafe', rssi: -45 }] }),
  ping({ observedAt: '2026-01-01T00:00:05.000Z', devices: [radio('b0:00:00:00:00:01', -50, 'public', { name: 'Beacon' })], networks: [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Cafe', rssi: -45 }] }),
  ping({ observedAt: '2026-01-01T00:00:20.000Z', lat: 47.63, devices: [radio('b0:00:00:00:00:02', -55, 'public')], networks: [{ bssid: 'aa:bb:cc:dd:ee:09', ssid: 'Hall', rssi: -80 }] }),
  ping({ observedAt: '2026-01-01T00:00:25.000Z', lat: 47.63, devices: [radio('b0:00:00:00:00:02', -55, 'public')], networks: [{ bssid: 'aa:bb:cc:dd:ee:09', ssid: 'Hall', rssi: -80 }] }),
])
assert.equal(cafeRoom.rooms.length, 2)
assert.equal(cafeRoom.rooms.find((room) => room.members.some((member) => member.id === 'b0:00:00:00:00:01'))?.originKind, 'wifi')
assert.equal(cafeRoom.rooms.find((room) => room.members.some((member) => member.id === 'b0:00:00:00:00:02'))?.originKind, 'bluetooth')

function pair(speedLabel: string, distances: number[], times: string[], broadcast = false): ScenePing[] {
  return distances.map((distance, index) => ping({
    observedAt: times[index],
    devices: [radio('aa:bb:cc:00:00:10', rssiFor(distance), 'random', broadcast ? {
      broadcastLat: 47.62 + (index * 15) / 110540,
      broadcastLon: -122.35,
    } : {})],
    networks: [{ bssid: 'de:ad:be:ef:00:01', ssid: 'Phone Hotspot', rssi: rssiFor(distance) }],
  }))
}

const walking = inferScene(pair('walk', [20, 18.5, 17], ['2026-01-01T00:10:00.000Z', '2026-01-01T00:10:01.000Z', '2026-01-01T00:10:02.000Z']))
const walker = walking.movers.find((mover) => mover.capabilities.includes('wifi') && mover.capabilities.includes('bluetooth'))
assert.equal(walker?.kind, 'person or vehicle')
assert.ok(walker != null && Math.abs((walker.speedMps ?? 0) - 1.5) < 0.15)

const driving = inferScene(pair('drive', [30, 15], ['2026-01-01T00:20:00.000Z', '2026-01-01T00:20:01.000Z'], true))
const driver = driving.movers.find((mover) => mover.kind === 'vehicle' && mover.id !== 'phone')
assert.equal(driver?.speedKind, 'ground')
assert.ok(driver != null && Math.abs((driver.speedMps ?? 0) - 15) < 1)

const fastRadial = inferScene(pair('radial', [24, 12], ['2026-01-01T00:30:00.000Z', '2026-01-01T00:30:01.000Z']))
const fast = fastRadial.movers.find((mover) => mover.capabilities.includes('wifi'))
assert.equal(fast?.kind, 'vehicle')
assert.equal(fast?.speedKind, 'radial_lower_bound')
assert.ok(fast != null && Math.abs((fast.speedMps ?? 0) - 12) < 0.2)

const slowRadial = inferScene(pair('slow', [20, 17], ['2026-01-01T00:40:00.000Z', '2026-01-01T00:40:01.000Z']))
const slow = slowRadial.movers.find((mover) => mover.capabilities.includes('wifi'))
assert.equal(slow?.kind, 'person or vehicle')
assert.equal(slow?.speedKind, 'radial_lower_bound')
assert.ok(slow != null && Math.abs((slow.speedMps ?? 0) - 3) < 0.2)

const alone = inferScene([
  ping({ observedAt: '2026-01-01T00:50:00.000Z', devices: [radio('aa:bb:cc:00:00:11', rssiFor(20))] }),
  ping({ observedAt: '2026-01-01T00:50:01.000Z', devices: [radio('aa:bb:cc:00:00:11', rssiFor(16))] }),
  ping({ observedAt: '2026-01-01T00:50:02.000Z', devices: [radio('aa:bb:cc:00:00:11', rssiFor(12))] }),
])
const solo = alone.movers.find((mover) => mover.capabilities.includes('bluetooth') && mover.capabilities.length === 1)
assert.equal(solo?.kind, 'person or vehicle')
assert.equal(solo?.capabilities.join(','), 'bluetooth')

const wifiOnly = inferScene([
  ping({ observedAt: '2026-01-01T00:51:00.000Z', lat: null, lon: null, networks: [{ bssid: 'de:ad:be:ef:00:02', ssid: 'Cafe', rssi: rssiFor(20) }] }),
  ping({ observedAt: '2026-01-01T00:51:01.000Z', lat: null, lon: null, networks: [{ bssid: 'de:ad:be:ef:00:02', ssid: 'Cafe', rssi: rssiFor(8) }] }),
])
assert.equal(wifiOnly.rooms.length, 1)
assert.equal(wifiOnly.rooms[0]?.originKind, 'wifi')
assert.equal(wifiOnly.rooms[0]?.originLabel, 'Cafe')
const wifiMover = wifiOnly.movers.find((mover) => mover.capabilities.length === 1 && mover.capabilities[0] === 'wifi')
assert.equal(wifiMover?.kind, 'vehicle')

const gpsOnly = inferScene([
  ping({ observedAt: '2026-01-01T00:52:00.000Z', lat: 47.62, lon: -122.35, speedMps: 4 }),
])
assert.equal(gpsOnly.rooms.length, 1)
assert.equal(gpsOnly.rooms[0]?.originKind, 'gps')
const gpsPhone = gpsOnly.movers.find((mover) => mover.id === 'phone')
assert.equal(gpsPhone?.kind, 'person or vehicle')
assert.equal(gpsPhone?.capabilities.join(','), 'gps')

const cellOnly = inferScene([
  ping({
    observedAt: '2026-01-01T00:53:00.000Z',
    lat: null,
    lon: null,
    cellOn: true,
    speedMps: 15,
    cells: [{ radio: 'lte', registered: true, mcc: '310', mnc: '260', area: '1234', cellId: '99', pci: 12, rssi: -80, timingAdvanceM: 100 }],
  }),
  ping({
    observedAt: '2026-01-01T00:53:01.000Z',
    lat: null,
    lon: null,
    cellOn: true,
    speedMps: 15,
    cells: [{ radio: 'lte', registered: true, mcc: '310', mnc: '260', area: '1234', cellId: '99', pci: 12, rssi: -95, timingAdvanceM: 100 }],
  }),
])
assert.equal(cellOnly.rooms.length, 1)
assert.equal(cellOnly.rooms[0]?.originKind, 'cell')
assert.equal(cellOnly.rooms[0]?.originLabel, 'LTE 99')
const cellPhone = cellOnly.movers.find((mover) => mover.id === 'phone')
assert.equal(cellPhone?.kind, 'vehicle')
assert.equal(cellPhone?.capabilities.join(','), 'cell')
const cellMover = cellOnly.movers.find((mover) => mover.capabilities.length === 1 && mover.capabilities[0] === 'cell' && mover.id !== 'phone')
assert.equal(cellMover?.kind, 'vehicle')

const oneBluetooth = inferScene([
  ping({ observedAt: '2026-01-01T00:54:00.000Z', lat: null, lon: null, devices: [radio('b0:00:00:00:00:09', -50, 'public', { name: 'Beacon' })] }),
])
assert.equal(oneBluetooth.rooms.length, 1)
assert.equal(oneBluetooth.rooms[0]?.originKind, 'bluetooth')

function phoneFrom(partial: Partial<ScenePing>) {
  return inferScene([ping({ observedAt: '2026-01-01T00:55:00.000Z', lat: null, lon: null, speedMps: 15, ...partial })]).movers.find((mover) => mover.id === 'phone')
}
assert.equal(phoneFrom({ wifiOn: true })?.capabilities.join(','), 'wifi')
assert.equal(phoneFrom({ wifiOn: true })?.kind, 'vehicle')
assert.equal(phoneFrom({ bluetoothOn: true })?.capabilities.join(','), 'bluetooth')
assert.equal(phoneFrom({ bluetoothOn: true })?.kind, 'vehicle')

const withPhone = inferScene([
  ping({ observedAt: '2026-01-01T01:00:00.000Z', devices: [radio('b0:00:00:00:00:01', -50, 'public')], networks: [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Cafe', rssi: -45 }] }),
  ping({ observedAt: '2026-01-01T01:00:05.000Z', devices: [radio('b0:00:00:00:00:01', -50, 'public')], networks: [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Cafe', rssi: -45 }] }),
  ping({ observedAt: '2026-01-01T01:00:10.000Z', speedMps: 15, wifiOn: true, lat: 47.62, lon: -122.35 }),
])
const handset = withPhone.movers.find((mover) => mover.id === 'phone')
assert.equal(handset?.kind, 'vehicle')
assert.equal(handset?.roomId, null)
assert.ok(withPhone.rooms.every((room) => room.members.every((member) => member.id !== 'phone')))

const macUuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const fromMac = collapseDevices([radio(macUuid, -40, 'random', { name: 'Speaker' })])
const speaker = fromMac[0]
assert.ok(speaker)
assert.equal(speaker.address, macUuid)
assert.equal(mergeDevice(null, speaker, fix, '2026-01-01T03:00:00.000Z').address, macUuid)
assert.equal(collapseDevices([radio('not-an-address', -40)]).length, 0)

const namedA = mergeDevice(null, radio('aa:bb:cc:00:00:21', -60, 'random', { name: 'Phone' }), fix, '2026-01-01T02:00:00.000Z')
const namedB = mergeDevice(null, radio('aa:bb:cc:00:00:22', -60, 'random', { name: 'Phone' }), fix, '2026-01-01T02:00:00.000Z')
assert.notEqual(namedA.address, namedB.address)
assert.equal(namedA.name, 'Phone')
assert.equal(namedB.name, 'Phone')

const heard = mergeDevice(null, radio('aa:bb:cc:00:00:23', -60, 'random', { broadcastLat: 47.7, broadcastLon: -122.2 }), fix, '2026-01-01T02:00:00.000Z')
assert.equal('broadcastLat' in heard, false)
assert.equal(heard.observations[0]?.lat, fix.lat)
assert.equal(JSON.stringify(heard).includes('47.7'), false)
const stripped = stripPing(ping({
  observedAt: '2026-01-01T02:00:00.000Z',
  devices: [radio('aa:bb:cc:00:00:23', -60, 'random', { broadcastLat: 47.7, broadcastLon: -122.2 })],
}))
assert.equal('broadcastLat' in stripped.devices[0], false)

const towerInput = (registered: boolean, timing: number | null): ScanCell => ({
  radio: 'lte',
  registered,
  mcc: '310',
  mnc: '260',
  area: '1234',
  cellId: registered ? '99' : '100',
  pci: 12,
  rssi: registered ? -80 : -110,
  timingAdvanceM: timing,
})
const northLat = 47.62 + 200 / 110540
let serving = mergeCell(null, towerInput(true, 100), { ...fix, lat: 47.62, lon: -122.35 }, '2026-01-01T03:00:00.000Z')
serving = mergeCell(serving, towerInput(true, 100), { ...fix, lat: northLat, lon: -122.35 }, '2026-01-01T03:00:10.000Z')
assert.equal(serving.role, 'serving')
assert.equal(serving.mcc, '310')
assert.equal(serving.area, '1234')
assert.equal(serving.cellId, '99')
assert.equal('imsi' in serving, false)
assert.equal('tmsi' in serving, false)
assert.equal('imei' in serving, false)
assert.ok(serving.siteLat != null && serving.siteLon != null)
assert.ok(haversineMeters(serving.siteLat, serving.siteLon, 47.62 + 100 / 110540, -122.35) < 20)

let remote = mergeCell(null, towerInput(false, null), { ...fix, lat: 47.62, lon: -122.35 }, '2026-01-01T03:01:00.000Z')
remote = mergeCell(remote, towerInput(false, null), { ...fix, lat: 47.62 + 10 / 110540, lon: -122.35 }, '2026-01-01T03:01:10.000Z')
assert.equal(remote.role, 'remote')
assert.equal(remote.siteLat, null)

function placedRoom(id: string, lat: number, lon: number, relative: number | null, bssid: string | null = null): Room {
  return {
    id,
    originKind: 'wifi',
    originLabel: id,
    originBssid: bssid,
    lat,
    lon,
    radiusM: 4,
    widthM: 4,
    depthM: 4,
    confidence: 1,
    members: [],
  }
}

const eastLon = -122.35 + 4 / (111320 * Math.cos((47.62 * Math.PI) / 180))
const joined = estimateBuildings([
  placedRoom('room:a', 47.62, -122.35, null),
  placedRoom('room:b', 47.62, eastLon, null),
], { networks: [], devices: [], phone: null })
assert.equal(joined.length, 1)
assert.equal(joined[0].floors.length, 1)
assert.ok(joined[0].floors[0].walls.some((wall) => wall.kind === 'interior'))
assert.ok(joined[0].floors[0].walls.some((wall) => wall.kind === 'exterior'))

const split = estimateBuildings([
  placedRoom('room:near', 47.62, -122.35, null),
  placedRoom('room:far', 47.63, -122.35, null),
], { networks: [], devices: [], phone: null })
assert.equal(split.length, 2)

const stackedFloors = estimateBuildings([
  placedRoom('room:low', 47.62, -122.35, 0, 'aa:bb:cc:dd:ee:10'),
  placedRoom('room:high', 47.62, -122.35, 9, 'aa:bb:cc:dd:ee:11'),
], {
  networks: [
    { bssid: 'aa:bb:cc:dd:ee:10', bestRelativeM: 0, bestAltitudeM: null, bestVerticalAccuracyM: null },
    { bssid: 'aa:bb:cc:dd:ee:11', bestRelativeM: 9, bestAltitudeM: null, bestVerticalAccuracyM: null },
  ],
  devices: [],
  phone: null,
})
assert.equal(stackedFloors.length, 1)
assert.deepEqual(stackedFloors[0].floors.map((floor) => floor.index), [0, 3])

const linked = stackSignals({
  networks: [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Cafe', hidden: false, bestRssi: -40, bestLat: 47.62, bestLon: -122.35 }],
  devices: [{ address: 'aa:bb:cc:00:00:10', name: 'Handset', lastRssi: -50, bestLat: null, bestLon: null }],
  cells: [],
  movers: [{
    id: 'track:aa:bb:cc:dd:ee:01+aa:bb:cc:00:00:10@1',
    label: 'Handset',
    roomId: null,
    kind: 'person or vehicle',
    capabilities: ['wifi', 'bluetooth'],
    speedMps: 1.5,
    speedKind: 'radial_lower_bound',
    distanceM: 4,
  }],
  phone: { lat: 47.62, lon: -122.35, accuracy: 5, altitudeM: null, verticalAccuracyM: null, relativeM: null },
})
const linkedHandset = linked.find((device) => device.keys.includes('aa:bb:cc:dd:ee:01') && device.keys.includes('aa:bb:cc:00:00:10'))
assert.ok(linkedHandset)
assert.ok(linkedHandset?.signals.some((signal) => signal.kind === 'wifi'))
assert.ok(linkedHandset?.signals.some((signal) => signal.kind === 'bluetooth'))
assert.ok(linkedHandset?.signals.some((signal) => signal.kind === 'gps'))
assert.deepEqual(segmentSignals(linked).map((section) => section.kind), ['wifi', 'bluetooth', 'gps'])

function rotationScan(id: string, at: string, lat: number | null, lon: number | null, devices: ScanDevice[], networks: ScanAp[] = []) {
  return {
    scanId: id,
    observedAt: at,
    lat,
    lon,
    accuracy: 8,
    altitudeM: null,
    verticalAccuracyM: null,
    relativeM: null,
    speedMps: 0,
    networks,
    devices,
  }
}

const rotatedCatalog = foldScans(emptyCatalog(), [
  rotationScan('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '2026-01-01T00:00:00.000Z', 47.62, -122.35, [radio('da:11:00:00:00:01', -58, 'random', { name: 'Beacon' })]),
  rotationScan('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '2026-01-01T00:00:01.000Z', 47.62, -122.35, [radio('da:11:00:00:00:01', -59, 'random', { name: 'Beacon' })]),
  rotationScan('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', '2026-01-01T00:00:02.000Z', 47.62, -122.35, [radio('da:11:00:00:00:02', -60, 'random', { name: 'Other' })]),
  rotationScan('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', '2026-01-01T00:00:03.000Z', 47.62, -122.35, [radio('da:11:00:00:00:02', -61, 'random', { name: 'Other' })]),
])
const rotated = findRotatingAddresses(rotatedCatalog.history)
assert.equal(rotated.length, 1)
assert.equal(rotated[0].kind, 'bluetooth')
assert.deepEqual(rotated[0].addresses, ['da:11:00:00:00:01', 'da:11:00:00:00:02'])
assert.equal(rotatedCatalog.devices.length, 2)
assert.equal(rotatedCatalog.devices.some((device) => device.address === 'da:11:00:00:00:01'), true)
assert.equal(rotatedCatalog.devices.some((device) => 'broadcastLat' in device), false)

const wifiRotated = findRotatingAddresses([
  ping({ observedAt: '2026-01-01T00:00:00.000Z', networks: [{ bssid: 'da:00:00:00:00:01', ssid: 'Phone', rssi: -60 }] }),
  ping({ observedAt: '2026-01-01T00:00:01.000Z', networks: [{ bssid: 'da:00:00:00:00:01', ssid: 'Phone', rssi: -61 }] }),
  ping({ observedAt: '2026-01-01T00:00:02.000Z', networks: [{ bssid: 'da:00:00:00:00:02', ssid: 'Guest', rssi: -62 }] }),
  ping({ observedAt: '2026-01-01T00:00:03.000Z', networks: [{ bssid: 'da:00:00:00:00:02', ssid: 'Guest', rssi: -63 }] }),
])
assert.equal(wifiRotated.length, 1)
assert.equal(wifiRotated[0].kind, 'wifi')
assert.deepEqual(wifiRotated[0].addresses, ['da:00:00:00:00:01', 'da:00:00:00:00:02'])

const jumped = findRotatingAddresses([
  ping({ observedAt: '2026-01-01T00:00:00.000Z', devices: [radio('aa:bb:cc:00:00:21', -50)] }),
  ping({ observedAt: '2026-01-01T00:00:01.000Z', devices: [radio('aa:bb:cc:00:00:21', -51)] }),
  ping({ observedAt: '2026-01-01T00:00:02.000Z', devices: [radio('aa:bb:cc:00:00:22', -90)] }),
  ping({ observedAt: '2026-01-01T00:00:03.000Z', devices: [radio('aa:bb:cc:00:00:22', -91)] }),
])
assert.equal(jumped.length, 0)

const far = findRotatingAddresses([
  ping({ observedAt: '2026-01-01T00:00:00.000Z', lat: 47.62, lon: -122.35, devices: [radio('aa:bb:cc:00:00:31', -50)] }),
  ping({ observedAt: '2026-01-01T00:00:01.000Z', lat: 47.62, lon: -122.35, devices: [radio('aa:bb:cc:00:00:31', -50)] }),
  ping({ observedAt: '2026-01-01T00:00:02.000Z', lat: 47.63, lon: -122.35, devices: [radio('aa:bb:cc:00:00:32', -50)] }),
  ping({ observedAt: '2026-01-01T00:00:03.000Z', lat: 47.63, lon: -122.35, devices: [radio('aa:bb:cc:00:00:32', -50)] }),
])
assert.equal(far.length, 0)

const sameTime = findRotatingAddresses([
  ping({
    observedAt: '2026-01-01T00:00:00.000Z',
    devices: [radio('aa:bb:cc:00:00:41', -50, 'random', { name: 'Speaker' }), radio('aa:bb:cc:00:00:42', -50, 'random', { name: 'Speaker' })],
  }),
  ping({
    observedAt: '2026-01-01T00:00:01.000Z',
    devices: [radio('aa:bb:cc:00:00:41', -51, 'random', { name: 'Speaker' }), radio('aa:bb:cc:00:00:42', -51, 'random', { name: 'Speaker' })],
  }),
])
assert.equal(sameTime.length, 0)

const publicAddresses = findRotatingAddresses([
  ping({ observedAt: '2026-01-01T00:00:00.000Z', devices: [radio('00:11:22:33:44:55', -50, 'public')] }),
  ping({ observedAt: '2026-01-01T00:00:01.000Z', devices: [radio('00:11:22:33:44:55', -50, 'public')] }),
  ping({ observedAt: '2026-01-01T00:00:02.000Z', devices: [radio('00:11:22:33:44:66', -50, 'public')] }),
  ping({ observedAt: '2026-01-01T00:00:03.000Z', devices: [radio('00:11:22:33:44:66', -51, 'public')] }),
  ping({ observedAt: '2026-01-01T00:00:04.000Z', networks: [{ bssid: '00:11:22:33:44:01', ssid: 'Cafe', rssi: -50 }] }),
  ping({ observedAt: '2026-01-01T00:00:05.000Z', networks: [{ bssid: '00:11:22:33:44:01', ssid: 'Cafe', rssi: -50 }] }),
  ping({ observedAt: '2026-01-01T00:00:06.000Z', networks: [{ bssid: '00:11:22:33:44:02', ssid: 'Cafe', rssi: -51 }] }),
  ping({ observedAt: '2026-01-01T00:00:07.000Z', networks: [{ bssid: '00:11:22:33:44:02', ssid: 'Cafe', rssi: -51 }] }),
])
assert.equal(publicAddresses.length, 0)

const longGap = findRotatingAddresses([
  ping({ observedAt: '2026-01-01T00:00:00.000Z', devices: [radio('aa:bb:cc:00:00:61', -83)] }),
  ping({ observedAt: '2026-01-01T00:00:01.000Z', devices: [radio('aa:bb:cc:00:00:61', -83)] }),
  ping({ observedAt: '2026-01-01T00:01:40.000Z', devices: [radio('aa:bb:cc:00:00:62', -88)] }),
  ping({ observedAt: '2026-01-01T00:01:41.000Z', devices: [radio('aa:bb:cc:00:00:62', -88)] }),
])
assert.equal(longGap.length, 0)

const heldLevel = findRotatingAddresses([
  ping({ observedAt: '2026-01-01T00:00:00.000Z', devices: [radio('aa:bb:cc:00:00:71', -60)] }),
  ping({ observedAt: '2026-01-01T00:00:01.000Z', devices: [radio('aa:bb:cc:00:00:71', -60)] }),
  ping({ observedAt: '2026-01-01T00:01:30.000Z', devices: [radio('aa:bb:cc:00:00:72', -62)] }),
  ping({ observedAt: '2026-01-01T00:01:31.000Z', devices: [radio('aa:bb:cc:00:00:72', -62)] }),
])
assert.equal(heldLevel.length, 1)
assert.deepEqual(heldLevel[0].addresses, ['aa:bb:cc:00:00:71', 'aa:bb:cc:00:00:72'])

const missingPlace = findRotatingAddresses([
  ping({ observedAt: '2026-01-01T00:00:00.000Z', lat: null, lon: null, devices: [radio('aa:bb:cc:00:00:51', -50)] }),
  ping({ observedAt: '2026-01-01T00:00:01.000Z', lat: null, lon: null, devices: [radio('aa:bb:cc:00:00:51', -50)] }),
  ping({ observedAt: '2026-01-01T00:00:02.000Z', lat: null, lon: null, devices: [radio('aa:bb:cc:00:00:52', -51)] }),
  ping({ observedAt: '2026-01-01T00:00:03.000Z', lat: null, lon: null, devices: [radio('aa:bb:cc:00:00:52', -51)] }),
])
assert.equal(missingPlace.length, 0)

const remediationPrompt = 'REMEDIATION-PROMPT-SHOULD-NOT-APPEAR'
const exploitUrl = 'https://www.exploit-db.com/exploits/55555'
const supportUrl = 'https://support.example/router'
const forensicsEnrichment: DeviceEnrichment = {
  schemaVersion: 1,
  status: 'complete',
  queryTitle: 'Cafe',
  manufacturer: 'Example',
  model: 'Radio',
  category: 'Router',
  tags: ['Router'],
  summary: 'A router.',
  confidence: 'low',
  supportStatus: 'unknown',
  supportEndsAt: null,
  officialSupportUrl: supportUrl,
  releases: [],
  newestRelease: null,
  vulnerabilities: [{
    id: 'CVE-2025-1234',
    title: 'Example issue',
    severity: 'high',
    cvss: null,
    affectedVersions: null,
    fixedVersion: null,
    publishedAt: null,
    updatedAt: null,
    mitigation: null,
    cisaKev: true,
    knownExploited: true,
    publicExploit: true,
    applicability: 'potential',
    links: [{
      kind: 'public_exploit',
      title: 'PoC',
      url: exploitUrl,
      official: false,
      accessedAt: '2026-01-01T00:00:00.000Z',
    }],
  }],
  risk: { level: 'high', reasons: ['Known exploited'] },
  sources: [
    { kind: 'support', title: 'Support', url: supportUrl, official: true, accessedAt: '2026-01-01T00:00:00.000Z' },
    { kind: 'public_exploit', title: 'PoC', url: exploitUrl, official: false, accessedAt: '2026-01-01T00:00:00.000Z' },
  ],
  remediationPrompt,
  lookedUpAt: '2026-01-01T00:00:00.000Z',
  modelName: 'deepseek-flash',
}
const forensicsNetwork = { ...elevated, enrichment: forensicsEnrichment }
const forensicsExtras = { devices: [beaconAgain], cells: [], rooms: [] }
const report = await catalogForensicsMarkdown([forensicsNetwork], forensicsExtras, '2026-01-02T00:00:00.000Z')
const reportHash = createHash('sha256').update(catalogBundleCsv([forensicsNetwork], forensicsExtras)).digest('hex')
assert.match(report, /^# Digital forensics report/)
assert.ok(report.includes('aa:bb:cc:dd:ee:01'))
assert.ok(report.includes('aa:bb:cc:00:00:10'))
assert.ok(report.includes(`SHA-256 of the companion CSV: ${reportHash}`))
assert.equal(report.includes(remediationPrompt), false)
assert.equal(report.includes(exploitUrl), false)
assert.ok(report.includes(supportUrl))
assert.ok(report.includes('CVE-2025-1234'))
assert.ok(report.includes('Public exploit reference: yes'))

console.log('logic tests passed')
