import {
  groupAccessPoints,
  groupAdvertisers,
  labelIds,
  UNNAMED_BLUETOOTH,
  type AccessPoint,
  type AdvertiserGroup,
} from './accessPoints.js'
import type { CellRecord, DeviceEnrichment, DeviceRecord, Fix, MotionTrack, NetworkRecord, Room } from './types.js'

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
  labelIds: string[]
  signals: SignalRow[]
  keys: string[]
  enrichments: DeviceEnrichment[]
}

type StackNetwork = Pick<NetworkRecord, 'bssid' | 'ssid' | 'hidden' | 'bestRssi' | 'bestLat' | 'bestLon' | 'enrichment'>
  & Partial<Pick<NetworkRecord, 'band' | 'apMldMac' | 'affiliatedLinks'>>
type StackDevice = Pick<DeviceRecord, 'address' | 'name' | 'lastRssi' | 'bestRssi' | 'bestLat' | 'bestLon' | 'enrichment'>

interface StackUnit extends StackedDevice {
  slot: string
  named: boolean
  linkable: boolean
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

function firstFix(items: Pick<NetworkRecord, 'bestLat' | 'bestLon'>[]): string | null {
  const located = items.find((item) => item.bestLat != null && item.bestLon != null)
  return located ? coords(located.bestLat, located.bestLon) : null
}

function radioDetail(network: StackNetwork): string {
  const band = network.band ? `${network.band} GHz` : null
  return [`${Math.round(network.bestRssi)} dBm`, network.bssid, band].filter(Boolean).join(' · ')
}

function enrichmentsOf(items: { enrichment?: DeviceEnrichment | null }[]): DeviceEnrichment[] {
  return items.flatMap((item) => (item.enrichment ? [item.enrichment] : []))
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
  networks: StackNetwork[]
  devices: StackDevice[]
  cells: Pick<CellRecord, 'key' | 'radio' | 'cellId' | 'role' | 'lastRssi' | 'siteLat' | 'siteLon' | 'bestLat' | 'bestLon'>[]
  movers: MotionTrack[]
  phone: Fix | null
  accessPoints?: AccessPoint<StackNetwork>[]
  advertisers?: AdvertiserGroup<StackDevice>[]
}): StackedDevice[] {
  const units: StackUnit[] = []
  for (const ap of input.accessPoints ?? groupAccessPoints(input.networks)) {
    const signals = ap.networks.map((network): SignalRow => ({
      kind: 'wifi',
      title: network.hidden || !network.ssid ? 'Hidden' : network.ssid,
      detail: radioDetail(network),
    }))
    addGps(signals, firstFix(ap.networks))
    units.push({
      slot: `wifi:${ap.id}`,
      id: ap.id,
      label: ap.label,
      labelIds: labelIds(ap),
      named: ap.ssids.length > 0,
      linkable: true,
      signals,
      keys: ap.networks.flatMap((network) => [network.bssid, `wifi:${network.bssid}`]),
      enrichments: enrichmentsOf(ap.networks),
    })
  }
  for (const group of input.advertisers ?? groupAdvertisers(input.devices)) {
    const count = group.devices.length
    const signals = group.named
      ? group.devices.map((device): SignalRow => ({
        kind: 'bluetooth',
        title: device.name?.trim() || group.label,
        detail: `${Math.round(device.lastRssi)} dBm · ${device.address}`,
      }))
      : [{
        kind: 'bluetooth' as const,
        title: group.label,
        detail: `${count} address${count === 1 ? '' : 'es'} · strongest ${Math.round(group.best.bestRssi)} dBm`,
      }]
    addGps(signals, firstFix(group.devices))
    units.push({
      slot: `bluetooth:${group.id}`,
      id: group.id,
      label: group.label,
      labelIds: labelIds(group),
      named: group.named,
      linkable: group.named,
      signals,
      keys: group.devices.flatMap((device) => [device.address, `bluetooth:${device.address}`]),
      enrichments: enrichmentsOf(group.devices),
    })
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
    const id = `cell:${cell.key}`
    units.push({ slot: id, id, label: title, labelIds: [id], named: true, linkable: true, signals, keys: [cell.key, id], enrichments: [] })
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
      units.push({ slot: 'phone', id: 'phone', label: 'This device', labelIds: ['phone'], named: true, linkable: true, signals, keys: ['phone'], enrichments: [] })
    }
  }

  const parent = new Map(units.map((unit) => [unit.slot, unit.slot]))
  const byKey = new Map<string, string>()
  for (const unit of units) {
    if (!unit.linkable) continue
    for (const key of unit.keys) byKey.set(key, unit.slot)
  }
  for (const mover of input.movers) {
    const slots = pairKeys(mover).map((key) => byKey.get(key)).filter((slot): slot is string => Boolean(slot))
    for (let index = 1; index < slots.length; index += 1) unite(parent, slots[0], slots[index])
  }

  const groups = new Map<string, StackUnit[]>()
  for (const unit of units) {
    const root = rootOf(parent, unit.slot)
    const list = groups.get(root) ?? []
    list.push(unit)
    groups.set(root, list)
  }
  return [...groups.values()].map((group) => {
    const signals: SignalRow[] = []
    const seen = new Set<string>()
    for (const unit of group) {
      for (const signal of unit.signals) {
        const mark = `${signal.kind}|${signal.title}|${signal.detail}`
        if (seen.has(mark)) continue
        seen.add(mark)
        signals.push(signal)
      }
    }
    const keys = [...new Set(group.flatMap((unit) => unit.keys))].sort()
    const enrichments = new Map<string, DeviceEnrichment>()
    for (const enrichment of group.flatMap((unit) => unit.enrichments)) {
      const key = [
        enrichment.queryTitle,
        enrichment.manufacturer,
        enrichment.model,
        enrichment.lookedUpAt,
      ].join('|')
      enrichments.set(key, enrichment)
    }
    const label = group.find((unit) => unit.named && !unit.label.includes(':'))?.label ?? group[0].label
    return {
      id: group[0].id,
      label,
      labelIds: [...new Set(group.flatMap((unit) => unit.labelIds))],
      signals,
      keys,
      enrichments: [...enrichments.values()],
    }
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
  const unnamed = room.members.filter((member) => member.label === member.id)
  for (const member of room.members) {
    if (member.label === member.id) continue
    if (signals.some((signal) => signal.kind === 'bluetooth' && signal.title === member.label)) continue
    signals.push({
      kind: 'bluetooth',
      title: member.label,
      detail: member.distanceM == null ? member.kind : `${member.distanceM.toFixed(0)} m`,
    })
  }
  if (unnamed.length > 0) {
    signals.push({
      kind: 'bluetooth',
      title: UNNAMED_BLUETOOTH,
      detail: `${unnamed.length} address${unnamed.length === 1 ? '' : 'es'}`,
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
