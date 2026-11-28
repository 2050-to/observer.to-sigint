import { isAllowlisted } from './allowlist.js'
import { compareBySamples, meetsBaselineGate } from './sampleOrder.js'

export const PROCESS_CAP = 5000

export type SignatureStatus =
  | 'apple'
  | 'developer'
  | 'adhoc'
  | 'unsigned'
  | 'invalid'
  | 'unreadable'
  | 'platform'
  | 'pending'

export interface ProcessSignature {
  status: SignatureStatus
  cdhash: string | null
  teamId: string | null
  identifier: string | null
  authority: string | null
  size: number | null
  mtimeMs: number | null
}

export interface ObservedProcess {
  pid: number
  ppid: number
  user: string
  state: string
  cpu: number
  mem: number
  rssKb: number
  time: string
  path: string
}

export interface LiveProcess extends ObservedProcess {
  command: string
}

export interface ProcessEntry {
  path: string
  name: string
  user: string
  signature: ProcessSignature
  firstSeen: string
  lastSeen: string
  samples: number
  pid: number
  alertedFingerprint: string | null
  dismissedFingerprint: string | null
}

export interface ProcessCatalog {
  updatedAt: string | null
  seededAt: string | null
  entries: ProcessEntry[]
}

export interface ProcessAlert {
  path: string
  name: string
  fingerprint: string
  reason: 'new' | 'changed'
}

export interface ProcessSnapshot {
  allowed: boolean
  catalog: ProcessCatalog
  live: LiveProcess[]
  allowlistText: string
  error: string | null
}

export interface CodesignRead {
  text: string
  verifyOk: boolean
  size: number | null
  mtimeMs: number | null
  readable: boolean
}

const STATUSES = new Set<SignatureStatus>([
  'apple',
  'developer',
  'adhoc',
  'unsigned',
  'invalid',
  'unreadable',
  'platform',
  'pending',
])

const CHECKABLE = new Set<SignatureStatus>(['apple', 'developer', 'adhoc', 'unsigned', 'platform'])

const PS_ROW = /^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(.+)$/
const PS_ARGS = /^(\d+)\s+(.+)$/

export function emptyProcessCatalog(): ProcessCatalog {
  return { updatedAt: null, seededAt: null, entries: [] }
}

export function emptySignature(status: SignatureStatus): ProcessSignature {
  return {
    status,
    cdhash: null,
    teamId: null,
    identifier: null,
    authority: null,
    size: null,
    mtimeMs: null,
  }
}

export function platformSignature(): ProcessSignature {
  return { ...emptySignature('platform'), identifier: 'kernel_task', authority: 'platform' }
}

export function processName(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  const name = slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  return name || trimmed
}

export function fingerprintOf(signature: ProcessSignature): string {
  return [
    signature.status,
    signature.cdhash ?? '',
    signature.size ?? '',
    signature.mtimeMs ?? '',
  ].join('|')
}

export function qualifiesProcess(entry: ProcessEntry): boolean {
  if (!CHECKABLE.has(entry.signature.status)) return false
  if (entry.signature.status !== 'platform' && entry.signature.size == null) return false
  return meetsBaselineGate(entry.samples, entry.firstSeen, entry.lastSeen)
}

export function processStanding(entry: ProcessEntry, allowNames: readonly string[]): 'checking' | 'allowed' | 'baseline' | 'outlier' {
  if (entry.signature.status === 'pending') return 'checking'
  if (isAllowlisted(allowNames, entry.name)) return 'allowed'
  if (qualifiesProcess(entry)) return 'baseline'
  return 'outlier'
}

export function isOutlier(entry: ProcessEntry, allowNames: readonly string[]): boolean {
  return processStanding(entry, allowNames) === 'outlier'
}

export function parsePsTable(text: string): ObservedProcess[] {
  const rows: ObservedProcess[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = PS_ROW.exec(line.trim())
    if (!match) continue
    const path = match[9].trim()
    if (!path) continue
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      user: match[3],
      state: match[4],
      cpu: numberOrZero(match[5]),
      mem: numberOrZero(match[6]),
      rssKb: Number(match[7]),
      time: match[8],
      path,
    })
  }
  return rows
}

export function parsePsArgs(text: string): Map<number, string> {
  const commands = new Map<number, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = PS_ARGS.exec(line.trim())
    if (!match) continue
    commands.set(Number(match[1]), match[2].trim())
  }
  return commands
}

export function signatureFromCodesign(read: CodesignRead): ProcessSignature {
  if (!read.readable) return emptySignature('unreadable')
  const text = read.text
  if (isAdhoc(text)) return signedFields('adhoc', text, read)
  if (isUnsigned(text) || !hasIdentity(text)) return signedFields('unsigned', text, read)
  if (read.verifyOk && isAppleSigned(text)) return signedFields('apple', text, read)
  if (read.verifyOk) return signedFields('developer', text, read)
  return signedFields('invalid', text, read)
}

