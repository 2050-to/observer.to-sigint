import { bssidHmac } from '../crypto.js'
import type { DeviceRecord, NetworkRecord } from '../types.js'

export type EnrichmentEntityKind = 'wifi' | 'bluetooth'

export interface EnrichmentInput {
  kind: EnrichmentEntityKind
  title: string
  vendorOuis: string[]
  serviceUuids: string[]
  wifiStandard: string | null
  addressType: 'public' | 'random' | null
}

export function isEnrichmentInput(value: unknown): value is EnrichmentInput {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<EnrichmentInput>
  if (input.kind !== 'wifi' && input.kind !== 'bluetooth') return false
  if (typeof input.title !== 'string' || input.title.length < 3 || input.title.length > 128) return false
  if (!Array.isArray(input.vendorOuis) || !input.vendorOuis.every((item) => typeof item === 'string')) return false
  if (!Array.isArray(input.serviceUuids) || !input.serviceUuids.every((item) => typeof item === 'string')) return false
  if (input.wifiStandard != null && typeof input.wifiStandard !== 'string') return false
  return input.addressType == null || input.addressType === 'public' || input.addressType === 'random'
}

const ADDRESS = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$|^[0-9a-f]{8}-[0-9a-f-]{27}$/i
const GENERIC = new Set([
  'bluetooth',
  'default',
  'device',
  'guest',
  'hidden',
  'home',
  'iot',
  'network',
  'phone',
  'private',
  'public',
  'router',
  'speaker',
  'unknown',
  'wifi',
  'wireless',
])

function cleanTitle(value: string): string | null {
  const title = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 128)
  if (title.length < 3 || ADDRESS.test(title) || /^\d+$/.test(title) || GENERIC.has(title.toLowerCase())) return null
  return title
}

function cleanList(values: string[], limit: number): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort().slice(0, limit)
}

export function inputForNetwork(record: NetworkRecord): EnrichmentInput | null {
  if (record.hidden || !record.ssid) return null
  const title = cleanTitle(record.ssid)
  if (!title) return null
  return {
    kind: 'wifi',
    title,
    vendorOuis: cleanList(record.vendorOuis ?? [], 16),
    serviceUuids: [],
    wifiStandard: record.wifiStandard?.trim().slice(0, 64) || null,
    addressType: null,
  }
}

export function inputForDevice(record: DeviceRecord): EnrichmentInput | null {
  const title = cleanTitle(record.name ?? '')
  if (!title) return null
  return {
    kind: 'bluetooth',
    title,
    vendorOuis: [],
    serviceUuids: cleanList(record.serviceUuids ?? [], 32),
    wifiStandard: null,
    addressType: record.addressType,
  }
}

export function canonicalInput(input: EnrichmentInput): string {
  return JSON.stringify({
    kind: input.kind,
    title: input.title.toLowerCase(),
    vendorOuis: [...input.vendorOuis].sort(),
    serviceUuids: [...input.serviceUuids].sort(),
    wifiStandard: input.wifiStandard?.toLowerCase() ?? null,
    addressType: input.addressType,
  })
}

export function enrichmentLookupHmac(input: EnrichmentInput): Buffer {
  return bssidHmac(`device-enrichment:v1:${canonicalInput(input)}`)
}
