import { useEffect, useState } from 'react'
import { api } from './api'
import { setSession } from './session'

const pending = new Map<string, Promise<{ token: string; email: string }>>()

function verifyOnce(token: string): Promise<{ token: string; email: string }> {
  const existing = pending.get(token)
  if (existing) return existing
  const promise = api.verify(token)
  pending.set(token, promise)
  promise.catch(() => pending.delete(token))
  return promise
}

export function Verify() {
  const [message, setMessage] = useState('Signing in…')

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') ?? ''
    if (!token) {
      setMessage('This sign-in link is missing a token.')
      return
    }
    let stop = false
    void verifyOnce(token).then((session) => {
      if (stop) return
      setSession(session.token)
      window.location.assign('/app')
    }).catch(() => {
      if (!stop) setMessage('This sign-in link is invalid or expired.')
    })
    return () => {
      stop = true
    }
  }, [])

  return (
    <main className="home">
      <header>
        <div>
          <p className="eyebrow">Legal purple team</p>
          <h1>Observer.to</h1>
        </div>
      </header>
      <p className="lede">{message}</p>
    </main>
  )
}
