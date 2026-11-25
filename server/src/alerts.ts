import { accessPointByBssid, groupAccessPoints, groupAdvertisers } from '../../shared/accessPoints.js'
import { closedRadioIds, dispositionOpen, shownReasons, siteEventId, type Disposition } from '../../shared/disposition.js'
import { ownedChangeText, type OwnedChange } from '../../shared/ownedDiff.js'
import type { WeeklyReview } from '../../shared/review.js'
import { reviewSiteEvents, siteFindings, walkDue, type SiteEvent, type SiteRecord } from '../../shared/sites.js'
import { bssidHmac } from './crypto.js'
import { appOrigin } from './auth.js'
import { sendEmail } from './mail.js'
import type { Store } from './store.js'
import type { CellRecord, DeviceRecord, NetworkRecord, OpenRow } from './types.js'

export const ALERT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
export const CRITICAL_DAILY_CAP = 20

export type AlertDigest = WeeklyReview

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

function riskItems(
  records: { name: string; enrichment: NetworkRecord['enrichment']; kind: 'ap' | 'adv' | null; id: string | null }[],
  dispositions: Disposition[],
): AlertDigest['highRisk'] {
  const closed = new Set(
    dispositions.filter((item) => !dispositionOpen(item.status)).map((item) => `${item.kind}:${item.id}`),
  )
  const byKey = new Map(dispositions.map((item) => [`${item.kind}:${item.id}`, item]))
  const items: AlertDigest['highRisk'] = []
  const listed = new Set<string>()
  for (const record of records) {
    if (record.kind && record.id && closed.has(`${record.kind}:${record.id}`)) continue
    if (record.enrichment?.risk.level !== 'high') continue
    const name = record.name || 'Unnamed device'
    const key = name.trim().toLowerCase()
    if (listed.has(key)) continue
    listed.add(key)
    const disposition = record.kind && record.id ? byKey.get(`${record.kind}:${record.id}`) ?? null : null
    const raw = record.enrichment.risk.reasons.find((item) => item.trim()) ?? 'Flagged from public support and vulnerability records'
    const reason = shownReasons([raw], disposition)[0] ?? raw
    items.push({
      name,
      reason,
      kind: record.kind,
      id: record.id,
      status: disposition?.status ?? null,
    })
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
  sites?: SiteRecord[]
  dispositions?: Disposition[]
  ownedChanges?: OwnedChange[]
}): AlertDigest {
  const openNetworks = input.openRows.slice(0, 15).map((row) => ({
    name: row.label,
    security: row.security,
    lastSeen: row.lastSeen,
    place: row.address,
  }))
  const accessPoints = groupAccessPoints(input.networks)
  const accessPointOf = accessPointByBssid(accessPoints)
  const advertisers = groupAdvertisers(input.devices)
  const advertiserOf = new Map(advertisers.flatMap((group) => group.devices.map((device) => [device.address, group] as const)))
  const dispositions = input.dispositions ?? []
  const hidden = closedRadioIds(dispositions)
  const fromNetworks = input.networks.map((network) => {
    const ap = accessPointOf.get(network.bssid)
    return {
      name: ap && ap.ssids.length > 0 ? ap.label : 'Unnamed network',
      enrichment: network.enrichment,
      kind: 'ap' as const,
      id: ap?.id ?? network.bssid,
    }
  })
  const fromDevices = input.devices.map((device) => {
    const group = advertiserOf.get(device.address)
    return {
      name: device.name || device.enrichment?.queryTitle || 'Unnamed advertiser',
      enrichment: device.enrichment,
      kind: 'adv' as const,
      id: group?.id ?? device.address,
    }
  })
  const newAccessPoints = accessPoints.filter((ap) => ap.networks.every((network) => isNew(network.firstSeen, input.since)))
  const newAdvertisers = advertisers.filter((group) => group.devices.every((device) => isNew(device.firstSeen, input.since)))
  const newCells = input.cells.filter((cell) => isNew(cell.firstSeen, input.since))
  const newRadios = [
    ...newAccessPoints.map((ap) => ({
      kind: 'ap' as const,
      id: ap.id,
      label: ap.label,
      firstSeen: earliest(ap.networks.map((network) => network.firstSeen)),
      lat: ap.best.bestLat ?? null,
      lon: ap.best.bestLon ?? null,
    })),
    ...newAdvertisers.map((group) => ({
      kind: 'adv' as const,
      id: group.id,
      label: group.label,
      firstSeen: earliest(group.devices.map((device) => device.firstSeen)),
      lat: group.best.bestLat ?? null,
      lon: group.best.bestLon ?? null,
    })),
    ...newCells.map((cell) => ({
      kind: 'cell' as const,
      id: cell.key || cell.cellId || `cell:${cell.firstSeen}`,
      label: cell.radio ? `${cell.radio.toUpperCase()} ${cell.cellId || ''}`.trim() : 'Tower',
      firstSeen: cell.firstSeen,
      lat: cell.bestLat ?? cell.siteLat ?? null,
      lon: cell.bestLon ?? cell.siteLon ?? null,
    })),
  ]
  return {
    openNetworks,
    highRisk: riskItems([...fromNetworks, ...fromDevices], dispositions),
    newAccessPoints: newAccessPoints.length,
    newAdvertisers: newAdvertisers.length,
    newCells: newCells.length,
    newRadios: newRadios.slice(0, 50),
    newRadioRemainder: Math.max(0, newRadios.length - 50),
    observationCount: input.networks.length + input.devices.length + input.cells.length,
    siteFindings: (input.sites ?? []).flatMap((site) => siteFindings(site))
      .filter((finding) => !finding.detail.toLowerCase().match(/[0-9a-f]{2}(?::[0-9a-f]{2}){5}/g)?.some((mac) => hidden.has(mac)))
      .slice(0, 15),
    siteEvents: siteEventsFor(input.sites ?? [], input.since, dispositions, hidden),
    ownedChanges: (input.ownedChanges ?? []).slice(0, 15).map((change) => ({ text: ownedChangeText(change) })),
    overdueWalks: (input.sites ?? []).flatMap((site) => {
      const due = walkDue(site)
      return due.overdue ? [{ site: site.name, walkedAt: site.lastWalk?.walkedAt ?? null, dueAt: due.dueAt }] : []
    }).slice(0, 15),
  }
}

