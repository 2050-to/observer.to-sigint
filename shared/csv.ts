import { gpsGround, plottedHeight } from './height.js'
import type { CellRecord, DeviceEnrichment, DeviceRecord, NetworkRecord, Room } from './types.js'

function csvCell(value: string | number | null): string {
  const text = value == null ? '' : String(value)
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

const ENRICHMENT_HEADER = [
  'manufacturer',
  'model',
  'category',
  'tags',
  'description',
  'support_status',
  'support_url',
  'latest_release_kind',
  'latest_release_version',
  'latest_release_date',
  'release_age_days',
  'release_age_band',
  'risk_level',
  'risk_reasons',
  'vulnerability_ids',
  'cisa_kev',
  'known_exploited',
  'exploit_reference_urls',
  'remediation_prompt',
  'enrichment_confidence',
  'enrichment_sources',
  'enriched_at',
]

function enrichmentCells(enrichment: DeviceEnrichment | null | undefined): (string | number | null)[] {
  if (!enrichment) return ENRICHMENT_HEADER.map(() => null)
  const exploitUrls = [...new Set(enrichment.vulnerabilities.flatMap((item) =>
    item.links
      .filter((link) => link.kind === 'public_exploit' || link.kind === 'poc')
      .map((link) => link.url),
  ))]
  const kev = enrichment.vulnerabilities.filter((item) => item.cisaKev).map((item) => item.id)
  const exploited = enrichment.vulnerabilities.filter((item) => item.knownExploited || item.cisaKev).map((item) => item.id)
  return [
    enrichment.manufacturer,
    enrichment.model,
    enrichment.category,
    enrichment.tags.join('|'),
    enrichment.summary,
    enrichment.supportStatus,
    enrichment.officialSupportUrl,
    enrichment.newestRelease?.kind ?? null,
    enrichment.newestRelease?.version ?? null,
    enrichment.newestRelease?.publishedAt ?? null,
    enrichment.newestRelease?.ageDays ?? null,
    enrichment.newestRelease?.ageBand ?? null,
    enrichment.risk.level,
    enrichment.risk.reasons.join('|'),
    enrichment.vulnerabilities.map((item) => item.id).join('|'),
    kev.join('|'),
    exploited.join('|'),
    exploitUrls.join('|'),
    enrichment.remediationPrompt,
    enrichment.confidence,
    enrichment.sources.map((source) => source.url).join('|'),
    enrichment.lookedUpAt,
  ]
}

export function catalogCsv(records: NetworkRecord[]): string {
  const ground = gpsGround(records.map((record) => ({ altitudeM: record.bestAltitudeM ?? null })))
  const header = ['last_seen', 'best_rssi', 'lat', 'lon', 'ssid', 'bssid', 'channel', 'security', 'altitude_m', 'floor', 'ground_elevation_m', 'postal_codes', ...ENRICHMENT_HEADER]
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
      record.place?.elevationM != null ? record.place.elevationM.toFixed(1) : null,
      (record.postalCodes ?? []).join('|'),
      ...enrichmentCells(record.enrichment),
    ].map(csvCell).join(',')
  })
  const body = [header.join(','), ...lines].join('\n')
  return body
}

export function catalogBundleCsv(records: NetworkRecord[], extras: { devices?: DeviceRecord[]; cells?: CellRecord[]; rooms?: Room[] } = {}): string {
  const sections = [catalogCsv(records)]
  if (extras.devices) {
    const header = ['device_address', 'name', 'address_type', 'best_rssi', 'lat', 'lon', 'last_seen', 'postal_codes', ...ENRICHMENT_HEADER]
    const lines = extras.devices.map((device) => [
      device.address,
      device.name,
      device.addressType,
      device.bestRssi,
      device.bestLat,
      device.bestLon,
      device.lastSeen,
      (device.postalCodes ?? []).join('|'),
      ...enrichmentCells(device.enrichment),
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
