import assert from 'node:assert/strict'
import {
  groupAccessPoints,
  groupAdvertisers,
  labelIds,
  onlyHeard,
  UNNAMED_BLUETOOTH,
  type DeviceLike,
  type WifiLike,
} from '../../shared/accessPoints.js'
import { catalogBundleCsv, catalogCsv } from '../../shared/csv.js'
import { catalogForensicsMarkdown } from '../../shared/forensics.js'
import { roomSignals, stackFor, stackSignals } from '../../shared/sources.js'
import type { DeviceRecord, MotionTrack, NetworkRecord, Room } from '../../shared/types.js'
import { digestFromCatalog } from './alerts.js'

const here = { lat: 29.7174, lon: -95.4018 }
const north = (meters: number) => ({ lat: here.lat + meters / 111_320, lon: here.lon })

function radio(bssid: string, ssid: string | null, bestRssi = -60, at = here): WifiLike {
  return { bssid, ssid: ssid ?? '', hidden: ssid == null, bestRssi, bestLat: at.lat, bestLon: at.lon }
}

function advertiser(address: string, name: string | null, bestRssi = -70, at = here): DeviceLike {
  return { address, name, bestRssi, bestLat: at.lat, bestLon: at.lon }
}

const skywalker = [
  radio('82:da:c2:ff:69:cd', 'Skywalker', -48),
  radio('82:da:c2:ff:69:ca', null, -52),
  radio('82:da:c2:06:69:ce', 'Skywalker', -55),
  radio('82:da:c2:06:69:ca', 'Xfinity Mobile', -57),
  radio('82:da:c2:06:69:c8', 'xfinitywifi', -58),
  radio('82:da:c2:06:69:cb', null, -60),
]
const photosynthesis = [
  radio('fa:d0:0e:71:7a:be', 'Photosynthesis', -66, north(40)),
  radio('fa:d0:0e:78:7a:bf', 'Photosynthesis', -70, north(40)),
  radio('fa:d0:0e:78:7a:bc', 'xfinitywifi', -71, north(40)),
  radio('fa:d0:0e:78:7a:ba', 'Xfinity Mobile', -72, north(40)),
  radio('fa:d0:0e:71:7a:b9', null, -74, north(40)),
]
const witch = [
  radio('d4:6c:6d:8b:1e:f5', 'Imnotawitchimyourwifi', -75, north(90)),
  radio('d2:6c:6d:8b:1e:f5', 'Xfinity Mobile', -61, north(90)),
  radio('ca:6c:6d:8b:1e:f5', 'xfinitywifi', -62, north(90)),
  radio('d4:6c:6d:8b:1e:f4', 'Imnotawitchimyourwifi', -77, north(90)),
]
const loneHotspot = radio('7c:9a:54:f8:3a:e9', 'xfinitywifi', -80, north(60))
const mesh = [
  radio('18:a5:ff:f3:f0:8c', 'TMOBILE-F08A', -64, north(20)),
  radio('3c:f0:83:db:4c:b8', 'TMOBILE-F08A', -78, north(120)),
]
const backhaul = radio('5e:11:22:33:44:55', null, -82, north(70))

const block = groupAccessPoints([...skywalker, ...photosynthesis, ...witch, loneHotspot, ...mesh, backhaul])
const apFor = (bssid: string) => {
  const found = block.find((ap) => ap.networks.some((network) => network.bssid === bssid))
  assert.ok(found, `no access point holds ${bssid}`)
  return found
}

assert.equal(block.length, 6)
assert.equal(new Set(block.map((ap) => ap.label)).size, block.length)

const gateway = apFor('82:da:c2:ff:69:cd')
assert.equal(gateway.label, 'Skywalker')
assert.equal(gateway.networks.length, skywalker.length)
assert.equal(gateway.id, '82:da:c2:06:69:c8')
assert.equal(gateway.best.bssid, '82:da:c2:ff:69:cd')
assert.deepEqual(gateway.networks.map((network) => network.bestRssi), [-48, -52, -55, -57, -58, -60])
assert.equal(gateway.ssids[0], 'Skywalker')
assert.deepEqual([...gateway.ssids].sort(), ['Skywalker', 'Xfinity Mobile', 'xfinitywifi'])

const neighbor = apFor('fa:d0:0e:78:7a:bc')
assert.notEqual(neighbor, gateway, 'gateways sharing xfinitywifi stay separate')
assert.equal(neighbor.label, 'Photosynthesis')
assert.equal(neighbor.networks.length, photosynthesis.length)

