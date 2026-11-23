import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { api } from '../api'
import { AskBox } from '../AskBox'
import { parseBookmarks, parseBrowsingHistory, parseSearchHistory } from '../../shared/imports'

type Kind = 'bookmarks' | 'search' | 'browsing'

const COPY: Record<Kind, { title: string; hint: string; empty: string }> = {
  bookmarks: {
    title: 'Bookmarks',
    hint: 'Choose a Netscape HTML export or a Chrome bookmarks JSON file. The file is stored for this account only.',
    empty: 'No bookmarks imported yet.',
  },
  search: {
    title: 'Search history',
    hint: 'Choose a Takeout JSON file or a text file of search URLs. The queries are stored for this account only.',
    empty: 'No search history imported yet.',
  },
  browsing: {
    title: 'Browsing history',
    hint: 'Choose a JSON or CSV export of page visits. The history is stored for this account only.',
    empty: 'No browsing history imported yet.',
  },
}

export function RecordView({ kind, subscribed }: { kind: Kind; subscribed: boolean }) {
  const copy = COPY[kind]
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<string[][]>([])
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stop = false
    void load(kind, q).then((next) => {
      if (!stop) setRows(next)
    }).catch((reason: unknown) => {
      if (!stop) setError(reason instanceof Error ? reason.message : 'The records could not be loaded')
    })
    return () => { stop = true }
  }, [kind, q])

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    setNote('')
    try {
      const text = await file.text()
      const count = await upload(kind, text)
      setNote(`Imported ${count} record${count === 1 ? '' : 's'} into this account.`)
      setRows(await load(kind, q))
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The file could not be imported')
    } finally {
      setBusy(false)
    }
  }

  function search(event: FormEvent) {
    event.preventDefault()
  }

  return (
    <section className="panel">
      <h2>{copy.title}</h2>
      <p className="disclaimer">{copy.hint}</p>
      <label className="file">
        Import a file
        <input type="file" accept=".html,.json,.csv,.txt,text/html,application/json,text/csv,text/plain" onChange={(event) => void onFile(event)} disabled={busy} />
      </label>
      <form className="signin" onSubmit={search}>
        <label>
          Search this account
          <input value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
      </form>
      {note && <p className="note">{note}</p>}
      {error && <p className="warn">{error}</p>}
      {rows.length === 0 ? <p className="empty">{copy.empty}</p> : (
        <table>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.join('|')}:${index}`}>
                {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {kind !== 'bookmarks' && <AskBox dataset={kind === 'search' ? 'search' : 'browsing'} subscribed={subscribed} />}
      {kind === 'bookmarks' && <AskBox dataset="bookmarks" subscribed={subscribed} />}
    </section>
  )
}

async function load(kind: Kind, q: string): Promise<string[][]> {
  if (kind === 'bookmarks') {
    return (await api.bookmarks(q)).map((item) => [item.title, item.url])
  }
  if (kind === 'search') {
    return (await api.searches(q)).map((item) => [new Date(item.queriedAt).toLocaleString(), item.engine ?? '', item.query])
  }
  return (await api.visits(q)).map((item) => [new Date(item.visitedAt).toLocaleString(), item.title ?? '', item.url])
}

async function upload(kind: Kind, text: string): Promise<number> {
  if (kind === 'bookmarks') return (await api.saveBookmarks(parseBookmarks(text))).count
  if (kind === 'search') return (await api.saveSearches(parseSearchHistory(text))).count
  return (await api.saveVisits(parseBrowsingHistory(text))).count
}
