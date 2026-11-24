import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { api } from '../api'
import { AskBox } from '../AskBox'
import { parseBrowsingHistory, parseSearchHistory } from '../../shared/imports'
import { onMacApp, promptFullDiskAccess, Wardrive } from '../native/drive'

type Kind = 'search' | 'browsing'

const COPY: Record<Kind, { title: string; hint: string; macHint: string; empty: string }> = {
  search: {
    title: 'Search history',
    hint: 'Choose a Takeout JSON file or a text file of search URLs. The queries are stored for this account only.',
    macHint: 'Reads search queries already stored by browsers on this Mac. Passwords, cookies, and payment cards are not read.',
    empty: 'No search history imported yet.',
  },
  browsing: {
    title: 'Browsing history',
    hint: 'Choose a JSON or CSV export of page visits. The history is stored for this account only.',
    macHint: 'Reads page visits already stored by browsers on this Mac. Passwords, cookies, and payment cards are not read.',
    empty: 'No browsing history imported yet.',
  },
}

export function RecordView({ kind, subscribed }: { kind: Kind; subscribed: boolean }) {
  const copy = COPY[kind]
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<{ when: string; mid: string; detail: string }[]>([])
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const macHistory = onMacApp()

  function publishImport(text: string, failed: boolean) {
    if (text.includes('Full Disk Access')) promptFullDiskAccess()
    if (failed) setError(text)
    else setNote(text)
  }

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

  async function onLocal() {
    setBusy(true)
    setError('')
    setNote('')
    try {
      const history = await Wardrive.importHistory({ consent: true })
      if (history.sources.length === 0) {
        publishImport(importNote(0, history.sources, history.skipped, history.accessDenied), true)
        return
      }
      const count = kind === 'search'
        ? (await api.saveSearches(history.searches, true)).count
        : (await api.saveVisits(history.visits, true)).count
      publishImport(importNote(count, history.sources, history.skipped, history.accessDenied), false)
      setRows(await load(kind, q))
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Browser history could not be imported')
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
      <p className="disclaimer">{macHistory ? copy.macHint : copy.hint}</p>
      {macHistory ? (
        <button type="button" className="fit" onClick={() => void onLocal()} disabled={busy}>
          {busy ? 'Importing…' : 'Import from this Mac'}
        </button>
      ) : (
        <label className="file">
          Import a file
          <input type="file" accept=".json,.csv,.txt,application/json,text/csv,text/plain" onChange={(event) => void onFile(event)} disabled={busy} />
        </label>
      )}
      <form className="signin" onSubmit={search}>
        <label>
          Search this account
          <input value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
      </form>
      {note && <p className="note">{note}</p>}
      {error && <p className="warn">{error}</p>}
      {rows.length === 0 ? <p className="empty">{copy.empty}</p> : (
        <table className="records">
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.when}:${row.detail}:${index}`}>
                <td className="when">{row.when}</td>
                <td className={kind === 'search' ? 'mid' : 'detail'}>{row.mid}</td>
                <td className="detail">{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!onMacApp() && <AskBox dataset={kind} subscribed={subscribed} />}
    </section>
  )
}

function importNote(count: number, sources: string[], skipped: string[], accessDenied: boolean): string {
  const missed = skipped.length ? ` Could not read ${formatList(skipped)}.` : ''
  const access = accessDenied
    ? ' Quit Observer.to and open it again after Full Disk Access is on for Observer.to. That switch does not apply to the app while it is already running.'
    : ''
  if (sources.length === 0) return `No browser history could be read on this Mac.${missed}${access}`
  const records = `Imported ${count} record${count === 1 ? '' : 's'} from ${formatList(sources)}.`
  return `${records}${missed}${access}`
}

function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

async function load(kind: Kind, q: string): Promise<{ when: string; mid: string; detail: string }[]> {
  if (kind === 'search') {
    return (await api.searches(q)).map((item) => ({
      when: new Date(item.queriedAt).toLocaleString(),
      mid: item.engine ?? '',
      detail: item.query,
    }))
  }
  return (await api.visits(q)).map((item) => ({
    when: new Date(item.visitedAt).toLocaleString(),
    mid: item.title ?? '',
    detail: item.url,
  }))
}

async function upload(kind: Kind, text: string): Promise<number> {
  if (kind === 'search') return (await api.saveSearches(parseSearchHistory(text))).count
  return (await api.saveVisits(parseBrowsingHistory(text))).count
}
