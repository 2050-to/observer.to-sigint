import { useEffect, useRef, useState } from 'react'
import {
  flagLabel,
  markFresh,
  socketKey,
  type ClassifiedSocket,
  type SecureLinkSnapshot,
  type SocketEndpoint,
} from '../../shared/secureLinks'
import { onMacApp, Wardrive } from '../native/drive'
import { loadSecureChoice, rememberSecureChoice } from '../secureLinksPrefs'

const REFRESH_MS = 5000

type ShownSocket = ClassifiedSocket & { fresh: boolean }

export function SecureLinks() {
  const mac = onMacApp()
  const [loaded, setLoaded] = useState(false)
  const [allowed, setAllowed] = useState(false)
  const [prompt, setPrompt] = useState(false)
  const [snapshot, setSnapshot] = useState<SecureLinkSnapshot | null>(null)
  const [rows, setRows] = useState<ShownSocket[]>([])
  const [error, setError] = useState('')
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

  return (
    <div className="secure-links">
      <h2>Connections on this Mac</h2>
      <p className="owned-help">This lists sockets on this Mac. It does not read contents and it does not see other devices.</p>
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
              Observer.to will list this Mac's current sockets and flag port 443, Tor, VPN, and other common secure protocols. It does not read message contents or see other devices. The list stays on this Mac and is not uploaded.
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
      {snapshot && (
        <>
          <p className="owned-help">{vpnText(snapshot)}</p>
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
    </div>
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
}

function connectionError(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : 'The socket table could not be read.'
  const cleaned = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
  return cleaned || 'The socket table could not be read.'
}

function vpnText(snapshot: SecureLinkSnapshot): string {
  if (snapshot.vpnRoute.active && snapshot.vpnRoute.interfaceName) {
    return `A VPN interface holds the default route (${snapshot.vpnRoute.interfaceName}).`
  }
  return 'The default route is not a VPN interface.'
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

function endpointText(local: SocketEndpoint, remote: SocketEndpoint | null): string {
  const left = formatEndpoint(local)
  if (!remote) return left
  return `${left} -> ${formatEndpoint(remote)}`
}

function formatEndpoint(endpoint: SocketEndpoint): string {
  const host = endpoint.host.includes(':') && !endpoint.host.startsWith('[') ? `[${endpoint.host}]` : endpoint.host
  if (endpoint.port == null) return host
  return `${host}:${endpoint.port}`
}
