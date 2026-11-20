import { gpsGround, plottedHeight } from './height.js'
import type { CellRecord, DeviceRecord, NetworkRecord, Room } from './types.js'

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
  const body = [header.join(','), ...lines].join('\n')
  return body
}

export function catalogBundleCsv(records: NetworkRecord[], extras: { devices?: DeviceRecord[]; cells?: CellRecord[]; rooms?: Room[] } = {}): string {
  const sections = [catalogCsv(records)]
  if (extras.devices) {
    const header = ['device_address', 'name', 'address_type', 'best_rssi', 'lat', 'lon', 'last_seen']
    const lines = extras.devices.map((device) => [
      device.address,
      device.name,
      device.addressType,
      device.bestRssi,
      device.bestLat,
      device.bestLon,
      device.lastSeen,
    ].map(csvCell).join(','))
    sections.push([header.join(','), ...lines].join('\n'))
  }
  if (extras.cells) {
    const header = ['cell_key', 'role', 'radio', 'mcc', 'mnc', 'area', 'cell_id', 'best_rssi', 'heard_lat', 'heard_lon', 'site_lat', 'site_lon', 'site_error_m']
    const lines = extras.cells.map((cell) => [
      cell.key,
      cell.role,
      cell.radio,
      cell.mcc,
      cell.mnc,
      cell.area,
      cell.cellId,
      cell.bestRssi,
      cell.bestLat,
      cell.bestLon,
      cell.siteLat,
      cell.siteLon,
      cell.siteErrorM,
    ].map(csvCell).join(','))
    sections.push([header.join(','), ...lines].join('\n'))
  }
  if (extras.rooms) {
    const header = ['room_id', 'origin_kind', 'origin_label', 'radius_m', 'width_m', 'depth_m', 'confidence', 'members']
    const lines = extras.rooms.map((room) => [
      room.id,
      room.originKind,
      room.originLabel,
      room.radiusM.toFixed(1),
      room.widthM.toFixed(1),
      room.depthM.toFixed(1),
      room.confidence,
      room.members.map((member) => member.label).join(' '),
    ].map(csvCell).join(','))
    sections.push([header.join(','), ...lines].join('\n'))
  }
  return sections.join('\n')
}
