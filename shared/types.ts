export type SecurityLabel = 'open' | 'owe' | 'wep' | 'wpa' | 'wpa2' | 'wpa3' | 'enterprise'

export interface AffiliatedLink {
  linkId: number
  mac: string
  frequencyMhz: number
}

export interface PlaceInfo {
  address: string
  crossStreets: string[]
  elevationM: number | null
  fetchedAt: string
  lat?: number | null
  lon?: number | null
  country?: string | null
  region?: string | null
  locality?: string | null
  postal?: string | null
}

export type DeviceCategory =
  | 'Printer'
  | 'Router'
  | 'Access Point'
  | 'Hotspot'
  | 'Phone'
  | 'Tablet'
  | 'Computer'
  | 'TV'
  | 'Audio'
  | 'Camera'
  | 'Wearable'
  | 'Vehicle'
  | 'Beacon'
  | 'Peripheral'
  | 'Home Appliance'
  | 'Industrial'
  | 'Unknown'

export type EnrichmentTag =
  | Exclude<DeviceCategory, 'Unknown'>
  | 'IoT'
  | 'Network Infrastructure'
  | 'Consumer'
  | 'Enterprise'
  | 'End of Support'
  | 'Known Exploited'
  | 'High Risk'

export type EnrichmentConfidence = 'low' | 'medium' | 'high'
export type EnrichmentAgeBand = '0-90 days' | '3-12 months' | '1-3 years' | 'over 3 years' | 'unknown'
export type SupportStatus = 'supported' | 'end_of_support' | 'unknown'
export type RiskLevel = 'low' | 'medium' | 'high' | 'unknown'
export type ReleaseKind = 'firmware' | 'driver' | 'software'
export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown'
export type EvidenceKind =
  | 'manufacturer'
  | 'support'
  | 'firmware'
  | 'driver'
  | 'vendor_advisory'
  | 'cve'
  | 'nvd'
  | 'cisa_kev'
  | 'patch_notes'
  | 'public_exploit'
  | 'poc'
  | 'other'

export interface EvidenceSource {
  kind: EvidenceKind
  title: string
  url: string
  official: boolean
  accessedAt: string
}

export interface PublishedRelease {
  kind: ReleaseKind
  version: string | null
  publishedAt: string
  ageDays: number
  ageBand: EnrichmentAgeBand
  notes: string | null
  sourceUrl: string
  official: boolean
}

export interface VulnerabilityArtifact {
  id: string
  title: string
  severity: VulnerabilitySeverity
  cvss: number | null
  affectedVersions: string | null
  fixedVersion: string | null
  publishedAt: string | null
  updatedAt: string | null
  mitigation: string | null
  cisaKev: boolean
  knownExploited: boolean
  publicExploit: boolean
  applicability: 'potential'
  links: EvidenceSource[]
}

export interface EnrichmentRisk {
  level: RiskLevel
  reasons: string[]
}

export interface DeviceEnrichment {
  schemaVersion: 1
  status: 'complete' | 'inconclusive'
  queryTitle: string
  manufacturer: string | null
  model: string | null
  category: DeviceCategory
  tags: EnrichmentTag[]
  summary: string | null
  confidence: EnrichmentConfidence
  supportStatus: SupportStatus
  supportEndsAt: string | null
  officialSupportUrl: string | null
  releases: PublishedRelease[]
  newestRelease: PublishedRelease | null
  vulnerabilities: VulnerabilityArtifact[]
  risk: EnrichmentRisk
  sources: EvidenceSource[]
  remediationPrompt: string
  lookedUpAt: string
  modelName: string
}

export interface EnrichmentQueueStatus {
  enabled: boolean
  pending: number
  processing: number
  failed: number
  complete: number
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
  postalCodes?: string[]
  enrichment?: DeviceEnrichment | null
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
export type OriginKind = 'wifi' | 'bluetooth' | 'gps' | 'cell'

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
  postalCodes?: string[]
  enrichment?: DeviceEnrichment | null
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
  heardDevices: DeviceRecord[]
  radiusM: number
  phone: Fix
  speedMps: number | null
  dwellSeconds: number
  scanPeriodSeconds: number
  rooms: Room[]
  movers: MotionTrack[]
  history: ScenePing[]
  postalCodes: string[]
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
  elevationM: number | null
  postalCodes: string[]
  lat: number | null
  lon: number | null
  floor: number | null
  bssids: string[]
}