function earliest(values: string[]): string {
  return values.filter(Boolean).sort()[0] ?? ''
}

function siteEventsFor(
  sites: SiteRecord[],
  since: string | null,
  dispositions: Disposition[],
  hidden: Set<string>,
): AlertDigest['siteEvents'] {
  const closedEvents = new Set(
    dispositions.filter((item) => item.kind === 'site_event' && !dispositionOpen(item.status)).map((item) => item.id),
  )
  return sites.flatMap((site) => reviewSiteEvents(site, since).flatMap((event) => {
    if (hidden.has(event.bssid.toLowerCase())) return []
    if (closedEvents.has(siteEventId(site.id, event))) return []
    return [{
      site: site.name,
      kind: event.kind,
      severity: event.severity,
      at: event.at,
      bssid: event.bssid,
      label: event.detail,
    }]
  })).sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1
    return Date.parse(b.at) - Date.parse(a.at)
  }).slice(0, 15)
}

export function criticalShouldSend(status: string): boolean {
  return status === 'active'
}

export function underCriticalCap(sentToday: number): boolean {
  return sentToday < CRITICAL_DAILY_CAP
}

export function findingKey(siteId: string, event: Pick<SiteEvent, 'kind' | 'bssid' | 'episode'>): string {
  return `critical:${siteId}:${event.kind}:${event.bssid}:${event.episode}`
}

export function pendingCritical(siteId: string, events: SiteEvent[], sent: ReadonlySet<string>): SiteEvent[] {
  return events.filter((event) => event.severity === 'critical' && !sent.has(findingKey(siteId, event)))
}

export function criticalAlertText(rows: { site: string; detail: string }[]): string {
  return [
    'Observer.to site alert',
    '',
    ...rows.map((row) => `- ${row.site}: ${row.detail}`),
    '',
    `Open the observer: ${appOrigin()}/app`,
    '',
    'Observer.to records public beacons only. It does not intercept protected Wi-Fi, Bluetooth connections, or cellular calls. It does not capture subscriber identities, transmit, jam, spoof, or track a person.',
  ].join('\n')
}

function section(rows: string[], empty: string): string {
  return rows.length ? rows.join('\n') : empty
}

function withoutHardware(value: string): string {
  return value.replace(/[0-9a-f]{2}(?::[0-9a-f]{2}){5}/gi, 'a radio')
}

export function alertText(digest: AlertDigest): string {
  const open = section(digest.openNetworks.map((row) => {
    const place = row.place ? `, ${row.place}` : ''
    return `- ${row.name} (${row.security}), last heard ${row.lastSeen}${place}`
  }), '- None in the saved catalog')
  const risk = section(digest.highRisk.map((row) => {
    const verified = row.status === 'verified' ? ' (verified)' : ''
    return `- ${row.name}: ${row.reason}${verified}`
  }), '- None in the saved catalog')
  const findings = section((digest.siteFindings ?? []).map((row) => `- ${row.site}: ${row.label}`), '- None in the saved catalog')
  const events = section((digest.siteEvents ?? []).map((row) => `- ${row.site}: ${row.label}`), '- None in the saved catalog')
  const owned = section((digest.ownedChanges ?? []).map((row) => `- ${row.text}`), '- None in the saved catalog')
  return [
    'Observer.to weekly review',
    '',
    'Open networks',
    open,
    '',
    'High risk from public research',
    risk,
    '',
    'New since the previous review',
    `- Access points: ${digest.newAccessPoints}`,
    `- Bluetooth advertisers: ${digest.newAdvertisers}`,
    `- Towers: ${digest.newCells}`,
    ...((digest.newRadios ?? []).slice(0, 15).map((row) => `- ${withoutHardware(row.label)}`)),
    ...((digest.newRadios?.length ?? 0) + (digest.newRadioRemainder ?? 0) > 15
      ? [`- ${(digest.newRadios?.length ?? 0) + (digest.newRadioRemainder ?? 0) - 15} more`]
      : []),
    '',
    'Walks due',
    section((digest.overdueWalks ?? []).map((row) => `- ${row.site} due ${row.dueAt}`), '- None'),
    '',
    'Site findings',
    findings,
    '',
    'Site events',
    events,
    '',
    'Owned-network changes',
    owned,
    '',
    `Open the observer: ${appOrigin()}/app`,
    '',
    'Observer.to records public beacons only. It does not intercept protected Wi-Fi, Bluetooth connections, or cellular calls. It does not capture subscriber identities, transmit, jam, spoof, or track a person.',
  ].join('\n')
}

