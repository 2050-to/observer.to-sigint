import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { browserTime, searchesFromBrowserRows, visitsFromBrowserRows } from '../../shared/browserHistory.js'
import { readBrowserHistoryFrom } from '../../electron/browserHistory.js'

const instant = Date.parse('2026-11-01T00:00:00.000Z')
const firefox = String(instant * 1000)
const safari = String(instant / 1000 - 978_307_200)
const chrome = String((instant + 11_644_473_600_000) * 1000)

assert.equal(browserTime(firefox, 'firefox'), '2026-11-01T00:00:00.000Z')
assert.equal(browserTime(safari, 'safari'), '2026-11-01T00:00:00.000Z')
assert.equal(browserTime(chrome, 'chrome'), '2026-11-01T00:00:00.000Z')
assert.equal(browserTime('0', 'chrome'), null)
assert.equal(browserTime('nope', 'firefox'), null)

const visits = visitsFromBrowserRows([
  { url: 'chrome://settings', title: 'Settings', visitedAt: firefox, epoch: 'firefox' },
  { url: 'file:///tmp/note.txt', title: 'Note', visitedAt: firefox, epoch: 'firefox' },
  { url: 'https://example.com/a', title: 'Example', visitedAt: firefox, epoch: 'firefox' },
  { url: 'https://example.com/safari', title: 'Safari page', visitedAt: safari, epoch: 'safari' },
  { url: 'https://example.com/chrome', title: 'Chrome page', visitedAt: chrome, epoch: 'chrome' },
])
assert.deepEqual(visits.map((item) => item.url), [
  'https://example.com/a',
  'https://example.com/safari',
  'https://example.com/chrome',
])
assert.equal(visits[0]?.title, 'Example')
assert.equal(visits[0]?.visitedAt, '2026-11-01T00:00:00.000Z')

const searches = searchesFromBrowserRows([
  { query: 'Harbor', url: 'https://www.google.com/search?q=Harbor', queriedAt: chrome, epoch: 'chrome' },
  { url: 'https://www.google.com/search?q=Harbor', queriedAt: chrome, epoch: 'chrome' },
  { url: 'https://duckduckgo.com/?q=radios', queriedAt: safari, epoch: 'safari' },
  { title: 'Searched for harbor seals', url: 'https://www.bing.com/search?q=harbor+seals', queriedAt: firefox, epoch: 'firefox' },
  { url: 'chrome://newtab', queriedAt: firefox, epoch: 'firefox' },
  { url: 'https://example.com/a', queriedAt: firefox, epoch: 'firefox' },
])
assert.equal(searches.length, 3)
assert.equal(searches.find((item) => item.query === 'Harbor')?.engine, 'Google')
assert.equal(searches.find((item) => item.query === 'radios')?.engine, 'DuckDuckGo')
assert.equal(searches.find((item) => item.query === 'harbor seals')?.engine, 'Bing')

const many = Array.from({ length: 2001 }, (_, index) => ({
  url: `https://example.com/${index}`,
  title: `Page ${index}`,
  visitedAt: String((Date.parse('2020-01-01T00:00:00.000Z') + index * 1000) * 1000),
  epoch: 'firefox' as const,
}))
const capped = visitsFromBrowserRows(many)
assert.equal(capped.length, 2000)
assert.equal(capped[0]?.url, 'https://example.com/2000')
assert.equal(capped[1999]?.url, 'https://example.com/1')

const manySearches = Array.from({ length: 2001 }, (_, index) => ({
  query: `query ${index}`,
  queriedAt: String((Date.parse('2020-01-01T00:00:00.000Z') + index * 1000) * 1000),
  epoch: 'firefox' as const,
}))
const cappedSearches = searchesFromBrowserRows(manySearches)
assert.equal(cappedSearches.length, 2000)
assert.equal(cappedSearches[0]?.query, 'query 2000')
assert.equal(cappedSearches[1999]?.query, 'query 1')

