import { execFile, execFileSync } from 'node:child_process'
import { createSocket, type Socket } from 'node:dgram'
import { connect as connectTcp } from 'node:net'
import { arch, cpus, hostname, networkInterfaces, release, totalmem, type, type NetworkInterfaceInfo } from 'node:os'
import { promisify } from 'node:util'
import {
  assembleCatalog,
  parseArpTable,
  presentFrom,
  type DeviceDetails,
  type SubnetCatalog,
} from '../shared/ownedNetwork.js'
import {
  applySightings,
  encodeMdnsQuery,
  parseMdnsPacket,
  parseSsdpMessage,
  RECORDER_PORTS,
  sightingsFromMdns,
  type MdnsRecord,
  type RecorderSighting,
} from '../shared/recorders.js'
import {
  chooseLanInterface,
  isTunnelName,
  netmaskToPrefix,
  normalizeMac,
  parseIpv4,
  planSubnet,
  type LanCandidate,
} from '../shared/subnet.js'

const execFileAsync = promisify(execFile)
const NO_LAN = 'Connect to a Wi-Fi or Ethernet network you own to catalog its addresses.'
const DISCOVER_MS = 2000
const SSDP_SEARCH = [
  'M-SEARCH * HTTP/1.1',
  'HOST: 239.255.255.250:1900',
  'MAN: "ssdp:discover"',
  'MX: 1',
  'ST: ssdp:all',
  '',
  '',
].join('\r\n')

export async function catalogLocalSubnet(): Promise<SubnetCatalog> {
  const lan = chooseLocalLan()
  if (!lan) throw new Error(NO_LAN)
  const plan = planSubnet(lan.address, lan.prefix)
  if (!plan) throw new Error(NO_LAN)
  const targets = plan.addresses.filter((item) => item.role === 'host').map((item) => item.ip)
  const pinged = await pingHosts(targets)
  const arp = readArp()
  const catalog = assembleCatalog(plan, presentFrom(pinged, arp, targets), arp, { mac: lan.mac, name: null })
  const sightings = await discover(targets, lan.address).catch(() => [] as RecorderSighting[])
  return { ...applySightings(catalog, sightings), internetRoute: hasInternetRoute() }
}

export function localDeviceDetails(browser: string): DeviceDetails {
  const cores = cpus()
  const model = cores[0]?.model?.trim() || 'Unknown processor'
  const agent = browser.trim().slice(0, 300) || 'Unknown browser'
  const name = hostname().trim().slice(0, 200) || 'This device'
  return {
    os: `${type()} ${release()} (${arch()})`.slice(0, 200),
    browser: agent,
    ramBytes: totalmem(),
    cpu: `${model} x ${cores.length}`.slice(0, 200),
    hostname: name,
    collectedAt: new Date().toISOString(),
  }
}

function chooseLocalLan(): { address: string; prefix: number; mac: string | null } | null {
  const candidates: LanCandidate[] = []
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (!isIpv4(entry)) continue
      const prefix = prefixOf(entry)
      if (prefix == null) continue
      candidates.push({
        name,
        address: entry.address,
        prefix,
        mac: normalizeMac(entry.mac),
        internal: entry.internal,
        tunnel: isTunnelName(name),
      })
    }
  }
  const chosen = chooseLanInterface(candidates, defaultInterfaceName())
  if (!chosen) return null
  return { address: chosen.address, prefix: chosen.prefix, mac: chosen.mac }
}

function isIpv4(entry: NetworkInterfaceInfo): entry is NetworkInterfaceInfo & { family: 'IPv4' } {
  return entry.family === 'IPv4'
}

function prefixOf(entry: NetworkInterfaceInfo): number | null {
  const cidr = entry.cidr?.split('/')[1]
  if (cidr) {
    const prefix = Number(cidr)
    if (Number.isInteger(prefix)) return prefix
  }
  return entry.netmask ? netmaskToPrefix(entry.netmask) : null
}

function hasInternetRoute(): boolean {
  try {
    const text = execFileSync('route', ['-n', 'get', 'default'], { encoding: 'utf8', timeout: 2000 })
    return /^\s*gateway:\s+\d+\.\d+\.\d+\.\d+\s*$/m.test(text)
  } catch {
    return false
  }
}

async function discover(hosts: string[], lanAddress: string): Promise<RecorderSighting[]> {
  const [announced, probed] = await Promise.all([
    listenForAnnouncements(lanAddress, DISCOVER_MS),
    probePorts(hosts),
  ])
  return [...announced, ...probed]
}