const virtual = apFor('ca:6c:6d:8b:1e:f5')
assert.equal(virtual.label, 'Imnotawitchimyourwifi', 'label is the SSID unique to this router, not the strongest')
assert.equal(virtual.networks.length, witch.length)
assert.equal(virtual.best.bssid, 'd2:6c:6d:8b:1e:f5')

const hotspot = apFor(loneHotspot.bssid)
assert.equal(hotspot.networks.length, 1, 'a hotspot name shared by several routers never picks one')
assert.equal(hotspot.label, 'xfinitywifi')

const meshAp = apFor('3c:f0:83:db:4c:b8')
assert.equal(meshAp.networks.length, 2, 'the same private SSID nearby is one access point')
assert.equal(meshAp.label, 'TMOBILE-F08A')

const hiddenAp = apFor(backhaul.bssid)
assert.equal(hiddenAp.networks.length, 1)
assert.equal(hiddenAp.label, 'Hidden 4455')
assert.deepEqual(hiddenAp.ssids, [])

assert.equal(groupAccessPoints([
  radio('c0:94:35:b9:5d:b7', 'Rice Visitor'),
  radio('70:3a:cb:11:22:33', 'Rice Visitor', -70, north(140)),
]).length, 1)
assert.equal(groupAccessPoints([
  radio('c0:94:35:b9:5d:b7', 'Rice Visitor'),
  radio('70:3a:cb:11:22:33', 'Rice Visitor', -70, north(1_000)),
]).length, 2, 'the same name a kilometer away is a different access point')
assert.equal(groupAccessPoints([
  radio('a8:70:5d:4a:d5:d7', 'Not Your Wifi'),
  radio('a8:70:5d:4a:d5:d8', 'Not Your Wifi', -70, north(1_000)),
]).length, 2, 'sibling MACs a kilometer apart stay separate')
assert.equal(groupAccessPoints([
  radio('a8:70:5d:4a:d5:d7', 'Not Your Wifi'),
  { ...radio('a8:70:5d:4a:d5:d8', 'Not Your Wifi', -70), bestLat: null, bestLon: null },
]).length, 1, 'a radio without a fix still joins its siblings')
assert.equal(groupAccessPoints([
  radio('a8:70:5d:4a:d5:d7', 'Upstairs'),
  radio('a8:70:5d:5a:d5:d7', 'Downstairs', -70),
]).length, 2, 'octet 4 too far apart is a different router')

const mlo = groupAccessPoints([
  { ...radio('12:00:00:00:00:01', null), apMldMac: '56:00:00:00:00:03' },
  { ...radio('34:00:00:00:00:02', null, -65), apMldMac: '56:00:00:00:00:03' },
  { ...radio('9a:00:00:00:00:07', null, -70), affiliatedLinks: [{ linkId: 1, mac: '12:00:00:00:00:01', frequencyMhz: 5180 }] },
])
assert.equal(mlo.length, 1, 'MLO links and affiliated links join hidden radios')
assert.equal(mlo[0].label, 'Hidden 0001')

const rotating = Array.from({ length: 9 }, (_, index) =>
  advertiser(`0000-${index}`, 'LE-Bose QC45', -60 - index, north(index * 10)))
const groups = groupAdvertisers([
  ...rotating,
  advertiser('quest-a', 'Quest 3', -65),
  advertiser('quest-b', ' quest 3 ', -66, north(10)),
  advertiser('quest-far', 'Quest 3', -68, north(1_000)),
  advertiser('anon-1', null, -71),
  advertiser('anon-2', '', -72, north(30)),
  advertiser('anon-3', '  ', -73, north(60)),
  advertiser('anon-far-1', null, -74, north(2_000)),
  advertiser('anon-far-2', null, -75, north(2_050)),
])
const groupFor = (address: string) => {
  const found = groups.find((group) => group.devices.some((device) => device.address === address))
  assert.ok(found, `no advertiser group holds ${address}`)
  return found
}

const headphones = groupFor('0000-4')
assert.equal(headphones.devices.length, 9)
assert.equal(headphones.label, 'LE-Bose QC45')
assert.equal(headphones.named, true)
assert.equal(headphones.best.address, '0000-0')
assert.equal(headphones.id, '0000-0')
assert.equal(groupFor('quest-b'), groupFor('quest-a'), 'names match without case or spacing')
assert.notEqual(groupFor('quest-far'), groupFor('quest-a'))
assert.equal(groupFor('quest-a').label, 'Quest 3')

