import { classifyRecorder } from '../../shared/recorders.js'
import type { CellRecord, DeviceRecord, NetworkRecord } from '../../shared/types.js'
import type { SubnetHost } from '../../shared/ownedNetwork.js'

export interface AskWifiRow {
  ssid: string
  city: string | null
  state: string | null
  zip: string | null
  country?: string | null
  region?: string | null
  locality?: string | null
  postal?: string | null
  security: string | null
  channel: number | null
}

export interface AskBluetoothRow {
  name: string | null
  city: string | null
  state: string | null
  zip: string | null
  country?: string | null
  region?: string | null
  locality?: string | null
  postal?: string | null
}

const SECTION_CAP = 20
const WIFI_CAP = 40

function tokensOf(question: string): string[] {
  return question.toLowerCase().split(/[^a-z0-9.-]+/).filter((token) => token.length > 2).slice(0, 8)
}

function pick(rows: string[], tokens: string[], cap: number): string[] {
  const matched = tokens.length
    ? rows.filter((row) => tokens.some((token) => row.toLowerCase().includes(token)))
    : []
  return (matched.length > 0 ? matched : rows).slice(0, cap)
}

export function buildAskExcerpt(input: {
  question: string
  wifi: AskWifiRow[]
  bluetooth: AskBluetoothRow[]
  cells: CellRecord[]
  networks: NetworkRecord[]
  devices: DeviceRecord[]
  owned: SubnetHost[]
}): string {
  const tokens = tokensOf(input.question)
  const wifi = input.wifi.map((row) => [row.ssid, row.country, row.region ?? row.state, row.locality ?? row.city, row.postal ?? row.zip, row.security, row.channel].filter(Boolean).join(' '))
  const bluetooth = input.bluetooth.map((row) => [row.name, row.country, row.region ?? row.state, row.locality ?? row.city, row.postal ?? row.zip].filter(Boolean).join(' '))
  const towers = input.cells.map((cell) => [cell.radio, cell.role, cell.mcc, cell.mnc, cell.area, cell.cellId].filter(Boolean).join(' '))
  const enrichment = uniqueLines(input.networks.flatMap((network) => enrichmentLine(network.ssid || network.enrichment?.queryTitle, network.enrichment))
    .concat(input.devices.flatMap((device) => enrichmentLine(device.name || device.enrichment?.queryTitle, device.enrichment))))
  const owned = input.owned.filter((host) => host.present && host.role === 'host').map((host) => {
    const flag = classifyRecorder(host)
    return [host.ip, host.name, flag ? `${flag.kind} ${flag.reasons.join(' ')}` : null].filter(Boolean).join(' ')
  })
  const sections: [string, string[], number][] = [
    ['Wi-Fi', wifi, WIFI_CAP],
    ['Bluetooth', bluetooth, SECTION_CAP],
    ['Tower', towers, SECTION_CAP],
    ['Enrichment', enrichment, SECTION_CAP],
    ['Owned network', owned, SECTION_CAP],
  ]
  const anyMatch = tokens.length > 0 && sections.some(([, rows]) => rows.some((row) => tokens.some((token) => row.toLowerCase().includes(token))))
  const lines = sections.flatMap(([label, rows, cap]) => {
    const chosen = anyMatch
      ? rows.filter((row) => tokens.some((token) => row.toLowerCase().includes(token))).slice(0, cap)
      : pick(rows, [], cap)
    return chosen.map((row) => `${label}: ${row}`)
  })
  if (lines.length === 0) return 'No records.'
  return lines.join('\n')
}

function enrichmentLine(name: string | null | undefined, enrichment: NetworkRecord['enrichment']): string[] {
  if (!enrichment) return []
  const title = (name || enrichment.queryTitle || 'Unnamed').trim()
  const reason = enrichment.risk.reasons.find((item) => item.trim()) ?? enrichment.risk.level
  return [`${title} ${enrichment.risk.level} ${reason}`]
}

function uniqueLines(rows: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const row of rows) {
    const key = row.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(row)
  }
  return unique
}
