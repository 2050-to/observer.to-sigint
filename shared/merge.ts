import { classifySecurity } from './security.js'
import type { Fix, NetworkRecord, ScanAp } from './types.js'

const BSSID = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i

export function normalizeBssid(value: string): string {
  const bssid = value.trim().toLowerCase()
  if (!BSSID.test(bssid)) throw new Error(`invalid bssid ${value}`)
  return bssid
}

export function nameOf(ssid: string): { ssid: string; hidden: boolean } {
  const trimmed = ssid.trim().replace(/^"|"$/g, '')
  if (!trimmed || trimmed === '<unknown ssid>' || trimmed.toLowerCase() === '<hidden>') {
    return { ssid: '', hidden: true }
  }
  return { ssid: trimmed, hidden: false }
}

export function collapseScan(networks: ScanAp[]): ScanAp[] {
  const byBssid = new Map<string, ScanAp>()
  for (const network of networks) {
    const bssid = normalizeBssid(network.bssid)
    const current = { ...network, bssid }
    const previous = byBssid.get(bssid)
    if (!previous || current.rssi > previous.rssi) byBssid.set(bssid, current)
  }
  return [...byBssid.values()]
}

function distinctChannels(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))].sort((a, b) => a - b)
}

export function mergeRecord(existing: NetworkRecord | null, incoming: ScanAp, fix: Fix, seenAt: string): NetworkRecord {
  const named = nameOf(incoming.ssid)
  const learned = named.hidden ? existing?.ssid ?? '' : named.ssid
  const hidden = learned.length === 0
  const stronger = !existing || incoming.rssi > existing.bestRssi
  const hadHeight = existing?.bestAltitudeM != null || existing?.bestRelativeM != null
  const takeHeight = stronger || (!hadHeight && incoming.rssi >= (existing?.bestRssi ?? incoming.rssi))
  return {
    ssid: learned,
    hidden,
    bssid: normalizeBssid(incoming.bssid),
    frequencyMhz: incoming.frequencyMhz,
    channel: incoming.channel,
    band: incoming.band,
    channelWidthMhz: incoming.channelWidthMhz,
    centerFreq0: incoming.centerFreq0,
    centerFreq1: incoming.centerFreq1,
    lastRssi: incoming.rssi,
    bestRssi: stronger ? incoming.rssi : existing.bestRssi,
    wifiStandard: incoming.wifiStandard,
    security: classifySecurity(incoming.capabilities, incoming.securityTypes),
    securityTypes: incoming.securityTypes,
    capabilities: incoming.capabilities,
    passpoint: incoming.passpoint,
    responder80211mc: incoming.responder80211mc,
    responder80211az: incoming.responder80211az,
    twtResponder: incoming.twtResponder,
    secureHeLtf: incoming.secureHeLtf,
    rangingFrameProtection: incoming.rangingFrameProtection,
    apMldMac: incoming.apMldMac,
    apMloLinkId: incoming.apMloLinkId,
    affiliatedLinks: incoming.affiliatedLinks,
    operatorName: incoming.operatorName,
    venueName: incoming.venueName,
    countryCode: incoming.countryCode,
    maxRateMbps: incoming.maxRateMbps,
    stationCount: incoming.stationCount,
    channelUtilization: incoming.channelUtilization,
    admissionCapacity: incoming.admissionCapacity,
    vendorOuis: incoming.vendorOuis,
    firstSeen: existing?.firstSeen ?? seenAt,
    lastSeen: seenAt,
    lastLat: fix.lat,
    lastLon: fix.lon,
    lastAccuracy: fix.accuracy,
    bestLat: stronger ? fix.lat : existing.bestLat,
    bestLon: stronger ? fix.lon : existing.bestLon,
    bestAccuracy: stronger ? fix.accuracy : existing.bestAccuracy,
    lastAltitudeM: fix.altitudeM,
    lastVerticalAccuracyM: fix.verticalAccuracyM,
    lastRelativeM: fix.relativeM,
    bestAltitudeM: takeHeight ? fix.altitudeM : existing?.bestAltitudeM ?? null,
    bestVerticalAccuracyM: takeHeight ? fix.verticalAccuracyM : existing?.bestVerticalAccuracyM ?? null,
    bestRelativeM: takeHeight ? fix.relativeM : existing?.bestRelativeM ?? null,
    seenCount: (existing?.seenCount ?? 0) + 1,
    channels: distinctChannels([...(existing?.channels ?? []), incoming.channel]),
    place: existing?.place ?? null,
    postalCodes: existing?.postalCodes ?? [],
    enrichment: existing?.enrichment ?? null,
  }
}
