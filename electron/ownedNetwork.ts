import { execFile, execFileSync } from 'node:child_process'
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

export async function catalogLocalSubnet(): Promise<SubnetCatalog> {
  const lan = chooseLocalLan()
  if (!lan) throw new Error(NO_LAN)
  const plan = planSubnet(lan.address, lan.prefix)
  if (!plan) throw new Error(NO_LAN)
  const targets = plan.addresses.filter((item) => item.role === 'host').map((item) => item.ip)
  const pinged = await pingHosts(targets)
  const arp = readArp()
  return assembleCatalog(plan, presentFrom(pinged, arp, targets), arp, { mac: lan.mac, name: null })
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