export async function digestFor(store: Store, userId: string, since: string | null): Promise<AlertDigest> {
  const [networks, devices, cells, openRows, sites, dispositions, ownedChanges] = await Promise.all([
    store.catalog(userId),
    store.devices(userId),
    store.cells(userId),
    store.open(userId),
    store.sites(userId),
    store.dispositions(userId),
    store.lanChanges(userId),
  ])
  return digestFromCatalog({ networks, devices, cells, openRows, since, sites, dispositions, ownedChanges })
}

export async function buildDueReviews(store: Store): Promise<number> {
  const due = await store.reviewCandidates()
  let built = 0
  for (const user of due) {
    const digest = await digestFor(store, user.id, user.lastReviewAt)
    await store.saveReview(user.id, digest)
    built += 1
  }
  return built
}

export async function deliverDueAlerts(
  store: Store,
  send: (input: { to: string; subject: string; text: string }) => Promise<unknown> = sendEmail,
): Promise<number> {
  const due = await store.alertCandidates()
  let sent = 0
  for (const user of due) {
    const stored = await store.reviewFor(user.id)
    const digest = stored?.digest ?? await digestFor(store, user.id, user.lastAlertAt)
    if (!stored) await store.saveReview(user.id, digest)
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
        subject: 'Observer.to weekly review',
        text: alertText(digest),
      })
      sent += 1
    } catch {
      await store.restoreAlert(user.id, user.lastAlertAt)
      console.error('weekly alert failed')
    }
  }
  return sent
}

export async function deliverCriticalAlerts(
  store: Store,
  send: (input: { to: string; subject: string; text: string }) => Promise<unknown> = sendEmail,
  userId?: string,
): Promise<number> {
  const recipients = userId
    ? await oneRecipient(store, userId)
    : await store.criticalRecipients()
  let sent = 0
  for (const user of recipients) {
    try {
      sent += await deliverCriticalTo(store, user, send)
    } catch {
      console.error('critical alert failed')
    }
  }
  return sent
}

async function oneRecipient(store: Store, userId: string): Promise<{ id: string; email: string }[]> {
  const user = await store.userById(userId)
  return user ? [user] : []
}

async function deliverCriticalTo(
  store: Store,
  user: { id: string; email: string },
  send: (input: { to: string; subject: string; text: string }) => Promise<unknown>,
): Promise<number> {
  const subscription = await store.subscriptionFor(user.id)
  if (!criticalShouldSend(subscription.status)) return 0
  const sites = await store.sites(user.id)
  const sentKeys = await store.criticalFindingKeys(user.id)
  const seen = new Set<string>()
  const pending = sites.flatMap((site) => (site.events ?? []).flatMap((event) => {
    if (event.severity !== 'critical') return []
    const hmac = bssidHmac(findingKey(site.id, event))
    const hex = hmac.toString('hex')
    if (sentKeys.has(hex) || seen.has(hex)) return []
    seen.add(hex)
    return [{ site: site.name, detail: event.detail, hmac }]
  }))
  if (pending.length === 0 || !underCriticalCap(await store.criticalMessagesToday(user.id))) return 0
  const claimed = await store.claimCriticalFindings(user.id, pending.map((item) => item.hmac), CRITICAL_DAILY_CAP)
  if (claimed.length === 0) return 0
  const claimedHex = new Set(claimed.map((hmac) => hmac.toString('hex')))
  const rows = pending.filter((item) => claimedHex.has(item.hmac.toString('hex')))
  try {
    await send({
      to: user.email,
      subject: 'Observer.to site alert',
      text: criticalAlertText(rows),
    })
    return 1
  } catch {
    await store.releaseCriticalFindings(user.id, claimed)
    console.error('critical alert failed')
    return 0
  }
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
      await buildDueReviews(this.store)
      await deliverDueAlerts(this.store)
      await deliverCriticalAlerts(this.store)
    } catch {
      console.error('weekly alert pass failed')
    }
  }
}
