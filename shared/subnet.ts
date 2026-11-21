export type AddressRole = 'network' | 'broadcast' | 'device' | 'host'

export interface PlannedAddress {
  ip: string
  role: AddressRole
}

export interface SubnetPlan {
  cidr: string
  interfacePrefix: number
  limited: boolean
  device: string
  addresses: PlannedAddress[]
}

export interface LanCandidate {
  name: string
  address: string
  prefix: number
  mac: string | null
  internal: boolean
  tunnel: boolean
}

const MAX_HOSTS = 256

export function parseIpv4(text: string): number | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return null
    if (part.length > 1 && part.startsWith('0')) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = ((value << 8) | octet) >>> 0
  }
  return value
}

export function formatIpv4(value: number): string {
  const ip = value >>> 0
  return `${(ip >>> 24) & 255}.${(ip >>> 16) & 255}.${(ip >>> 8) & 255}.${ip & 255}`
}

export function netmaskToPrefix(mask: string): number | null {
  const value = parseIpv4(mask)
  if (value == null) return null
  let seenZero = false
  let bits = 0
  for (let shift = 31; shift >= 0; shift -= 1) {
    const one = ((value >>> shift) & 1) === 1
    if (one && seenZero) return null
    if (one) bits += 1
    else seenZero = true
  }
  return bits
}

export function normalizeMac(value: string | null | undefined): string | null {
  if (!value) return null
  const parts = value.trim().toLowerCase().split(':')
  if (parts.length !== 6) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^[0-9a-f]{1,2}$/.test(part)) return null
    octets.push(Number.parseInt(part, 16))
  }
  const mac = octets.map((octet) => octet.toString(16).padStart(2, '0')).join(':')
  if (mac === '00:00:00:00:00:00' || mac === '02:00:00:00:00:00') return null
  return mac
}

export function isTunnelName(name: string): boolean {
  return /^(lo\d*|utun\d*|awdl\d*|llw\d*|bridge\d*|docker\d*|vboxnet\d*|vmnet\d*|gif\d*|stf\d*|tun\d*|ppp\d*|ipsec\d*|wg\d*|ap\d+)$/.test(name)
}

export function planSubnet(address: string, prefixLength: number): SubnetPlan | null {
  const ip = parseIpv4(address)
  if (ip == null) return null
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) return null
  if (ip === 0 || ip === 0xffffffff) return null
  if ((ip >>> 28) === 14) return null
  const limited = prefixLength < 24
  const prefix = limited ? 24 : prefixLength
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (ip & mask) >>> 0
  const broadcast = prefix === 32 ? network : (network | (~mask >>> 0)) >>> 0
  if (broadcast < network || broadcast - network > MAX_HOSTS - 1) return null
  const device = formatIpv4(ip)
  const addresses: PlannedAddress[] = []
  for (let value = network; value <= broadcast; value += 1) {
    const host = formatIpv4(value)
    let role: AddressRole
    if (host === device) role = 'device'
    else if (prefix <= 30 && value === network) role = 'network'
    else if (prefix <= 30 && value === broadcast) role = 'broadcast'
    else role = 'host'
    addresses.push({ ip: host, role })
  }
  return {
    cidr: `${formatIpv4(network)}/${prefix}`,
    interfacePrefix: prefixLength,
    limited,
    device,
    addresses,
  }
}

export function chooseLanInterface(candidates: LanCandidate[], preferredName: string | null): LanCandidate | null {
  const usable = candidates.filter((item) => (
    !item.internal
    && !item.tunnel
    && !item.address.startsWith('169.254.')
    && Number.isInteger(item.prefix)
    && item.prefix >= 0
    && item.prefix <= 32
    && parseIpv4(item.address) != null
  ))
  const preferred = usable.find((item) => item.name === preferredName)
  if (preferred) return preferred
  return usable.find((item) => /^(en|eth|wlan|wl)\d/.test(item.name)) ?? null
}
