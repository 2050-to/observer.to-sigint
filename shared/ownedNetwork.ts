import { recorderPorts, recorderServices } from './recorders.js'
import { normalizeMac, parseIpv4, type AddressRole, type SubnetPlan } from './subnet.js'

export const OWNED_NETWORK_DISCLAIMER = 'These optional features are intended only for a network you own. Turn them on only while this device is joined to a network you own or are allowed to inventory. Address lists and device details are saved to this account. Other accounts cannot see them.'

export type OwnedPrompt = 'addresses' | 'details'

export interface OwnedConsent {
  addresses: boolean
  details: boolean
}

export interface OwnedToggle {
  consent: OwnedConsent
  prompt: OwnedPrompt | null
}

export interface SubnetHost {
  ip: string
  role: AddressRole
  present: boolean
  mac: string | null
  name: string | null
  services: string[]
  ports: number[]
}

export interface SubnetCatalog {
  cidr: string
  interfacePrefix: number
  limited: boolean
  checked: number
  internetRoute: boolean
  hosts: SubnetHost[]
}

export interface DeviceDetails {
  os: string
  browser: string
  ramBytes: number
  cpu: string
  hostname: string
  collectedAt: string
}

export interface ArpEntry {
  mac: string
  name: string | null
}

const ROLES = new Set<AddressRole>(['network', 'broadcast', 'device', 'host'])

export function normalizeOwnedConsent(value: Partial<OwnedConsent> | null | undefined): OwnedConsent {
  const addresses = value?.addresses === true
  return { addresses, details: addresses && value?.details === true }
}

export function toggleAddresses(consent: OwnedConsent): OwnedToggle {
  if (consent.addresses) return { consent: { addresses: false, details: false }, prompt: null }
  return { consent, prompt: 'addresses' }
}

export function toggleDetails(consent: OwnedConsent): OwnedToggle {
  if (!consent.addresses || consent.details) {
    return { consent: { addresses: consent.addresses, details: false }, prompt: null }
  }
  return { consent, prompt: 'details' }
}

export function allowOwned(consent: OwnedConsent, prompt: OwnedPrompt): OwnedToggle {
  if (prompt === 'addresses') return { consent: { addresses: true, details: false }, prompt: 'details' }
  if (prompt === 'details' && consent.addresses) return { consent: { addresses: true, details: true }, prompt: null }
  return {
    consent: { addresses: consent.addresses, details: consent.addresses ? consent.details : false },
    prompt: null,
  }
}

export function roleLabel(role: AddressRole): string {
  if (role === 'device') return 'This device'
  if (role === 'network') return 'Network'
  if (role === 'broadcast') return 'Broadcast'
  return 'Host'
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown'
  const gib = bytes / (1024 * 1024 * 1024)
  if (gib >= 1) return `${gib.toFixed(1)} GB`
  const mib = bytes / (1024 * 1024)
  return `${Math.round(mib)} MB`
}

export function parseArpTable(text: string): Record<string, ArpEntry> {
  const found: Record<string, ArpEntry> = {}
  for (const line of text.split(/\r?\n/)) {
    const proc = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+\S+\s+0x([0-9a-fA-F]+)\s+(\S+)/)
    if (proc) {
      const flags = Number.parseInt(proc[2], 16)
      const mac = normalizeMac(proc[3])
      if ((flags & 0x2) !== 0 && mac && parseIpv4(proc[1]) != null) found[proc[1]] = { mac, name: null }
      continue
    }
    const ip = line.match(/\((\d+\.\d+\.\d+\.\d+)\)/)
    const mac = normalizeMac(line.match(/([0-9a-fA-F]{1,2}(?::[0-9a-fA-F]{1,2}){5})/)?.[1])
    if (!ip || !mac || parseIpv4(ip[1]) == null || /\(incomplete\)/i.test(line)) continue
    const name = line.match(/^(\S+)\s+\(/)?.[1]
    found[ip[1]] = { mac, name: name && name !== '?' ? name.slice(0, 120) : null }
  }
  return found
}

export function presentFrom(pinged: Iterable<string>, arp: Record<string, ArpEntry>, hosts: Iterable<string>): Set<string> {
  const allowed = new Set(hosts)
  const present = new Set<string>()
  for (const ip of pinged) {
    if (allowed.has(ip)) present.add(ip)
  }
  for (const [ip, entry] of Object.entries(arp)) {
    if (allowed.has(ip) && entry.mac) present.add(ip)
  }
  return present
}

export function assembleCatalog(
  plan: SubnetPlan,
  present: ReadonlySet<string>,
  arp: Record<string, ArpEntry>,
  self: { mac: string | null; name: string | null },
): SubnetCatalog {
  const hosts = plan.addresses.map((item) => {
    const known = arp[item.ip]
    const isSelf = item.role === 'device'
    const isEndpoint = item.role === 'network' || item.role === 'broadcast'
    const active = isSelf || (!isEndpoint && present.has(item.ip))
    return {
      ip: item.ip,
      role: item.role,
      present: active,
      mac: active ? (isSelf ? self.mac ?? known?.mac ?? null : known?.mac ?? null) : null,
      name: active ? clip(isSelf ? self.name ?? known?.name ?? null : known?.name ?? null, 120) : null,
      services: [],
      ports: [],
    }
  })
  return {
    cidr: plan.cidr,
    interfacePrefix: plan.interfacePrefix,
    limited: plan.limited,
    checked: plan.addresses.filter((item) => item.role === 'host').length,
    internetRoute: false,
    hosts,
  }
}

export function asSubnetCatalog(value: unknown): SubnetCatalog | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.cidr !== 'string' || !/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(record.cidr)) return null
  if (!Number.isInteger(record.interfacePrefix)) return null
  if (typeof record.limited !== 'boolean') return null
  if (!Number.isInteger(record.checked) || Number(record.checked) < 0) return null
  if (!Array.isArray(record.hosts) || record.hosts.length > 256) return null
  const hosts: SubnetHost[] = []
  for (const item of record.hosts) {
    if (!item || typeof item !== 'object') return null
    const host = item as Record<string, unknown>
    if (typeof host.ip !== 'string' || parseIpv4(host.ip) == null) return null
    if (typeof host.role !== 'string' || !ROLES.has(host.role as AddressRole)) return null
    if (typeof host.present !== 'boolean') return null
    hosts.push({
      ip: host.ip,
      role: host.role as AddressRole,
      present: host.present,
      mac: host.mac == null ? null : normalizeMac(String(host.mac)),
      name: host.name == null ? null : clip(String(host.name), 120),
      services: recorderServices(host.services),
      ports: recorderPorts(host.ports),
    })
  }
  return {
    cidr: record.cidr,
    interfacePrefix: Number(record.interfacePrefix),
    limited: record.limited,
    checked: Number(record.checked),
    internetRoute: record.internetRoute === true,
    hosts,
  }
}

export function asDeviceDetails(value: unknown): DeviceDetails | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const os = clip(record.os, 200)
  const browser = clip(record.browser, 300)
  const cpu = clip(record.cpu, 200)
  const hostname = clip(record.hostname, 200)
  const collectedAt = clip(record.collectedAt, 40)
  if (!os || !browser || !cpu || !hostname || !collectedAt) return null
  if (typeof record.ramBytes !== 'number' || !Number.isFinite(record.ramBytes) || record.ramBytes < 0) return null
  return { os, browser, ramBytes: record.ramBytes, cpu, hostname, collectedAt }
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.slice(0, max)
}
