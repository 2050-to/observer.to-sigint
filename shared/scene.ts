import { haversineMeters } from './geo.js'
import { eastNorthMeters } from './height.js'
import { distanceFromRssi } from './pathloss.js'
import { collapseCells, collapseDevices } from './radios.js'
import type {
  Capability,
  ContentKind,
  MotionKind,
  MotionTrack,
  Room,
  RoomMember,
  ScanCell,
  ScanDevice,
  ScenePing,
  SpeedKind,
} from './types.js'
import { RUN_LIMIT_MPS } from './types.js'

const STILL_MPS = 1.5
const GAP_MS = 30_000
const HISTORY_LIMIT = 40

export function pingFrom(scan: {
  observedAt: string
  lat?: number | null
  lon?: number | null
  speedMps?: number | null
  wifiOn?: boolean
  bluetoothOn?: boolean
  cellOn?: boolean
  networks?: { bssid: string; ssid: string; rssi: number }[]
  devices?: ScanDevice[]
  cells?: ScanCell[]
}): ScenePing {
  return {
    observedAt: scan.observedAt,
    lat: scan.lat ?? null,
    lon: scan.lon ?? null,
    speedMps: scan.speedMps ?? null,
    wifiOn: Boolean(scan.wifiOn),
    bluetoothOn: Boolean(scan.bluetoothOn),
    cellOn: Boolean(scan.cellOn),
    networks: (scan.networks ?? []).map((network) => ({
      bssid: network.bssid,
      ssid: network.ssid,
      rssi: network.rssi,
    })),
    devices: collapseDevices(scan.devices ?? []),
    cells: collapseCells(scan.cells ?? []),
  }
}

export function stripPing(ping: ScenePing): ScenePing {
  return {
    ...ping,
    devices: ping.devices.map((device) => ({
      address: device.address,
      addressType: device.addressType,
      name: device.name,
      rssi: device.rssi,
      txPower: device.txPower,
      serviceUuids: device.serviceUuids,
    })),
  }
}

export function trimHistory(history: ScenePing[]): ScenePing[] {
  return history.slice(-HISTORY_LIMIT)
}

