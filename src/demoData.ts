import type { JournalScan } from '../shared/catalog'
import { ownedChangeText, type OwnedChange } from '../shared/ownedDiff'
import type { SubnetCatalog } from '../shared/ownedNetwork'
import type { WeeklyReview } from '../shared/review'
import { siteFindings, type SiteRecord } from '../shared/sites'
import type { ScanAp, ScanCell, ScanDevice } from '../shared/types'

const START = Date.parse('2026-11-20T15:00:00.000Z')

export const DEMO_PLACE = { lat: 47.6092, lon: -122.3418 }

export const DEMO_BSSID = {
  annex: '02:4a:10:20:30:01',
  twin: '06:9c:77:10:20:99',
  guest: '0a:21:55:01:02:03',
  iot: '0e:33:88:44:55:66',
} as const

export const DEMO_BLE = {
  lobby: 'aa:bb:10:00:00:01',
  unnamed: 'da:11:00:00:00:07',
} as const

const ANNEX = 'Harbor Annex'
const GUEST = 'Harbor Guest'
const IOT = 'Annex-IoT'

function at(seconds: number): string {
  return new Date(START + seconds * 1000).toISOString()
}

function offset(northM: number, eastM: number): { lat: number; lon: number } {
  return {
    lat: DEMO_PLACE.lat + northM / 110540,
    lon: DEMO_PLACE.lon + eastM / (111320 * Math.cos((DEMO_PLACE.lat * Math.PI) / 180)),
  }
}

function ap(fields: Pick<ScanAp, 'ssid' | 'bssid' | 'rssi' | 'capabilities' | 'channel' | 'frequencyMhz' | 'band'> & { wifiStandard?: string }): ScanAp {
  return {
    securityTypes: [],
    channelWidthMhz: 20,
    centerFreq0: 0,
    centerFreq1: 0,
    wifiStandard: fields.wifiStandard ?? 'n',
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
    maxRateMbps: fields.band === '5' ? 600 : 144,
    stationCount: 4,
    channelUtilization: 18,
    admissionCapacity: 80,
    vendorOuis: [fields.bssid.slice(0, 8).replace(/:/g, '').toUpperCase()],
    ...fields,
  }
}

function beacon(address: string, rssi: number, name: string | null, addressType: 'public' | 'random' = 'public'): ScanDevice {
  return { address, addressType, name, rssi, txPower: -59, serviceUuids: [] }
}

function serving(): ScanCell {
  return {
    radio: 'lte',
    registered: true,
    mcc: '310',
    mnc: '260',
    area: '404',
    cellId: '8801',
    pci: 18,
    rssi: -86,
    timingAdvanceM: 180,
  }
}

const annex = (rssi: number) => ap({
  ssid: ANNEX,
  bssid: DEMO_BSSID.annex,
  rssi,
  capabilities: '[WPA2-PSK-CCMP][ESS]',
  channel: 36,
  frequencyMhz: 5180,
  band: '5',
  wifiStandard: 'ax',
})

const twin = (rssi: number) => ap({
  ssid: ANNEX,
  bssid: DEMO_BSSID.twin,
  rssi,
  capabilities: '[ESS]',
  channel: 6,
  frequencyMhz: 2437,
  band: '2.4',
})

const guest = (rssi: number) => ap({
  ssid: GUEST,
  bssid: DEMO_BSSID.guest,
  rssi,
  capabilities: '[ESS]',
  channel: 11,
  frequencyMhz: 2462,
  band: '2.4',
})

const iot = (rssi: number) => ap({
  ssid: IOT,
  bssid: DEMO_BSSID.iot,
  rssi,
  capabilities: '[WPA2-PSK-CCMP][ESS]',
  channel: 44,
  frequencyMhz: 5220,
  band: '5',
  wifiStandard: 'ax',
})

function scan(
  id: string,
  seconds: number,
  northM: number,
  eastM: number,
  speed: number,
  networks: ScanAp[],
  devices: ScanDevice[] = [],
  cells: ScanCell[] = [],
): JournalScan {
  const point = offset(northM, eastM)
  return {
    scanId: id,
    observedAt: at(seconds),
    lat: point.lat,
    lon: point.lon,
    accuracy: 8,
    altitudeM: 18,
    verticalAccuracyM: 4,
    relativeM: 1,
    speedMps: speed,
    wifiOn: networks.length > 0,
    bluetoothOn: devices.length > 0,
    cellOn: cells.length > 0,
    networks,
    devices,
    cells,
  }
}

export function demoScans(): JournalScan[] {
  const lobby = beacon(DEMO_BLE.lobby, -52, 'Lobby beacon')
  const unnamed = beacon(DEMO_BLE.unnamed, -68, null, 'random')
  return [
    scan('demo-harbor-1', 0, 0, 0, 1.1, [annex(-40), guest(-58), iot(-64)]),
    scan('demo-harbor-2', 40, 35, 0, 1.2, [annex(-48), guest(-54), iot(-66)], [lobby]),
    scan('demo-harbor-3', 80, 70, 8, 1.0, [annex(-55), twin(-49), guest(-50), iot(-70)], [lobby, unnamed]),
    scan('demo-harbor-4', 130, 55, 20, 1.1, [annex(-52), twin(-46), guest(-47), iot(-63)], [lobby]),
    scan('demo-harbor-5', 200, 12, 4, 0.2, [annex(-42), twin(-51), guest(-56), iot(-60)], [lobby, unnamed], [serving()]),
  ]
}

