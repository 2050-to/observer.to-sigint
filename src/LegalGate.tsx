import { useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react'
import { api, type LegalDocuments } from './api'
import { SignInForm } from './SignInForm'
import { clearSession, sessionToken } from './session'
import { isAdult } from '../shared/legal'

export function LegalGate({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<LegalDocuments | null>(null)
  const [accepted, setAccepted] = useState<boolean | null>(sessionToken() ? null : false)
  const [termsRead, setTermsRead] = useState(false)
  const [privacyRead, setPrivacyRead] = useState(false)
  const [termsChecked, setTermsChecked] = useState(false)
  const [privacyChecked, setPrivacyChecked] = useState(false)
  const [bornOn, setBornOn] = useState('')
  const [error, setError] = useState('')
  const [refused, setRefused] = useState(false)
  const [busy, setBusy] = useState(false)
  const termsRef = useRef<HTMLElement>(null)
  const privacyRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let stop = false
    void api.legal().then((next) => {
      if (!stop) setDocuments(next)
    }).catch(() => {
      if (!stop) setError('The Terms and Privacy Policy could not be loaded.')
    })
    if (!sessionToken()) return () => { stop = true }
    void api.me().then((account) => {
      if (!stop) setAccepted(account.consent.accepted)
    }).catch(() => {
      if (!stop) setAccepted(false)
    })
    return () => { stop = true }
  }, [])

  useEffect(() => {
    const terms = termsRef.current
    const privacy = privacyRef.current
    if (terms && terms.scrollHeight <= terms.clientHeight + 8) setTermsRead(true)
    if (privacy && privacy.scrollHeight <= privacy.clientHeight + 8) setPrivacyRead(true)
  }, [documents])

  if (accepted && documents) return children
  if (accepted && !documents) {
    return <main><p className="note">Loading the Terms and Privacy Policy.</p></main>
  }

  function markRead(event: UIEvent<HTMLElement>, which: 'terms' | 'privacy') {
    const el = event.currentTarget
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 8) return
    if (which === 'terms') setTermsRead(true)
    else setPrivacyRead(true)
  }

  async function accept() {
    if (!documents) return
    setBusy(true)
    setError('')
    try {
      await api.acceptLegal({
        bornOn,
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

  const signedIn = Boolean(sessionToken())
  const adultDate = isAdult(bornOn)
  const canAccept = Boolean(documents && signedIn && termsRead && privacyRead && termsChecked && privacyChecked && bornOn && !busy)

  return (
    <main className="legal-gate">
      <header>
        <div>
          <p className="eyebrow">Legal purple team</p>
          <h1>Observer.to</h1>
        </div>
      </header>
      <p className="lede">
        Read the Terms of Service and the Privacy Policy to the end. Sign in, confirm you are 18 or older, and accept both before the observer or any stored data opens.
      </p>
      {refused && (
        <section className="confirm" role="alert">
          <div>
            <h2>Observer.to is for adults</h2>
            <p>This date of birth is under 18. The account was deleted and nothing was kept.</p>
          </div>
        </section>
      )}
      {error && <p className="warn">{error}</p>}
      {!documents && !error && <p className="note">Loading the Terms and Privacy Policy.</p>}
      {documents && (
        <div className="legal-columns">
          <section>
            <h2>Terms of Service</h2>
            <article ref={termsRef} className="legal-scroll" tabIndex={0} onScroll={(event) => markRead(event, 'terms')}>
              {documents.terms}
            </article>
            <label>
              <input
                type="checkbox"
                checked={termsChecked}
                disabled={!termsRead}
                onChange={(event) => setTermsChecked(event.target.checked)}
              />
              I have read the Terms of Service
            </label>
          </section>
          <section>
            <h2>Privacy Policy</h2>
            <article ref={privacyRef} className="legal-scroll" tabIndex={0} onScroll={(event) => markRead(event, 'privacy')}>
              {documents.privacy}
            </article>
            <label>
              <input
                type="checkbox"
                checked={privacyChecked}
                disabled={!privacyRead}
                onChange={(event) => setPrivacyChecked(event.target.checked)}
              />
              I have read the Privacy Policy
            </label>
          </section>
        </div>
      )}
      {!signedIn && !refused && (
        <section>
          <h2>Sign in</h2>
          <SignInForm action="Email me a link" />
        </section>
      )}
      {signedIn && !refused && (
        <form className="signin" onSubmit={(event) => { event.preventDefault(); void accept() }}>
          <label>
            Date of birth
            <input type="date" value={bornOn} required onChange={(event) => setBornOn(event.target.value)} />
          </label>
          {bornOn && !adultDate && <p className="warn">Observer.to does not allow accounts for anyone under 18.</p>}
          <button type="submit" disabled={!canAccept}>{busy ? 'Saving…' : 'Accept and continue'}</button>
        </form>
      )}
    </main>
  )
}
