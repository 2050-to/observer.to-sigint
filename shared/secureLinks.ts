import { isTunnelName } from './subnet.js'

export const SOCKET_CAP = 400

export const SECURE_FLAGS = [
  '443',
  'tor',
  'vpn',
  'ssh',
  'dot',
  'mail',
  'ldaps',
  'ftps',
  'telnets',
  'sips',
  'ircs',
  'alt-tls',
  'apns',
] as const

export type SecureFlag = (typeof SECURE_FLAGS)[number]

export interface SocketEndpoint {
  host: string
  port: number | null
}

export interface ParsedSocket {
  process: string
  pid: number
  protocol: 'tcp' | 'udp'
  local: SocketEndpoint
  remote: SocketEndpoint | null
  state: string | null
}

export interface ClassifiedSocket extends ParsedSocket {
  flags: SecureFlag[]
}

export interface SecureFlagCount {
  flag: SecureFlag
  count: number
}

export interface VpnRoute {
  active: boolean
  interfaceName: string | null
}

export interface SecureLinkSnapshot {
  vpnRoute: VpnRoute
  sockets: ClassifiedSocket[]
  counts: SecureFlagCount[]
  truncated: boolean
  note: string | null
}

const TOR_PORTS = new Set([9050, 9150, 9051, 9151])
const TOR_REMOTE_PORTS = new Set([9001, 9030])
const VPN_PORTS = new Set([500, 4500, 1194, 51820, 1701, 1723])
const VPN_INTERFACE = /^(utun\d*|ipsec\d*|ppp\d*|tun\d*|wg\d*)$/
const VPN_COMMANDS = [
  'openvpn',
  'wireguard',
  'wireguard-go',
  'wg-quick',
  'tunnelblick',
  'viscosity',
  'nordvpn',
  'expressvpn',
  'protonvpn',
  'mullvad',
  'mullvad-daemon',
  'tailscale',
  'tailscaled',
  'vpnagentd',
  'globalprotect',
  'openconnect',
  'charon',
  'racoon',
  'pppd',
  'outline',
  'warp-svc',
]

const PORT_FLAGS: Array<[number, SecureFlag]> = [
  [22, 'ssh'],
  [853, 'dot'],
  [465, 'mail'],
  [993, 'mail'],
  [995, 'mail'],
  [636, 'ldaps'],
  [989, 'ftps'],
  [990, 'ftps'],
  [992, 'telnets'],
  [5061, 'sips'],
  [6697, 'ircs'],
  [8443, 'alt-tls'],
  [9443, 'alt-tls'],
  [5223, 'apns'],
]

interface SocketDraft {
  protocol: 'tcp' | 'udp' | null
  name: string | null
  state: string | null
}

export function flagLabel(flag: SecureFlag): string {
  switch (flag) {
    case '443': return '443'
    case 'tor': return 'Tor'
    case 'vpn': return 'VPN'
    case 'ssh': return 'SSH'
    case 'dot': return 'DNS over TLS'
    case 'mail': return 'Mail TLS'
    case 'ldaps': return 'LDAPS'
    case 'ftps': return 'FTPS'
    case 'telnets': return 'Telnet TLS'
    case 'sips': return 'SIPS'
    case 'ircs': return 'IRC TLS'
    case 'alt-tls': return 'Alt HTTPS'
    case 'apns': return 'APNs'
  }
}

export function classifySocket(socket: ParsedSocket): SecureFlag[] {
  const flags = new Set<SecureFlag>()
  const ports = [socket.local.port, socket.remote?.port ?? null]
  const has = (port: number) => ports.includes(port)
  if (has(443)) flags.add('443')
  if (isTorProcess(socket.process) || [...TOR_PORTS].some(has) || (socket.remote?.port != null && TOR_REMOTE_PORTS.has(socket.remote.port))) {
    flags.add('tor')
  }
  if (isVpnProcess(socket.process) || [...VPN_PORTS].some(has)) flags.add('vpn')
  for (const [port, flag] of PORT_FLAGS) {
    if (has(port)) flags.add(flag)
  }
  return SECURE_FLAGS.filter((flag) => flags.has(flag))
}

export function socketKey(socket: Pick<ParsedSocket, 'process' | 'protocol' | 'local' | 'remote'>): string {
  return [
    socket.process,
    socket.protocol,
    endpointKey(socket.local),
    socket.remote ? endpointKey(socket.remote) : '',
  ].join('\n')
}

export function markFresh<T extends Pick<ParsedSocket, 'process' | 'protocol' | 'local' | 'remote'>>(
  sockets: T[],
  seen: Set<string> | null,
): Array<T & { fresh: boolean }> {
  return sockets.map((socket) => ({
    ...socket,
    fresh: seen != null && !seen.has(socketKey(socket)),
  }))
}

export function defaultRouteInterface(routeText: string): string | null {
  const match = /^\s*interface:\s+(\S+)\s*$/m.exec(routeText)
  return match?.[1] ?? null
}

