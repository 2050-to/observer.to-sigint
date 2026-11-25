import { useEffect, useState } from 'react'
import { api, type Account } from './api'
import { clearSession, sessionToken } from './session'
import { Wardrive } from './native/drive'
import { SignInForm } from './SignInForm'

const UPGRADE_DISMISSED = 'observer.upgrade.dismissed'

export function alertLabel(status: string): string {
  if (status === 'active') return 'Weekly alerts are on.'
  if (status === 'none') return 'Weekly alerts are off.'
  return 'Weekly alerts are paused.'
}

export function UpgradeBanner({ account }: { account: Account | null }) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(UPGRADE_DISMISSED) === '1')
  const [emailOpen, setEmailOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (dismissed || account?.alerts.status === 'active') return null

  function dismiss() {
    localStorage.setItem(UPGRADE_DISMISSED, '1')
    setDismissed(true)
  }

  async function upgrade() {
    if (!sessionToken()) {
      setEmailOpen(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      window.location.assign(await api.checkout())
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Billing is unavailable')
      setBusy(false)
    }
  }

  return (
    <aside className="upgrade" role="region" aria-label="Upgrade">
      <p>
        <strong>$5 per month.</strong> One purple-team alert email each week, the same review shown on the Changes tab. Open networks, high-risk public research, site findings, owned-network changes, and what is new since the last review.
      </p>
      <div className="upgrade-side">
        <div className="actions">
          {emailOpen ? (
            <SignInForm action="Send link" />
          ) : (
            <button type="button" onClick={() => void upgrade()} disabled={busy}>
              {busy ? 'Opening…' : 'Upgrade'}
            </button>
          )}
          <button type="button" onClick={dismiss}>Dismiss</button>
        </div>
        {error && <p className="warn">{error}</p>}
      </div>
    </aside>
  )
}

export function AccountBar({ account }: { account: Account }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sessions, setSessions] = useState<{ id: string; client: string; label: string; createdAt: string; lastSeenAt: string }[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [observationDays, setObservationDays] = useState(90)
  const canManage = account.alerts.portal

  useEffect(() => {
    let stop = false
    void Promise.all([api.sessions(), api.retention()]).then(([listed, retention]) => {
      if (stop) return
      setSessions(listed.sessions)
      setCurrent(listed.current)
      setObservationDays(retention.observationDays)
    }).catch(() => undefined)
    return () => {
      stop = true
    }
  }, [account.id])

  async function revoke(id: string) {
    await api.revokeSession(id)
    if (id === current) {
      await signOut()
      return
    }
    const listed = await api.sessions()
    setSessions(listed.sessions)
    setCurrent(listed.current)
  }

  async function revokeAll() {
    await api.revokeAllSessions()
    await signOut()
  }

  async function saveWindow(days: number) {
    const saved = await api.setRetention(days)
    setObservationDays(saved.observationDays)
  }

  async function openPortal() {
    setBusy(true)
    setError('')
    try {
      window.location.assign(await api.portal())
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Billing is unavailable')
      setBusy(false)
    }
  }

  async function signOut() {
    await Wardrive.stopDrive().catch(() => undefined)
    clearSession()
    window.location.assign('/')
  }

  return (
    <div className="account">
      <span>{account.email}</span>
      <span>{alertLabel(account.alerts.status)}</span>
      {canManage && (
        <button type="button" onClick={() => void openPortal()} disabled={busy}>Manage subscription</button>
      )}
      <button type="button" onClick={() => void signOut()}>Sign out</button>
      <label>
        Observation window
        <select aria-label="Observation window" value={observationDays} onChange={(event) => void saveWindow(Number(event.target.value))}>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </label>
      {sessions.length > 0 && (
        <ul className="diff-list">
          {sessions.map((session) => (
            <li key={session.id}>
              {session.label} · {session.client} · last seen {new Date(session.lastSeenAt).toLocaleString()}
              {session.id === current ? ' · this session' : ''}
              <button type="button" onClick={() => void revoke(session.id)}>Revoke</button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => void revokeAll()}>Sign out everywhere</button>
      {error && <p className="warn">{error}</p>}
    </div>
  )
}

export function useAccount(): Account | null {
  const [account, setAccount] = useState<Account | null>(null)
  useEffect(() => {
    if (!sessionToken()) return
    let stop = false
    void api.me().then((next) => {
      if (!stop) setAccount(next)
    }).catch(() => undefined)
    return () => {
      stop = true
    }
  }, [])
  return account
}
