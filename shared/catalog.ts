import { collapseScan, mergeRecord, normalizeBssid } from './merge.js'
import { circleFor, snapshotFrom } from './range.js'
import { openRows } from './security.js'
import type { Fix, NetworkRecord, OpenRow, RangeSnapshot, ScanAp } from './types.js'

export interface JournalScan {
  scanId: string
  observedAt: string
  lat: number | null
  lon: number | null
  accuracy: number | null
  altitudeM: number | null
  verticalAccuracyM: number | null
  relativeM: number | null
  speedMps: number | null
  networks: ScanAp[]
  uploaded?: boolean
}

export interface LocalCatalog {
  networks: NetworkRecord[]
  heardBssids: string[]
  phone: Fix
  foldedScanIds: string[]
  syncedBssids: string[]
  speedMps: number | null
}

export interface PresentedCatalog {
  range: RangeSnapshot
  circle: NetworkRecord[]
  networks: NetworkRecord[]
  openRows: OpenRow[]
  count: number
}

function emptyFix(): Fix {
  return {
    lat: null,
    lon: null,
    accuracy: null,
    altitudeM: null,
    verticalAccuracyM: null,
    relativeM: null,
  }
}

export function emptyCatalog(): LocalCatalog {
  return {
    networks: [],
    heardBssids: [],
    phone: emptyFix(),
    foldedScanIds: [],
    syncedBssids: [],
    speedMps: null,
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function seenAtOf(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return new Date().toISOString()
  return date.toISOString()
}

function fixFrom(scan: JournalScan): Fix {
  return {
    lat: numberOrNull(scan.lat),
    lon: numberOrNull(scan.lon),
    accuracy: numberOrNull(scan.accuracy),
    altitudeM: numberOrNull(scan.altitudeM),
    verticalAccuracyM: numberOrNull(scan.verticalAccuracyM),
    relativeM: numberOrNull(scan.relativeM),
  }
}

function collapseSafe(networks: ScanAp[]): ScanAp[] {
  const valid: ScanAp[] = []
  for (const network of networks) {
    try {
      valid.push({ ...network, bssid: normalizeBssid(network.bssid) })
    } catch {
      continue
    }
  }
  return collapseScan(valid)
}

export function foldScans(catalog: LocalCatalog, scans: JournalScan[]): LocalCatalog {
  const folded = new Set(catalog.foldedScanIds)
  const networks = catalog.networks.map((network) => ({ ...network }))
  let phone = catalog.phone
  let speedMps = catalog.speedMps
  let heardBssids = catalog.heardBssids
  for (const scan of scans) {
    if (!scan.scanId || folded.has(scan.scanId)) continue
    const collapsed = collapseSafe(scan.networks ?? [])
    const fix = fixFrom(scan)
    const seenAt = seenAtOf(scan.observedAt)
    const heard: string[] = []
    for (const ap of collapsed) {
      const index = networks.findIndex((network) => network.bssid === ap.bssid)
      const existing = index >= 0 ? networks[index] : null
      const merged = mergeRecord(existing, ap, fix, seenAt)
      if (index >= 0) networks[index] = merged
      else networks.unshift(merged)
      heard.push(merged.bssid)
    }
    phone = fix
    speedMps = numberOrNull(scan.speedMps)
    heardBssids = heard
    folded.add(scan.scanId)
  }
  return {
    networks,
    heardBssids,
    phone,
    foldedScanIds: [...folded],
    syncedBssids: catalog.syncedBssids,
    speedMps,
  }
}

export function scanHearsSaved(networks: { bssid: string }[], syncedBssids: string[]): boolean {
  const saved = new Set(syncedBssids.map((bssid) => bssid.toLowerCase()))
  if (saved.size === 0) return false
  return networks.some((network) => {
    try {
      return saved.has(normalizeBssid(network.bssid))
    } catch {
      return false
    }
  })
}

export function reconcileCatalog(
  catalog: LocalCatalog,
  journal: JournalScan[],
  server: { networks: NetworkRecord[]; snapshot: RangeSnapshot } | null,
): LocalCatalog {
  if (!server) return foldScans(catalog, journal)
  const synced = new Set(catalog.syncedBssids.map((bssid) => bssid.toLowerCase()))
  for (const network of server.networks) synced.add(network.bssid.toLowerCase())
  const uploaded = journal.filter((scan) => scan.uploaded).map((scan) => scan.scanId)
  const base: LocalCatalog = {
    networks: server.networks,
    heardBssids: server.snapshot.heard.map((network) => network.bssid),
    phone: server.snapshot.phone,
    foldedScanIds: uploaded,
    syncedBssids: [...synced],
    speedMps: server.snapshot.speedMps,
  }
  return foldScans(base, journal.filter((scan) => !scan.uploaded))
}

export function presentCatalog(catalog: LocalCatalog): PresentedCatalog {
  const byBssid = new Map(catalog.networks.map((network) => [network.bssid, network]))
  const heard = catalog.heardBssids.flatMap((bssid) => {
    const network = byBssid.get(bssid)
    return network ? [network] : []
  })
  const range = snapshotFrom(heard, catalog.phone, catalog.speedMps)
  const circle = circleFor(catalog.networks, range)
  return {
    range,
    circle,
    networks: catalog.networks,
    openRows: openRows(catalog.networks),
    count: catalog.networks.length,
  }
}
