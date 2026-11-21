import { clampRadius, DEFAULT_RADIUS_M, timingFor } from './dwell.js'
import { haversineMeters } from './geo.js'
import type { Fix, NetworkRecord, RangeSnapshot } from './types.js'

export function radiusOf(phone: Fix, heard: NetworkRecord[]): number {
  if (phone.lat == null || phone.lon == null) return DEFAULT_RADIUS_M
  let farthest = 0
  for (const network of heard) {
    if (network.bestLat == null || network.bestLon == null) continue
    farthest = Math.max(farthest, haversineMeters(phone.lat, phone.lon, network.bestLat, network.bestLon))
  }
  if (farthest < 10) return DEFAULT_RADIUS_M
  return clampRadius(farthest)
}

export function snapshotFrom(
  heard: NetworkRecord[],
  phone: Fix,
  speedMps: number | null,
  postalCodes: string[] = [],
): RangeSnapshot {
  const radiusM = radiusOf(phone, heard)
  const timing = timingFor(radiusM, speedMps)
  return {
    heard,
    radiusM,
    phone,
    speedMps,
    dwellSeconds: timing.dwellSeconds,
    scanPeriodSeconds: timing.scanPeriodSeconds,
    rooms: [],
    movers: [],
    history: [],
    postalCodes,
  }
}

export function circleFor(networks: NetworkRecord[], snapshot: RangeSnapshot): NetworkRecord[] {
  if (snapshot.phone.lat == null || snapshot.phone.lon == null) return []
  const { lat, lon } = snapshot.phone
  return networks.filter((network) => {
    if (network.bestLat == null || network.bestLon == null) return false
    return haversineMeters(lat, lon, network.bestLat, network.bestLon) <= snapshot.radiusM
  })
}
