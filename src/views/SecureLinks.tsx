import { useEffect, useRef, useState } from 'react'
import {
  reviewChanges,
  sortBySamples,
  type ConnectionCatalog,
  type ConnectionEntry,
  type ConnectionSnapshot,
} from '../../shared/connectionCatalog'
import {
  flagLabel,
  markFresh,
  socketKey,
  type ClassifiedSocket,
  type SocketEndpoint,
  type VpnRoute,
} from '../../shared/secureLinks'
import { onMacApp, Wardrive } from '../native/drive'
import { loadSecureChoice, rememberSecureChoice } from '../secureLinksPrefs'

const REFRESH_MS = 5000

type ShownSocket = ClassifiedSocket & { fresh: boolean }

export function SecureLinks({ resetToken = 0 }: { resetToken?: number }) {
  const mac = onMacApp()
  const [loaded, setLoaded] = useState(false)
  const [allowed, setAllowed] = useState(false)
  const [prompt, setPrompt] = useState(false)
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot | null>(null)
  const [catalog, setCatalog] = useState<ConnectionCatalog | null>(null)
  const [rows, setRows] = useState<ShownSocket[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!mac) return
    let stop = false
    void loadSecureChoice().then((value) => {
      if (stop) return
      setAllowed(value)
      setLoaded(true)
    })
    return () => {
      stop = true
    }
  }, [mac])

  useEffect(() => {
    if (!mac) return
    let stop = false
    void Wardrive.getConnectionCatalog().then((value) => {
      if (!stop) setCatalog(value)
    }).catch((reason: unknown) => {
      if (!stop) setError(connectionError(reason))
    })
    return () => {
      stop = true
    }
  }, [mac, resetToken])

  useEffect(() => {
    if (!mac || allowed) return
    let stop = false
    void Wardrive.getConnectionCatalog().then((value) => {
      if (!stop) setCatalog(value)
    }).catch((reason: unknown) => {
      if (!stop) setError(connectionError(reason))
    })
    return () => {
      stop = true
    }
  }, [allowed, mac])

  useEffect(() => {
    if (!mac || !loaded || !allowed) {
      seen.current = null
      setSnapshot(null)
      setRows([])
      return
    }
    let stop = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      try {
        const next = await Wardrive.listConnections({ consent: true })
        if (stop) return
        const marked = markFresh(next.sockets, seen.current)
        seen.current = new Set(next.sockets.map((item) => socketKey(item)))
        setSnapshot(next)
        setCatalog(next.catalog)
        setRows(marked)
        setError('')
      } catch (reason: unknown) {
        if (stop) return
        setError(connectionError(reason))
      } finally {
        if (!stop) timer = setTimeout(() => void tick(), REFRESH_MS)
      }
    }
    void tick()
    return () => {
      stop = true
      if (timer) clearTimeout(timer)
    }
  }, [allowed, loaded, mac])

  if (!mac) return null

  const changes = catalog ? reviewChanges(catalog) : null

  return (
    <section className="card secure-links">
      <h2>Connections on this Mac</h2>
      <p className="owned-help">This lists sockets on this Mac and keeps a catalog of them on this Mac until you clear it or delete all data. It does not read contents, see other devices, or upload the catalog.</p>
      <fieldset className="owned-options">
        <legend className="owned-help">Optional feature</legend>
        <label>
          <input type="checkbox" checked={allowed} disabled={!loaded || prompt} onChange={onToggle} />
          List secure connections on this Mac
        </label>
      </fieldset>
      {prompt && (
        <div className="prompt" role="alertdialog" aria-labelledby="secure-links-title">
          <div>
            <h3 id="secure-links-title">List secure connections on this Mac?</h3>
            <p>
              Observer.to will list this Mac's current sockets and flag port 443, Tor, VPN, and other common secure protocols. It keeps a catalog on this Mac until you clear it or delete all data. It does not read message contents, see other devices, or upload the catalog.
            </p>
          </div>
          <div className="actions">
            <button type="button" onClick={() => setPrompt(false)}>Don't allow</button>
            <button type="button" onClick={allow}>Allow</button>
          </div>
        </div>
      )}
      {error && <p className="warn" aria-live="polite">{error}</p>}
      {allowed && !snapshot && !error && <p className="owned-help">Reading this Mac's sockets.</p>}
      {!allowed && <p className="owned-help">Listing is off, so this catalog is not updating.</p>}
      {snapshot && (
        <>
          <p className="owned-help">{vpnText(snapshot.vpnRoute)}</p>
          {snapshot.counts.length > 0 ? (
            <p className="owned-help">{snapshot.counts.map((item) => `${flagLabel(item.flag)} ${item.count}`).join(' · ')}</p>
          ) : (
            <p className="owned-help">No connections on 443, Tor, VPN, or another secure protocol are open.</p>
          )}
          {snapshot.truncated && (
            <p className="owned-help">Showing the first {snapshot.sockets.length} matching connections.</p>
          )}
          <ConnectionTable rows={rows} />
        </>
      )}
      {catalog && changes && (
        <>
          <p className="owned-help">{catalogSummary(catalog)}</p>
          <h3>Since last review</h3>
          {!catalog.reviewedAt && <p className="owned-help">Nothing has been marked reviewed.</p>}
          {catalog.reviewedAt && changes.appeared.length === 0 && changes.quiet.length === 0 && (
            <p className="owned-help">No connections appeared or went quiet since the last review.</p>
          )}
          {changes.appeared.length > 0 && (
            <>
              <h3>Appeared</h3>
              <ul className="diff-list">
                {changes.appeared.map((entry) => <li key={entryKey(entry)}>{changeText(entry)}</li>)}
              </ul>
            </>
          )}
          {changes.quiet.length > 0 && (
            <>
              <h3>No longer seen</h3>
              <ul className="diff-list">
                {changes.quiet.map((entry) => <li key={entryKey(entry)}>{changeText(entry)}</li>)}
              </ul>
            </>
          )}
          <div className="owned-actions">
            <button type="button" onClick={() => void markCatalogReviewed()} disabled={busy || !catalog.updatedAt}>Mark reviewed</button>
            <button type="button" onClick={() => void clearCatalog()} disabled={busy || catalog.entries.length === 0}>Clear catalog</button>
          </div>
          {catalog.entries.length > 0 ? <CatalogTable entries={catalog.entries} /> : <p className="owned-help">No saved connections.</p>}
        </>
      )}
    </section>
  )

  function onToggle() {
    if (allowed) {
      setAllowed(false)
      setPrompt(false)
      setError('')
      void rememberSecureChoice(false).catch(() => {
        setError('Turned off in this window. The Mac preference could not be stored.')
      })
      return
    }
    setPrompt(true)
  }

  function allow() {
    setPrompt(false)
    setAllowed(true)
    setError('')
    void rememberSecureChoice(true).catch(() => {
      setError('Allowed in this window. The Mac preference could not be stored.')
    })
  }

  async function markCatalogReviewed() {
    setBusy(true)
    try {
      setCatalog(await Wardrive.reviewConnectionCatalog())
      setError('')
    } catch (reason: unknown) {
      setError(connectionError(reason))
    } finally {
      setBusy(false)
    }
  }

  async function clearCatalog() {
    setBusy(true)
    try {
      setCatalog(await Wardrive.clearConnectionCatalog())
      setError('')
    } catch (reason: unknown) {
      setError(connectionError(reason))
    } finally {
      setBusy(false)
    }
  }
}

