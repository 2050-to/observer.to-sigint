import type { Disposition, DispositionStatus } from './disposition.js'
import { dispositionLabel } from './disposition.js'
import { boundaryLabel, siteDiff, type HeardBeacon, type SiteEvent, type SiteRecord } from './sites.js'
import { ownedChangeText, type OwnedChange } from './ownedDiff.js'

export interface ReportRisk {
  name: string
  reason: string
  status: DispositionStatus | null
  note: string
}

export interface SiteReport {
  generatedAt: string
  site: SiteRecord
  openNetworks: { label: string; security: string }[]
  highRisk: ReportRisk[]
  dispositions: { name: string; status: DispositionStatus; note: string }[]
  ownedChanges: OwnedChange[]
}

export function openBeacons(heard: HeardBeacon[]): { label: string; security: string }[] {
  const rows = new Map<string, { label: string; security: string }>()
  for (const beacon of heard) {
    if (beacon.security !== 'open' && beacon.security !== 'owe') continue
    const label = beacon.ssid.trim() || 'Hidden network'
    const key = label.toLowerCase()
    if (!rows.has(key)) rows.set(key, { label, security: beacon.security })
  }
  return [...rows.values()]
}

function eventLine(site: SiteRecord, event: SiteEvent): string {
  const radio = (site.radios ?? []).find((item) => item.bssid === event.bssid)
  const first = radio?.firstSeen ?? event.at
  const last = radio?.lastSeen ?? event.at
  return `${event.detail} (${event.bssid}), first seen ${first}, last seen ${last}`
}

function line(text: string): string {
  return `- ${text}`
}

function block(title: string, rows: string[]): string[] {
  return [title, '', ...(rows.length ? rows.map(line) : [line('None')]), '']
}

export function siteReportMarkdown(report: SiteReport): string {
  const diff = siteDiff(report.site)
  const walked = report.site.lastWalk?.walkedAt ?? 'not walked yet'
  const claimed = report.site.claims.filter((claim) => claim.bssid).length
  return [
    `# ${report.site.name}`,
    '',
    'Observer.to site report. This pack is an export of one site on the signed-in account. It does not grant access to another account.',
    '',
    '## Walk coverage',
    '',
    `- Boundary: ${boundaryLabel(report.site.boundary)}`,
    `- Last walked: ${walked}`,
    `- Claimed radios: ${claimed}`,
    `- Heard and expected: ${diff.heardAndExpected.length}`,
    '',
    ...block('## Events', (report.site.events ?? []).map((event) => eventLine(report.site, event))),
    ...block('## Heard and expected', diff.heardAndExpected.map((beacon) => {
      const name = beacon.ssid.trim() || beacon.bssid
      return `${name} (${beacon.security}) ${beacon.bssid}`
    })),
    ...block('## Heard and not on the list', diff.heardNotListed.map((beacon) => {
      const name = beacon.ssid.trim() || 'Hidden network'
      return `${name} (${beacon.security}) ${beacon.bssid}`
    })),
    ...block('## Expected and missing', diff.expectedMissing.map((claim) => {
      const name = claim.ssid.trim() || 'Hidden network'
      return claim.bssid ? `${name} ${claim.bssid}` : name
    })),
    ...block('## Security changes', diff.securityChanges.map((change) => {
      const name = change.beacon.ssid.trim() || 'Hidden network'
      return `${name} heard as ${change.beacon.security}, baseline ${change.baseline} (${change.beacon.bssid})`
    })),
    ...block('## Open networks on this walk', report.openNetworks.map((row) => `${row.label} (${row.security})`)),
    ...block('## High-risk research', report.highRisk.map((row) => {
      const status = row.status ? `, ${dispositionLabel(row.status)}` : ''
      const note = row.note ? `. ${row.note}` : ''
      return `${row.name}: ${row.reason}${status}${note}`
    })),
    ...block('## Dispositions', report.dispositions.map((row) => {
      const note = row.note ? `. ${row.note}` : ''
      return `${row.name}: ${dispositionLabel(row.status)}${note}`
    })),
    ...block('## Owned-network changes', report.ownedChanges.map(ownedChangeText)),
    'This report uses public beacons and the owned-network inventory already saved on this account. It does not open video, try passwords, or record traffic.',
    '',
    `Generated ${report.generatedAt}`,
    '',
  ].join('\n')
}

export function dispositionsFor(reportDispositions: Disposition[], names: Map<string, string>): SiteReport['dispositions'] {
  return reportDispositions.map((item) => ({
    name: names.get(`${item.kind}:${item.id}`) ?? item.id,
    status: item.status,
    note: item.note,
  }))
}
