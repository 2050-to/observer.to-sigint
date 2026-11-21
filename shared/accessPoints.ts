import { haversineMeters } from './geo.js'
import { hiddenLabel } from './security.js'
import type { DeviceRecord, NetworkRecord } from './types.js'

export const SAME_PLACE_M = 150
export const UNNAMED_BLUETOOTH = 'Unnamed Bluetooth'

export type WifiLike = Pick<NetworkRecord, 'bssid' | 'ssid' | 'hidden' | 'bestRssi' | 'bestLat' | 'bestLon'>
  & Partial<Pick<NetworkRecord, 'apMldMac' | 'affiliatedLinks'>>

export type DeviceLike = Pick<DeviceRecord, 'address' | 'name' | 'bestRssi' | 'bestLat' | 'bestLon'>

export interface AccessPoint<T extends WifiLike = NetworkRecord> {
  id: string
  label: string
  ssids: string[]
  networks: T[]
  best: T
}

export interface AdvertiserGroup<T extends DeviceLike = DeviceRecord> {
  id: string
  label: string
  named: boolean
  devices: T[]
  best: T
}

type Group = AccessPoint<WifiLike> | AdvertiserGroup<DeviceLike>

function samePlace(a: Pick<NetworkRecord, 'bestLat' | 'bestLon'>, b: Pick<NetworkRecord, 'bestLat' | 'bestLon'>): boolean {
  if (a.bestLat == null || a.bestLon == null || b.bestLat == null || b.bestLon == null) return true
  return haversineMeters(a.bestLat, a.bestLon, b.bestLat, b.bestLon) <= SAME_PLACE_M
}

function strongestFirst<T extends { bestRssi: number }>(keyOf: (item: T) => string) {
  return (a: T, b: T) => b.bestRssi - a.bestRssi || keyOf(a).localeCompare(keyOf(b))
}

const byRadio = strongestFirst<WifiLike>((network) => network.bssid)
const byAdvertiser = strongestFirst<DeviceLike>((device) => device.address)

function lowest(values: string[]): string {
  return [...values].sort()[0]
}

function ssidOf(network: WifiLike): string | null {
  return network.hidden || !network.ssid ? null : network.ssid
}

function octets(bssid: string): number[] | null {
  const parts = bssid.trim().toLowerCase().split(':')
  if (parts.length !== 6 || !parts.every((part) => /^[0-9a-f]{2}$/.test(part))) return null
  return parts.map((part) => Number.parseInt(part, 16))
}

function octetGap(a: number, b: number): number {
  const gap = Math.abs(a - b)
  return Math.min(gap, 256 - gap)
}

// One router's radios share every octet but the first (virtual BSSIDs), or keep the
// vendor prefix and octet 5 while octet 4 moves a few steps between bands.
function siblingMacs(a: number[], b: number[]): boolean {
  if (a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5]) return true
  if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2] || a[4] !== b[4]) return false
  return octetGap(a[3], b[3]) <= 8 && Math.abs(a[5] - b[5]) <= 15
}

function disjointSets(size: number) {
  const parent = Array.from({ length: size }, (_, index) => index)
  const find = (start: number): number => {
    let index = start
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]]
      index = parent[index]
    }
    return index
  }
  return {
    unite(left: number, right: number) {
      const a = find(left)
      const b = find(right)
      if (a !== b) parent[a] = b
    },
    groups(): number[][] {
      const byRoot = new Map<number, number[]>()
      for (let index = 0; index < size; index += 1) {
        const root = find(index)
        const list = byRoot.get(root) ?? []
        list.push(index)
        byRoot.set(root, list)
      }
      return [...byRoot.values()]
    },
  }
}

function buckets<T>(items: T[], keyOf: (item: T) => string | null): number[][] {
  const byKey = new Map<string, number[]>()
  items.forEach((item, index) => {
    const key = keyOf(item)
    if (!key) return
    const list = byKey.get(key) ?? []
    list.push(index)
    byKey.set(key, list)
  })
  return [...byKey.values()].filter((list) => list.length > 1)
}

