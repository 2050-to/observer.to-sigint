import { useEffect, useRef, useState, type FormEvent } from 'react'
import { presenceKey, type PresenceHit } from '../shared/presence'
import { api } from './api'

export type AskDataset = 'wifi' | 'account'

const DATASET_NAME: Record<AskDataset, string> = {
  wifi: 'Networks',
  account: 'Records',
}

const DATASET_RECORDS: Record<AskDataset, string> = {
  wifi: 'networks',
  account: 'records',
}

type RailSize = 'min' | 'normal' | 'max'

type Turn = {
  id: string
  dataset: AskDataset
  source: string
  question: string
  answer: string
  excerpt: string
}

export function AskBox({
  dataset,
  subscribed,
  layout = 'inline',
  scope,
  source,
  arrivals = [],
  onDismissArrivals,
}: {
  dataset: AskDataset
  subscribed: boolean
  layout?: 'inline' | 'rail'
  scope?: string
  source?: string
  arrivals?: PresenceHit[]
  onDismissArrivals?: () => void
}) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [size, setSize] = useState<RailSize>('normal')
  const transcript = useRef<HTMLDivElement>(null)
  const rail = layout === 'rail'
  const scopeText = scope ?? `your ${DATASET_RECORDS[dataset]}`
  const sourceText = source ?? DATASET_NAME[dataset]

  useEffect(() => {
    if (!subscribed) return
    let stop = false
    void api.questions().then((rows) => {
      if (stop) return
      setTurns(rows.map((row) => ({
        id: row.id,
        dataset,
        source: sourceText,
        question: row.question,
        answer: row.answer,
        excerpt: row.excerpt,
      })))
    }).catch(() => undefined)
    return () => {
      stop = true
    }
  }, [subscribed, dataset, sourceText])

  useEffect(() => {
    const node = transcript.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [turns])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const askedDataset = dataset
    const asked = question
    setBusy(true)
    setError('')
    try {
      const reply = await api.ask(askedDataset, asked)
      if (rail) {
        setTurns((current) => [...current, {
          id: reply.id,
          dataset: askedDataset,
          source: sourceText,
          question: asked.trim(),
          answer: reply.answer,
          excerpt: reply.excerpt,
        }])
        setQuestion('')
      } else {
        setAnswer(reply.answer)
      }
    } catch (reason: unknown) {
      if (!rail) setAnswer('')
      setError(reason instanceof Error ? reason.message : 'The question could not be answered')
    } finally {
      setBusy(false)
    }
  }

  const form = (
    <form className="ask" onSubmit={(event) => void submit(event)}>
      {rail && <p className="ask-scope">Next question uses {scopeText}.</p>}
      <label>
        Ask about this account
        <input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1000} required />
      </label>
      <button type="submit" disabled={busy}>{busy ? 'Asking…' : 'Ask'}</button>
      {error && <p className="warn">{error}</p>}
      {!rail && answer && <p className="answer">{answer}</p>}
    </form>
  )

  if (!rail) {
    if (!subscribed) return <p className="note">Questions about this account are part of the $5 monthly plan.</p>
    return form
  }

  const controls = (
    <div className="ask-rail-controls">
      <button
        type="button"
        aria-pressed={size === 'min'}
        onClick={() => setSize((current) => current === 'min' ? 'normal' : 'min')}
      >
        {size === 'min' ? 'Restore' : 'Minimize'}
      </button>
      <button
        type="button"
        aria-pressed={size === 'max'}
        onClick={() => setSize((current) => current === 'max' ? 'normal' : 'max')}
      >
        {size === 'max' ? 'Restore' : 'Maximize'}
      </button>
    </div>
  )

  return (
    <aside className={`ask-rail ${size}`} aria-label="Ask about this account" aria-expanded={size !== 'min'}>
      <div className="ask-rail-bar">
        {size !== 'min' && <strong className="ask-source">{sourceText}</strong>}
        {controls}
      </div>
      {arrivals.length > 0 && size === 'min' && (
        <button type="button" className="ask-presence-min" onClick={() => setSize('normal')}>
          {arrivals.length} new
        </button>
      )}
      {arrivals.length > 0 && size !== 'min' && (
        <div className="prompt presence-dialog" role="dialog" aria-labelledby="presence-title">
          <div className="presence-heading">
            <h3 id="presence-title">New in range</h3>
            <button type="button" onClick={() => onDismissArrivals?.()}>Dismiss</button>
          </div>
          <ul className="diff-list">
            {arrivals.map((hit) => (
              <li key={presenceKey(hit)}>{hit.kind === 'ap' ? 'Wi-Fi' : 'Bluetooth'} · {hit.label}</li>
            ))}
          </ul>
        </div>
      )}
      {size !== 'min' && (subscribed ? (
        <>
          <div className="ask-transcript" ref={transcript}>
            {turns.map((turn) => (
              <article key={turn.id} className="ask-turn">
                <p className="ask-dataset">{turn.source}</p>
                <p className="ask-question">{turn.question}</p>
                <p className="answer">{turn.answer}</p>
                {turn.excerpt && <p className="note">Records used: {turn.excerpt}</p>}
              </article>
            ))}
          </div>
          {form}
        </>
      ) : <p className="note">Questions about this account are part of the $5 monthly plan.</p>)}
    </aside>
  )
}
