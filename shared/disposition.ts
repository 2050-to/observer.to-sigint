export const DISPOSITION_STATUSES = ['verified', 'false_match', 'patched', 'accepted'] as const

export type DispositionStatus = (typeof DISPOSITION_STATUSES)[number]
export type DispositionKind = 'ap' | 'adv'

export interface Disposition {
  kind: DispositionKind
  id: string
  status: DispositionStatus
  note: string
  updatedAt?: string
}

const STATUSES = new Set<string>(DISPOSITION_STATUSES)

export function dispositionOpen(status: DispositionStatus | null | undefined): boolean {
  return status == null || status === 'verified'
}

export function asDispositionDraft(value: unknown): { kind: DispositionKind; id: string; status: DispositionStatus; note: string } | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { kind?: unknown; id?: unknown; status?: unknown; note?: unknown }
  if (record.kind !== 'ap' && record.kind !== 'adv') return null
  if (typeof record.id !== 'string' || !record.id.trim() || record.id.length > 80) return null
  if (typeof record.status !== 'string' || !STATUSES.has(record.status)) return null
  const note = typeof record.note === 'string' ? record.note.trim() : ''
  if (note.length > 2000) return null
  return { kind: record.kind, id: record.id.trim().toLowerCase(), status: record.status as DispositionStatus, note }
}

export function dispositionLabel(status: DispositionStatus): string {
  if (status === 'false_match') return 'False match'
  if (status === 'patched') return 'Patched'
  if (status === 'accepted') return 'Accepted'
  return 'Verified'
}
