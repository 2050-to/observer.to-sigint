import assert from 'node:assert/strict'
import { parseBookmarks, parseBrowsingHistory, parseSearchHistory, searchFromUrl } from '../../shared/imports.js'

const html = '<DL><DT><A HREF="https://example.com/a">Example</A></DT><DT><A HREF="https://example.com/a#part">Again</A></DT></DL>'
const bookmarks = parseBookmarks(html)
assert.equal(bookmarks.length, 1)
assert.equal(bookmarks[0]?.title, 'Example')
assert.equal(bookmarks[0]?.url, 'https://example.com/a')

const chrome = JSON.stringify({
  roots: {
    bookmark_bar: {
      children: [
        { type: 'url', name: 'News', url: 'https://news.example/path' },
        { type: 'folder', name: 'Folder', children: [] },
      ],
    },
  },
})
assert.equal(parseBookmarks(chrome)[0]?.title, 'News')

const searches = parseSearchHistory(JSON.stringify([
  { title: 'Searched for harbor seals', titleUrl: 'https://www.google.com/search?q=harbor+seals', time: '2026-11-01T00:00:00Z' },
]))
assert.equal(searches[0]?.query, 'harbor seals')
assert.equal(searches[0]?.engine, 'Google')
assert.deepEqual(searchFromUrl('https://duckduckgo.com/?q=radios'), { query: 'radios', engine: 'DuckDuckGo' })

const visits = parseBrowsingHistory('https://example.com/page,Example,"2026-11-02T00:00:00Z"\n')
assert.equal(visits[0]?.url, 'https://example.com/page')
assert.equal(visits[0]?.title, 'Example')
const jsonVisits = parseBrowsingHistory(JSON.stringify({
  'Browser History': [{ url: 'https://maps.example/', title: 'Maps', time_usec: 1762041600000000 }],
}))
assert.equal(jsonVisits[0]?.title, 'Maps')
assert.ok(jsonVisits[0]?.visitedAt.startsWith('202'))

console.log('import checks passed')
