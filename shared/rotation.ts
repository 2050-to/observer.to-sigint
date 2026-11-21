import { haversineMeters } from './geo.js'
import { distanceFromRssi } from './pathloss.js'
import type { ScenePing } from './types.js'

export interface RotationGroup {
  id: string
  kind: 'wifi' | 'bluetooth'
  addresses: string[]
  rssiDelta: number
  separationM: number
  confidence: number
}

const RSSI_HOLD_DB = 8
const RSSI_STEADY_DB = 10
const GAP_MS = 120_000
const RANGE_SLACK_M = 8

interface Sample {
  at: number
  rssi: number
  lat: number | null
  lon: number | null
  distanceM: number
}

interface Track {
  address: string
  kind: 'wifi' | 'bluetooth'
  samples: Sample[]
}

interface Edge {
  from: number
  to: number
  rssiDelta: number
  separationM: number
  confidence: number
}

function locallyAdministered(bssid: string): boolean {
  const octet = Number.parseInt(bssid.slice(0, 2), 16)
  return Number.isFinite(octet) && (octet & 0x02) !== 0
}

function steady(samples: Sample[]): boolean {
  if (samples.length < 2) return false
  const mean = samples.reduce((sum, sample) => sum + sample.rssi, 0) / samples.length
  const variance = samples.reduce((sum, sample) => sum + (sample.rssi - mean) ** 2, 0) / samples.length
  return Math.sqrt(variance) <= RSSI_STEADY_DB
}

function overlaps(left: Track, right: Track): boolean {
  const leftStart = left.samples[0].at
  const leftEnd = left.samples[left.samples.length - 1].at
  const rightStart = right.samples[0].at
  const rightEnd = right.samples[right.samples.length - 1].at
  return leftStart <= rightEnd && rightStart <= leftEnd
}

function handoff(tracks: Track[], leftIndex: number, rightIndex: number): Edge | null {
  const left = tracks[leftIndex]
  const right = tracks[rightIndex]
  if (left.kind !== right.kind || overlaps(left, right)) return null
  const earlierIndex = left.samples[left.samples.length - 1].at < right.samples[0].at ? leftIndex : rightIndex
  const laterIndex = earlierIndex === leftIndex ? rightIndex : leftIndex
  const earlier = tracks[earlierIndex]
  const later = tracks[laterIndex]
  const tail = earlier.samples[earlier.samples.length - 1]
  const head = later.samples[0]
  const gap = head.at - tail.at
  if (gap <= 0 || gap > GAP_MS) return null
  if (!steady(earlier.samples) && !steady(later.samples)) return null
  const rssiDelta = Math.abs(tail.rssi - head.rssi)
  const allowance = gap <= 15_000 ? RSSI_HOLD_DB : gap <= 60_000 ? 6 : 4
  if (rssiDelta > allowance) return null
  if (tail.lat == null || tail.lon == null || head.lat == null || head.lon == null) return null
  const separationM = haversineMeters(tail.lat, tail.lon, head.lat, head.lon)
  if (separationM > tail.distanceM + head.distanceM) return null
  if (Math.abs(tail.distanceM - head.distanceM) > separationM + RANGE_SLACK_M) return null
  const rssiScore = 1 - rssiDelta / RSSI_HOLD_DB
  const span = tail.distanceM + head.distanceM
  const locScore = span <= 0 ? 1 : 1 - Math.min(1, separationM / span)
  return {
    from: earlierIndex,
    to: laterIndex,
    rssiDelta,
    separationM,
    confidence: (rssiScore + locScore) / 2,
  }
}

function remember(tracks: Map<string, Track>, kind: Track['kind'], address: string, sample: Sample) {
  const key = `${kind}:${address}`
  const track = tracks.get(key) ?? { address, kind, samples: [] }
  track.samples.push(sample)
  tracks.set(key, track)
}

export function findRotatingAddresses(history: ScenePing[]): RotationGroup[] {
  const tracks = new Map<string, Track>()
  const ordered = [...history].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
  for (const ping of ordered) {
    const at = Date.parse(ping.observedAt)
    if (!Number.isFinite(at)) continue
    for (const network of ping.networks) {
      if (!network.bssid || !locallyAdministered(network.bssid)) continue
      remember(tracks, 'wifi', network.bssid, {
        at,
        rssi: network.rssi,
        lat: ping.lat,
        lon: ping.lon,
        distanceM: distanceFromRssi(network.rssi, null),
      })
    }
    for (const device of ping.devices) {
      if (device.addressType !== 'random' || !device.address) continue
      remember(tracks, 'bluetooth', device.address, {
        at,
        rssi: device.rssi,
        lat: ping.lat,
        lon: ping.lon,
        distanceM: distanceFromRssi(device.rssi, device.txPower),
      })
    }
  }

  const list = [...tracks.values()].map((track) => ({
    ...track,
    samples: [...track.samples].sort((a, b) => a.at - b.at),
  }))
  const edges: Edge[] = []
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const edge = handoff(list, i, j)
      if (edge) edges.push(edge)
    }
  }
  edges.sort((a, b) => b.confidence - a.confidence || a.from - b.from || a.to - b.to)
  const next = new Map<number, Edge>()
  const previous = new Set<number>()
  for (const edge of edges) {
    if (next.has(edge.from) || previous.has(edge.to)) continue
    next.set(edge.from, edge)
    previous.add(edge.to)
  }

  const groups: RotationGroup[] = []
  for (let start = 0; start < list.length; start++) {
    if (previous.has(start) || !next.has(start)) continue
    const members = [start]
    const used: Edge[] = []
    let cursor = start
    const seen = new Set<number>([start])
    while (next.has(cursor) && !seen.has(next.get(cursor)!.to)) {
      const edge = next.get(cursor)!
      used.push(edge)
      cursor = edge.to
      seen.add(cursor)
      members.push(cursor)
    }
    const kind = list[start].kind
    const addresses = members.map((index) => list[index].address)
    const rssiDelta = Math.max(...used.map((edge) => edge.rssiDelta))
    const separationM = Math.max(...used.map((edge) => edge.separationM))
    const confidence = used.reduce((sum, edge) => sum + edge.confidence, 0) / used.length
    groups.push({
      id: `rotate:${kind}:${addresses[0]}`,
      kind,
      addresses,
      rssiDelta: Math.round(rssiDelta * 10) / 10,
      separationM: Math.round(separationM),
      confidence: Math.round(confidence * 100) / 100,
    })
  }
  return groups.sort((a, b) => b.confidence - a.confidence || a.addresses[0].localeCompare(b.addresses[0]))
}
