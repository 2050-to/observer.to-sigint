import { haversineMeters } from './geo.js'
import { eastNorthMeters, latLonFromEastNorth } from './height.js'
import { coarseCellRangeM, distanceFromRssi } from './pathloss.js'
import type { CellRecord, DeviceRecord, Fix, ScanCell, ScanDevice, SignalObservation } from './types.js'

const MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i
const OBSERVATION_CAP = 40
const SITE_SPREAD_M = 100

export function normalizeMac(value: string): string {
  const mac = value.trim().toLowerCase()
  if (!MAC.test(mac)) throw new Error(`invalid address ${value}`)
  return mac
}

export function cellKeyOf(cell: Pick<ScanCell, 'radio' | 'mcc' | 'mnc' | 'area' | 'cellId'>): string {
  return [cell.radio, cell.mcc, cell.mnc, cell.area, cell.cellId].join(':').toLowerCase()
}

export function collapseDevices(devices: ScanDevice[]): ScanDevice[] {
  const byAddress = new Map<string, ScanDevice>()
  for (const device of devices) {
    let address: string
    try {
      address = normalizeMac(device.address)
    } catch {
      continue
    }
    const current = { ...device, address }
    const previous = byAddress.get(address)
    if (!previous || current.rssi > previous.rssi) byAddress.set(address, current)
  }
  return [...byAddress.values()]
}

export function collapseCells(cells: ScanCell[]): ScanCell[] {
  const byKey = new Map<string, ScanCell>()
  for (const cell of cells) {
    if (!cell.mcc || !cell.mnc || !cell.area || !cell.cellId) continue
    const current = { ...cell, mcc: cell.mcc.trim(), mnc: cell.mnc.trim(), area: cell.area.trim(), cellId: String(cell.cellId).trim() }
    const key = cellKeyOf(current)
    const previous = byKey.get(key)
    if (!previous || current.rssi > previous.rssi) {
      byKey.set(key, { ...current, registered: current.registered || previous?.registered || false })
    } else if (current.registered) {
      byKey.set(key, { ...previous, registered: true })
    }
  }
  return [...byKey.values()]
}

function separation(a: SignalObservation, b: SignalObservation): number {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return 0
  return haversineMeters(a.lat, a.lon, b.lat, b.lon)
}

export function rememberObservation(existing: SignalObservation[], next: SignalObservation): SignalObservation[] {
  const kept = [...existing, next]
  if (kept.length <= OBSERVATION_CAP) return kept
  let drop = 0
  let closest = Infinity
  for (let i = 0; i < kept.length - 1; i += 1) {
    let nearest = Infinity
    for (let j = 0; j < kept.length; j += 1) {
      if (i === j) continue
      nearest = Math.min(nearest, separation(kept[i], kept[j]))
    }
    if (nearest < closest) {
      closest = nearest
      drop = i
    }
  }
  kept.splice(drop, 1)
  return kept
}

function sameUuids(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])].sort()
}

export function mergeDevice(existing: DeviceRecord | null, incoming: ScanDevice, fix: Fix, seenAt: string): DeviceRecord {
  const address = normalizeMac(incoming.address)
  const stronger = !existing || incoming.rssi > existing.bestRssi
  const hadHeight = existing?.bestAltitudeM != null || existing?.bestRelativeM != null
  const takeHeight = stronger || (!hadHeight && incoming.rssi >= (existing?.bestRssi ?? incoming.rssi))
  const observation: SignalObservation = {
    observedAt: seenAt,
    lat: fix.lat,
    lon: fix.lon,
    rssi: incoming.rssi,
    distanceM: distanceFromRssi(incoming.rssi, incoming.txPower),
  }
  return {
    address,
    addressType: incoming.addressType === 'public' ? 'public' : 'random',
    name: incoming.name?.trim() || existing?.name || null,
    txPower: incoming.txPower ?? existing?.txPower ?? null,
    serviceUuids: sameUuids(existing?.serviceUuids ?? [], incoming.serviceUuids ?? []),
    lastRssi: incoming.rssi,
    bestRssi: stronger ? incoming.rssi : existing.bestRssi,
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
    observations: rememberObservation(existing?.observations ?? [], observation),
  }
}

interface LocalRing {
  east: number
  north: number
  range: number
}