export function demoSite(): SiteRecord {
  const walkedAt = at(200)
  const twinAt = at(80)
  return {
    id: 'demo-harbor-annex',
    name: ANNEX,
    boundary: { kind: 'radius', lat: DEMO_PLACE.lat, lon: DEMO_PLACE.lon, radiusM: 150 },
    claims: [
      { ssid: ANNEX, bssid: DEMO_BSSID.annex, baseline: 'wpa2' },
      { ssid: IOT, bssid: DEMO_BSSID.iot, baseline: 'wpa2' },
    ],
    walkEveryDays: 14,
    lastWalk: {
      startedAt: at(0),
      walkedAt,
      heard: [
        { bssid: DEMO_BSSID.annex, ssid: ANNEX, security: 'wpa2', channel: 36 },
        { bssid: DEMO_BSSID.twin, ssid: ANNEX, security: 'open', channel: 6 },
        { bssid: DEMO_BSSID.guest, ssid: GUEST, security: 'open', channel: 11 },
        { bssid: DEMO_BSSID.iot, ssid: IOT, security: 'wpa2', channel: 44 },
      ],
      heardDevices: [
        { address: DEMO_BLE.lobby, name: 'Lobby beacon' },
        { address: DEMO_BLE.unnamed, name: null },
      ],
    },
    radios: [
      {
        bssid: DEMO_BSSID.annex,
        ssid: ANNEX,
        channel: 36,
        security: 'wpa2',
        firstSeen: at(0),
        lastSeen: walkedAt,
        baselineChannel: 36,
        misses: 0,
        departedAt: null,
        alerts: [],
      },
      {
        bssid: DEMO_BSSID.twin,
        ssid: ANNEX,
        channel: 6,
        security: 'open',
        firstSeen: twinAt,
        lastSeen: walkedAt,
        baselineChannel: null,
        misses: 0,
        departedAt: null,
        alerts: [
          { kind: 'evil_twin', episode: twinAt },
          { kind: 'open', episode: twinAt },
        ],
      },
      {
        bssid: DEMO_BSSID.guest,
        ssid: GUEST,
        channel: 11,
        security: 'open',
        firstSeen: at(0),
        lastSeen: walkedAt,
        baselineChannel: null,
        misses: 0,
        departedAt: null,
        alerts: [],
      },
      {
        bssid: DEMO_BSSID.iot,
        ssid: IOT,
        channel: 44,
        security: 'wpa2',
        firstSeen: at(0),
        lastSeen: walkedAt,
        baselineChannel: 44,
        misses: 0,
        departedAt: null,
        alerts: [],
      },
    ],
    events: [
      {
        kind: 'evil_twin',
        severity: 'critical',
        at: twinAt,
        bssid: DEMO_BSSID.twin,
        ssid: ANNEX,
        channel: 6,
        detail: 'Harbor Annex heard on a radio that is not claimed',
        episode: twinAt,
      },
      {
        kind: 'open',
        severity: 'critical',
        at: twinAt,
        bssid: DEMO_BSSID.twin,
        ssid: ANNEX,
        channel: 6,
        detail: 'Harbor Annex heard as open, baseline wpa2',
        episode: twinAt,
      },
    ],
  }
}

export function demoReview(): { id: string; builtAt: string; digest: WeeklyReview } {
  const site = demoSite()
  const walkedAt = site.lastWalk?.walkedAt ?? at(200)
  return {
    id: 'demo-harbor-review',
    builtAt: '2026-11-21T16:00:00.000Z',
    digest: {
      openNetworks: [
        { name: GUEST, security: 'open', lastSeen: walkedAt, place: ANNEX },
        { name: ANNEX, security: 'open', lastSeen: walkedAt, place: ANNEX },
      ],
      highRisk: [],
      newAccessPoints: 4,
      newAdvertisers: 2,
      newCells: 1,
      newRadios: [
        { kind: 'ap', id: DEMO_BSSID.guest, label: GUEST, firstSeen: at(0), lat: DEMO_PLACE.lat, lon: DEMO_PLACE.lon },
        { kind: 'ap', id: DEMO_BSSID.twin, label: `${ANNEX} open`, firstSeen: at(80), lat: DEMO_PLACE.lat, lon: DEMO_PLACE.lon },
        { kind: 'ap', id: DEMO_BSSID.iot, label: IOT, firstSeen: at(0), lat: DEMO_PLACE.lat, lon: DEMO_PLACE.lon },
        { kind: 'adv', id: DEMO_BLE.lobby, label: 'Lobby beacon', firstSeen: at(40), lat: DEMO_PLACE.lat, lon: DEMO_PLACE.lon },
      ],
      newRadioRemainder: 0,
      observationCount: demoScans().length,
      siteFindings: siteFindings(site),
      siteEvents: site.events.map((event) => ({
        site: site.name,
        kind: event.kind,
        severity: event.severity,
        at: event.at,
        bssid: event.bssid,
        label: event.detail,
      })),
      ownedChanges: [{ text: ownedChangeText(demoOwnedChange()) }],
      overdueWalks: [],
    },
  }
}

export function demoSubnet(): SubnetCatalog {
  return {
    cidr: '192.168.8.0/24',
    interfacePrefix: 24,
    limited: false,
    checked: 3,
    internetRoute: true,
    hosts: [
      { ip: '192.168.8.1', role: 'host', present: true, mac: '02:4a:10:00:00:01', name: 'Harbor gateway', services: [], ports: [] },
      { ip: '192.168.8.20', role: 'host', present: true, mac: '0e:33:88:00:00:20', name: 'Lobby NVR', services: ['rtsp'], ports: [554] },
      { ip: '192.168.8.42', role: 'host', present: true, mac: '0a:21:55:00:00:42', name: 'Front desk phone', services: [], ports: [] },
    ],
  }
}

export function demoOwnedChange(): OwnedChange {
  return {
    kind: 'recorder_appeared',
    ip: '192.168.8.20',
    name: 'Lobby NVR',
    previousName: null,
  }
}
