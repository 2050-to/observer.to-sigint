import { useEffect, useState, type ReactNode } from 'react'
import { api, type LegalDocuments } from './api'
import { SignInForm } from './SignInForm'
import { clearSession, sessionToken } from './session'
import { isAdult } from '../shared/legal'

export function LegalGate({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<LegalDocuments | null>(null)
  const [accepted, setAccepted] = useState<boolean | null>(sessionToken() ? null : false)
  const [storedBornOn, setStoredBornOn] = useState<string | null>(null)
  const [bornOn, setBornOn] = useState('')
  const [error, setError] = useState('')
  const [refused, setRefused] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!sessionToken()) return
    let stop = false
    void api.me().then((account) => {
      if (stop) return
      setAccepted(account.consent.accepted)
      setStoredBornOn(account.consent.bornOn)
      if (account.consent.bornOn) setBornOn(account.consent.bornOn)
    }).catch(() => {
      if (!stop) setAccepted(false)
    })
    return () => { stop = true }
  }, [])

  useEffect(() => {
    if (accepted !== false || !sessionToken()) return
    let stop = false
    void api.legal().then((next) => {
      if (!stop) setDocuments(next)
    }).catch(() => {
      if (!stop) setError('The Terms and Privacy Policy could not be loaded.')
    })
    return () => { stop = true }
  }, [accepted])

  if (accepted) return children
  if (!sessionToken() || refused) {
    return (
      <main className="legal-gate">
        <header>
          <div>
            <p className="eyebrow">Legal purple team</p>
            <h1>Observer.to</h1>
          </div>
        </header>
        <p className="lede">Sign in with your email.</p>
        {refused && (
          <section className="confirm" role="alert">
            <div>
              <h2>Observer.to is for adults</h2>
              <p>This date of birth is under 18. The account was deleted and nothing was kept.</p>
            </div>
          </section>
        )}
        {error && <p className="warn">{error}</p>}
        {!refused && <SignInForm action="Email me a link" />}
      </main>
    )
  }
  if (accepted === null) {
    return <main><p className="note">Checking this account.</p></main>
  }

  const knownAdult = Boolean(storedBornOn && isAdult(storedBornOn))
  const adultDate = isAdult(bornOn)
  const canAccept = Boolean(documents && !busy && (knownAdult || adultDate))

  async function accept() {
    if (!documents) return
    const date = knownAdult && storedBornOn ? storedBornOn : bornOn
    setBusy(true)
    setError('')
    try {
      await api.acceptLegal({
        bornOn: date,
        tosVersion: documents.tosVersion,
        privacyVersion: documents.privacyVersion,
      })
      setAccepted(true)
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : 'The acceptance could not be saved'
      if (message === 'age restricted') {
        clearSession()
        setRefused(true)
        setAccepted(false)
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="legal-gate">
      <header>
        <div>
          <p className="eyebrow">Legal purple team</p>
          <h1>Observer.to</h1>
        </div>
      </header>
      <p className="lede">
        {knownAdult
          ? 'The Terms of Service or the Privacy Policy has changed. Read both, then accept to continue.'
          : 'Read the Terms of Service and the Privacy Policy. Enter your date of birth, then accept to open the observer.'}
      </p>
      {error && <p className="warn">{error}</p>}
      {!documents && !error && <p className="note">Loading the Terms and Privacy Policy.</p>}
      {documents && (
        <div className="legal-columns">
          <section>
            <h2>Terms of Service</h2>
            <article className="legal-scroll" tabIndex={0}>{documents.terms}</article>
          </section>
          <section>
            <h2>Privacy Policy</h2>
            <article className="legal-scroll" tabIndex={0}>{documents.privacy}</article>
          </section>
        </div>
      )}
      <form className="signin" onSubmit={(event) => { event.preventDefault(); void accept() }}>
        {!knownAdult && (
          <label>
            Date of birth
            <input type="date" value={bornOn} required onChange={(event) => setBornOn(event.target.value)} />
          </label>
        )}
        {bornOn && !knownAdult && !adultDate && <p className="warn">Observer.to does not allow accounts for anyone under 18.</p>}
        <button type="submit" disabled={!canAccept}>{busy ? 'Saving…' : 'Accept and continue'}</button>
      </form>
    </main>
  )
}