export function foldProcesses(
  catalog: ProcessCatalog,
  observed: readonly ObservedProcess[],
  observedAt: string,
  signatures: ReadonlyMap<string, ProcessSignature>,
): ProcessCatalog {
  const iso = normalizeTime(observedAt)
  const entries = catalog.entries.map(cloneEntry)
  const byPath = new Map(entries.map((entry) => [entry.path, entry]))
  for (const [path, group] of groupByPath(observed)) {
    const current = representative(group)
    const existing = byPath.get(path)
    const signature = signatureFor(current, signatures.get(path), existing?.signature)
    if (!existing) {
      const created: ProcessEntry = {
        path,
        name: processName(path),
        user: current.user,
        signature,
        firstSeen: iso,
        lastSeen: iso,
        samples: 1,
        pid: current.pid,
        alertedFingerprint: null,
        dismissedFingerprint: null,
      }
      entries.push(created)
      byPath.set(path, created)
      continue
    }
    existing.name = processName(path)
    existing.user = current.user
    existing.signature = signature
    existing.pid = current.pid
    existing.samples += 1
    if (iso >= existing.lastSeen) existing.lastSeen = iso
  }
  return {
    updatedAt: observed.length > 0 ? iso : catalog.updatedAt,
    seededAt: catalog.seededAt ?? (observed.length > 0 ? iso : null),
    entries: capEntries(entries),
  }
}

export function applyAlerts(
  before: ProcessCatalog,
  after: ProcessCatalog,
  livePaths: readonly string[],
  allowNames: readonly string[],
): { catalog: ProcessCatalog; alerts: ProcessAlert[] } {
  if (!before.seededAt) return { catalog: after, alerts: [] }
  const previousByPath = new Map(before.entries.map((entry) => [entry.path, entry]))
  const live = new Set(livePaths)
  const alerts: ProcessAlert[] = []
  for (const entry of after.entries) {
    if (!live.has(entry.path)) continue
    if (entry.signature.status === 'pending') continue
    if (isAllowlisted(allowNames, entry.name)) continue
    const fingerprint = fingerprintOf(entry.signature)
    if (entry.alertedFingerprint === fingerprint || entry.dismissedFingerprint === fingerprint) continue
    const previous = previousByPath.get(entry.path)
    const fingerprintChanged = previous != null
      && previous.signature.status !== 'pending'
      && fingerprintOf(previous.signature) !== fingerprint
    const changedBaseline = previous != null && fingerprintChanged && qualifiesProcess(previous)
    const dismissedStale = previous != null
      && fingerprintChanged
      && previous.dismissedFingerprint != null
      && previous.dismissedFingerprint !== fingerprint
    const isNew = entry.firstSeen > before.seededAt
    const quietApple = changedBaseline && (entry.signature.status === 'apple' || entry.signature.status === 'platform')
    if (quietApple && !dismissedStale) continue
    let reason: ProcessAlert['reason'] | null = null
    if (changedBaseline || dismissedStale) reason = 'changed'
    else if (isNew && !qualifiesProcess(entry)) reason = 'new'
    if (!reason) continue
    alerts.push({ path: entry.path, name: entry.name, fingerprint, reason })
  }
  alerts.sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path))
  if (alerts.length === 0) return { catalog: after, alerts }
  const marked = new Map(alerts.map((alert) => [alert.path, alert.fingerprint]))
  return {
    alerts,
    catalog: {
      ...after,
      entries: after.entries.map((entry) => {
        const fingerprint = marked.get(entry.path)
        if (!fingerprint) return entry
        return { ...entry, alertedFingerprint: fingerprint }
      }),
    },
  }
}

export function dismissProcess(catalog: ProcessCatalog, path: string, fingerprint: string): ProcessCatalog {
  return {
    ...catalog,
    entries: catalog.entries.map((entry) => {
      if (entry.path !== path) return entry
      if (entry.signature.status !== 'invalid' && entry.signature.status !== 'unreadable') return entry
      if (fingerprintOf(entry.signature) !== fingerprint) return entry
      return { ...entry, dismissedFingerprint: fingerprint }
    }),
  }
}

export function sortProcessEntries(entries: readonly ProcessEntry[]): ProcessEntry[] {
  return [...entries].sort((left, right) => compareBySamples(
    { samples: left.samples, name: left.name, key: left.path },
    { samples: right.samples, name: right.name, key: right.path },
  ))
}

export function parseProcessCatalog(text: string): ProcessCatalog {
  if (!text.trim()) return emptyProcessCatalog()
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyProcessCatalog()
    const record = value as Record<string, unknown>
    const entries: ProcessEntry[] = []
    const seen = new Set<string>()
    if (Array.isArray(record.entries)) {
      for (const item of record.entries) {
        const entry = entryFrom(item)
        if (!entry || seen.has(entry.path)) continue
        seen.add(entry.path)
        entries.push(entry)
      }
    }
    return {
      updatedAt: timeOf(record.updatedAt),
      seededAt: timeOf(record.seededAt),
      entries: capEntries(entries),
    }
  } catch {
    return emptyProcessCatalog()
  }
}