function deviation(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function still(speed: number | null): boolean {
  return speed == null || speed <= STILL_MPS
}

function contentKind(addressType: string, rssi: number[], present: number, total: number, phoneStill: boolean): ContentKind {
  const spread = deviation(rssi)
  if (addressType === 'public' || (phoneStill && rssi.length >= 2 && spread < 3)) return 'fixed'
  if (addressType === 'random' && (present < total || spread > 6)) return 'carried'
  return 'unknown'
}

function findRoot(parent: Map<string, string>, id: string): string {
  const next = parent.get(id) ?? id
  if (next === id) return id
  const root = findRoot(parent, next)
  parent.set(id, root)
  return root
}

export function inferRooms(pings: ScenePing[]): Room[] {
  const heard = new Map<string, number[]>()
  pings.forEach((ping, index) => {
    for (const device of ping.devices) {
      const list = heard.get(device.address) ?? []
      list.push(index)
      heard.set(device.address, list)
    }
  })
  const core = [...heard.entries()].filter(([, indexes]) => indexes.length >= 2).map(([address]) => address)
  if (core.length === 0) return []
  const parent = new Map(core.map((address) => [address, address]))
  const unite = (left: string, right: string) => {
    const a = findRoot(parent, left)
    const b = findRoot(parent, right)
    if (a !== b) parent.set(a, b)
  }
  for (const ping of pings) {
    const present = [...new Set(ping.devices.map((device) => device.address).filter((address) => parent.has(address)))]
    for (let index = 1; index < present.length; index += 1) unite(present[0], present[index])
  }
  const groups = new Map<string, Set<string>>()
  for (const address of core) {
    const root = findRoot(parent, address)
    const set = groups.get(root) ?? new Set<string>()
    set.add(address)
    groups.set(root, set)
  }
  for (const [address, indexes] of heard) {
    if (parent.has(address)) continue
    for (const index of indexes) {
      const partner = pings[index].devices.find((device) => parent.has(device.address))
      if (!partner) continue
      groups.get(findRoot(parent, partner.address))?.add(address)
      break
    }
  }
  const rooms: Room[] = []
  for (const members of groups.values()) {
    const addresses = [...members].sort()
    const indexes = pings
      .map((ping, index) => (ping.devices.some((device) => members.has(device.address)) ? index : -1))
      .filter((index) => index >= 0)
    const coreIndexes = indexes.filter((index) => pings[index].devices.some((device) => parent.has(device.address) && members.has(device.address)))
    const used = coreIndexes.length > 0 ? coreIndexes : indexes
    const apStats = new Map<string, { ssid: string; rssi: number[] }>()
    for (const index of used) {
      for (const network of pings[index].networks) {
        const stat = apStats.get(network.bssid) ?? { ssid: network.ssid, rssi: [] }
        if (network.ssid) stat.ssid = network.ssid
        stat.rssi.push(network.rssi)
        apStats.set(network.bssid, stat)
      }
    }
    let originBssid: string | null = null
    let originLabel = 'Bluetooth'
    let originKind: Room['originKind'] = 'bluetooth'
    let bestMean = -Infinity
    for (const [bssid, stat] of apStats) {
      if (stat.rssi.length < Math.ceil(used.length / 2)) continue
      const mean = stat.rssi.reduce((sum, value) => sum + value, 0) / stat.rssi.length
      if (mean < -67 || deviation(stat.rssi) > 6 || mean <= bestMean) continue
      bestMean = mean
      originBssid = bssid
      originLabel = stat.ssid || bssid
      originKind = 'wifi'
    }
    const fixes = used
      .map((index) => pings[index])
      .filter((ping) => ping.lat != null && ping.lon != null)
    const lat = fixes.length ? fixes.reduce((sum, ping) => sum + (ping.lat ?? 0), 0) / fixes.length : null
    const lon = fixes.length ? fixes.reduce((sum, ping) => sum + (ping.lon ?? 0), 0) / fixes.length : null
    let travel = 0
    for (let i = 0; i < fixes.length; i += 1) {
      for (let j = i + 1; j < fixes.length; j += 1) {
        travel = Math.max(travel, haversineMeters(fixes[i].lat!, fixes[i].lon!, fixes[j].lat!, fixes[j].lon!))
      }
    }
    const phoneStill = used.every((index) => still(pings[index].speedMps))
    let reach = 1
    const rssiSpread: number[] = []
    const roomMembers: RoomMember[] = []
    for (const address of addresses) {
      const samples = used.flatMap((index) => pings[index].devices.filter((device) => device.address === address))
      if (samples.length === 0) continue
      const distances = samples.map((device) => distanceFromRssi(device.rssi, device.txPower))
      reach = Math.max(reach, ...distances)
      rssiSpread.push(deviation(samples.map((device) => device.rssi)))
      const latest = samples[samples.length - 1]
      roomMembers.push({
        id: address,
        label: latest.name?.trim() || address,
        kind: contentKind(latest.addressType, samples.map((device) => device.rssi), samples.length, used.length, phoneStill),
        distanceM: distances[distances.length - 1] ?? null,
      })
    }
    let eastSpan = 0
    let northSpan = 0
    if (lat != null && lon != null && fixes.length > 1) {
      const offsets = fixes.map((ping) => eastNorthMeters(lat, lon, ping.lat!, ping.lon!))
      eastSpan = Math.max(...offsets.map((item) => item.east)) - Math.min(...offsets.map((item) => item.east))
      northSpan = Math.max(...offsets.map((item) => item.north)) - Math.min(...offsets.map((item) => item.north))
    }
    const spread = rssiSpread.length ? rssiSpread.reduce((sum, value) => sum + value, 0) / rssiSpread.length : 0
    const confidence = Math.round(Math.min(1, used.length / 4) * (1 - Math.min(1, spread / 12)) * 100) / 100
    rooms.push({
      id: `room:${addresses.join('+')}`,
      originKind,
      originLabel,
      originBssid,
      lat,
      lon,
      radiusM: reach + travel,
      widthM: Math.max(eastSpan, 2 * reach),
      depthM: Math.max(northSpan, 2 * reach),
      confidence,
      members: roomMembers,
    })
  }
  return rooms.sort((a, b) => a.id.localeCompare(b.id))
}

interface Sample {
  time: number
  distance: number
  phoneLat: number | null
  phoneLon: number | null
  phoneSpeed: number | null
  broadcastLat: number | null
  broadcastLon: number | null
  label: string
}

interface Span {
  id: string
  label: string
  samples: Sample[]
}

function groupSpans(samples: Sample[], id: string): Span[] {
  const sorted = [...samples].sort((a, b) => a.time - b.time)
  const groups: Sample[][] = []
  for (const sample of sorted) {
    const current = groups[groups.length - 1]
    if (!current || sample.time - current[current.length - 1].time > GAP_MS) groups.push([sample])
    else current.push(sample)
  }
  return groups.map((group) => ({
    id,
    label: group.find((sample) => sample.label)?.label || id,
    samples: group,
  }))
}

function netChange(values: number[]): number {
  return values[values.length - 1] - values[0]
}

function trendsAgree(left: number[], right: number[]): boolean {
  if (left.length < 2 || right.length < 2) return false
  const leftChange = netChange(left)
  const rightChange = netChange(right)
  if (Math.abs(leftChange) < 0.4 || Math.abs(rightChange) < 0.4) return false
  if (Math.sign(leftChange) !== Math.sign(rightChange)) return false
  return Math.abs(leftChange - rightChange) / Math.max(Math.abs(leftChange), Math.abs(rightChange)) < 0.65
}

function groundSpeed(samples: Sample[]): number | null {
  const located = samples.filter((sample) => sample.broadcastLat != null && sample.broadcastLon != null)
  if (located.length < 2) return null
  let meters = 0
  let seconds = 0
  for (let index = 1; index < located.length; index += 1) {
    const dt = (located[index].time - located[index - 1].time) / 1000
    if (dt <= 0) continue
    meters += haversineMeters(located[index - 1].broadcastLat!, located[index - 1].broadcastLon!, located[index].broadcastLat!, located[index].broadcastLon!)
    seconds += dt
  }
  if (seconds <= 0) return null
  return meters / seconds
}

function radialSpeed(samples: Sample[]): number | null {
  let unexplained = 0
  let seconds = 0
  for (let index = 1; index < samples.length; index += 1) {
    const dt = (samples[index].time - samples[index - 1].time) / 1000
    if (dt <= 0) continue
    const change = Math.abs(samples[index].distance - samples[index - 1].distance)
    let phoneMove = 0
    const previous = samples[index - 1]
    const current = samples[index]
    if (previous.phoneLat != null && previous.phoneLon != null && current.phoneLat != null && current.phoneLon != null) {
      phoneMove = haversineMeters(previous.phoneLat, previous.phoneLon, current.phoneLat, current.phoneLon)
    }
    unexplained += Math.max(0, change - phoneMove)
    seconds += dt
  }
  if (seconds <= 0) return null
  return unexplained / seconds
}

function monotonic(distances: number[]): 'approaching' | 'receding' | null {
  if (distances.length < 3) return null
  let down = true
  let up = true
  for (let index = 1; index < distances.length; index += 1) {
    const delta = distances[index] - distances[index - 1]
    if (delta > -0.3) down = false
    if (delta < 0.3) up = false
  }
  if (down) return 'approaching'
  if (up) return 'receding'
  return null
}

function classify(capabilities: Capability[], speed: number | null): { kind: MotionKind; speedKind: SpeedKind } | null {
  if (capabilities.length < 2 || speed == null || speed <= 0.3) return null
  return {
    kind: speed > RUN_LIMIT_MPS ? 'vehicle' : 'person or vehicle',
    speedKind: 'ground',
  }
}

function roomFor(rooms: Room[], address: string): string | null {
  return rooms.find((room) => room.members.some((member) => member.id === address))?.id ?? null
}

export function inferMotion(pings: ScenePing[], rooms: Room[]): MotionTrack[] {
  const ble = new Map<string, Sample[]>()
  const wifi = new Map<string, Sample[]>()
  pings.forEach((ping) => {
    const time = Date.parse(ping.observedAt)
    if (Number.isNaN(time)) return
    for (const device of ping.devices) {
      const list = ble.get(device.address) ?? []
      list.push({
        time,
        distance: distanceFromRssi(device.rssi, device.txPower),
        phoneLat: ping.lat,
        phoneLon: ping.lon,
        phoneSpeed: ping.speedMps,
        broadcastLat: device.broadcastLat ?? null,
        broadcastLon: device.broadcastLon ?? null,
        label: device.name?.trim() || device.address,
      })
      ble.set(device.address, list)
    }
    for (const network of ping.networks) {
      const list = wifi.get(network.bssid) ?? []
      list.push({
        time,
        distance: distanceFromRssi(network.rssi, null),
        phoneLat: ping.lat,
        phoneLon: ping.lon,
        phoneSpeed: ping.speedMps,
        broadcastLat: null,
        broadcastLon: null,
        label: network.ssid || network.bssid,
      })
      wifi.set(network.bssid, list)
    }
  })
  const bleSpans = [...ble.entries()].flatMap(([id, samples]) => groupSpans(samples, id))
  const wifiSpans = [...wifi.entries()].flatMap(([id, samples]) => groupSpans(samples, id))
  const usedBle = new Set<Span>()
  const tracks: MotionTrack[] = []
  for (const radio of bleSpans) {
    let match: { wifi: Span; left: number[]; right: number[] } | null = null
    for (const access of wifiSpans) {
      const byTime = new Map(access.samples.map((sample) => [sample.time, sample.distance]))
      const left: number[] = []
      const right: number[] = []
      for (const sample of radio.samples) {
        const other = byTime.get(sample.time)
        if (other == null) continue
        left.push(sample.distance)
        right.push(other)
      }
      if (!trendsAgree(left, right)) continue
      match = { wifi: access, left, right }
      break
    }
    if (match) {
      usedBle.add(radio)
      const capabilities: Capability[] = ['wifi', 'bluetooth']
      if (radio.samples.some((sample) => sample.broadcastLat != null && sample.broadcastLon != null)) capabilities.push('gps')
      const ground = groundSpeed(radio.samples)
      const radial = radialSpeed(radio.samples)
      const speed = ground ?? radial
      const speedKind: SpeedKind | null = ground != null ? 'ground' : radial != null ? 'radial_lower_bound' : null
      const labeled = classify(capabilities, speed)
      if (!labeled || speed == null || speedKind == null) continue
      const resolvedKind = speedKind === 'radial_lower_bound' && labeled.kind === 'vehicle'
        ? 'vehicle'
        : labeled.kind
      tracks.push({
        id: `track:${match.wifi.id}+${radio.id}@${radio.samples[0].time}`,
        label: radio.label || match.wifi.label,
        roomId: roomFor(rooms, radio.id),
        kind: resolvedKind,
        capabilities,
        speedMps: speed,
        speedKind,
        distanceM: radio.samples[radio.samples.length - 1]?.distance ?? null,
      })
      continue
    }
  }
  for (const radio of bleSpans) {
    if (usedBle.has(radio)) continue
    if (!radio.samples.every((sample) => still(sample.phoneSpeed))) continue
    const direction = monotonic(radio.samples.map((sample) => sample.distance))
    if (!direction) continue
    tracks.push({
      id: `ble:${radio.id}@${radio.samples[0].time}`,
      label: radio.label,
      roomId: roomFor(rooms, radio.id),
      kind: direction,
      capabilities: ['bluetooth'],
      speedMps: radialSpeed(radio.samples),
      speedKind: 'radial_lower_bound',
      distanceM: radio.samples[radio.samples.length - 1]?.distance ?? null,
    })
  }
  for (const room of rooms) {
    const fixed = room.members.filter((member) => member.kind === 'fixed')
    if (fixed.length < 3) continue
    const jumpy = fixed.filter((member) => {
      const rssi = pings.flatMap((ping) => ping.devices.filter((device) => device.address === member.id).map((device) => device.rssi))
      return deviation(rssi) >= 8
    })
    if (jumpy.length < 3) continue
    if (jumpy.some((member) => tracks.some((track) => track.kind === 'approaching' || track.kind === 'receding') && tracks.some((track) => track.id.includes(member.id)))) continue
    tracks.push({
      id: `shadow:${room.id}`,
      label: 'Body shadow',
      roomId: room.id,
      kind: 'body shadow',
      capabilities: [],
      speedMps: null,
      speedKind: null,
      distanceM: null,
    })
  }
  const latest = [...pings].reverse().find((ping) => ping.speedMps != null && ping.lat != null && ping.lon != null)
  if (latest?.speedMps != null) {
    const capabilities: Capability[] = []
    if (latest.wifiOn) capabilities.push('wifi')
    if (latest.bluetoothOn) capabilities.push('bluetooth')
    if (latest.cellOn) capabilities.push('cell')
    if (latest.lat != null && latest.lon != null) capabilities.push('gps')
    const labeled = classify(capabilities, latest.speedMps)
    if (labeled) {
      tracks.push({
        id: 'phone',
        label: 'This phone',
        roomId: null,
        kind: latest.speedMps > RUN_LIMIT_MPS ? 'vehicle' : 'person or vehicle',
        capabilities,
        speedMps: latest.speedMps,
        speedKind: 'ground',
        distanceM: null,
      })
    }
  }
  return tracks
}

export function inferScene(pings: ScenePing[]): { rooms: Room[]; movers: MotionTrack[] } {
  const rooms = inferRooms(pings)
  return { rooms, movers: inferMotion(pings, rooms) }
}
