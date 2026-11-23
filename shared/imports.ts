export interface SearchItem {
  query: string
  engine: string | null
  queriedAt: string
}

export interface VisitItem {
  url: string
  title: string | null
  visitedAt: string
}

const ENGINES: { name: string; host: RegExp; param: string }[] = [
  { name: 'Google', host: /(^|\.)google\./i, param: 'q' },
  { name: 'Bing', host: /(^|\.)bing\.com$/i, param: 'q' },
  { name: 'DuckDuckGo', host: /(^|\.)duckduckgo\.com$/i, param: 'q' },
  { name: 'Yahoo', host: /(^|\.)yahoo\./i, param: 'p' },
  { name: 'Brave', host: /(^|\.)search\.brave\.com$/i, param: 'q' },
  { name: 'Ecosia', host: /(^|\.)ecosia\.org$/i, param: 'q' },
]

export function normalizeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > 2000) return null
  try {
    const url = new URL(text)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function clipText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.slice(0, max)
}

export function parseWhen(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1e14 ? Math.round(value / 1000) : value > 1e11 ? value : value * 1000
    const date = new Date(millis)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function searchFromUrl(value: string): { query: string; engine: string } | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const engine = ENGINES.find((item) => item.host.test(url.hostname))
  if (!engine) return null
  const query = clipText(url.searchParams.get(engine.param), 500)
  if (!query) return null
  return { query, engine: engine.name }
}

export function parseSearchHistory(text: string): SearchItem[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return searchFromJson(JSON.parse(trimmed) as unknown)
  const items: SearchItem[] = []
  for (const line of trimmed.split(/\r?\n/)) {
    const found = searchFromUrl(line.trim())
    if (found) items.push({ ...found, queriedAt: new Date().toISOString() })
  }
  return dedupeSearch(items)
}

export function parseBrowsingHistory(text: string): VisitItem[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return visitsFromJson(JSON.parse(trimmed) as unknown)
  return visitsFromCsv(trimmed)
}

function searchFromJson(value: unknown): SearchItem[] {
  const rows = rowsOf(value, ['Browser History', 'Searches', 'events', 'items'])
  const items: SearchItem[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const direct = clipText(record.query ?? record.search, 500)
    const fromTitle = typeof record.title === 'string' && record.title.toLowerCase().startsWith('searched for ')
      ? clipText(record.title.slice('searched for '.length), 500)
      : null
    const fromUrl = typeof record.titleUrl === 'string'
      ? searchFromUrl(record.titleUrl)
      : typeof record.url === 'string'
        ? searchFromUrl(record.url)
        : null
    const query = direct ?? fromTitle ?? fromUrl?.query ?? null
    if (!query) continue
    const queriedAt = parseWhen(record.queriedAt ?? record.time ?? record.time_usec ?? record.timestamp) ?? new Date().toISOString()
    items.push({ query, engine: fromUrl?.engine ?? clipText(record.engine, 40), queriedAt })
  }
  return dedupeSearch(items)
}

function visitsFromJson(value: unknown): VisitItem[] {
  const rows = rowsOf(value, ['Browser History', 'history', 'visits', 'items'])
  const items: VisitItem[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const url = normalizeUrl(record.url ?? record.href)
    if (!url) continue
    const visitedAt = parseWhen(record.visitedAt ?? record.time ?? record.time_usec ?? record.timestamp)
    if (!visitedAt) continue
    items.push({ url, title: clipText(record.title ?? record.name, 300), visitedAt })
  }
  return items.slice(0, 2000)
}

function visitsFromCsv(text: string): VisitItem[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  const items: VisitItem[] = []
  for (const line of lines) {
    const cells = splitCsv(line)
    const url = normalizeUrl(cells[0])
    if (!url) continue
    const visitedAt = parseWhen(cells[2] ?? cells[1])
    if (!visitedAt) continue
    const titleCell = cells[2] ? cells[1] : null
    items.push({ url, title: clipText(titleCell, 300), visitedAt })
  }
  return items.slice(0, 2000)
}

function rowsOf(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key]
  }
  return [value]
}

function dedupeSearch(items: SearchItem[]): SearchItem[] {
  const seen = new Set<string>()
  const next: SearchItem[] = []
  for (const item of items) {
    const key = `${item.queriedAt}:${item.query.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
    if (next.length === 2000) break
  }
  return next
}

function splitCsv(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (char === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}
