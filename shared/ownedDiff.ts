import { classifyRecorder } from './recorders.js'
import type { SubnetHost } from './ownedNetwork.js'

export type OwnedChangeKind = 'new_address' | 'new_name' | 'recorder_appeared' | 'recorder_disappeared'

export interface OwnedChange {
  kind: OwnedChangeKind
  ip: string
  name: string | null
  previousName: string | null
}

function activeHosts(hosts: SubnetHost[]): Map<string, SubnetHost> {
  const present = new Map<string, SubnetHost>()
  for (const host of hosts) {
    if (host.role !== 'host' || !host.present) continue
    present.set(host.ip, host)
  }
  return present
}

export function diffOwnedInventory(previous: SubnetHost[] | null, next: SubnetHost[]): OwnedChange[] {
  if (!previous) return []
  const before = activeHosts(previous)
  const after = activeHosts(next)
  const changes: OwnedChange[] = []
  for (const [ip, host] of after) {
    const prior = before.get(ip)
    if (!prior) {
      changes.push({ kind: 'new_address', ip, name: host.name, previousName: null })
    } else if (host.name && host.name !== prior.name) {
      changes.push({ kind: 'new_name', ip, name: host.name, previousName: prior.name })
    }
    const was = prior ? classifyRecorder(prior) : null
    const now = classifyRecorder(host)
    if (!was && now) changes.push({ kind: 'recorder_appeared', ip, name: host.name, previousName: prior?.name ?? null })
  }
  for (const [ip, host] of before) {
    const now = after.get(ip)
    const was = classifyRecorder(host)
    if (!was) continue
    if (!now || !classifyRecorder(now)) {
      changes.push({ kind: 'recorder_disappeared', ip, name: host.name, previousName: host.name })
    }
  }
  return changes
}

export function ownedChangeText(change: OwnedChange): string {
  if (change.kind === 'new_address') return `New address ${change.ip}`
  if (change.kind === 'new_name') return `New announced name ${change.name} at ${change.ip}`
  if (change.kind === 'recorder_appeared') {
    return change.name ? `Recorder name appeared: ${change.name}` : `Recorder classification appeared at ${change.ip}`
  }
  return change.name
    ? `Recorder classification disappeared: ${change.name}`
    : `Recorder classification disappeared at ${change.ip}`
}
