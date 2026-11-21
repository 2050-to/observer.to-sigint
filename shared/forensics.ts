import { accessPointByBssid, groupAccessPoints, groupAdvertisers, type AccessPoint } from './accessPoints.js'
import { catalogBundleCsv } from './csv.js'
import { gpsGround, plottedHeight } from './height.js'
import type { CellRecord, DeviceEnrichment, DeviceRecord, NetworkRecord, Room } from './types.js'

export interface CatalogExtras {
  devices?: DeviceRecord[]
  cells?: CellRecord[]
  rooms?: Room[]
}

function shown(value: string | number | null | undefined): string {
  if (value == null || value === '') return 'Unknown'
  return String(value).replace(/[`\r\n]+/g, ' ').trim() || 'Unknown'
}

function field(label: string, value: string | number | null | undefined): string {
  return `- ${label}: ${shown(value)}`
}

function coordinates(lat: number | null, lon: number | null): string | null {
  if (lat == null || lon == null) return null
  return `${lat}, ${lon}`
}

function hasPublicExploit(enrichment: DeviceEnrichment): boolean {
  return enrichment.vulnerabilities.some((item) =>
    item.publicExploit || item.links.some((link) => link.kind === 'public_exploit' || link.kind === 'poc'),
  )
}

function sourceUrls(enrichment: DeviceEnrichment): string[] {
  const urls = enrichment.sources
    .filter((source) => source.kind !== 'public_exploit' && source.kind !== 'poc')
    .map((source) => source.url)
  return [...new Set(urls)]
}

function enrichmentFields(enrichment: DeviceEnrichment | null | undefined): string[] {
  if (!enrichment) return []
  const kev = enrichment.vulnerabilities.some((item) => item.cisaKev)
  const urls = sourceUrls(enrichment)
  return [
    field('Manufacturer', enrichment.manufacturer),
    field('Model', enrichment.model),
    field('Risk', enrichment.risk.level),
    field('Vulnerability IDs', enrichment.vulnerabilities.map((item) => item.id).join(', ')),
    field('CISA KEV', kev ? 'yes' : 'no'),
    field('Official support', enrichment.officialSupportUrl),
    field('Sources', urls.join(', ')),
    field('Public exploit reference', hasPublicExploit(enrichment) ? 'yes' : 'no'),
  ]
}

function wifiBlock(record: NetworkRecord, ground: number | null, ap: AccessPoint | undefined): string {
  const height = plottedHeight({
    altitudeM: record.bestAltitudeM ?? null,
    verticalAccuracyM: record.bestVerticalAccuracyM ?? null,
    relativeM: record.bestRelativeM ?? null,
  }, ground)
  const lines = [
    `### ${record.bssid}`,
    '',
    field('SSID', record.hidden || !record.ssid ? 'Hidden' : record.ssid),
    field('BSSID', record.bssid),
    field('Access point', ap ? `${ap.label} (${ap.id})` : null),
    field('Security', record.security),
    field('Channel', record.channel),
    field('Best RSSI', `${record.bestRssi} dBm`),
    field('Seen', record.seenCount),
    field('First seen', record.firstSeen),
    field('Last seen', record.lastSeen),
    field('Coordinates', coordinates(record.bestLat, record.bestLon)),
    field('Address', record.place?.address ?? null),
    field('Postal codes', (record.postalCodes ?? []).join(', ')),
    field('Floor', height?.floor ?? null),
    ...enrichmentFields(record.enrichment),
  ]
  return lines.join('\n')
}

function deviceBlock(device: DeviceRecord): string {
  return [
    `### ${device.address}`,
    '',
    field('Name', device.name),
    field('Address', device.address),
    field('Address type', device.addressType),
    field('Best RSSI', `${device.bestRssi} dBm`),
    field('Coordinates', coordinates(device.bestLat, device.bestLon)),
    field('Last seen', device.lastSeen),
    field('Postal codes', (device.postalCodes ?? []).join(', ')),
    ...enrichmentFields(device.enrichment),
  ].join('\n')
}

function cellBlock(cell: CellRecord): string {
  return [
    `### ${cell.key}`,
    '',
    field('Key', cell.key),
    field('Role', cell.role),
    field('Radio', cell.radio),
    field('MCC', cell.mcc),
    field('MNC', cell.mnc),
    field('Area', cell.area),
    field('Cell ID', cell.cellId),
    field('Best RSSI', `${cell.bestRssi} dBm`),
    field('Heard coordinates', coordinates(cell.bestLat, cell.bestLon)),
    field('Site coordinates', coordinates(cell.siteLat, cell.siteLon)),
    field('Site error', cell.siteErrorM == null ? null : `${cell.siteErrorM} m`),
  ].join('\n')
}

function roomBlock(room: Room): string {
  return [
    `### ${room.id}`,
    '',
    field('Origin', room.originKind),
    field('Label', room.originLabel),
    field('Radius', `${room.radiusM.toFixed(1)} m`),
    field('Width', `${room.widthM.toFixed(1)} m`),
    field('Depth', `${room.depthM.toFixed(1)} m`),
    field('Confidence', room.confidence),
    field('Members', room.members.map((member) => member.label).join(', ')),
  ].join('\n')
}

function section(title: string, blocks: string[]): string {
  if (blocks.length === 0) return `## ${title}\n\nNone.`
  return [`## ${title}`, '', blocks.join('\n\n')].join('\n')
}

function span(values: string[]): { first: string | null; last: string | null } {
  const stamps = values.filter((value) => value).sort()
  return {
    first: stamps[0] ?? null,
    last: stamps[stamps.length - 1] ?? null,
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function catalogForensicsMarkdown(
  records: NetworkRecord[],
  extras: CatalogExtras = {},
  generatedAt: string,
): Promise<string> {
  const devices = extras.devices ?? []
  const cells = extras.cells ?? []
  const rooms = extras.rooms ?? []
  const hash = await sha256(catalogBundleCsv(records, extras))
  const window = span([
    ...records.flatMap((record) => [record.firstSeen, record.lastSeen]),
    ...devices.flatMap((device) => [device.firstSeen, device.lastSeen]),
    ...cells.flatMap((cell) => [cell.firstSeen, cell.lastSeen]),
  ])
  const ground = gpsGround(records.map((record) => ({ altitudeM: record.bestAltitudeM ?? null })))
  const accessPoints = groupAccessPoints(records)
  const accessPointOf = accessPointByBssid(accessPoints)
  const parts = [
    '# Digital forensics report',
    '',
    `Generated: ${shown(generatedAt)}`,
    '',
    'Passive broadcast observations only. No association, no payload capture, and no exploit content. Each BSSID, Bluetooth address, and cell identity stays its own observation. Access points and Bluetooth advertiser groups are inferred from sibling addresses and matching names heard nearby, and the records stay separate.',
    '',
    '## Summary',
    '',
    field('Wi-Fi radios', records.length),
    field('Access points', accessPoints.length),
    field('Bluetooth advertisements', devices.length),
    field('Bluetooth advertiser groups', groupAdvertisers(devices).length),
    field('Cell sites', cells.length),
    field('Rooms', rooms.length),
    field('First seen', window.first),
    field('Last seen', window.last),
    field('SHA-256 of the companion CSV', hash),
    '',
    section('Wi-Fi', records.map((record) => wifiBlock(record, ground, accessPointOf.get(record.bssid)))),
    '',
    section('Bluetooth', devices.map((device) => deviceBlock(device))),
    '',
    section('Cell', cells.map((cell) => cellBlock(cell))),
    '',
    section('Rooms', rooms.map((room) => roomBlock(room))),
    '',
    '## Limits',
    '',
    'The saved point is where the phone heard the strongest signal. Enrichment describes public research about a title, not the installed firmware.',
    '',
  ]
  return parts.join('\n')
}
