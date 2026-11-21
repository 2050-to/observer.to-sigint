import type { SubnetCatalog } from './ownedNetwork.js'
import { normalizeMac, parseIpv4, type AddressRole } from './subnet.js'

export const RECORDER_PORTS = [554, 8554, 37777] as const

export type RecorderService = 'rtsp' | 'onvif'
export type RecorderKind = 'camera' | 'recorder'
export type RecorderConfidence = 'high' | 'medium'

export interface RecorderFlag {
  kind: RecorderKind
  confidence: RecorderConfidence
  reasons: string[]
}

export interface RecorderSighting {
  ip: string
  name: string | null
  services: string[]
  ports: number[]
}

export interface MdnsRecord {
  name: string
  type: number
  ptr: string | null
  target: string | null
  ip: string | null
}

const NAME_TOKENS = new Set([
  'camera',
  'cameras',
  'ipcam',
  'ipc',
  'doorbell',
  'hikvision',
  'dahua',
  'ezviz',
  'uniview',
  'axis',
  'amcrest',
  'wyze',
  'reolink',
  'lorex',
  'swann',
  'foscam',
  'imou',
  'annke',
  'tapo',
  'eufy',
  'arlo',
  'blink',
  'instar',
  'nestcam',
  'yicam',
  'ring',
])

