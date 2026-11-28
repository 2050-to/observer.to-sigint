import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { api } from './api'
import { clearDemo } from './demo'
import { setSession } from './session'

function clientKind(): 'web' | 'mac' | 'android' {
  if (window.wifiMapping) return 'mac'
  if (Capacitor.getPlatform() === 'android') return 'android'
  return 'web'
}

const pending = new Map<string, Promise<{ token: string; email: string }>>()

function verifyOnce(token: string): Promise<{ token: string; email: string }> {
  const existing = pending.get(token)
  if (existing) return existing
  const promise = api.verify(token, clientKind())
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
      clearDemo()
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