function intersections(a: LocalRing, b: LocalRing): { east: number; north: number }[] {
  const dx = b.east - a.east
  const dy = b.north - a.north
  const distance = Math.hypot(dx, dy)
  if (distance < 1e-3) return []
  const along = (distance * distance + a.range * a.range - b.range * b.range) / (2 * distance)
  const off2 = a.range * a.range - along * along
  if (off2 < -25) return []
  const off = Math.sqrt(Math.max(0, off2))
  const baseEast = a.east + (dx / distance) * along
  const baseNorth = a.north + (dy / distance) * along
  const rx = -dy / distance
  const ry = dx / distance
  if (off < 1) return [{ east: baseEast, north: baseNorth }]
  return [
    { east: baseEast + rx * off, north: baseNorth + ry * off },
    { east: baseEast - rx * off, north: baseNorth - ry * off },
  ]
}

export function estimateSite(record: Pick<CellRecord, 'observations'>): { siteLat: number | null; siteLon: number | null; siteErrorM: number | null } {
  const points = record.observations.filter((item) => item.lat != null && item.lon != null && item.distanceM != null && item.distanceM > 0)
  let spread = 0
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      spread = Math.max(spread, haversineMeters(points[i].lat!, points[i].lon!, points[j].lat!, points[j].lon!))
    }
  }
  if (spread < SITE_SPREAD_M || points.length < 2) return { siteLat: null, siteLon: null, siteErrorM: null }
  let pairA = 0
  let pairB = 1
  let widest = 0
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const gap = haversineMeters(points[i].lat!, points[i].lon!, points[j].lat!, points[j].lon!)
      if (gap > widest) {
        widest = gap
        pairA = i
        pairB = j
      }
    }
  }
  const origin = points[pairA]
  const local = points.map((point) => {
    const { east, north } = eastNorthMeters(origin.lat!, origin.lon!, point.lat!, point.lon!)
    return { east, north, range: point.distanceM! }
  })
  const choices = intersections(local[pairA], local[pairB])
  if (choices.length === 0) return { siteLat: null, siteLon: null, siteErrorM: null }
  let best = choices[0]
  let bestError = Infinity
  for (const choice of choices) {
    const error = local.reduce((sum, point) => sum + Math.abs(Math.hypot(choice.east - point.east, choice.north - point.north) - point.range), 0) / local.length
    if (error < bestError) {
      best = choice
      bestError = error
    }
  }
  const site = latLonFromEastNorth(origin.lat!, origin.lon!, best.east, best.north)
  return { siteLat: site.lat, siteLon: site.lon, siteErrorM: bestError }
}

export function mergeCell(existing: CellRecord | null, incoming: ScanCell, fix: Fix, seenAt: string): CellRecord {
  const key = cellKeyOf(incoming)
  const stronger = !existing || incoming.rssi > existing.bestRssi
  const hadHeight = existing?.bestAltitudeM != null || existing?.bestRelativeM != null
  const takeHeight = stronger || (!hadHeight && incoming.rssi >= (existing?.bestRssi ?? incoming.rssi))
  const distanceM = incoming.timingAdvanceM ?? coarseCellRangeM(incoming.rssi)
  const observation: SignalObservation = {
    observedAt: seenAt,
    lat: fix.lat,
    lon: fix.lon,
    rssi: incoming.rssi,
    distanceM,
  }
  const merged: CellRecord = {
    key,
    radio: incoming.radio,
    role: existing?.role === 'serving' || incoming.registered ? 'serving' : 'remote',
    mcc: incoming.mcc,
    mnc: incoming.mnc,
    area: incoming.area,
    cellId: incoming.cellId,
    pci: incoming.pci ?? existing?.pci ?? null,
    lastRssi: incoming.rssi,
    bestRssi: stronger ? incoming.rssi : existing.bestRssi,
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
    timingAdvanceM: incoming.timingAdvanceM ?? existing?.timingAdvanceM ?? null,
    seenCount: (existing?.seenCount ?? 0) + 1,
    observations: rememberObservation(existing?.observations ?? [], observation),
    siteLat: null,
    siteLon: null,
    siteErrorM: null,
  }
  return { ...merged, ...estimateSite(merged) }
}