// 24-bit prefixes from the public Wireshark manuf list for companies whose products are cameras, NVRs, or DVRs.
const VENDORS: Record<string, string> = {
  '00:1f:54': 'Lorex',
  '00:40:8c': 'Axis',
  '00:65:1e': 'Amcrest',
  '00:bc:99': 'Hikvision',
  '04:03:12': 'Hikvision',
  '04:ee:cd': 'Hikvision',
  '08:3b:c1': 'Hikvision',
  '08:54:11': 'Hikvision',
  '08:a1:89': 'Hikvision',
  '08:cc:81': 'Hikvision',
  '08:ed:ed': 'Dahua',
  '0c:75:d2': 'Hikvision',
  '0c:a6:4c': 'Ezviz',
  '10:12:fb': 'Hikvision',
  '14:a7:8b': 'Dahua',
  '14:ba:88': 'Uniview',
  '18:68:cb': 'Hikvision',
  '18:80:25': 'Hikvision',
  '20:2c:05': 'Dahua',
  '20:bb:bc': 'Ezviz',
  '24:0f:9b': 'Hikvision',
  '24:28:fd': 'Hikvision',
  '24:32:ae': 'Hikvision',
  '24:48:45': 'Hikvision',
  '24:52:6a': 'Dahua',
  '24:b1:05': 'Hikvision',
  '28:57:be': 'Hikvision',
  '2c:a5:9c': 'Hikvision',
  '2c:aa:8e': 'Wyze',
  '30:dd:aa': 'Dahua',
  '34:09:62': 'Hikvision',
  '34:c6:dd': 'Ezviz',
  '38:af:29': 'Dahua',
  '38:f2:5d': 'Ezviz',
  '3c:1b:f8': 'Hikvision',
  '3c:e3:6b': 'Dahua',
  '3c:ef:8c': 'Dahua',
  '40:7a:a4': 'Dahua',
  '40:ac:bf': 'Hikvision',
  '40:b5:70': 'Hikvision',
  '44:19:b6': 'Hikvision',
  '44:47:cc': 'Hikvision',
  '44:a6:42': 'Hikvision',
  '48:78:5b': 'Hikvision',
  '48:ea:63': 'Uniview',
  '4c:11:bf': 'Dahua',
  '4c:1f:86': 'Hikvision',
  '4c:62:df': 'Hikvision',
  '4c:99:e8': 'Dahua',
  '4c:bd:8f': 'Hikvision',
  '4c:f5:dc': 'Hikvision',
  '50:e5:38': 'Hikvision',
  '54:8c:81': 'Hikvision',
  '54:c4:15': 'Hikvision',
  '54:d6:0d': 'Ezviz',
  '58:03:fb': 'Hikvision',
  '58:50:ed': 'Hikvision',
  '58:8f:cf': 'Ezviz',
  '5c:34:5b': 'Hikvision',
  '5c:f5:1a': 'Dahua',
  '64:24:4d': 'Ezviz',
  '64:db:8b': 'Hikvision',
  '64:f2:fb': 'Ezviz',
  '64:fd:29': 'Dahua',
  '68:6d:bc': 'Hikvision',
  '6c:1c:71': 'Dahua',
  '6c:f1:7e': 'Uniview',
  '74:3f:c2': 'Hikvision',
  '74:c9:29': 'Dahua',
  '78:a6:a0': 'Ezviz',
  '78:c1:ae': 'Ezviz',
  '7c:78:b2': 'Wyze',
  '80:48:2c': 'Wyze',
  '80:48:9f': 'Hikvision',
  '80:7c:62': 'Hikvision',
  '80:be:af': 'Hikvision',
  '80:f5:ae': 'Hikvision',
  '84:94:59': 'Hikvision',
  '84:9a:40': 'Hikvision',
  '88:26:3f': 'Uniview',
  '88:de:39': 'Hikvision',
  '8c:22:d2': 'Hikvision',
  '8c:e7:48': 'Hikvision',
  '8c:e9:b4': 'Dahua',
  '90:02:a9': 'Dahua',
  '94:e1:ac': 'Hikvision',
  '94:ec:13': 'Ezviz',
  '98:8b:0a': 'Hikvision',
  '98:9d:e5': 'Hikvision',
  '98:df:82': 'Hikvision',
  '98:f1:12': 'Hikvision',
  '98:f9:cc': 'Dahua',
  '9c:14:63': 'Dahua',
  '9c:8e:cd': 'Amcrest',
  'a0:60:32': 'Amcrest',
  'a0:bd:1d': 'Dahua',
  'a0:ff:0c': 'Hikvision',
  'a4:14:37': 'Hikvision',
  'a4:29:02': 'Hikvision',
  'a4:4b:d9': 'Hikvision',
  'a4:a4:59': 'Hikvision',
  'a4:d5:c2': 'Hikvision',
  'a8:ca:87': 'Dahua',
  'ac:1c:26': 'Ezviz',
  'ac:b9:2f': 'Hikvision',
  'ac:cb:51': 'Hikvision',
  'ac:cc:8e': 'Axis',
  'b0:ff:0d': 'Hikvision',
  'b4:4c:3b': 'Dahua',
  'b4:a3:82': 'Hikvision',
  'b8:a4:4f': 'Axis',
  'bc:29:78': 'Hikvision',
  'bc:32:5f': 'Dahua',
  'bc:51:fe': 'Swann',
  'bc:5e:33': 'Hikvision',
  'bc:9b:5e': 'Hikvision',
  'bc:ad:28': 'Hikvision',
  'bc:ba:c2': 'Hikvision',
  'c0:39:5a': 'Dahua',
  'c0:51:7e': 'Hikvision',
  'c0:56:e3': 'Hikvision',
  'c0:6d:ed': 'Hikvision',
  'c4:2f:90': 'Hikvision',
  'c4:79:05': 'Uniview',
  'c4:aa:c4': 'Dahua',
  'c8:a7:02': 'Hikvision',
  'cc:13:f3': 'Hikvision',
  'd0:3f:27': 'Wyze',
  'd4:43:0e': 'Dahua',
  'd4:e8:53': 'Hikvision',
  'dc:07:f8': 'Hikvision',
  'dc:d2:6a': 'Hikvision',
  'e0:2e:fe': 'Dahua',
  'e0:50:8b': 'Dahua',
  'e0:ba:ad': 'Hikvision',
  'e0:ca:3c': 'Hikvision',
  'e0:df:13': 'Hikvision',
  'e4:24:6c': 'Dahua',
  'e4:d5:8b': 'Hikvision',
  'e8:27:25': 'Axis',
  'e8:a0:ed': 'Hikvision',
  'ec:71:db': 'Reolink',
  'ec:97:e0': 'Ezviz',
  'ec:a9:71': 'Hikvision',
  'ec:c8:9c': 'Hikvision',
  'f0:c8:8b': 'Wyze',
  'f4:70:18': 'Ezviz',
  'f4:b1:c2': 'Dahua',
  'f8:4d:fc': 'Hikvision',
  'f8:ce:07': 'Dahua',
  'fc:24:22': 'Ezviz',
  'fc:5f:49': 'Dahua',
  'fc:9f:fd': 'Hikvision',
  'fc:b6:9d': 'Dahua',
}

