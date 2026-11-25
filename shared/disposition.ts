export const DISPOSITION_STATUSES = ['verified', 'false_match', 'patched', 'accepted'] as const
export const DISPOSITION_KINDS = ['ap', 'adv', 'cell', 'site_event', 'lan_host'] as const

export type DispositionStatus = (typeof DISPOSITION_STATUSES)[number]
export type DispositionKind = (typeof DISPOSITION_KINDS)[number]

export interface Disposition {
  kind: DispositionKind
  id: string
  status: DispositionStatus
  note: string
  model?: string
  firmware?: string
  assignee?: string
  dueAt?: string | null
  updatedAt?: string
}

const STATUSES = new Set<string>(DISPOSITION_STATUSES)
const KINDS = new Set<string>(DISPOSITION_KINDS)
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

export function dispositionOpen(status: DispositionStatus | null | undefined): boolean {
  return status == null || status === 'verified'
}

export function isDispositionKind(value: unknown): value is DispositionKind {
  return typeof value === 'string' && KINDS.has(value)
}

function shortText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function dueDay(value: unknown): string | null | undefined {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || !DAY.test(value.trim())) return undefined
  return value.trim()
}

export function asDispositionDraft(value: unknown): Omit<Disposition, 'updatedAt'> | null {
  if (!value || typeof value !== 'object') return null
  const record = value as {
    kind?: unknown
    id?: unknown
    status?: unknown
    note?: unknown
    model?: unknown
    firmware?: unknown
    assignee?: unknown
    dueAt?: unknown
  }
  if (!isDispositionKind(record.kind)) return null
  if (typeof record.id !== 'string' || !record.id.trim() || record.id.length > 200) return null
  if (typeof record.status !== 'string' || !STATUSES.has(record.status)) return null
  const note = typeof record.note === 'string' ? record.note.trim() : ''
  if (note.length > 2000) return null
  const dueAt = dueDay(record.dueAt)
  if (dueAt === undefined) return null
  return {
    kind: record.kind,
    id: record.id.trim().toLowerCase(),
    status: record.status as DispositionStatus,
    note,
    model: shortText(record.model, 80),
    firmware: shortText(record.firmware, 80),
    assignee: shortText(record.assignee, 80),
    dueAt,
  }
}

export function recordedLine(disposition: Pick<Disposition, 'model' | 'firmware' | 'updatedAt'> | null | undefined): string | null {
  const model = disposition?.model?.trim()
  const firmware = disposition?.firmware?.trim()
  if (!model || !firmware) return null
  const when = disposition?.updatedAt ? ` on ${disposition.updatedAt}` : ''
  return `Recorded model ${model}, firmware ${firmware}${when}.`
}

export function shownReasons(reasons: string[], disposition: Disposition | null | undefined): string[] {
  const recorded = recordedLine(disposition)
  if (!recorded) return reasons
  let replaced = false
  const next = reasons.map((reason) => {
    if (!/potentially applicable/i.test(reason)) return reason
    replaced = true
    return recorded
  })
  return replaced ? next : [...next, recorded]
}

const MAC = /[0-9a-f]{2}(?::[0-9a-f]{2}){5}/g

export function closedRadioIds(dispositions: Disposition[]): Set<string> {
  const ids = new Set<string>()
  for (const item of dispositions) {
    if (item.kind !== 'ap' || dispositionOpen(item.status)) continue
    for (const mac of item.id.toLowerCase().match(MAC) ?? []) ids.add(mac)
  }
  return ids
}

export function siteEventId(siteId: string, event: { kind: string; bssid: string; episode: string }): string {
  return `${siteId}:${event.kind}:${event.bssid}:${event.episode}`.toLowerCase()
}

export function dispositionLabel(status: DispositionStatus): string {
  if (status === 'false_match') return 'False match'
  if (status === 'patched') return 'Patched'
  if (status === 'accepted') return 'Accepted'
  return 'Verified'
}