export function groupAccessPoints<T extends WifiLike>(networks: T[]): AccessPoint<T>[] {
  const sets = disjointSets(networks.length)
  const join = (left: number, right: number) => {
    if (samePlace(networks[left], networks[right])) sets.unite(left, right)
  }

  const macs = networks.map((network) => octets(network.bssid))
  const siblingBuckets = [
    ...buckets(macs, (mac) => mac && mac.slice(1).join(':')),
    ...buckets(macs, (mac) => mac && [mac[0], mac[1], mac[2], mac[4]].join(':')),
  ]
  for (const indexes of siblingBuckets) {
    for (let i = 0; i < indexes.length; i += 1) {
      for (let j = i + 1; j < indexes.length; j += 1) {
        const left = macs[indexes[i]]
        const right = macs[indexes[j]]
        if (left && right && siblingMacs(left, right)) join(indexes[i], indexes[j])
      }
    }
  }
  for (const indexes of buckets(networks, (network) => network.apMldMac?.trim().toLowerCase() || null)) {
    for (const index of indexes.slice(1)) join(indexes[0], index)
  }
  const byBssid = new Map(networks.map((network, index) => [network.bssid.toLowerCase(), index]))
  networks.forEach((network, index) => {
    for (const link of network.affiliatedLinks ?? []) {
      const other = byBssid.get(link.mac.trim().toLowerCase())
      if (other != null && other !== index) join(index, other)
    }
  })

  const firstPass = sets.groups()
  const names = firstPass.map((indexes) => new Set(indexes.flatMap((index) => ssidOf(networks[index]) ?? [])))
  const leads = firstPass.map((indexes) => networks[indexes.reduce((best, index) => (
    byRadio(networks[index], networks[best]) < 0 ? index : best
  ))])
  const holders = new Map<string, number[]>()
  names.forEach((ssids, group) => {
    for (const ssid of ssids) {
      const list = holders.get(ssid) ?? []
      list.push(group)
      holders.set(ssid, list)
    }
  })
  names.forEach((ssids, group) => {
    if (ssids.size === 0) return
    const wider: number[] = []
    for (const other of holders.get([...ssids][0]) ?? []) {
      if (other === group || !samePlace(leads[group], leads[other])) continue
      if (![...ssids].every((ssid) => names[other].has(ssid))) continue
      if (names[other].size === ssids.size) sets.unite(firstPass[group][0], firstPass[other][0])
      else wider.push(other)
    }
    if (wider.length === 1) sets.unite(firstPass[group][0], firstPass[wider[0]][0])
  })

  const radios = sets.groups().map((indexes) => indexes.map((index) => networks[index]).sort(byRadio))
  const broadcasters = new Map<string, number>()
  for (const group of radios) {
    for (const ssid of new Set(group.flatMap((network) => ssidOf(network) ?? []))) {
      broadcasters.set(ssid, (broadcasters.get(ssid) ?? 0) + 1)
    }
  }
  return radios.map((group) => {
    const ssids = [...new Set(group.flatMap((network) => ssidOf(network) ?? []))]
      .sort((a, b) => (broadcasters.get(a) ?? 0) - (broadcasters.get(b) ?? 0))
    return {
      id: lowest(group.map((network) => network.bssid)),
      label: ssids[0] ?? hiddenLabel(group[0].bssid),
      ssids,
      networks: group,
      best: group[0],
    }
  }).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
}

export function groupAdvertisers<T extends DeviceLike>(devices: T[]): AdvertiserGroup<T>[] {
  const byName = new Map<string, T[][]>()
  for (const device of [...devices].sort(byAdvertiser)) {
    const key = device.name?.trim().toLowerCase() ?? ''
    const groups = byName.get(key) ?? []
    const home = groups.find((group) => samePlace(group[0], device))
    if (home) home.push(device)
    else groups.push([device])
    byName.set(key, groups)
  }
  return [...byName.values()].flat().map((group) => {
    const name = group[0].name?.trim() ?? ''
    return {
      id: lowest(group.map((device) => device.address)),
      label: name || UNNAMED_BLUETOOTH,
      named: name.length > 0,
      devices: group,
      best: group[0],
    }
  }).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
}

export function accessPointByBssid<T extends WifiLike>(accessPoints: AccessPoint<T>[]): Map<string, AccessPoint<T>> {
  return new Map(accessPoints.flatMap((ap) => ap.networks.map((network) => [network.bssid, ap] as const)))
}

export function advertiserByAddress<T extends DeviceLike>(groups: AdvertiserGroup<T>[]): Map<string, AdvertiserGroup<T>> {
  return new Map(groups.flatMap((group) => group.devices.map((device) => [device.address, group] as const)))
}

export function onlyHeard<T extends WifiLike>(groups: AccessPoint<T>[], keys: Iterable<string>): AccessPoint<T>[]
export function onlyHeard<T extends DeviceLike>(groups: AdvertiserGroup<T>[], keys: Iterable<string>): AdvertiserGroup<T>[]
export function onlyHeard(groups: Group[], keys: Iterable<string>): Group[] {
  const heard = new Set([...keys].map((key) => key.toLowerCase()))
  return groups.flatMap<Group>((group) => {
    if ('networks' in group) {
      const networks = group.networks.filter((network) => heard.has(network.bssid.toLowerCase()))
      return networks.length > 0 ? [{ ...group, networks, best: networks[0] }] : []
    }
    const devices = group.devices.filter((device) => heard.has(device.address.toLowerCase()))
    return devices.length > 0 ? [{ ...group, devices, best: devices[0] }] : []
  })
}

export function labelIds(group: Group): string[] {
  if ('networks' in group) {
    const older = group.ssids.includes(group.label)
      ? [`ssid:${group.label}`]
      : group.networks.map((network) => `hidden:${network.bssid}`)
    return [...new Set([group.id, ...older, ...group.networks.map((network) => network.bssid)])]
  }
  if (!group.named) return [group.id]
  return [...new Set([group.id, ...group.devices.flatMap((device) => [device.address, `bluetooth:${device.address}`])])]
}