function listenForAnnouncements(lanAddress: string, timeoutMs: number): Promise<RecorderSighting[]> {
  return new Promise((resolve) => {
    const records: MdnsRecord[] = []
    const sightings: RecorderSighting[] = []
    let settled = false
    const mdns = createSocket({ type: 'udp4', reuseAddr: true })
    const ssdp = createSocket({ type: 'udp4', reuseAddr: true })
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      closeSocket(mdns)
      closeSocket(ssdp)
      resolve([...sightingsFromMdns(records), ...sightings])
    }
    timer = setTimeout(finish, timeoutMs)
    mdns.on('error', () => undefined)
    ssdp.on('error', () => undefined)
    mdns.on('message', (message: Buffer) => {
      if (!settled) records.push(...parseMdnsPacket(message))
    })
    ssdp.on('message', (message: Buffer, remote: { address?: string }) => {
      if (settled) return
      const sighting = parseSsdpMessage(message.toString('utf8'), remote.address)
      if (sighting) sightings.push(sighting)
    })
    mdns.on('listening', () => {
      try {
        mdns.setMulticastTTL(255)
        mdns.setMulticastInterface(lanAddress)
      } catch {
        // The query can still leave on the default interface.
      }
      sendUdp(mdns, Buffer.from(encodeMdnsQuery('_rtsp._tcp.local')), 5353, '224.0.0.251')
      sendUdp(mdns, Buffer.from(encodeMdnsQuery('_onvif._tcp.local')), 5353, '224.0.0.251')
    })
    ssdp.on('listening', () => {
      try {
        ssdp.setMulticastInterface(lanAddress)
      } catch {
        // The search can still go to the SSDP address.
      }
      sendUdp(ssdp, Buffer.from(SSDP_SEARCH), 1900, '239.255.255.250')
    })
    try {
      mdns.bind(0)
      ssdp.bind(0)
    } catch {
      finish()
    }
  })
}

function sendUdp(socket: Socket, message: Buffer, port: number, address: string): void {
  try {
    socket.send(message, port, address)
  } catch {
    // Announcements are optional. The port check still runs.
  }
}

function closeSocket(socket: Socket): void {
  try {
    socket.close()
  } catch {
    // The socket is already closed.
  }
}

function probePorts(hosts: string[]): Promise<RecorderSighting[]> {
  const jobs: { ip: string, port: number }[] = []
  for (const ip of hosts) {
    if (parseIpv4(ip) == null) continue
    for (const port of RECORDER_PORTS) jobs.push({ ip, port })
  }
  const open = new Map<string, number[]>()
  let index = 0
  async function worker(): Promise<void> {
    while (index < jobs.length) {
      const job = jobs[index]
      index += 1
      if (await probeOne(job.ip, job.port)) {
        const ports = open.get(job.ip) ?? []
        ports.push(job.port)
        open.set(job.ip, ports)
      }
    }
  }
  const workers = Array.from({ length: Math.min(32, jobs.length) }, () => worker())
  return Promise.all(workers).then(() => [...open].map(([ip, ports]) => ({
    ip,
    name: null,
    services: [],
    ports,
  })))
}

function probeOne(ip: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connectTcp({ host: ip, port, family: 4 })
    let settled = false
    const finish = (open: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(open)
    }
    const timer = setTimeout(() => finish(false), 400)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

function defaultInterfaceName(): string | null {
  try {
    const text = execFileSync('route', ['-n', 'get', 'default'], { encoding: 'utf8', timeout: 2000 })
    return text.match(/^interface:\s+(\S+)/m)?.[1] ?? null
  } catch {
    return null
  }
}

function readArp(): ReturnType<typeof parseArpTable> {
  try {
    return parseArpTable(execFileSync('arp', ['-a'], { encoding: 'utf8', timeout: 2000 }))
  } catch {
    return {}
  }
}

async function pingHosts(hosts: string[]): Promise<Set<string>> {
  const present = new Set<string>()
  let index = 0
  async function worker(): Promise<void> {
    while (index < hosts.length) {
      const ip = hosts[index]
      index += 1
      if (await pingOne(ip)) present.add(ip)
    }
  }
  const workers = Array.from({ length: Math.min(32, hosts.length) }, () => worker())
  await Promise.all(workers)
  return present
}

async function pingOne(ip: string): Promise<boolean> {
  if (parseIpv4(ip) == null) return false
  try {
    await execFileAsync('ping', ['-c', '1', '-W', '1000', '-n', ip], { timeout: 2000 })
    return true
  } catch {
    return false
  }
}