const unnamed = groupFor('anon-1')
assert.equal(unnamed.label, UNNAMED_BLUETOOTH)
assert.equal(unnamed.named, false)
assert.deepEqual(unnamed.devices.map((device) => device.address), ['anon-1', 'anon-2', 'anon-3'])
assert.equal(groupFor('anon-far-2').devices.length, 2, 'unnamed advertisers fold once per area')
assert.notEqual(groupFor('anon-far-1'), unnamed)
assert.equal(groups.length, 5)

const heardAps = onlyHeard(block, ['82:DA:C2:06:69:CE', '82:da:c2:06:69:c8', 'ff:ff:ff:ff:ff:ff'])
assert.equal(heardAps.length, 1)
assert.equal(heardAps[0].label, 'Skywalker')
assert.deepEqual(heardAps[0].networks.map((network) => network.bssid), ['82:da:c2:06:69:ce', '82:da:c2:06:69:c8'])
assert.equal(heardAps[0].best.bssid, '82:da:c2:06:69:ce')
assert.equal(gateway.networks.length, skywalker.length, 'onlyHeard leaves the catalog groups alone')

const heardGroups = onlyHeard(groups, ['anon-2', '0000-8'])
assert.deepEqual(heardGroups.map((group) => [group.label, group.devices.length]), [['LE-Bose QC45', 1], [UNNAMED_BLUETOOTH, 1]])
assert.equal(heardGroups[0].best.address, '0000-8')

assert.deepEqual(labelIds(gateway).slice(0, 3), ['82:da:c2:06:69:c8', 'ssid:Skywalker', '82:da:c2:ff:69:cd'])
assert.equal(labelIds(gateway).length, 1 + skywalker.length)
assert.deepEqual(labelIds(hiddenAp), ['5e:11:22:33:44:55', 'hidden:5e:11:22:33:44:55'])
assert.deepEqual(labelIds(groupFor('quest-a')), ['quest-a', 'bluetooth:quest-a', 'quest-b', 'bluetooth:quest-b'])
assert.deepEqual(labelIds(unnamed), ['anon-1'], 'a member name never labels the unnamed fold')

const handset = { address: 'aa:bb:cc:00:00:10', name: 'Handset', lastRssi: -50, bestRssi: -50, bestLat: here.lat, bestLon: here.lon }
const anonymous = [1, 2, 3].map((index) => ({
  address: `da:11:00:00:00:0${index}`,
  name: null,
  lastRssi: -70 - index,
  bestRssi: -70 - index,
  bestLat: here.lat,
  bestLon: here.lon,
}))
const walking = (id: string): MotionTrack => ({
  id,
  label: 'Walker',
  roomId: null,
  kind: 'person or vehicle',
  capabilities: ['wifi', 'bluetooth'],
  speedMps: 1.2,
  speedKind: 'radial_lower_bound',
  distanceM: 4,
})
const stacks = stackSignals({
  networks: [{ ...skywalker[0], band: '2.4' }, ...skywalker.slice(1), ...photosynthesis],
  devices: [handset, ...anonymous],
  cells: [],
  movers: [walking('track:82:da:c2:06:69:c8+aa:bb:cc:00:00:10@1'), walking('track:fa:d0:0e:78:7a:bf+da:11:00:00:00:01@2')],
  phone: null,
})
assert.equal(stacks.length, 3)
assert.equal(stacks.filter((stack) => stack.signals.some((signal) => signal.kind === 'wifi')).length, 2)

const gatewayCard = stackFor(stacks, '82:da:c2:ff:69:cd')
assert.ok(gatewayCard)
assert.equal(gatewayCard.id, '82:da:c2:06:69:c8')
assert.equal(gatewayCard.label, 'Skywalker')
for (const network of skywalker) assert.ok(gatewayCard.keys.includes(network.bssid) && gatewayCard.keys.includes(`wifi:${network.bssid}`))
assert.ok(gatewayCard.keys.includes('aa:bb:cc:00:00:10'), 'a mover still links a named handset to the access point')
assert.equal(gatewayCard.signals.filter((signal) => signal.kind === 'wifi').length, skywalker.length)
assert.deepEqual(gatewayCard.signals[0], { kind: 'wifi', title: 'Skywalker', detail: '-48 dBm · 82:da:c2:ff:69:cd · 2.4 GHz' })
assert.deepEqual(gatewayCard.signals[1], { kind: 'wifi', title: 'Hidden', detail: '-52 dBm · 82:da:c2:ff:69:ca' })
assert.equal(gatewayCard.signals.filter((signal) => signal.kind === 'gps').length, 1)
assert.deepEqual(gatewayCard.labelIds.slice(0, 2), ['82:da:c2:06:69:c8', 'ssid:Skywalker'])
assert.equal(stackFor(stacks, 'wifi:fa:d0:0e:71:7a:b9')?.label, 'Photosynthesis')
assert.ok(!stackFor(stacks, 'fa:d0:0e:71:7a:b9')?.keys.includes('da:11:00:00:00:01'), 'the unnamed fold never joins a mover link')

