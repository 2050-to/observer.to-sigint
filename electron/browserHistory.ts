import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { SearchItem, VisitItem } from '../shared/imports.js'
import {
  searchesFromBrowserRows,
  visitsFromBrowserRows,
  type BrowserEpoch,
  type RawSearch,
  type RawVisit,
} from '../shared/browserHistory.js'

const execFileAsync = promisify(execFile)
const SQLITE = '/usr/bin/sqlite3'

const CHROMIUM: { name: string; root: string }[] = [
  { name: 'Chrome', root: 'Library/Application Support/Google/Chrome' },
  { name: 'Edge', root: 'Library/Application Support/Microsoft Edge' },
  { name: 'Brave', root: 'Library/Application Support/BraveSoftware/Brave-Browser' },
  { name: 'Arc', root: 'Library/Application Support/Arc/User Data' },
  { name: 'Vivaldi', root: 'Library/Application Support/Vivaldi' },
  { name: 'Chromium', root: 'Library/Application Support/Chromium' },
]

const SKIP_PROFILES = new Set(['Guest Profile', 'System Profile'])

const CHROME_VISITS = `SELECT urls.url AS url, urls.title AS title, CAST(visits.visit_time AS TEXT) AS visited_at
FROM visits JOIN urls ON urls.id = visits.url
WHERE urls.url LIKE 'http%'
ORDER BY visits.visit_time DESC LIMIT 2000`

const CHROME_TERMS = `SELECT keyword_search_terms.term AS query, urls.url AS url, CAST(urls.last_visit_time AS TEXT) AS queried_at
FROM keyword_search_terms JOIN urls ON urls.id = keyword_search_terms.url_id
ORDER BY urls.last_visit_time DESC LIMIT 2000`

const FIREFOX_VISITS = `SELECT p.url AS url, p.title AS title, CAST(v.visit_date AS TEXT) AS visited_at
FROM moz_historyvisits v JOIN moz_places p ON p.id = v.place_id
WHERE v.visit_date IS NOT NULL AND p.url LIKE 'http%'
ORDER BY v.visit_date DESC LIMIT 2000`

const SAFARI_VISITS = `SELECT history_items.url AS url, history_visits.title AS title, CAST(history_visits.visit_time AS TEXT) AS visited_at
FROM history_visits JOIN history_items ON history_items.id = history_visits.history_item
WHERE history_items.url LIKE 'http%'
ORDER BY history_visits.visit_time DESC LIMIT 2000`

const SAFARI_VISITS_NO_TITLE = `SELECT history_items.url AS url, NULL AS title, CAST(history_visits.visit_time AS TEXT) AS visited_at
FROM history_visits JOIN history_items ON history_items.id = history_visits.history_item
WHERE history_items.url LIKE 'http%'
ORDER BY history_visits.visit_time DESC LIMIT 2000`

export interface LocalBrowserHistory {
  visits: VisitItem[]
  searches: SearchItem[]
  sources: string[]
  skipped: string[]
}

class SqliteMissing extends Error {
  constructor() {
    super('The sqlite3 tool is not available on this Mac.')
    this.name = 'SqliteMissing'
  }
}

export async function readLocalBrowserHistory(): Promise<LocalBrowserHistory> {
  return readBrowserHistoryFrom(homedir())
}

export async function readBrowserHistoryFrom(home: string): Promise<LocalBrowserHistory> {
  try {
    await execFileAsync(SQLITE, ['-version'], { timeout: 3000 })
  } catch {
    throw new SqliteMissing()
  }
  const visits: RawVisit[] = []
  const searches: RawSearch[] = []
  const sources: string[] = []
  const skipped: string[] = []
  for (const browser of CHROMIUM) {
    const files = historyFiles(join(home, browser.root), 'History')
    if (files == null) {
      skipped.push(browser.name)
      continue
    }
    await readFiles(browser.name, files, (file) => readChromium(file), visits, searches, sources, skipped)
  }
  const firefoxRoot = join(home, 'Library/Application Support/Firefox/Profiles')
  const firefox = historyFiles(firefoxRoot, 'places.sqlite')
  if (firefox == null) skipped.push('Firefox')
  else await readFiles('Firefox', firefox, (file) => readFirefox(file), visits, searches, sources, skipped)
  const safari = join(home, 'Library/Safari/History.db')
  const safariState = fileAccess(safari)
  if (safariState === 'file') {
    await readFiles('Safari', [safari], (file) => readSafari(file), visits, searches, sources, skipped)
  } else if (safariState === 'blocked') {
    skipped.push('Safari')
  }
  return {
    visits: visitsFromBrowserRows(visits),
    searches: searchesFromBrowserRows(searches),
    sources,
    skipped,
  }
}

