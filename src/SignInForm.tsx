import { FormEvent, useState } from 'react'
import { api } from './api'

export function SignInForm({ action = 'Start free' }: { action?: string }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.requestLink(email)
      setSent(true)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The sign-in email could not be sent')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return <p className="note">Check your email for a sign-in link. It expires in 15 minutes and works once.</p>
  }

  return (
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
      {error && <p className="warn">{error}</p>}
    </form>
  )
}