const foldCard = stackFor(stacks, 'da:11:00:00:00:02')
assert.ok(foldCard)
assert.equal(foldCard.label, UNNAMED_BLUETOOTH)
assert.deepEqual(foldCard.signals.filter((signal) => signal.kind === 'bluetooth'), [
  { kind: 'bluetooth', title: UNNAMED_BLUETOOTH, detail: '3 addresses · strongest -71 dBm' },
])
assert.deepEqual(foldCard.labelIds, ['da:11:00:00:00:01'])

const room: Room = {
  id: 'room:photosynthesis',
  originKind: 'wifi',
  originLabel: 'Photosynthesis',
  originBssid: 'fa:d0:0e:78:7a:bf',
  lat: here.lat,
  lon: here.lon,
  radiusM: 12,
  widthM: 24,
  depthM: 24,
  confidence: 0.8,
  members: [
    { id: 'aa:bb:cc:00:00:10', label: 'Handset', kind: 'carried', distanceM: 3 },
    { id: 'da:11:00:00:00:01', label: 'da:11:00:00:00:01', kind: 'unknown', distanceM: 5 },
    { id: 'da:11:00:00:00:02', label: 'da:11:00:00:00:02', kind: 'unknown', distanceM: null },
  ],
}
assert.deepEqual(
  roomSignals(room).filter((signal) => signal.kind === 'bluetooth').map((signal) => [signal.title, signal.detail]),
  [['Handset', '3 m'], [UNNAMED_BLUETOOTH, '2 addresses']],
)

const records = [...skywalker, ...photosynthesis].map((network) => ({
  ...network,
  firstSeen: '2026-11-20T00:00:00Z',
  lastSeen: '2026-11-20T01:00:00Z',
  enrichment: null,
}) as unknown as NetworkRecord)
const highRisk = { risk: { level: 'high', reasons: ['End of support in public records'] } } as NetworkRecord['enrichment']
const risky = records.map((record) => (record.bssid.startsWith('82:') ? { ...record, enrichment: highRisk } : record))
const beacons = rotating.map((device) => ({
  ...device,
  addressType: 'random',
  firstSeen: '2026-11-20T00:00:00Z',
  lastSeen: '2026-11-20T01:00:00Z',
  enrichment: null,
}) as unknown as DeviceRecord)

const csvRows = catalogCsv(records).split('\n')
assert.deepEqual(csvRows[0].split(',').slice(-2), ['access_point_id', 'access_point'])
assert.ok(csvRows[1].endsWith(',82:da:c2:06:69:c8,Skywalker'), 'each radio row names its access point')
assert.equal(csvRows.length, 1 + records.length, 'the export still lists one row per radio')
const bundleRows = catalogBundleCsv([], { devices: beacons }).split('\n')
assert.ok(bundleRows[1].endsWith(',advertiser_group'))
assert.ok(bundleRows.slice(2).every((row) => row.endsWith(',0000-0')))

const report = await catalogForensicsMarkdown(records, { devices: beacons }, '2026-11-21T00:00:00.000Z')
assert.ok(report.includes('- Wi-Fi radios: 11'))
assert.ok(report.includes('- Access points: 2'))
assert.ok(report.includes('- Bluetooth advertisements: 9'))
assert.ok(report.includes('- Bluetooth advertiser groups: 1'))
assert.ok(report.includes('- Access point: Photosynthesis (fa:d0:0e:71:7a:b9)'))
assert.ok(report.includes('the records stay separate'))

const weekly = digestFromCatalog({ networks: risky, devices: beacons, cells: [], openRows: [], since: '2026-11-15T00:00:00Z' })
assert.equal(weekly.newAccessPoints, 2)
assert.equal(weekly.newAdvertisers, 1)
assert.deepEqual(weekly.highRisk.map((item) => item.name), ['Skywalker'], 'one high-risk line per access point')
assert.equal(weekly.observationCount, records.length + beacons.length)
const older = digestFromCatalog({
  networks: records.map((record, index) => (index === 0 ? { ...record, firstSeen: '2026-11-01T00:00:00Z' } : record)),
  devices: beacons,
  cells: [],
  openRows: [],
  since: '2026-11-15T00:00:00Z',
})
assert.equal(older.newAccessPoints, 1, 'an access point is new only when its earliest radio is new')

console.log('access point tests passed')