async function readFiles(
  name: string,
  files: string[],
  read: (file: string) => Promise<{ visits: RawVisit[]; searches: RawSearch[] }>,
  visits: RawVisit[],
  searches: RawSearch[],
  sources: string[],
  skipped: string[],
): Promise<void> {
  if (files.length === 0) return
  let ok = false
  for (const file of files) {
    try {
      const found = await read(file)
      visits.push(...found.visits)
      searches.push(...found.searches)
      ok = true
    } catch (error) {
      if (error instanceof SqliteMissing) throw error
    }
  }
  if (ok) sources.push(name)
  else skipped.push(name)
}

function historyFiles(root: string, fileName: string): string[] | null {
  if (!existsSync(root)) return []
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !SKIP_PROFILES.has(entry.name))
      .map((entry) => join(root, entry.name, fileName))
      .filter((file) => isFile(file))
  } catch {
    return null
  }
}

async function readChromium(source: string): Promise<{ visits: RawVisit[]; searches: RawSearch[] }> {
  return withCopy(source, 'History', async (copy) => {
    const visitRows = await sqliteJson(copy, CHROME_VISITS)
    const visits = visitRows.map((row) => rawVisit(row, 'chrome'))
    const searches = visits.map((visit) => rawSearchFromVisit(visit))
    try {
      const terms = await sqliteJson(copy, CHROME_TERMS)
      for (const row of terms) {
        searches.push({
          query: row.query,
          url: row.url,
          queriedAt: row.queried_at,
          epoch: 'chrome',
        })
      }
    } catch (error) {
      if (error instanceof SqliteMissing) throw error
    }
    return { visits, searches }
  })
}

async function readFirefox(source: string): Promise<{ visits: RawVisit[]; searches: RawSearch[] }> {
  return withCopy(source, 'places.sqlite', async (copy) => {
    const visits = (await sqliteJson(copy, FIREFOX_VISITS)).map((row) => rawVisit(row, 'firefox'))
    return { visits, searches: visits.map((visit) => rawSearchFromVisit(visit)) }
  })
}

async function readSafari(source: string): Promise<{ visits: RawVisit[]; searches: RawSearch[] }> {
  return withCopy(source, 'History.db', async (copy) => {
    let rows: Record<string, unknown>[]
    try {
      rows = await sqliteJson(copy, SAFARI_VISITS)
    } catch (error) {
      if (error instanceof SqliteMissing) throw error
      rows = await sqliteJson(copy, SAFARI_VISITS_NO_TITLE)
    }
    const visits = rows.map((row) => rawVisit(row, 'safari'))
    return { visits, searches: visits.map((visit) => rawSearchFromVisit(visit)) }
  })
}

function rawVisit(row: Record<string, unknown>, epoch: BrowserEpoch): RawVisit {
  return { url: row.url, title: row.title, visitedAt: row.visited_at, epoch }
}

function rawSearchFromVisit(visit: RawVisit): RawSearch {
  return { url: visit.url, title: visit.title, queriedAt: visit.visitedAt, epoch: visit.epoch }
}

async function withCopy<T>(source: string, fileName: string, read: (copy: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'observer-history-'))
  try {
    const dest = join(dir, fileName)
    await copyFile(source, dest)
    for (const suffix of ['-wal', '-shm']) {
      const side = `${source}${suffix}`
      if (isFile(side)) await copyFile(side, `${dest}${suffix}`)
    }
    return await read(dest)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function sqliteJson(dbPath: string, sql: string): Promise<Record<string, unknown>[]> {
  let stdout = ''
  try {
    const result = await execFileAsync(SQLITE, ['-json', dbPath, sql], {
      timeout: 20_000,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8',
    })
    stdout = typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? '')
  } catch (error) {
    if (isMissingSqlite(error)) throw new SqliteMissing()
    throw error
  }
  const text = stdout.trim()
  if (!text) return []
  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed)) return []
  return parsed.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
}

function isFile(path: string): boolean {
  return fileAccess(path) === 'file'
}

function fileAccess(path: string): 'file' | 'missing' | 'blocked' {
  try {
    return statSync(path).isFile() ? 'file' : 'missing'
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing'
    return 'blocked'
  }
}

function isMissingSqlite(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