const SSDP_HINT = /\b(rtsp|onvif|hikvision|dahua|ezviz|uniview|amcrest|wyze|reolink|lorex|swann|foscam|imou|annke|tapo|eufy|arlo|blink|instar|ipcam|doorbell|nvr|dvr|camera)\b/i

export function classifyRecorder(host: {
  role: AddressRole
  mac: string | null
  name: string | null
  services?: readonly string[]
  ports?: readonly number[]
}): RecorderFlag | null {
  if (host.role !== 'host') return null
  const vendor = vendorFor(host.mac)
  const label = clipName(host.name)
  const words = tokens(label ?? '')
  const nameHit = words.some((token) => cameraToken(token) || recorderToken(token))
  const services = recorderServices(host.services)
  const ports = recorderPorts(host.ports)
  const reasons: string[] = []
  if (vendor) reasons.push(vendor)
  if (label && nameHit) reasons.push(label)
  if (services.includes('rtsp')) reasons.push('Announced RTSP')
  if (services.includes('onvif')) reasons.push('Announced ONVIF')
  if (ports.includes(554)) reasons.push('554')
  if (ports.includes(8554)) reasons.push('8554')
  if (ports.includes(37777)) reasons.push('37777')
  if (!reasons.length) return null
  const strong = [
    vendor ? 'vendor' : '',
    services.includes('rtsp') ? 'rtsp' : '',
    services.includes('onvif') ? 'onvif' : '',
    ports.includes(554) ? '554' : '',
    ports.includes(8554) ? '8554' : '',
    ports.includes(37777) ? '37777' : '',
  ].filter((item) => item.length > 0)
  const kind: RecorderKind = words.some(recorderToken) || (strong.length === 1 && strong[0] === '37777')
    ? 'recorder'
    : 'camera'
  return {
    kind,
    confidence: strong.length > 0 ? 'high' : 'medium',
    reasons,
  }
}

export function recorderServices(values: unknown): RecorderService[] {
  if (!Array.isArray(values)) return []
  const present = new Set(values.filter((item): item is string => typeof item === 'string').map((item) => item.toLowerCase()))
  const found: RecorderService[] = []
  if (present.has('rtsp')) found.push('rtsp')
  if (present.has('onvif')) found.push('onvif')
  return found
}

export function recorderPorts(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  const present = new Set(values.filter((item): item is number => typeof item === 'number' && Number.isInteger(item)))
  return RECORDER_PORTS.filter((port) => present.has(port))
}

export function applySightings(catalog: SubnetCatalog, sightings: readonly RecorderSighting[]): SubnetCatalog {
  const extras = new Map<string, RecorderSighting>()
  for (const sighting of sightings) {
    if (parseIpv4(sighting.ip) == null) continue
    const current = extras.get(sighting.ip) ?? { ip: sighting.ip, name: null, services: [], ports: [] }
    const name = clipName(sighting.name)
    extras.set(sighting.ip, {
      ip: sighting.ip,
      name: current.name ?? name,
      services: recorderServices([...current.services, ...sighting.services]),
      ports: recorderPorts([...current.ports, ...sighting.ports]),
    })
  }
  return {
    ...catalog,
    hosts: catalog.hosts.map((host) => {
      const extra = extras.get(host.ip)
      if (!extra || host.role !== 'host') {
        return { ...host, services: recorderServices(host.services), ports: recorderPorts(host.ports) }
      }
      const announced = extra.services.length > 0 || extra.ports.length > 0
      const present = host.present || announced
      return {
        ...host,
        present,
        name: host.name ?? (present ? extra.name : null),
        services: recorderServices([...host.services, ...(present ? extra.services : [])]),
        ports: recorderPorts([...host.ports, ...(present ? extra.ports : [])]),
      }
    }),
  }
}

