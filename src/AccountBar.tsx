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
        <strong>$5 per month.</strong> One purple-team alert email each week. Open networks, high-risk public research, and what is new since the last review.
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
  const canManage = account.alerts.status !== 'none'

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
