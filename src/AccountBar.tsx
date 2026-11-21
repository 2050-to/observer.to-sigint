import { useEffect, useState } from 'react'
import { api, type Account } from './api'
import { clearSession, sessionToken } from './session'
import { Wardrive } from './native/drive'

export function alertLabel(status: string): string {
  if (status === 'active') return 'Monthly alerts are on.'
  if (status === 'none') return 'Monthly alerts are off.'
  return 'Monthly alerts are paused.'
}

export function AccountBar({ account }: { account: Account }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = account.alerts.status === 'active'
  const canManage = account.alerts.status !== 'none'

  async function openBilling(kind: 'checkout' | 'portal') {
    setBusy(true)
    setError('')
    try {
      const url = kind === 'checkout' ? await api.checkout() : await api.portal()
      window.location.assign(url)
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
      {active || canManage ? (
        <button type="button" onClick={() => void openBilling('portal')} disabled={busy}>Manage subscription</button>
      ) : null}
      {!active && (
        <button type="button" onClick={() => void openBilling('checkout')} disabled={busy}>Subscribe, $5/month</button>
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