export function encodeMdnsQuery(fqdn: string): Uint8Array {
  const name = encodeDnsName(fqdn)
  const packet = new Uint8Array(12 + name.length + 4)
  packet[5] = 1
  packet.set(name, 12)
  const at = 12 + name.length
  packet[at + 1] = 12
  packet[at + 2] = 0x80
  packet[at + 3] = 1
  return packet
}

export function parseMdnsPacket(packet: Uint8Array): MdnsRecord[] {
  if (packet.length < 12 || packet.length > 9000) return []
  const questions = uint16(packet, 4)
  const answers = uint16(packet, 6)
  const authority = uint16(packet, 8)
  const additional = uint16(packet, 10)
  if (questions == null || answers == null || authority == null || additional == null) return []
  let offset = 12
  for (let index = 0; index < questions; index += 1) {
    const name = readName(packet, offset)
    if (!name || name.next + 4 > packet.length) return []
    offset = name.next + 4
  }
  const total = answers + authority + additional
  if (total > 64) return []
  const records: MdnsRecord[] = []
  for (let index = 0; index < total; index += 1) {
    const record = readRecord(packet, offset)
    if (!record) break
    records.push(record.record)
    offset = record.next
  }
  return records
}

export function sightingsFromMdns(records: readonly MdnsRecord[]): RecorderSighting[] {
  const addresses = new Map<string, string[]>()
  const targets = new Map<string, string>()
  const sightings: RecorderSighting[] = []
  const seen = new Set<string>()
  for (const record of records) {
    const key = dnsKey(record.name)
    if (record.type === 1 && record.ip && parseIpv4(record.ip) != null) {
      const list = addresses.get(key) ?? []
      list.push(record.ip)
      addresses.set(key, list)
    } else if (record.type === 33 && record.target) {
      targets.set(key, dnsKey(record.target))
    }
  }
  for (const record of records) {
    if (record.type !== 12 || !record.ptr) continue
    const service = serviceOf(record.name) ?? serviceOf(record.ptr)
    if (!service) continue
    const instance = dnsKey(record.ptr)
    const host = targets.get(instance) ?? instance
    const ips = addresses.get(host) ?? addresses.get(instance) ?? []
    const name = instanceLabel(record.ptr)
    for (const ip of ips) {
      const id = `${ip}|${service}`
      if (seen.has(id)) continue
      seen.add(id)
      sightings.push({ ip, name, services: [service], ports: [] })
    }
  }
  return sightings
}

export function parseSsdpMessage(message: string, sourceIp?: string | null): RecorderSighting | null {
  if (!message || message.length > 8000) return null
  const text = message.replace(/\0/g, '')
  if (!/^HTTP\/1\.[01]\s+200\b/i.test(text) && !/^NOTIFY /i.test(text)) return null
  if (!SSDP_HINT.test(text)) return null
  const location = /^location:\s*(\S+)/im.exec(text)?.[1] ?? ''
  const located = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(location)?.[1] ?? null
  const ip = located && parseIpv4(located) != null
    ? located
    : sourceIp && parseIpv4(sourceIp) != null
      ? sourceIp
      : null
  if (!ip) return null
  const services: RecorderService[] = []
  if (/\brtsp\b/i.test(text)) services.push('rtsp')
  if (/\bonvif\b/i.test(text)) services.push('onvif')
  const server = /^server:\s*(.+)$/im.exec(text)?.[1] ?? null
  return { ip, name: clipName(server), services, ports: [] }
}

