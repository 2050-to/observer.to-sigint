import { gpsGround, plottedHeight } from './height.js'
import type { NetworkRecord, OpenRow, SecurityLabel } from './types.js'

export function classifySecurity(capabilities: string, types: string[]): SecurityLabel {
  const blob = `${capabilities} ${types.join(' ')}`.toUpperCase()
  if (/ENTERPRISE|\bEAP\b|WPA3-ENT/.test(blob)) return 'enterprise'
  if (/SAE|WPA3/.test(blob)) return 'wpa3'
  if (/WPA2|\bRSN\b/.test(blob)) return 'wpa2'
  if (/WPA/.test(blob)) return 'wpa'
  if (/OWE/.test(blob)) return 'owe'
  if (/WEP/.test(blob)) return 'wep'
  return 'open'
}

export function hiddenLabel(bssid: string): string {
  const hex = bssid.replace(/:/g, '').slice(-4).toUpperCase()
  return `Hidden ${hex}`
}

export function openRows(records: NetworkRecord[]): OpenRow[] {
  const ground = gpsGround(records.map((record) => ({ altitudeM: record.bestAltitudeM ?? null })))
  const groups = new Map<string, NetworkRecord[]>()
  for (const record of records) {
    if (record.security !== 'open' && record.security !== 'owe') continue
    const key = record.hidden || !record.ssid ? `hidden:${record.bssid}` : `ssid:${record.ssid}`
    const list = groups.get(key) ?? []
    list.push(record)
    groups.set(key, list)
  }
  return [...groups.values()]
    .map((group) => {
      const best = group.reduce((a, b) => (a.bestRssi >= b.bestRssi ? a : b))
      const latest = group.reduce((a, b) => (a.lastSeen >= b.lastSeen ? a : b))
      const withPlace = group.find((item) => item.place) ?? null
      const channels = [...new Set(group.flatMap((item) => item.channels))].sort((a, b) => a - b)
      return {
        label: best.hidden || !best.ssid ? hiddenLabel(best.bssid) : best.ssid,
        ssid: best.ssid,
        hidden: best.hidden || !best.ssid,
        security: best.security,
        bssidCount: group.length,
        bestRssi: best.bestRssi,
        channels,
        lastSeen: latest.lastSeen,
        address: withPlace?.place?.address ?? null,
        crossStreets: withPlace?.place?.crossStreets ?? [],
        lat: best.bestLat,
        lon: best.bestLon,
        floor: plottedHeight({
          altitudeM: best.bestAltitudeM ?? null,
          verticalAccuracyM: best.bestVerticalAccuracyM ?? null,
          relativeM: best.bestRelativeM ?? null,
        }, ground)?.floor ?? null,
        bssids: group.map((item) => item.bssid),
      }
    })
    .sort((a, b) => b.bestRssi - a.bestRssi)
}
