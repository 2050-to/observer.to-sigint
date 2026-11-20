import { gpsGround, plottedHeight } from './height.js'
import type { NetworkRecord } from './types.js'

function csvCell(value: string | number | null): string {
  const text = value == null ? '' : String(value)
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

export function catalogCsv(records: NetworkRecord[]): string {
  const ground = gpsGround(records.map((record) => ({ altitudeM: record.bestAltitudeM ?? null })))
  const header = ['last_seen', 'best_rssi', 'lat', 'lon', 'ssid', 'bssid', 'channel', 'security', 'altitude_m', 'floor']
  const lines = records.map((record) => {
    const height = plottedHeight({
      altitudeM: record.bestAltitudeM ?? null,
      verticalAccuracyM: record.bestVerticalAccuracyM ?? null,
      relativeM: record.bestRelativeM ?? null,
    }, ground)
    return [
      record.lastSeen,
      record.bestRssi,
      record.bestLat,
      record.bestLon,
      record.ssid,
      record.bssid,
      record.channel,
      record.security,
      height ? height.meters.toFixed(1) : null,
      height?.floor ?? null,
    ].map(csvCell).join(',')
  })
  return [header.join(','), ...lines].join('\n')
}
