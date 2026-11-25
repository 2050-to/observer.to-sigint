import { useEffect, useState } from 'react'
import type { Disposition, DispositionKind, DispositionStatus } from '../../shared/disposition'
import type { WeeklyReview } from '../../shared/review'
import { api } from '../api'
import { DispositionControl } from '../DispositionControl'
import { sessionToken } from '../session'

export function ChangesView({
  dispositions,
  onDisposition,
}: {
  dispositions: Disposition[]
  onDisposition: (kind: DispositionKind, id: string, status: DispositionStatus | null, note: string) => Promise<void>
}) {
  const [builtAt, setBuiltAt] = useState<string | null>(null)
  const [digest, setDigest] = useState<WeeklyReview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const signedIn = Boolean(sessionToken())

  async function load() {
    const review = await api.review()
    setBuiltAt(review.builtAt)
    setDigest(review.digest)
  }

  useEffect(() => {
    if (!signedIn) return
    void load().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'The review could not be loaded')
    })
  }, [signedIn])

  async function build() {
    setBusy(true)
    setError('')
    try {
      const review = await api.buildReview()
      setBuiltAt(review.builtAt)
      setDigest(review.digest)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The review could not be built')
    } finally {
      setBusy(false)
    }
  }

  if (!signedIn) {
    return <section className="card"><h2>Changes</h2><p>Sign in to see the weekly review.</p></section>
  }

  return (
    <section className="card">
      <div className="log-head">
        <div>
          <h2>Changes</h2>
          <p>{builtAt ? `Built ${new Date(builtAt).toLocaleString()}.` : 'No review has been stored yet.'}</p>
        </div>
        <button type="button" onClick={() => void build()} disabled={busy}>{busy ? 'Building…' : digest ? 'Build again' : 'Build review'}</button>
      </div>
      {error && <p className="warn">{error}</p>}
      {digest && (
        <>
          <ReviewList title="Open networks" rows={digest.openNetworks.map((row) => `${row.name} (${row.security})`)} />
          <h2>High risk from public research</h2>
          {digest.highRisk.length === 0 && <p className="empty">None</p>}
          {digest.highRisk.map((row) => (
            <div key={`${row.kind}:${row.id}:${row.name}`}>
              <p>{row.name}: {row.reason}{row.status === 'verified' ? ' (verified)' : ''}</p>
              {row.kind && row.id && (
                <DispositionControl
                  kind={row.kind}
                  id={row.id}
                  disposition={dispositions.find((item) => item.kind === row.kind && item.id === row.id) ?? null}
                  onSave={onDisposition}
                />
              )}
            </div>
          ))}
          <h2>New since the previous review</h2>
          <ul className="diff-list">
            <li>Access points: {digest.newAccessPoints}</li>
            <li>Bluetooth advertisers: {digest.newAdvertisers}</li>
            <li>Towers: {digest.newCells}</li>
          </ul>
          <ReviewList title="Site findings" rows={(digest.siteFindings ?? []).map((row) => `${row.site}: ${row.label}`)} />
          <ReviewList title="Site events" rows={(digest.siteEvents ?? []).map((row) => `${row.site}: ${row.label}`)} />
          <ReviewList title="Owned-network changes" rows={(digest.ownedChanges ?? []).map((row) => row.text)} />
        </>
      )}
    </section>
  )
}

function ReviewList({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div>
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="empty">None</p> : (
        <ul className="diff-list">{rows.map((row) => <li key={row}>{row}</li>)}</ul>
      )}
    </div>
  )
}
