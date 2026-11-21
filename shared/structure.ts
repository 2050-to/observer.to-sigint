import { haversineMeters } from './geo.js'
import { eastNorthMeters, gpsGround, plottedHeight, STORY_M, type HeightFix } from './height.js'
import type { DeviceRecord, Fix, NetworkRecord, Room } from './types.js'

export interface PlanRoom {
  id: string
  label: string
  originKind: Room['originKind']
  east: number
  north: number
  widthM: number
  depthM: number
  floor: number
}

export interface PlanWall {
  id: string
  roomId: string
  east1: number
  north1: number
  east2: number
  north2: number
  kind: 'exterior' | 'interior'
}

export interface PlanFloor {
  index: number
  label: string
  rooms: PlanRoom[]
  walls: PlanWall[]
}

export interface PlanBuilding {
  id: string
  label: string
  lat: number | null
  lon: number | null
  floors: PlanFloor[]
}

function findRoot(parent: Map<string, string>, id: string): string {
  const next = parent.get(id) ?? id
  if (next === id) return id
  const root = findRoot(parent, next)
  parent.set(id, root)
  return root
}

function heightFor(
  room: Room,
  networks: Pick<NetworkRecord, 'bssid' | 'bestRelativeM' | 'bestAltitudeM' | 'bestVerticalAccuracyM'>[],
  devices: Pick<DeviceRecord, 'address' | 'bestRelativeM' | 'bestAltitudeM' | 'bestVerticalAccuracyM'>[],
  phone: Pick<Fix, 'relativeM' | 'altitudeM' | 'verticalAccuracyM'> | null,
): HeightFix {
  if (room.originBssid) {
    const network = networks.find((item) => item.bssid === room.originBssid)
    if (network && (network.bestRelativeM != null || network.bestAltitudeM != null)) {
      return {
        relativeM: network.bestRelativeM,
        altitudeM: network.bestAltitudeM,
        verticalAccuracyM: network.bestVerticalAccuracyM,
      }
    }
  }
  for (const member of room.members) {
    const device = devices.find((item) => item.address === member.id)
    if (device && (device.bestRelativeM != null || device.bestAltitudeM != null)) {
      return {
        relativeM: device.bestRelativeM,
        altitudeM: device.bestAltitudeM,
        verticalAccuracyM: device.bestVerticalAccuracyM,
      }
    }
  }
  return {
    relativeM: phone?.relativeM ?? null,
    altitudeM: phone?.altitudeM ?? null,
    verticalAccuracyM: phone?.verticalAccuracyM ?? null,
  }
}

function floorIndex(fix: HeightFix, ground: number | null): number {
  return plottedHeight(fix, ground)?.floor ?? 0
}

