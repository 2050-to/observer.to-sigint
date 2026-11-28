import { useEffect, useRef, useState } from 'react'
import { appendAllowlist, parseAllowlist } from '../../shared/allowlist'
import {
  fingerprintOf,
  isOutlier,
  processStanding,
  sortProcessEntries,
  type LiveProcess,
  type ProcessEntry,
  type ProcessSnapshot,
  type SignatureStatus,
} from '../../shared/processCatalog'
import { macProcesses } from '../native/drive'

const SIGNATURE_LABEL: Record<SignatureStatus, string> = {
  apple: 'Apple',
  developer: 'Developer ID',
  adhoc: 'Ad hoc',
  unsigned: 'Unsigned',
  invalid: 'Invalid',
  unreadable: 'Unreadable',
  platform: 'Platform',
  pending: 'Checking',
}

const STANDING_LABEL = {
  checking: 'Checking',
  allowed: 'Allowed',
  baseline: 'Baseline',
  outlier: 'Outlier',
} as const

export function MacProcesses() {
  const [snapshot, setSnapshot] = useState<ProcessSnapshot | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = useRef(false)

  useEffect(() => {
    const bridge = macProcesses()
    if (!bridge) return
    let stop = false
    let remove: (() => Promise<void>) | null = null
    const apply = (next: ProcessSnapshot) => {
      if (stop) return
      setSnapshot(next)
      if (!dirty.current) setDraft(next.allowlistText)
      setError(next.error ?? '')
    }
    void bridge.get().then(apply).catch((reason: unknown) => {
      if (!stop) setError(plainError(reason, 'The process catalog could not be read.'))
    })
    void bridge.onSnapshot(apply).then((handle) => {
      if (stop) void handle.remove()
      else remove = () => handle.remove()
    }).catch(() => undefined)
    return () => {
      stop = true
      void remove?.()
    }
  }, [])

  const names = parseAllowlist(snapshot?.allowlistText ?? '')
  const catalog = snapshot ? sortProcessEntries(snapshot.catalog.entries) : []
  const running = [...(snapshot?.live ?? [])].sort((left, right) => right.cpu - left.cpu || right.mem - left.mem || left.pid - right.pid)
  const byPath = new Map(catalog.map((entry) => [entry.path, entry]))
  const seededAt = snapshot?.catalog.seededAt ?? null
  const seenOutliers = new Set<string>()
  const outliers = sortProcessEntries(running.flatMap((row) => {
    const entry = byPath.get(row.path)
    if (!entry || seenOutliers.has(entry.path) || !attention(entry, names, seededAt)) return []
    seenOutliers.add(entry.path)
    return [entry]
  }))

  async function refresh() {
    const bridge = macProcesses()
    if (!bridge) return
    const next = await bridge.get()
    setSnapshot(next)
    if (!dirty.current) setDraft(next.allowlistText)
    setError(next.error ?? '')
  }

  async function onToggle() {
    const bridge = macProcesses()
    if (!bridge || !snapshot) return
    setBusy(true)
    try {
      await bridge.setAllowed({ allowed: !snapshot.allowed })
      await refresh()
    } catch (reason: unknown) {
      setError(plainError(reason, 'Process logging could not be changed.'))
    } finally {
      setBusy(false)
    }
  }

  async function allow(name: string) {
    const bridge = macProcesses()
    if (!bridge) return
    setBusy(true)
    try {
      const result = await bridge.allowName({ name })
      setDraft((current) => dirty.current ? appendAllowlist(current, name) : result.text)
      await refresh()
    } catch (reason: unknown) {
      setError(plainError(reason, 'The allowlist could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  async function dismiss(entry: ProcessEntry) {
    const bridge = macProcesses()
    if (!bridge) return
    setBusy(true)
    try {
      await bridge.dismiss({ path: entry.path, fingerprint: fingerprintOf(entry.signature) })
      await refresh()
    } catch (reason: unknown) {
      setError(plainError(reason, 'The process could not be dismissed.'))
    } finally {
      setBusy(false)
    }
  }

  async function saveAllowlist() {
    const bridge = macProcesses()
    if (!bridge) return
    setBusy(true)
    try {
      const result = await bridge.saveAllowlist({ text: draft })
      dirty.current = false
      setDraft(result.text)
      await refresh()
    } catch (reason: unknown) {
      setError(plainError(reason, 'The allowlist could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  async function clearCatalog() {
    const bridge = macProcesses()
    if (!bridge) return
    setBusy(true)
    try {
      await bridge.clear()
      await refresh()
    } catch (reason: unknown) {
      setError(plainError(reason, 'The process catalog could not be cleared.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card mac-processes">
      <div className="log-head">
        <div>
          <h2>Mac Processes</h2>
          <p>
            This lists processes on this Mac and keeps a catalog of them on this Mac. Rare rows stay at the top.
            A process seen at least 50 times across 30 minutes is saved to a baseline file on this Mac.
            Add a process name to the allowlist when it is expected, such as Cursor Helper.
            Command lines are shown here and are not saved. Nothing in this tab is uploaded.
          </p>
        </div>
      </div>
      <label>
        <input type="checkbox" checked={snapshot?.allowed === true} disabled={!snapshot || busy} onChange={() => void onToggle()} />
        Log processes on this Mac
      </label>
      {error && <p className="warn">{error}</p>}
      {!snapshot && !error && <p>Reading this Mac.</p>}
      {snapshot?.allowed && (
        <>
          <h3>Running</h3>
          {running.length === 0 ? <p>No processes read yet.</p> : <LiveTable rows={running} byPath={byPath} names={names} seededAt={seededAt} />}
        </>
      )}
      {outliers.length > 0 && (
        <>
          <h3>Outside the baseline</h3>
          <ul className="diff-list">
            {outliers.map((entry) => (
              <li key={entry.path}>
                <strong>{entry.name}</strong>
                <p>{entry.path}</p>
                <p>{SIGNATURE_LABEL[entry.signature.status]}. {entry.samples} samples.</p>
                <div className="actions">
                  <button type="button" onClick={() => void allow(entry.name)} disabled={busy}>Allow</button>
                  {canDismiss(entry) && (
                    <button type="button" onClick={() => void dismiss(entry)} disabled={busy}>Dismiss</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Catalog</h3>
      {snapshot && <p>{catalogSummary(snapshot)}</p>}
      {catalog.length === 0 ? <p>No saved processes.</p> : (
        <CatalogTable entries={catalog} names={names} seededAt={seededAt} busy={busy} onAllow={(name) => void allow(name)} onDismiss={(entry) => void dismiss(entry)} />
      )}
      {catalog.length > 0 && (
        <button type="button" onClick={() => void clearCatalog()} disabled={busy}>Clear catalog</button>
      )}
      <h3>Allowlist</h3>
      <p>One process name per line. Blank lines and comments stay in the file and are ignored when matching.</p>
      <textarea
        className="allowlist-editor"
        value={draft}
        spellCheck={false}
        onChange={(event) => {
          dirty.current = true
          setDraft(event.target.value)
        }}
      />
      <button type="button" onClick={() => void saveAllowlist()} disabled={busy || !snapshot}>Save allowlist</button>
    </section>
  )
}

function LiveTable({ rows, byPath, names, seededAt }: { rows: LiveProcess[]; byPath: Map<string, ProcessEntry>; names: string[]; seededAt: string | null }) {
  return (
    <div className="process-scroll">
      <table className="process-table">
        <thead>
          <tr>
            <th scope="col">PID</th>
            <th scope="col">USER</th>
            <th scope="col">STATE</th>
            <th scope="col">CPU%</th>
            <th scope="col">MEM%</th>
            <th scope="col">RES</th>
            <th scope="col">TIME</th>
            <th scope="col">COMMAND</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const entry = byPath.get(row.path)
            return (
              <tr key={row.pid} className={attention(entry, names, seededAt) ? 'host-flagged' : undefined}>
                <td>{row.pid}</td>
                <td>{row.user}</td>
                <td>{row.state}</td>
                <td>{row.cpu.toFixed(1)}</td>
                <td>{row.mem.toFixed(1)}</td>
                <td>{formatRss(row.rssKb)}</td>
                <td>{row.time}</td>
                <td className="command" title={row.command}>{row.command}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CatalogTable({
  entries,
  names,
  seededAt,
  busy,
  onAllow,
  onDismiss,
}: {
  entries: ProcessEntry[]
  names: string[]
  seededAt: string | null
  busy: boolean
  onAllow: (name: string) => void
  onDismiss: (entry: ProcessEntry) => void
}) {
  return (
    <div className="host-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Process</th>
            <th scope="col">Path</th>
            <th scope="col">Signature</th>
            <th scope="col">User</th>
            <th scope="col">Samples</th>
            <th scope="col">First seen</th>
            <th scope="col">Last seen</th>
            <th scope="col">Standing</th>
            <th scope="col" className="row-actions">Action</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const standing = processStanding(entry, names)
            const flagged = attention(entry, names, seededAt)
            return (
              <tr key={entry.path} className={flagged ? 'host-flagged' : undefined}>
                <td>{entry.name}</td>
                <td title={entry.path}>{entry.path}</td>
                <td>{SIGNATURE_LABEL[entry.signature.status]}</td>
                <td>{entry.user}</td>
                <td>{entry.samples}</td>
                <td>{seenText(entry.firstSeen)}</td>
                <td>{seenText(entry.lastSeen)}</td>
                <td>{standingText(entry, names, seededAt)}{dismissed(entry) ? ', dismissed' : ''}</td>
                <td className="row-actions">
                  {standing !== 'allowed' && <button type="button" onClick={() => onAllow(entry.name)} disabled={busy}>Allow</button>}
                  {canDismiss(entry) && (
                    <button type="button" onClick={() => onDismiss(entry)} disabled={busy}>Dismiss</button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function canDismiss(entry: ProcessEntry): boolean {
  if (entry.signature.status !== 'invalid' && entry.signature.status !== 'unreadable') return false
  return !dismissed(entry)
}

function dismissed(entry: ProcessEntry): boolean {
  return entry.dismissedFingerprint === fingerprintOf(entry.signature)
}

function attention(entry: ProcessEntry | undefined, names: readonly string[], seededAt: string | null): boolean {
  if (!entry || !isOutlier(entry, names)) return false
  if (entry.signature.status === 'invalid' || entry.signature.status === 'unreadable') return true
  return seededAt != null && entry.firstSeen > seededAt
}

function standingText(entry: ProcessEntry, names: readonly string[], seededAt: string | null): string {
  const standing = processStanding(entry, names)
  if (standing === 'outlier' && !attention(entry, names, seededAt)) return 'Recording'
  return STANDING_LABEL[standing]
}

function catalogSummary(snapshot: ProcessSnapshot): string {
  const count = snapshot.catalog.entries.length
  const noun = count === 1 ? 'saved process' : 'saved processes'
  const when = snapshot.catalog.updatedAt ? `Catalog updated ${seenText(snapshot.catalog.updatedAt)}.` : 'The catalog has not been updated.'
  return `${when} ${count} ${noun}.`
}

function formatRss(kb: number): string {
  if (kb < 1024) return `${kb}K`
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)}M`
  return `${(kb / (1024 * 1024)).toFixed(1)}G`
}

function seenText(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function plainError(reason: unknown, fallback: string): string {
  const raw = reason instanceof Error ? reason.message : fallback
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
}
