import { FormEvent, useState } from 'react'
import { api } from './api'

function macApp(): boolean {
  return typeof window !== 'undefined' && window.wifiMapping != null
}

export function SignInForm({ action = 'Start free', onDemo }: { action?: string; onDemo?: () => void }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.requestLink(email, macApp() ? 'mac' : undefined)
      setSent(true)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The sign-in email could not be sent')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="signin-block">
        <p className="note">
          Check your email for a sign-in link. It expires in 15 minutes and works once.
          {macApp() ? ' On this Mac, the link opens Observer.to.' : ''}
        </p>
        <Agreement />
      </div>
    )
  }

  return (
    <div className="signin-block">
      <form className="signin" onSubmit={(event) => void submit(event)}>
        <label>
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>{busy ? 'Sending…' : action}</button>
        {onDemo && <button type="button" onClick={onDemo}>Try demo</button>}
        {error && <p className="warn">{error}</p>}
      </form>
      <Agreement />
    </div>
  )
}

function Agreement() {
  return (
    <p className="note">
      Signing in agrees to the <a href="https://observer.to/terms">Terms of Service</a> and <a href="https://observer.to/privacy">Privacy Policy</a>.
    </p>
  )
}