function vendorFor(mac: string | null): string | null {
  const normal = normalizeMac(mac)
  if (!normal) return null
  return VENDORS[normal.slice(0, 8)] ?? null
}

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 0)
}

function cameraToken(token: string): boolean {
  return NAME_TOKENS.has(token) || token.startsWith('ipcam') || /^ipc\d+$/.test(token) || /^camera\d+$/.test(token)
}

function recorderToken(token: string): boolean {
  return token === 'nvr' || token === 'dvr' || token === 'recorder' || /^nvr\d+$/.test(token) || /^dvr\d+$/.test(token)
}

function clipName(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.slice(0, 120)
}

function encodeDnsName(fqdn: string): Uint8Array {
  const labels = fqdn.replace(/\.$/, '').split('.').filter((label) => label.length > 0)
  const parts: number[] = []
  for (const label of labels) {
    const bytes = [...label].map((char) => char.charCodeAt(0))
    if (bytes.length > 63 || bytes.some((byte) => byte > 127)) return new Uint8Array([0])
    parts.push(bytes.length, ...bytes)
  }
  parts.push(0)
  return Uint8Array.from(parts)
}

function uint16(packet: Uint8Array, offset: number): number | null {
  if (offset + 2 > packet.length) return null
  return (packet[offset] << 8) | packet[offset + 1]
}

function readName(packet: Uint8Array, start: number): { name: string, next: number } | null {
  const labels: string[] = []
  let cursor = start
  let next = start
  let jumped = false
  const seen = new Set<number>()
  while (labels.length < 16) {
    if (cursor >= packet.length || seen.has(cursor)) return null
    seen.add(cursor)
    const length = packet[cursor]
    if (length === 0) {
      if (!jumped) next = cursor + 1
      return { name: labels.join('.'), next }
    }
    if ((length & 0xc0) === 0xc0) {
      if (cursor + 1 >= packet.length) return null
      const pointer = ((length & 0x3f) << 8) | packet[cursor + 1]
      if (pointer >= packet.length) return null
      if (!jumped) next = cursor + 2
      jumped = true
      cursor = pointer
      continue
    }
    if ((length & 0xc0) !== 0 || cursor + 1 + length > packet.length) return null
    let label = ''
    for (let index = 0; index < length; index += 1) {
      const byte = packet[cursor + 1 + index]
      if (byte >= 32 && byte < 127) label += String.fromCharCode(byte)
    }
    labels.push(label)
    cursor += 1 + length
    if (!jumped) next = cursor
  }
  return null
}

function readRecord(packet: Uint8Array, offset: number): { record: MdnsRecord, next: number } | null {
  const owner = readName(packet, offset)
  if (!owner) return null
  const type = uint16(packet, owner.next)
  const length = uint16(packet, owner.next + 8)
  if (type == null || length == null) return null
  const rdata = owner.next + 10
  if (rdata + length > packet.length) return null
  const record: MdnsRecord = { name: owner.name, type, ptr: null, target: null, ip: null }
  if (type === 12) record.ptr = readName(packet, rdata)?.name ?? null
  else if (type === 33 && length >= 6) record.target = readName(packet, rdata + 6)?.name ?? null
  else if (type === 1 && length === 4) {
    record.ip = `${packet[rdata]}.${packet[rdata + 1]}.${packet[rdata + 2]}.${packet[rdata + 3]}`
  }
  return { record, next: rdata + length }
}

function dnsKey(name: string): string {
  return name.toLowerCase().replace(/\.$/, '')
}

function serviceOf(name: string): RecorderService | null {
  const key = dnsKey(name)
  if (key.includes('_rtsp._tcp')) return 'rtsp'
  if (key.includes('_onvif._tcp')) return 'onvif'
  return null
}

function instanceLabel(name: string): string | null {
  const label = name.split('.')[0] ?? ''
  if (!label || label.startsWith('_')) return null
  return clipName(label)
}
