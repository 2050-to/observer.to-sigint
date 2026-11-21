import { collapseScan, mergeRecord, normalizeBssid } from './merge.js'
import { addPostalCode, cleanPostalCode, samePostalCell } from './postal.js'
import { circleFor, snapshotFrom } from './range.js'
import { cellKeyOf, mergeCell, mergeDevice } from './radios.js'
import { inferScene, pingFrom, stripPing, trimHistory } from './scene.js'
import { openRows } from './security.js'
import type { CellRecord, DeviceRecord, Fix, NetworkRecord, OpenRow, RangeSnapshot, ScanAp, ScanCell, ScanDevice } from './types.js'

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
  wifiOn?: boolean
  bluetoothOn?: boolean
  cellOn?: boolean
  networks: ScanAp[]
  devices?: ScanDevice[]
  cells?: ScanCell[]
  uploaded?: boolean
}

export interface LocalCatalog {
  networks: NetworkRecord[]
  devices: DeviceRecord[]
  cells: CellRecord[]
  history: RangeSnapshot['history']
  heardBssids: string[]
  phone: Fix
  postalCodes: string[]
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
    devices: [],
    cells: [],
    history: [],
    heardBssids: [],
    phone: emptyFix(),
    postalCodes: [],
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
  const devices = (catalog.devices ?? []).map((device) => ({ ...device, observations: [...device.observations] }))
  const cells = (catalog.cells ?? []).map((cell) => ({ ...cell, observations: [...cell.observations] }))
  let history = [...(catalog.history ?? [])]
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
    const ping = pingFrom({ ...scan, observedAt: seenAt })
    for (const device of ping.devices) {
      try {
        const index = devices.findIndex((item) => item.address === device.address)
        const merged = mergeDevice(index >= 0 ? devices[index] : null, device, fix, seenAt)
        if (index >= 0) devices[index] = merged
        else devices.unshift(merged)
      } catch {
        continue
      }
    }
    for (const cell of ping.cells) {
      const index = cells.findIndex((item) => item.key === cellKeyOf(cell))
      const merged = mergeCell(index >= 0 ? cells[index] : null, cell, fix, seenAt)
      if (index >= 0) cells[index] = merged
      else cells.unshift(merged)
    }
    history = trimHistory([...history, stripPing(ping)])
    phone = fix
    speedMps = numberOrNull(scan.speedMps)
    heardBssids = heard
    folded.add(scan.scanId)
  }
  return {
    networks,
    devices,
    cells,
    history,
    heardBssids,
    phone,
    postalCodes: catalog.postalCodes ?? [],
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
  server: { networks: NetworkRecord[]; devices?: DeviceRecord[]; cells?: CellRecord[]; snapshot: RangeSnapshot } | null,
): LocalCatalog {
  if (!server) return foldScans(catalog, journal)
  const synced = new Set(catalog.syncedBssids.map((bssid) => bssid.toLowerCase()))
  for (const network of server.networks) synced.add(network.bssid.toLowerCase())
  const uploaded = journal.filter((scan) => scan.uploaded).map((scan) => scan.scanId)
  const base: LocalCatalog = {
    networks: server.networks,
    devices: server.devices ?? [],
    cells: server.cells ?? [],
    history: server.snapshot.history ?? [],
    heardBssids: server.snapshot.heard.map((network) => network.bssid),
    phone: server.snapshot.phone,
    postalCodes: server.snapshot.postalCodes ?? [],
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
  const byAddress = new Map((catalog.devices ?? []).map((device) => [device.address, device]))
  const latest = (catalog.history ?? []).at(-1)
  const heardDevices = (latest?.devices ?? []).flatMap((device) => {
    const record = byAddress.get(device.address)
    return record ? [record] : []
  })
  const scene = inferScene(catalog.history ?? [])
  const range = {
    ...snapshotFrom(heard, catalog.phone, catalog.speedMps, catalog.postalCodes ?? [], heardDevices),
    rooms: scene.rooms,
    movers: scene.movers,
    history: catalog.history ?? [],
  }
  const circle = circleFor(catalog.networks, range)
  return {
    range,
    circle,
    networks: catalog.networks,
    openRows: openRows(catalog.networks),
    count: catalog.networks.length,
  }
}

function heardInCell(
  lat: number,
  lon: number,
  bestLat: number | null,
  bestLon: number | null,
  lastLat: number | null,
  lastLon: number | null,
): boolean {
  const best = bestLat != null && bestLon != null && samePostalCell(lat, lon, bestLat, bestLon)
  const last = lastLat != null && lastLon != null && samePostalCell(lat, lon, lastLat, lastLon)
  return best || last
}

export function stampFixPostalCode(catalog: LocalCatalog, lat: number, lon: number, code: string | null): LocalCatalog {
  if (!cleanPostalCode(code)) return catalog
  return {
    ...catalog,
    postalCodes: addPostalCode(catalog.postalCodes, code),
    networks: catalog.networks.map((network) => (
      heardInCell(lat, lon, network.bestLat, network.bestLon, network.lastLat, network.lastLon)
        ? { ...network, postalCodes: addPostalCode(network.postalCodes, code) }
        : network
    )),
    devices: (catalog.devices ?? []).map((device) => (
      heardInCell(lat, lon, device.bestLat, device.bestLon, device.lastLat, device.lastLon)
        ? { ...device, postalCodes: addPostalCode(device.postalCodes, code) }
        : device
    )),
  }
}