function connectionError(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : 'The socket table could not be read.'
  const cleaned = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
  return cleaned || 'The socket table could not be read.'
}

function vpnText(route: VpnRoute): string {
  if (route.active && route.interfaceName) return `A VPN interface holds the default route (${route.interfaceName}).`
  return 'The default route is not a VPN interface.'
}

function catalogSummary(catalog: ConnectionCatalog): string {
  const count = catalog.entries.length === 1 ? '1 saved connection' : `${catalog.entries.length} saved connections`
  const when = catalog.updatedAt ? `Catalog updated ${seenText(catalog.updatedAt)}.` : 'The catalog has not been updated.'
  return `${when} ${count}. ${vpnText(catalog.vpnRoute)}`
}

function ConnectionTable({ rows }: { rows: ShownSocket[] }) {
  if (!rows.length) return null
  return (
    <div className="host-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Flag</th>
            <th scope="col">Process</th>
            <th scope="col">Protocol</th>
            <th scope="col">Endpoints</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.pid}:${socketKey(row)}`} className={row.fresh ? 'host-flagged' : undefined}>
              <td>
                {row.fresh && <span className="host-notice">New</span>}
                <span>{row.flags.map((flag) => flagLabel(flag)).join(', ')}</span>
              </td>
              <td>{row.process}</td>
              <td>{row.protocol.toUpperCase()}</td>
              <td>{endpointText(row.local, row.remote)}</td>
              <td>{row.state ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CatalogTable({ entries }: { entries: ConnectionEntry[] }) {
  const ordered = sortBySamples(entries)
  return (
    <div className="host-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Flag</th>
            <th scope="col">Process</th>
            <th scope="col">Pid</th>
            <th scope="col">Protocol</th>
            <th scope="col">Destination</th>
            <th scope="col">Last local</th>
            <th scope="col">State</th>
            <th scope="col">Open</th>
            <th scope="col">First seen</th>
            <th scope="col">Last seen</th>
            <th scope="col">Samples</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((entry) => (
            <tr key={entryKey(entry)} className={entry.openCount > 0 ? 'connection-open' : undefined}>
              <td>{entry.flags.map((flag) => flagLabel(flag)).join(', ')}</td>
              <td>{entry.process}</td>
              <td>{entry.pid}</td>
              <td>{entry.protocol.toUpperCase()}</td>
              <td>{endpointLabel(entry.destination, entry.listen)}</td>
              <td>{endpointLabel(entry.local, false)}</td>
              <td>{entry.state ?? ''}</td>
              <td>{entry.openCount}</td>
              <td>{seenText(entry.firstSeen)}</td>
              <td>{seenText(entry.lastSeen)}</td>
              <td>{entry.samples}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function endpointText(local: SocketEndpoint, remote: SocketEndpoint | null): string {
  const left = endpointLabel(local, false)
  if (!remote) return left
  return `${left} -> ${endpointLabel(remote, false)}`
}

function endpointLabel(endpoint: SocketEndpoint, listen: boolean): string {
  const host = endpoint.host.includes(':') && !endpoint.host.startsWith('[') ? `[${endpoint.host}]` : endpoint.host
  const text = endpoint.port == null ? host : `${host}:${endpoint.port}`
  return listen ? `listen ${text}` : text
}

function changeText(entry: ConnectionEntry): string {
  return `${entry.process} ${entry.protocol.toUpperCase()} ${endpointLabel(entry.destination, entry.listen)}`
}

function entryKey(entry: ConnectionEntry): string {
  return [
    entry.process,
    entry.protocol,
    entry.listen ? 'listen' : 'remote',
    entry.destination.host,
    entry.destination.port ?? '',
    entry.firstSeen,
  ].join(':')
}

function seenText(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
