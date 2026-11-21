import type { CellRecord, DeviceRecord, Fix, MotionTrack, NetworkRecord, Room } from './types.js'

export type SignalKind = 'wifi' | 'bluetooth' | 'gps' | 'cell'

export const SIGNAL_KINDS: SignalKind[] = ['wifi', 'bluetooth', 'gps', 'cell']

export const SIGNAL_COLORS: Record<SignalKind, string> = {
  wifi: '#3d8bfd',
  bluetooth: '#c9a0dc',
  gps: '#7dcea0',
  cell: '#e6a23c',
}

export const SIGNAL_NAMES: Record<SignalKind, string> = {
  wifi: 'Wi-Fi',
  bluetooth: 'Bluetooth',
  gps: 'GPS',
  cell: 'Cell',
}

export interface SignalRow {
  kind: SignalKind
  title: string
  detail: string
}

export interface StackedDevice {
  id: string
  label: string
  signals: SignalRow[]
  keys: string[]
}

export function signalKinds(signals: SignalRow[]): SignalKind[] {
  return SIGNAL_KINDS.filter((kind) => signals.some((signal) => signal.kind === kind))
}

function coords(lat: number | null, lon: number | null): string | null {
  if (lat == null || lon == null) return null
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`
}

function addGps(signals: SignalRow[], detail: string | null) {
  if (!detail) return
  if (signals.some((signal) => signal.kind === 'gps')) return
  signals.push({ kind: 'gps', title: 'Fix', detail })
}

function rootOf(parent: Map<string, string>, id: string): string {
  const next = parent.get(id) ?? id
  if (next === id) return id
  const root = rootOf(parent, next)
  parent.set(id, root)
  return root
}

function unite(parent: Map<string, string>, left: string, right: string) {
  const a = rootOf(parent, left)
  const b = rootOf(parent, right)
  if (a !== b) parent.set(a, b)
}

function pairKeys(mover: MotionTrack): string[] {
  const matched = /^track:([^@+]+)\+([^@]+)@/.exec(mover.id)
  if (!matched) return []
  const keys: string[] = []
  if (mover.capabilities.includes('wifi')) keys.push(matched[1])
  if (mover.capabilities.includes('bluetooth')) keys.push(matched[2])
  return keys
}

export function stackSignals(input: {
  networks: Pick<NetworkRecord, 'bssid' | 'ssid' | 'hidden' | 'bestRssi' | 'bestLat' | 'bestLon'>[]
  devices: Pick<DeviceRecord, 'address' | 'name' | 'lastRssi' | 'bestLat' | 'bestLon'>[]
  cells: Pick<CellRecord, 'key' | 'radio' | 'cellId' | 'role' | 'lastRssi' | 'siteLat' | 'siteLon' | 'bestLat' | 'bestLon'>[]
  movers: MotionTrack[]
  phone: Fix | null
}): StackedDevice[] {
  const devices: StackedDevice[] = []
  for (const network of input.networks) {
    const title = network.hidden || !network.ssid ? network.bssid : network.ssid
    const signals: SignalRow[] = [{
      kind: 'wifi',
      title,
      detail: `${Math.round(network.bestRssi)} dBm · ${network.bssid}`,
    }]
    addGps(signals, coords(network.bestLat, network.bestLon))
    devices.push({ id: `wifi:${network.bssid}`, label: title, signals, keys: [network.bssid, `wifi:${network.bssid}`] })
  }
  for (const device of input.devices) {
    const title = device.name?.trim() || device.address
    const signals: SignalRow[] = [{
      kind: 'bluetooth',
      title,
      detail: `${Math.round(device.lastRssi)} dBm · ${device.address}`,
    }]
    addGps(signals, coords(device.bestLat, device.bestLon))
    devices.push({ id: `bluetooth:${device.address}`, label: title, signals, keys: [device.address, `bluetooth:${device.address}`] })
  }
  for (const cell of input.cells) {
    const title = `${cell.radio.toUpperCase()} ${cell.cellId}`
    const signals: SignalRow[] = [{
      kind: 'cell',
      title,
      detail: `${cell.role} · ${Math.round(cell.lastRssi)} dBm`,
    }]
    const lat = cell.siteLat ?? cell.bestLat
    const lon = cell.siteLon ?? cell.bestLon
    addGps(signals, coords(lat, lon))
    devices.push({ id: `cell:${cell.key}`, label: title, signals, keys: [cell.key, `cell:${cell.key}`] })
  }
  if (input.phone) {
    const signals: SignalRow[] = []
    const phoneMover = input.movers.find((mover) => mover.id === 'phone')
    for (const kind of phoneMover?.capabilities ?? []) {
      if (kind === 'gps') continue
      const speed = phoneMover?.speedMps
      signals.push({
        kind,
        title: 'This device',
        detail: speed == null ? 'Heard on this device' : `${speed.toFixed(1)} m/s`,
      })
    }
    addGps(signals, coords(input.phone.lat, input.phone.lon))
    if (signals.length > 0) {
      devices.push({ id: 'phone', label: 'This device', signals, keys: ['phone'] })
    }
  }

  const parent = new Map(devices.map((device) => [device.id, device.id]))
  const byKey = new Map<string, string>()
  for (const device of devices) {
    for (const key of device.keys) byKey.set(key, device.id)
  }
  for (const mover of input.movers) {
    const keys = pairKeys(mover).map((key) => byKey.get(key)).filter((id): id is string => Boolean(id))
    for (let index = 1; index < keys.length; index += 1) unite(parent, keys[0], keys[index])
    if (keys[0]) byKey.set(mover.id, keys[0])
  }

  const groups = new Map<string, StackedDevice[]>()
  for (const device of devices) {
    const root = rootOf(parent, device.id)
    const list = groups.get(root) ?? []
    list.push(device)
    groups.set(root, list)
  }
  return [...groups.values()].map((group) => {
    const signals: SignalRow[] = []
    const seen = new Set<string>()
    for (const device of group) {
      for (const signal of device.signals) {
        const mark = `${signal.kind}|${signal.title}|${signal.detail}`
        if (seen.has(mark)) continue
        seen.add(mark)
        signals.push(signal)
      }
    }
    const keys = [...new Set(group.flatMap((device) => device.keys))].sort()
    const label = group.find((device) => device.label && !device.label.includes(':'))?.label ?? group[0].label
    return { id: keys[0] ?? group[0].id, label, signals, keys }
  }).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
}

export function roomSignals(room: Room): SignalRow[] {
  const signals: SignalRow[] = []
  if (!(room.originKind === 'bluetooth' && room.members.length > 0)) {
    signals.push({
      kind: room.originKind,
      title: room.originLabel,
      detail: `${Math.round(room.radiusM)} m radius`,
    })
  }
  for (const member of room.members) {
    if (signals.some((signal) => signal.kind === 'bluetooth' && signal.title === member.label)) continue
    signals.push({
      kind: 'bluetooth',
      title: member.label,
      detail: member.distanceM == null ? member.kind : `${member.distanceM.toFixed(0)} m`,
    })
  }
  if (room.lat != null && room.lon != null && !signals.some((signal) => signal.kind === 'gps')) {
    signals.push({ kind: 'gps', title: 'Fix', detail: `${room.lat.toFixed(5)}, ${room.lon.toFixed(5)}` })
  }
  return signals
}

export function moverSignals(mover: MotionTrack): SignalRow[] {
  const speed = mover.speedMps == null ? mover.kind : `${mover.kind} · ${mover.speedMps.toFixed(1)} m/s`
  return mover.capabilities.map((kind) => ({ kind, title: mover.label, detail: speed }))
}

export function stackFor(devices: StackedDevice[], key: string): StackedDevice | null {
  return devices.find((device) => device.id === key || device.keys.includes(key)) ?? null
}

export function segmentSignals(devices: StackedDevice[]): { kind: SignalKind; devices: StackedDevice[] }[] {
  return SIGNAL_KINDS.flatMap((kind) => {
    const matched = devices.filter((device) => device.signals.some((signal) => signal.kind === kind))
    return matched.length > 0 ? [{ kind, devices: matched }] : []
  })
}