function buildingLabel(rooms: Room[], index: number): string {
  const counts = new Map<string, number>()
  for (const room of rooms) {
    if (!room.originLabel || room.originLabel === 'Bluetooth' || room.originLabel === 'GPS') continue
    counts.set(room.originLabel, (counts.get(room.originLabel) ?? 0) + 1)
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return best?.[0] ?? `Building ${index + 1}`
}

function placeRooms(rooms: Room[], floors: Map<string, number>, located: boolean): PlanRoom[] {
  const origin = located
    ? {
        lat: rooms.reduce((sum, room) => sum + (room.lat ?? 0), 0) / rooms.length,
        lon: rooms.reduce((sum, room) => sum + (room.lon ?? 0), 0) / rooms.length,
      }
    : null
  const used = new Map<string, number>()
  const cursors = new Map<number, number>()
  return rooms.map((room) => {
    const widthM = Math.max(room.widthM, 2)
    const depthM = Math.max(room.depthM, 2)
    const floor = floors.get(room.id) ?? 0
    let east = 0
    let north = 0
    if (origin && room.lat != null && room.lon != null) {
      const offset = eastNorthMeters(origin.lat, origin.lon, room.lat, room.lon)
      east = offset.east
      north = offset.north
      const slot = `${floor}:${east.toFixed(1)}:${north.toFixed(1)}`
      const duplicate = used.get(slot) ?? 0
      used.set(slot, duplicate + 1)
      if (duplicate > 0) east += duplicate * (widthM + 1)
    } else {
      const cursor = cursors.get(floor) ?? 0
      east = cursor
      cursors.set(floor, cursor + widthM + 2)
    }
    return {
      id: room.id,
      label: room.originLabel,
      originKind: room.originKind,
      east,
      north,
      widthM,
      depthM,
      floor,
    }
  })
}

function wallSegments(room: PlanRoom): PlanWall[] {
  const west = room.east - room.widthM / 2
  const east = room.east + room.widthM / 2
  const south = room.north - room.depthM / 2
  const north = room.north + room.depthM / 2
  return [
    { id: `${room.id}:n`, roomId: room.id, east1: west, north1: north, east2: east, north2: north, kind: 'exterior' },
    { id: `${room.id}:s`, roomId: room.id, east1: west, north1: south, east2: east, north2: south, kind: 'exterior' },
    { id: `${room.id}:e`, roomId: room.id, east1: east, north1: south, east2: east, north2: north, kind: 'exterior' },
    { id: `${room.id}:w`, roomId: room.id, east1: west, north1: south, east2: west, north2: north, kind: 'exterior' },
  ]
}

function inside(room: PlanRoom, east: number, north: number): boolean {
  return Math.abs(east - room.east) <= room.widthM / 2 + 0.3
    && Math.abs(north - room.north) <= room.depthM / 2 + 0.3
}

function classifyWalls(rooms: PlanRoom[], walls: PlanWall[]): PlanWall[] {
  return walls.map((wall) => {
    const midEast = (wall.east1 + wall.east2) / 2
    const midNorth = (wall.north1 + wall.north2) / 2
    const horizontal = Math.abs(wall.north1 - wall.north2) < 0.01
    const outwardEast = horizontal ? 0 : midEast >= rooms.find((room) => room.id === wall.roomId)!.east ? 0.8 : -0.8
    const outwardNorth = horizontal ? (midNorth >= rooms.find((room) => room.id === wall.roomId)!.north ? 0.8 : -0.8) : 0
    const probeEast = midEast + outwardEast
    const probeNorth = midNorth + outwardNorth
    const shared = rooms.some((room) => room.id !== wall.roomId && inside(room, probeEast, probeNorth))
    return shared ? { ...wall, kind: 'interior' } : wall
  })
}

function floorsFrom(rooms: PlanRoom[]): PlanFloor[] {
  const indexes = [...new Set(rooms.map((room) => room.floor))].sort((a, b) => a - b)
  return indexes.map((index) => {
    const onFloor = rooms.filter((room) => room.floor === index).sort((a, b) => a.id.localeCompare(b.id))
    const walls = classifyWalls(onFloor, onFloor.flatMap(wallSegments))
    return {
      index,
      label: `Floor ${index}`,
      rooms: onFloor,
      walls,
    }
  })
}

export function estimateBuildings(
  rooms: Room[],
  context: {
    networks: Pick<NetworkRecord, 'bssid' | 'bestRelativeM' | 'bestAltitudeM' | 'bestVerticalAccuracyM'>[]
    devices: Pick<DeviceRecord, 'address' | 'bestRelativeM' | 'bestAltitudeM' | 'bestVerticalAccuracyM'>[]
    phone: Pick<Fix, 'relativeM' | 'altitudeM' | 'verticalAccuracyM'> | null
  },
): PlanBuilding[] {
  if (rooms.length === 0) return []
  const ground = gpsGround([
    ...(context.phone ? [{ altitudeM: context.phone.altitudeM }] : []),
    ...context.networks.map((network) => ({ altitudeM: network.bestAltitudeM })),
    ...context.devices.map((device) => ({ altitudeM: device.bestAltitudeM })),
  ])
  const floors = new Map(rooms.map((room) => [
    room.id,
    floorIndex(heightFor(room, context.networks, context.devices, context.phone), ground),
  ]))
  const located = rooms.filter((room) => room.lat != null && room.lon != null)
  const loose = rooms.filter((room) => room.lat == null || room.lon == null)
  const parent = new Map(located.map((room) => [room.id, room.id]))
  for (let i = 0; i < located.length; i += 1) {
    for (let j = i + 1; j < located.length; j += 1) {
      const left = located[i]
      const right = located[j]
      const gap = haversineMeters(left.lat!, left.lon!, right.lat!, right.lon!)
      const reach = Math.min(80, Math.max(40, left.radiusM + right.radiusM))
      if (gap <= reach) {
        const a = findRoot(parent, left.id)
        const b = findRoot(parent, right.id)
        if (a !== b) parent.set(a, b)
      }
    }
  }
  const groups = new Map<string, Room[]>()
  for (const room of located) {
    const root = findRoot(parent, room.id)
    const list = groups.get(root) ?? []
    list.push(room)
    groups.set(root, list)
  }
  if (loose.length > 0) groups.set('unlocated', loose)
  return [...groups.values()].map((group, index) => {
    const placed = placeRooms(group, floors, group !== loose)
    const lat = group.every((room) => room.lat != null)
      ? group.reduce((sum, room) => sum + (room.lat ?? 0), 0) / group.length
      : null
    const lon = group.every((room) => room.lon != null)
      ? group.reduce((sum, room) => sum + (room.lon ?? 0), 0) / group.length
      : null
    const id = `building:${group.map((room) => room.id).sort()[0]}`
    return {
      id,
      label: buildingLabel(group, index),
      lat,
      lon,
      floors: floorsFrom(placed),
    }
  }).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
}

export const STORY_HEIGHT_M = STORY_M
