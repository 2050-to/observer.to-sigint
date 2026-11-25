import { useEffect, useState } from 'react'
import type { Disposition, DispositionKind, DispositionStatus } from '../../shared/disposition'
import type { ReviewRadio, WeeklyReview } from '../../shared/review'
import { api } from '../api'
import { DispositionControl } from '../DispositionControl'
import { sessionToken } from '../session'

export function ChangesView({
  dispositions,
  onDisposition,
  onOpen,
}: {
  dispositions: Disposition[]
  onDisposition: (kind: DispositionKind, id: string, status: DispositionStatus | null, note: string) => Promise<void>
  onOpen: (radio: ReviewRadio) => void
}) {
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [history, setHistory] = useState<{ id: string; builtAt: string }[]>([])
  const [builtAt, setBuiltAt] = useState<string | null>(null)
  const [digest, setDigest] = useState<WeeklyReview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const signedIn = Boolean(sessionToken())

  async function load(id?: string) {
    const [review, reviews] = await Promise.all([api.review(id), api.reviews()])
    setHistory(reviews)
    setReviewId(review.id ?? id ?? reviews[0]?.id ?? null)
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
      setReviewId(review.id)
      setBuiltAt(review.builtAt)
      setDigest(review.digest)
      setHistory(await api.reviews())
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
        <div className="actions">
          <button type="button" onClick={() => void build()} disabled={busy}>{busy ? 'Building…' : digest ? 'Build again' : 'Build review'}</button>
          {reviewId && (
            <>
              <button type="button" onClick={() => void download(reviewId, 'md')}>Download review</button>
              <button type="button" onClick={() => void download(reviewId, 'csv')}>Download radios</button>
            </>
          )}
        </div>
      </div>
      {history.length > 1 && (
        <label>
          Stored reviews
          <select aria-label="Stored reviews" value={reviewId ?? ''} onChange={(event) => void load(event.target.value)}>
            {history.map((row) => <option key={row.id} value={row.id}>{new Date(row.builtAt).toLocaleString()}</option>)}
          </select>
        </label>
      )}
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
          {(digest.newRadios ?? []).map((radio) => (
            <p key={`${radio.kind}:${radio.id}`}>
              <button type="button" onClick={() => onOpen(radio)}>{radio.label}</button>
              {' '}{radio.kind} · first seen {new Date(radio.firstSeen).toLocaleString()}
            </p>
          ))}
          {(digest.newRadioRemainder ?? 0) > 0 && <p className="note">{digest.newRadioRemainder} more new radios are in the download.</p>}
          <ReviewList title="Walks due" rows={(digest.overdueWalks ?? []).map((row) => `${row.site} due ${new Date(row.dueAt).toLocaleDateString()}`)} />
          <ReviewList title="Site findings" rows={(digest.siteFindings ?? []).map((row) => `${row.site}: ${row.label}`)} />
          <ReviewList title="Site events" rows={(digest.siteEvents ?? []).map((row) => `${row.site}: ${row.label}`)} />
          <ReviewList title="Owned-network changes" rows={(digest.ownedChanges ?? []).map((row) => row.text)} />
        </>
      )}
    </section>
  )
}

async function download(id: string, kind: 'md' | 'csv') {
  const blob = await api.reviewFile(id, kind)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = kind === 'md' ? 'review.md' : 'review.csv'
  link.click()
  URL.revokeObjectURL(url)
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