const home = mkdtempSync(join(tmpdir(), 'observer-history-home-'))
try {
  const chrome = join(home, 'Library/Application Support/Google/Chrome/Default')
  const guest = join(home, 'Library/Application Support/Google/Chrome/Guest Profile')
  const firefox = join(home, 'Library/Application Support/Firefox/Profiles/test.default')
  const safariDir = join(home, 'Library/Safari')
  mkdirSync(chrome, { recursive: true })
  mkdirSync(guest, { recursive: true })
  mkdirSync(firefox, { recursive: true })
  mkdirSync(safariDir, { recursive: true })
  const chromeUs = (instant + 11_644_473_600_000) * 1000
  const firefoxUs = instant * 1000
  const safariSeconds = instant / 1000 - 978_307_200
  sqlite(join(chrome, 'History'), `
    CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_time INTEGER);
    CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER);
    CREATE TABLE keyword_search_terms (url_id INTEGER, term TEXT);
    INSERT INTO urls (id, url, title, last_visit_time) VALUES
      (1, 'https://example.com/a', 'Example', ${chromeUs}),
      (2, 'https://www.google.com/search?q=harbor+seals', 'Google', ${chromeUs}),
      (3, 'chrome://settings', 'Settings', ${chromeUs});
    INSERT INTO visits (url, visit_time) VALUES (1, ${chromeUs}), (2, ${chromeUs}), (3, ${chromeUs});
    INSERT INTO keyword_search_terms (url_id, term) VALUES (2, 'harbor seals');
  `)
  sqlite(join(guest, 'History'), `
    CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_time INTEGER);
    CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER);
    INSERT INTO urls (id, url, title, last_visit_time) VALUES (1, 'https://guest.example/', 'Guest', ${chromeUs});
    INSERT INTO visits (url, visit_time) VALUES (1, ${chromeUs});
  `)
  sqlite(join(firefox, 'places.sqlite'), `
    CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT);
    CREATE TABLE moz_historyvisits (id INTEGER PRIMARY KEY, place_id INTEGER, visit_date INTEGER);
    INSERT INTO moz_places (id, url, title) VALUES (1, 'https://duckduckgo.com/?q=radios', 'DuckDuckGo');
    INSERT INTO moz_historyvisits (place_id, visit_date) VALUES (1, ${firefoxUs});
  `)
  sqlite(join(safariDir, 'History.db'), `
    CREATE TABLE history_items (id INTEGER PRIMARY KEY, url TEXT);
    CREATE TABLE history_visits (id INTEGER PRIMARY KEY, history_item INTEGER, visit_time REAL, title TEXT);
    INSERT INTO history_items (id, url) VALUES (1, 'https://www.bing.com/search?q=towers');
    INSERT INTO history_visits (history_item, visit_time, title) VALUES (1, ${safariSeconds}, 'Bing');
  `)
  const imported = await readBrowserHistoryFrom(home)
  assert.deepEqual(imported.sources, ['Chrome', 'Firefox', 'Safari'])
  assert.deepEqual(imported.skipped, [])
  assert.deepEqual(imported.visits.map((item) => item.url).sort(), [
    'https://duckduckgo.com/?q=radios',
    'https://example.com/a',
    'https://www.bing.com/search?q=towers',
    'https://www.google.com/search?q=harbor+seals',
  ])
  assert.equal(imported.visits.some((item) => item.url.startsWith('chrome:')), false)
  assert.equal(imported.visits.some((item) => item.url.includes('guest.example')), false)
  assert.equal(imported.searches.find((item) => item.query === 'harbor seals')?.engine, 'Google')
  assert.equal(imported.searches.find((item) => item.query === 'radios')?.engine, 'DuckDuckGo')
  assert.equal(imported.searches.find((item) => item.query === 'towers')?.engine, 'Bing')
} finally {
  rmSync(home, { recursive: true, force: true })
}

function sqlite(file: string, sql: string): void {
  execFileSync('/usr/bin/sqlite3', [file, sql], { encoding: 'utf8' })
}

console.log('browser history checks passed')