function signatureFor(
  current: ObservedProcess,
  provided: ProcessSignature | undefined,
  previous: ProcessSignature | undefined,
): ProcessSignature {
  if (current.pid === 0) return platformSignature()
  if (provided) return cloneSignature(provided)
  if (previous) return cloneSignature(previous)
  return emptySignature('pending')
}

function groupByPath(observed: readonly ObservedProcess[]): Map<string, ObservedProcess[]> {
  const groups = new Map<string, ObservedProcess[]>()
  for (const row of observed) {
    const group = groups.get(row.path)
    if (group) group.push(row)
    else groups.set(row.path, [row])
  }
  return groups
}

function representative(group: readonly ObservedProcess[]): ObservedProcess {
  return group.reduce((best, item) => (
    item.cpu > best.cpu || (item.cpu === best.cpu && item.pid > best.pid) ? item : best
  ))
}

function capEntries(entries: ProcessEntry[]): ProcessEntry[] {
  if (entries.length <= PROCESS_CAP) return entries
  const ranked = entries
    .filter((entry) => !qualifiesProcess(entry))
    .sort((left, right) => left.lastSeen.localeCompare(right.lastSeen) || left.path.localeCompare(right.path))
  const drop = new Set(ranked.slice(0, entries.length - PROCESS_CAP))
  return entries.filter((entry) => !drop.has(entry))
}

function signedFields(status: SignatureStatus, text: string, read: CodesignRead): ProcessSignature {
  return {
    status,
    cdhash: lineValue(text, 'CDHash'),
    teamId: teamIdOf(text),
    identifier: lineValue(text, 'Identifier'),
    authority: authorityOf(text),
    size: read.size,
    mtimeMs: read.mtimeMs,
  }
}

function isAdhoc(text: string): boolean {
  return /^Signature=adhoc$/m.test(text) || /flags=[^\n]*\badhoc\b/.test(text)
}

function isUnsigned(text: string): boolean {
  return /not signed/i.test(text)
}

function hasIdentity(text: string): boolean {
  return lineValue(text, 'Identifier') != null || lineValue(text, 'CDHash') != null || authorityOf(text) != null
}

function isAppleSigned(text: string): boolean {
  if (/Developer ID/i.test(text)) return false
  if (teamIdOf(text)) return false
  return /^Authority=(?:macOS )?Software Signing$/m.test(text)
}

function teamIdOf(text: string): string | null {
  const value = lineValue(text, 'TeamIdentifier')
  if (!value || value.toLowerCase() === 'not set') return null
  return value
}

function authorityOf(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('Authority=')) continue
    const value = line.slice('Authority='.length).trim()
    if (value) return value
  }
  return null
}

function lineValue(text: string, key: string): string | null {
  const prefix = `${key}=`
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(prefix)) continue
    const value = line.slice(prefix.length).trim()
    return value || null
  }
  return null
}

function numberOrZero(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return new Date().toISOString()
  return date.toISOString()
}

function cloneEntry(entry: ProcessEntry): ProcessEntry {
  return { ...entry, signature: cloneSignature(entry.signature) }
}

function cloneSignature(signature: ProcessSignature): ProcessSignature {
  return { ...signature }
}

function entryFrom(value: unknown): ProcessEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const path = textOf(record.path)
  const user = textOf(record.user)
  const firstSeen = timeOf(record.firstSeen)
  const lastSeen = timeOf(record.lastSeen)
  const samples = countOf(record.samples)
  const pid = countOf(record.pid)
  const signature = signatureFrom(record.signature)
  if (!path || !user || !firstSeen || !lastSeen || samples == null || samples < 1 || pid == null || !signature) return null
  const name = textOf(record.name) ?? processName(path)
  return {
    path,
    name,
    user,
    signature,
    firstSeen,
    lastSeen,
    samples,
    pid,
    alertedFingerprint: optionalText(record.alertedFingerprint),
    dismissedFingerprint: optionalText(record.dismissedFingerprint),
  }
}

function signatureFrom(value: unknown): ProcessSignature | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.status !== 'string' || !STATUSES.has(record.status as SignatureStatus)) return null
  return {
    status: record.status as SignatureStatus,
    cdhash: optionalText(record.cdhash),
    teamId: optionalText(record.teamId),
    identifier: optionalText(record.identifier),
    authority: optionalText(record.authority),
    size: optionalCount(record.size),
    mtimeMs: optionalCount(record.mtimeMs),
  }
}

function optionalText(value: unknown): string | null {
  if (value == null) return null
  return textOf(value)
}

function optionalCount(value: unknown): number | null {
  if (value == null) return null
  return countOf(value)
}

function countOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
  return value
}

function timeOf(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function textOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text || null
}
