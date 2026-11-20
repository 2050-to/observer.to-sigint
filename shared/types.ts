export type SecurityLabel = 'open' | 'owe' | 'wep' | 'wpa' | 'wpa2' | 'wpa3' | 'enterprise'

export interface AffiliatedLink {
  linkId: number
  mac: string
  frequencyMhz: number
}

export interface PlaceInfo {
  address: string
  crossStreets: string[]
  fetchedAt: string
}

export interface ScanAp {
  ssid: string
  bssid: string
  rssi: number
  frequencyMhz: number
  channel: number
  band: string
  channelWidthMhz: number
  centerFreq0: number
  centerFreq1: number
  wifiStandard: string
  capabilities: string
  securityTypes: string[]
  passpoint: boolean
  responder80211mc: boolean
  responder80211az: boolean
  twtResponder: boolean
  secureHeLtf: boolean
  rangingFrameProtection: boolean
  apMldMac: string | null
  apMloLinkId: number | null
  affiliatedLinks: AffiliatedLink[]
  operatorName: string | null
  venueName: string | null
  countryCode: string | null
  maxRateMbps: number | null
  stationCount: number | null
  channelUtilization: number | null
  admissionCapacity: number | null
  vendorOuis: string[]
}

export interface NetworkRecord {
  ssid: string
  hidden: boolean
  bssid: string
  frequencyMhz: number
  channel: number
  band: string
  channelWidthMhz: number
  centerFreq0: number
  centerFreq1: number
  lastRssi: number
  bestRssi: number
  wifiStandard: string
  security: SecurityLabel
  securityTypes: string[]
  capabilities: string
  passpoint: boolean
  responder80211mc: boolean
  responder80211az: boolean
  twtResponder: boolean
  secureHeLtf: boolean
  rangingFrameProtection: boolean
  apMldMac: string | null
  apMloLinkId: number | null
  affiliatedLinks: AffiliatedLink[]
  operatorName: string | null
  venueName: string | null
  countryCode: string | null
  maxRateMbps: number | null
  stationCount: number | null
  channelUtilization: number | null
  admissionCapacity: number | null
  vendorOuis: string[]
  firstSeen: string
  lastSeen: string
  lastLat: number | null
  lastLon: number | null
  lastAccuracy: number | null
  bestLat: number | null
  bestLon: number | null
  bestAccuracy: number | null
  lastAltitudeM: number | null
  lastVerticalAccuracyM: number | null
  lastRelativeM: number | null
  bestAltitudeM: number | null
  bestVerticalAccuracyM: number | null
  bestRelativeM: number | null
  seenCount: number
  channels: number[]
  place: PlaceInfo | null
}

export interface Fix {
  lat: number | null
  lon: number | null
  accuracy: number | null
  altitudeM: number | null
  verticalAccuracyM: number | null
  relativeM: number | null
}

export type AddressType = 'public' | 'random'
export type CellRadio = 'lte' | 'nr' | 'wcdma' | 'gsm'
export type CellRole = 'serving' | 'remote'
export type Capability = 'wifi' | 'bluetooth' | 'cell' | 'gps'
export type SpeedKind = 'ground' | 'radial_lower_bound'
export type MotionKind = 'approaching' | 'receding' | 'body shadow' | 'person or vehicle' | 'vehicle'
export type ContentKind = 'fixed' | 'carried' | 'unknown'
export type OriginKind = 'wifi' | 'bluetooth'

export const RUN_LIMIT_MPS = 10

export interface SignalObservation {
  observedAt: string
  lat: number | null
  lon: number | null
  rssi: number
  distanceM: number | null
}

export interface ScanDevice {
  address: string
  addressType: AddressType
  name: string | null
  rssi: number
  txPower: number | null
  serviceUuids: string[]
  broadcastLat?: number | null
  broadcastLon?: number | null
}

export interface DeviceRecord {
  address: string
  addressType: AddressType
  name: string | null
  txPower: number | null
  serviceUuids: string[]
  lastRssi: number
  bestRssi: number
  firstSeen: string
  lastSeen: string
  lastLat: number | null
  lastLon: number | null
  lastAccuracy: number | null
  bestLat: number | null
  bestLon: number | null
  bestAccuracy: number | null
  lastAltitudeM: number | null
  lastVerticalAccuracyM: number | null
  lastRelativeM: number | null
  bestAltitudeM: number | null
  bestVerticalAccuracyM: number | null
  bestRelativeM: number | null
  seenCount: number
  observations: SignalObservation[]
}

export interface ScanCell {
  radio: CellRadio
  registered: boolean
  mcc: string
  mnc: string
  area: string
  cellId: string
  pci: number | null
  rssi: number
  timingAdvanceM: number | null
}

export interface CellRecord {
  key: string
  radio: CellRadio
  role: CellRole
  mcc: string
  mnc: string
  area: string
  cellId: string
  pci: number | null
  lastRssi: number
  bestRssi: number
  firstSeen: string
  lastSeen: string
  lastLat: number | null
  lastLon: number | null
  lastAccuracy: number | null
  bestLat: number | null
  bestLon: number | null
  bestAccuracy: number | null
  lastAltitudeM: number | null
  lastVerticalAccuracyM: number | null
  lastRelativeM: number | null
  bestAltitudeM: number | null
  bestVerticalAccuracyM: number | null
  bestRelativeM: number | null
  timingAdvanceM: number | null
  seenCount: number
  observations: SignalObservation[]
  siteLat: number | null
  siteLon: number | null
  siteErrorM: number | null
}

export interface RoomMember {
  id: string
  label: string
  kind: ContentKind
  distanceM: number | null
}

export interface Room {
  id: string
  originKind: OriginKind
  originLabel: string
  originBssid: string | null
  lat: number | null
  lon: number | null
  radiusM: number
  widthM: number
  depthM: number
  confidence: number
  members: RoomMember[]
}

export interface MotionTrack {
  id: string
  label: string
  roomId: string | null
  kind: MotionKind
  capabilities: Capability[]
  speedMps: number | null
  speedKind: SpeedKind | null
  distanceM: number | null
}

export interface ScenePing {
  observedAt: string
  lat: number | null
  lon: number | null
  speedMps: number | null
  wifiOn: boolean
  bluetoothOn: boolean
  cellOn: boolean
  networks: { bssid: string; ssid: string; rssi: number }[]
  devices: ScanDevice[]
  cells: ScanCell[]
}

export interface RangeSnapshot {
  heard: NetworkRecord[]
  radiusM: number
  phone: Fix
  speedMps: number | null
  dwellSeconds: number
  scanPeriodSeconds: number
  rooms: Room[]
  movers: MotionTrack[]
  history: ScenePing[]
}

export interface OpenRow {
  label: string
  ssid: string
  hidden: boolean
  security: SecurityLabel
  bssidCount: number
  bestRssi: number
  channels: number[]
  lastSeen: string
  address: string | null
  crossStreets: string[]
  lat: number | null
  lon: number | null
  floor: number | null
  bssids: string[]
}
