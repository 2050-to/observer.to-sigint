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

export interface RangeSnapshot {
  heard: NetworkRecord[]
  radiusM: number
  phone: Fix
  speedMps: number | null
  dwellSeconds: number
  scanPeriodSeconds: number
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
