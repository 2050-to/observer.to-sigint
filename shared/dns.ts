const QUESTION = /(?:^|\s)IP6?\s+(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]+)\.(\d+)\s+>\s+\S+\.53:.*?\s([A-Z0-9]+)\?\s+(\S+)/

export function localIpv4(interfaces: Record<string, { address: string; family: string | number; internal: boolean }[] | undefined>): string[] {
  const found: string[] = []
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      const family = entry.family === 4 || entry.family === 'IPv4'
      if (!family || entry.internal) continue
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(entry.address) && !found.includes(entry.address)) found.push(entry.address)
    }
  }
  return found
}

export function dnsCaptureFilter(addresses: string[]): string {
  const hosts = addresses.filter((address) => /^\d{1,3}(\.\d{1,3}){3}$/.test(address))
  if (hosts.length === 0) throw new Error('This Mac has no local IPv4 address to filter on.')
  return `udp port 53 and ( ${hosts.map((address) => `src host ${address}`).join(' or ')} )`
}

export function parseDnsLine(line: string): { src: string; name: string; type: string } | null {
  const match = QUESTION.exec(line)
  if (!match) return null
  const name = match[4].replace(/\.$/, '').toLowerCase()
  if (!name || name.length > 253 || name.endsWith('.local') || name.includes(' ')) return null
  const type = match[3].slice(0, 16)
  if (!/^[A-Z0-9]+$/.test(type)) return null
  return { src: match[1], name, type }
}

export function fromThisHost(src: string, local: readonly string[]): boolean {
  return local.includes(src)
}
