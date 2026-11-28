import { compareBySamples } from './sampleOrder.js'
import {
  SECURE_FLAGS,
  type ClassifiedSocket,
  type SecureFlag,
  type SecureLinkSnapshot,
  type SocketEndpoint,
  type VpnRoute,
} from './secureLinks.js'

export const CONNECTION_CAP = 2000

export interface ConnectionEntry {
  process: string
  protocol: 'tcp' | 'udp'
  flags: SecureFlag[]
  listen: boolean
  destination: SocketEndpoint
  local: SocketEndpoint
  pid: number
  state: string | null
  firstSeen: string
  lastSeen: string
  samples: number
  openCount: number
}

export interface ConnectionCatalog {
  updatedAt: string | null
  reviewedAt: string | null
  vpnRoute: VpnRoute
  entries: ConnectionEntry[]
}

export interface ConnectionChanges {
  unreviewed: ConnectionEntry[]
  appeared: ConnectionEntry[]
  quiet: ConnectionEntry[]
}

export interface ConnectionSnapshot extends SecureLinkSnapshot {
  catalog: ConnectionCatalog
}

export function emptyConnectionCatalog(): ConnectionCatalog {
  return {
    updatedAt: null,
    reviewedAt: null,
    vpnRoute: { active: false, interfaceName: null },
    entries: [],
  }
}

export function foldCatalog(
  catalog: ConnectionCatalog,
  sockets: ClassifiedSocket[],
  vpnRoute: VpnRoute,
  observedAt: string,
): ConnectionCatalog {
  const iso = normalizeTime(observedAt)
  const entries = catalog.entries.map(cloneEntry)
  const byKey = new Map(entries.map((entry) => [entryKey(entry), entry]))
  const seen = new Set<string>()
  for (const [key, group] of groupSockets(sockets)) {
    seen.add(key)
    const latest = group[group.length - 1]
    const destination = destinationOf(latest)
    const flags = unionFlags(group.flatMap((socket) => socket.flags))
    const existing = byKey.get(key)
    if (!existing) {
      const created: ConnectionEntry = {
        process: latest.process,
        protocol: latest.protocol,
        flags,
        listen: destination.listen,
        destination: copyEndpoint(destination.destination),
        local: copyEndpoint(latest.local),
        pid: latest.pid,
        state: latest.state,
        firstSeen: iso,
        lastSeen: iso,
        samples: 1,
        openCount: group.length,
      }
      entries.push(created)
      byKey.set(key, created)
      continue
    }
    existing.flags = flags
    existing.local = copyEndpoint(latest.local)
    existing.pid = latest.pid
    existing.state = latest.state
    if (iso >= existing.lastSeen) existing.lastSeen = iso
    existing.samples += 1
    existing.openCount = group.length
  }
  for (const entry of entries) {
    if (!seen.has(entryKey(entry))) entry.openCount = 0
  }
  return {
    updatedAt: iso,
    reviewedAt: catalog.reviewedAt,
    vpnRoute: { active: vpnRoute.active === true, interfaceName: vpnRoute.interfaceName ?? null },
    entries: capEntries(entries),
  }
}

export function reviewChanges(catalog: ConnectionCatalog): ConnectionChanges {
  if (!catalog.reviewedAt) {
    return { unreviewed: sortEntries(catalog.entries), appeared: [], quiet: [] }
  }
  const reviewedAt = catalog.reviewedAt
  const appeared: ConnectionEntry[] = []
  const quiet: ConnectionEntry[] = []
  for (const entry of catalog.entries) {
    if (entry.firstSeen > reviewedAt) appeared.push(entry)
    // A row that is still open was seen in the latest poll, including the poll that was just reviewed.
    else if (entry.lastSeen <= reviewedAt && entry.openCount === 0) quiet.push(entry)
  }
  return { unreviewed: [], appeared: sortEntries(appeared), quiet: sortEntries(quiet) }
}

export function sortBySamples(entries: readonly ConnectionEntry[]): ConnectionEntry[] {
  return [...entries].sort((left, right) => compareBySamples(
    { samples: left.samples, name: left.process, key: entryKey(left) },
    { samples: right.samples, name: right.process, key: entryKey(right) },
  ))
}

export function markReviewed(catalog: ConnectionCatalog): ConnectionCatalog {
  return {
    updatedAt: catalog.updatedAt,
    reviewedAt: catalog.updatedAt,
    vpnRoute: { ...catalog.vpnRoute },
    entries: catalog.entries.map(cloneEntry),
  }
}

export function parseConnectionCatalog(text: string): ConnectionCatalog {
  if (!text.trim()) return emptyConnectionCatalog()
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyConnectionCatalog()
    const record = value as Record<string, unknown>
    const entries: ConnectionEntry[] = []
    const seen = new Set<string>()
    if (Array.isArray(record.entries)) {
      for (const item of record.entries) {
        const entry = entryFrom(item)
        if (!entry) continue
        const key = entryKey(entry)
        if (seen.has(key)) continue
        seen.add(key)
        entries.push(entry)
      }
    }
    return {
      updatedAt: timeOf(record.updatedAt),
      reviewedAt: timeOf(record.reviewedAt),
      vpnRoute: routeOf(record.vpnRoute),
      entries: capEntries(entries),
    }
  } catch {
    return emptyConnectionCatalog()
  }
}

