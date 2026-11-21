import { appOrigin } from './auth.js'
import { sendEmail } from './mail.js'
import type { Store } from './store.js'
import type { CellRecord, DeviceRecord, NetworkRecord, OpenRow } from './types.js'

export const ALERT_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

export interface AlertDigest {
  openNetworks: { name: string; security: string; lastSeen: string; place: string | null }[]
  highRisk: { name: string; reason: string }[]
  newNetworks: number
  newDevices: number
  newCells: number
  observationCount: number
}

export function alertShouldSend(input: {
  status: string
  lastAlertAt: string | null
  observationCount: number
  now: number
}): boolean {
  if (input.status !== 'active') return false
  if (input.observationCount <= 0) return false
  if (!input.lastAlertAt) return true
  return input.now - Date.parse(input.lastAlertAt) >= ALERT_INTERVAL_MS
}

function isNew(firstSeen: string, since: string | null): boolean {
  if (!since) return true
  const seen = Date.parse(firstSeen)
  const start = Date.parse(since)
  return Number.isFinite(seen) && Number.isFinite(start) && seen > start
}

function riskItems(records: { name: string; enrichment: NetworkRecord['enrichment'] }[]): AlertDigest['highRisk'] {
  const items: AlertDigest['highRisk'] = []
  for (const record of records) {
    if (record.enrichment?.risk.level !== 'high') continue
    const reason = record.enrichment.risk.reasons.find((item) => item.trim()) ?? 'Flagged from public support and vulnerability records'
    items.push({ name: record.name || 'Unnamed device', reason })
    if (items.length >= 15) break
  }
  return items
}

export function digestFromCatalog(input: {
  networks: NetworkRecord[]
  devices: DeviceRecord[]
  cells: CellRecord[]
  openRows: OpenRow[]
  since: string | null
}): AlertDigest {
  const openNetworks = input.openRows.slice(0, 15).map((row) => ({
    name: row.label,
    security: row.security,
    lastSeen: row.lastSeen,
    place: row.address,
  }))
  const fromNetworks = input.networks.map((network) => ({
    name: network.hidden || !network.ssid ? 'Unnamed network' : network.ssid,
    enrichment: network.enrichment,
  }))
  const fromDevices = input.devices.map((device) => ({
    name: device.name || device.enrichment?.queryTitle || 'Unnamed advertiser',
    enrichment: device.enrichment,
  }))
  return {
    openNetworks,
    highRisk: riskItems([...fromNetworks, ...fromDevices]),
    newNetworks: input.networks.filter((network) => isNew(network.firstSeen, input.since)).length,
    newDevices: input.devices.filter((device) => isNew(device.firstSeen, input.since)).length,
    newCells: input.cells.filter((cell) => isNew(cell.firstSeen, input.since)).length,
    observationCount: input.networks.length + input.devices.length + input.cells.length,
  }
}

export function alertText(digest: AlertDigest): string {
  const open = digest.openNetworks.length
    ? digest.openNetworks.map((row) => {
      const place = row.place ? `, ${row.place}` : ''
      return `- ${row.name} (${row.security}), last heard ${row.lastSeen}${place}`
    }).join('\n')
    : '- None in the saved catalog'
  const risk = digest.highRisk.length
    ? digest.highRisk.map((row) => `- ${row.name}: ${row.reason}`).join('\n')
    : '- None in the saved catalog'
  return [
    'Observer.to monthly review',
    '',
    'Open networks',
    open,
    '',
    'High risk from public research',
    risk,
    '',
    'New since the previous review',
    `- Networks: ${digest.newNetworks}`,
    `- Bluetooth advertisers: ${digest.newDevices}`,
    `- Towers: ${digest.newCells}`,
    '',
    `Open the observer: ${appOrigin()}/app`,
    '',
    'Observer.to records public beacons only. It does not intercept protected Wi-Fi, Bluetooth connections, or cellular calls. It does not capture subscriber identities, transmit, jam, spoof, or track a person.',
  ].join('\n')
}

export async function digestFor(store: Store, userId: string, since: string | null): Promise<AlertDigest> {
  const [networks, devices, cells, openRows] = await Promise.all([
    store.catalog(userId),
    store.devices(userId),
    store.cells(userId),
    store.open(userId),
  ])
  return digestFromCatalog({ networks, devices, cells, openRows, since })
}

export async function deliverDueAlerts(
  store: Store,
  send: (input: { to: string; subject: string; text: string }) => Promise<unknown> = sendEmail,
): Promise<number> {
  const due = await store.alertCandidates()
  let sent = 0
  for (const user of due) {
    const digest = await digestFor(store, user.id, user.lastAlertAt)
    if (!alertShouldSend({
      status: 'active',
      lastAlertAt: user.lastAlertAt,
      observationCount: digest.observationCount,
      now: Date.now(),
    })) continue
    const claimed = await store.claimAlert(user.id)
    if (!claimed) continue
    try {
      await send({
        to: user.email,
        subject: 'Observer.to monthly review',
        text: alertText(digest),
      })
      sent += 1
    } catch {
      await store.restoreAlert(user.id, user.lastAlertAt)
      console.error('monthly alert failed')
    }
  }
  return sent
}

export class AlertWorker {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly store: Store,
    private readonly intervalMs = 60 * 60 * 1000,
  ) {}

  start(): void {
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    try {
      await deliverDueAlerts(this.store)
    } catch {
      console.error('monthly alert pass failed')
    }
  }
}
