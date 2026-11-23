import { clipText, normalizeUrl, searchFromUrl, type SearchItem, type VisitItem } from './imports.js'

export type BrowserEpoch = 'chrome' | 'firefox' | 'safari'

export interface RawVisit {
  url: unknown
  title: unknown
  visitedAt: unknown
  epoch: BrowserEpoch
}

export interface RawSearch {
  query?: unknown
  url?: unknown
  title?: unknown
  engine?: unknown
  queriedAt: unknown
  epoch: BrowserEpoch
}

const LIMIT = 2000
const CHROME_UNIX_OFFSET_MS = 11_644_473_600_000
const SAFARI_UNIX_OFFSET_MS = 978_307_200_000

export function browserTime(value: unknown, epoch: BrowserEpoch): string | null {
  const raw = readCount(value)
  if (raw == null || raw <= 0) return null
  const ms = epoch === 'chrome'
    ? raw / 1000 - CHROME_UNIX_OFFSET_MS
    : epoch === 'firefox'
      ? raw / 1000
      : raw * 1000 + SAFARI_UNIX_OFFSET_MS
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  const year = date.getUTCFullYear()
  if (year < 1991 || year > 2100) return null
  return date.toISOString()
}

export function visitsFromBrowserRows(rows: RawVisit[]): VisitItem[] {
  const items: VisitItem[] = []
  for (const row of rows) {
    const url = normalizeUrl(row.url)
    const visitedAt = browserTime(row.visitedAt, row.epoch)
    if (!url || !visitedAt) continue
    items.push({ url, title: clipText(row.title, 300), visitedAt })
  }
  items.sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))
  return items.slice(0, LIMIT)
}

export function searchesFromBrowserRows(rows: RawSearch[]): SearchItem[] {
  const items: SearchItem[] = []
  for (const row of rows) {
    const queriedAt = browserTime(row.queriedAt, row.epoch)
    if (!queriedAt) continue
    const direct = clipText(row.query, 500)
    const fromTitle = typeof row.title === 'string' && row.title.toLowerCase().startsWith('searched for ')
      ? clipText(row.title.slice('searched for '.length), 500)
      : null
    const fromUrl = typeof row.url === 'string' ? searchFromUrl(row.url) : null
    const query = direct ?? fromTitle ?? fromUrl?.query ?? null
    if (!query) continue
    items.push({
      query,
      engine: fromUrl?.engine ?? clipText(row.engine, 40),
      queriedAt,
    })
  }
  items.sort((a, b) => b.queriedAt.localeCompare(a.queriedAt))
  const seen = new Set<string>()
  const next: SearchItem[] = []
  for (const item of items) {
    const key = `${item.queriedAt}:${item.query.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
    if (next.length === LIMIT) break
  }
  return next
}

function readCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value.trim())) return null
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}