function groupSockets(sockets: ClassifiedSocket[]): Map<string, ClassifiedSocket[]> {
  const groups = new Map<string, ClassifiedSocket[]>()
  for (const socket of sockets) {
    if (socket.flags.length === 0) continue
    const destination = destinationOf(socket)
    const key = entryKey({
      process: socket.process,
      protocol: socket.protocol,
      listen: destination.listen,
      destination: destination.destination,
    })
    const group = groups.get(key)
    if (group) group.push(socket)
    else groups.set(key, [socket])
  }
  return groups
}

function destinationOf(socket: ClassifiedSocket): { listen: boolean; destination: SocketEndpoint } {
  if (socket.remote == null) return { listen: true, destination: socket.local }
  return { listen: false, destination: socket.remote }
}

function entryKey(entry: Pick<ConnectionEntry, 'process' | 'protocol' | 'listen' | 'destination'>): string {
  return [
    entry.process,
    entry.protocol,
    entry.listen ? 'listen' : 'remote',
    entry.destination.host,
    entry.destination.port ?? '',
  ].join('\n')
}

function capEntries(entries: ConnectionEntry[]): ConnectionEntry[] {
  if (entries.length <= CONNECTION_CAP) return entries
  const ranked = [...entries].sort((left, right) => (
    left.lastSeen.localeCompare(right.lastSeen) || entryKey(left).localeCompare(entryKey(right))
  ))
  const drop = new Set(ranked.slice(0, entries.length - CONNECTION_CAP))
  return entries.filter((entry) => !drop.has(entry))
}

function sortEntries(entries: ConnectionEntry[]): ConnectionEntry[] {
  return [...entries].sort((left, right) => (
    right.lastSeen.localeCompare(left.lastSeen)
    || left.process.localeCompare(right.process)
    || entryKey(left).localeCompare(entryKey(right))
  ))
}

function unionFlags(flags: SecureFlag[]): SecureFlag[] {
  const found = new Set(flags)
  return SECURE_FLAGS.filter((flag) => found.has(flag))
}

function cloneEntry(entry: ConnectionEntry): ConnectionEntry {
  return {
    ...entry,
    flags: [...entry.flags],
    destination: copyEndpoint(entry.destination),
    local: copyEndpoint(entry.local),
  }
}

function copyEndpoint(endpoint: SocketEndpoint): SocketEndpoint {
  return { host: endpoint.host, port: endpoint.port }
}

function normalizeTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return new Date().toISOString()
  return date.toISOString()
}

function entryFrom(value: unknown): ConnectionEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const process = textOf(record.process)
  const protocol = record.protocol === 'tcp' || record.protocol === 'udp' ? record.protocol : null
  const flags = flagsOf(record.flags)
  const destination = endpointOf(record.destination)
  const local = endpointOf(record.local)
  const firstSeen = timeOf(record.firstSeen)
  const lastSeen = timeOf(record.lastSeen)
  const samples = countOf(record.samples)
  const openCount = countOf(record.openCount)
  const pid = countOf(record.pid)
  if (!process || !protocol || !flags || !destination || !local || !firstSeen || !lastSeen) return null
  if (samples == null || samples < 1 || openCount == null || pid == null) return null
  if (typeof record.listen !== 'boolean') return null
  const state = record.state == null ? null : textOf(record.state)
  if (record.state != null && !state) return null
  return {
    process,
    protocol,
    flags,
    listen: record.listen,
    destination,
    local,
    pid,
    state,
    firstSeen,
    lastSeen,
    samples,
    openCount,
  }
}

function endpointOf(value: unknown): SocketEndpoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const host = textOf(record.host)
  const port = portOf(record.port)
  if (!host || port === undefined) return null
  return { host, port }
}

function routeOf(value: unknown): VpnRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { active: false, interfaceName: null }
  const record = value as Record<string, unknown>
  const interfaceName = record.interfaceName == null ? null : textOf(record.interfaceName)
  return { active: record.active === true && interfaceName != null, interfaceName }
}

function flagsOf(value: unknown): SecureFlag[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const found = new Set<SecureFlag>()
  for (const item of value) {
    if (typeof item !== 'string' || !SECURE_FLAGS.includes(item as SecureFlag)) return null
    found.add(item as SecureFlag)
  }
  return SECURE_FLAGS.filter((flag) => found.has(flag))
}

function portOf(value: unknown): number | null | undefined {
  if (value == null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 65535) return undefined
  return value
}

function countOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
  return value
}

function timeOf(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function textOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text : null
}
