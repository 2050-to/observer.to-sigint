import { groupAccessPoints, groupAdvertisers } from '../../shared/accessPoints.js'
import { dispositionOpen } from '../../shared/disposition.js'
import type { Disposition } from '../../shared/disposition.js'
import { openBeacons, siteReportMarkdown, type SiteReport } from '../../shared/siteReport.js'
import type { SiteRecord } from '../../shared/sites.js'
import type { DeviceRecord, NetworkRecord } from './types.js'
import type { Store } from './store.js'

export async function siteReportFor(store: Store, userId: string, siteId: string): Promise<string | null> {
  const site = (await store.sites(userId)).find((item) => item.id === siteId)
  if (!site) return null
  const [networks, devices, dispositions, ownedChanges] = await Promise.all([
    store.catalog(userId),
    store.devices(userId),
    store.dispositions(userId),
    store.lanChanges(userId),
  ])
  const report = assembleReport(site, networks, devices, dispositions, ownedChanges)
  return siteReportMarkdown(report)
}

function assembleReport(
  site: SiteRecord,
  networks: NetworkRecord[],
  devices: DeviceRecord[],
  dispositions: Disposition[],
  ownedChanges: SiteReport['ownedChanges'],
): SiteReport {
  const heard = new Set(site.lastWalk?.heard.map((beacon) => beacon.bssid) ?? [])
  const heardDevices = new Set(site.lastWalk?.heardDevices.map((device) => device.address) ?? [])
  const accessPoints = groupAccessPoints(networks.filter((network) => heard.has(network.bssid)))
  const advertisers = groupAdvertisers(devices.filter((device) => heardDevices.has(device.address)))
  const saved = new Map(dispositions.map((item) => [`${item.kind}:${item.id}`, item]))
  const names = new Map<string, string>()
  const highRisk: SiteReport['highRisk'] = []
  for (const ap of accessPoints) {
    names.set(`ap:${ap.id}`, ap.label)
    const enrichment = ap.networks.find((network) => network.enrichment?.risk.level === 'high')?.enrichment
    const record = saved.get(`ap:${ap.id}`)
    if (!enrichment || (record && !dispositionOpen(record.status))) continue
    highRisk.push({
      name: ap.label,
      reason: enrichment.risk.reasons.find((item) => item.trim()) ?? 'Flagged from public support and vulnerability records',
      status: record?.status ?? null,
      note: record?.note ?? '',
    })
  }
  for (const group of advertisers) {
    names.set(`adv:${group.id}`, group.label)
    const enrichment = group.devices.find((device) => device.enrichment?.risk.level === 'high')?.enrichment
    const record = saved.get(`adv:${group.id}`)
    if (!enrichment || (record && !dispositionOpen(record.status))) continue
    highRisk.push({
      name: group.label,
      reason: enrichment.risk.reasons.find((item) => item.trim()) ?? 'Flagged from public support and vulnerability records',
      status: record?.status ?? null,
      note: record?.note ?? '',
    })
  }
  return {
    generatedAt: new Date().toISOString(),
    site,
    openNetworks: openBeacons(site.lastWalk?.heard ?? []),
    highRisk,
    dispositions: dispositions.flatMap((item) => {
      const name = names.get(`${item.kind}:${item.id}`)
      if (!name) return []
      return [{ name, status: item.status, note: item.note }]
    }),
    ownedChanges,
  }
}