export function vpnRouteFrom(interfaceName: string | null): VpnRoute {
  if (!interfaceName || !isTunnelName(interfaceName) || !VPN_INTERFACE.test(interfaceName)) {
    return { active: false, interfaceName: null }
  }
  return { active: true, interfaceName }
}

export function parseLsof(text: string): ParsedSocket[] {
  const sockets: ParsedSocket[] = []
  let processName = ''
  let pid = -1
  let draft: SocketDraft | null = null
  const flush = () => {
    if (!draft) return
    const current = draft
    draft = null
    pushSocket(sockets, processName, pid, current)
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    const id = line[0]
    const value = line.slice(1)
    if (id === 'p') {
      flush()
      const next = Number(value)
      pid = Number.isInteger(next) && next >= 0 ? next : -1
      processName = ''
      continue
    }
    if (pid < 0) continue
    if (id === 'c') {
      processName = value.trim() || 'Unknown'
      continue
    }
    if (id === 'f') {
      flush()
      draft = { protocol: null, name: null, state: null }
      continue
    }
    if (!draft) continue
    if (id === 'P') draft.protocol = protocolOf(value)
    else if (id === 'n') draft.name = value
    else if (id === 'T' && value.startsWith('ST=')) draft.state = value.slice(3).trim() || null
  }
  flush()
  return sockets
}

export function flagSockets(sockets: ParsedSocket[]): ClassifiedSocket[] {
  const flagged: ClassifiedSocket[] = []
  for (const socket of sockets) {
    const flags = classifySocket(socket)
    if (flags.length > 0) flagged.push({ ...socket, flags })
  }
  return flagged
}

export function buildSnapshot(sockets: ParsedSocket[], vpnRoute: VpnRoute): SecureLinkSnapshot {
  const flagged = flagSockets(sockets)
  return {
    vpnRoute,
    sockets: flagged.slice(0, SOCKET_CAP),
    counts: countFlags(flagged),
    truncated: flagged.length > SOCKET_CAP,
    note: null,
  }
}

export function emptySnapshot(note: string | null): SecureLinkSnapshot {
  return {
    vpnRoute: { active: false, interfaceName: null },
    sockets: [],
    counts: [],
    truncated: false,
    note,
  }
}

function countFlags(sockets: ClassifiedSocket[]): SecureFlagCount[] {
  const totals = new Map<SecureFlag, number>()
  for (const socket of sockets) {
    for (const flag of socket.flags) totals.set(flag, (totals.get(flag) ?? 0) + 1)
  }
  return SECURE_FLAGS.flatMap((flag) => {
    const count = totals.get(flag) ?? 0
    return count > 0 ? [{ flag, count }] : []
  })
}

function isTorProcess(name: string): boolean {
  const value = name.trim().toLowerCase()
  return value === 'tor' || value === 'tor browser'
}

function isVpnProcess(name: string): boolean {
  const value = name.trim().toLowerCase()
  return VPN_COMMANDS.some((command) => value === command || value.startsWith(`${command} `) || value.startsWith(`${command}-`))
}

function endpointKey(endpoint: SocketEndpoint): string {
  return `${endpoint.host}:${endpoint.port ?? ''}`
}

function protocolOf(value: string): 'tcp' | 'udp' | null {
  const text = value.toLowerCase()
  if (text.startsWith('tcp')) return 'tcp'
  if (text.startsWith('udp')) return 'udp'
  return null
}

function pushSocket(sockets: ParsedSocket[], processName: string, pid: number, draft: SocketDraft): void {
  if (!draft.protocol || !draft.name || pid < 0) return
  const parsed = parseName(draft.name)
  if (!parsed) return
  sockets.push({
    process: processName || 'Unknown',
    pid,
    protocol: draft.protocol,
    local: parsed.local,
    remote: parsed.remote,
    state: draft.state,
  })
}

function parseName(name: string): { local: SocketEndpoint; remote: SocketEndpoint | null } | null {
  const arrow = name.indexOf('->')
  if (arrow === -1) {
    const local = parseEndpoint(name)
    return local ? { local, remote: null } : null
  }
  const local = parseEndpoint(name.slice(0, arrow))
  const remote = parseEndpoint(name.slice(arrow + 2))
  if (!local || !remote) return null
  return { local, remote }
}

function parseEndpoint(text: string): SocketEndpoint | null {
  const value = text.trim()
  if (!value) return null
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end <= 1) return null
    const host = value.slice(1, end)
    return finishEndpoint(host, value.slice(end + 1))
  }
  const colon = value.lastIndexOf(':')
  if (colon <= 0) return { host: value, port: null }
  return finishEndpoint(value.slice(0, colon), value.slice(colon))
}

function finishEndpoint(host: string, portText: string): SocketEndpoint | null {
  if (!host) return null
  if (!portText || portText === ':*') return { host, port: null }
  if (!portText.startsWith(':')) return null
  const raw = portText.slice(1)
  if (raw === '*') return { host, port: null }
  if (!/^\d+$/.test(raw)) return null
  const port = Number(raw)
  if (port > 65535) return null
  return { host, port }
}
