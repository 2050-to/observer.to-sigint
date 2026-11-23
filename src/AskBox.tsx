import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from './api'

export type AskDataset = 'wifi' | 'search' | 'browsing'

const DATASET_NAME: Record<AskDataset, string> = {
  wifi: 'Networks',
  search: 'Search history',
  browsing: 'Browsing history',
}

const DATASET_RECORDS: Record<AskDataset, string> = {
  wifi: 'networks',
  search: 'search history',
  browsing: 'browsing history',
}

type Turn = {
  id: number
  dataset: AskDataset
  question: string
  answer: string
}

export function AskBox({
  dataset,
  subscribed,
  layout = 'inline',
}: {
  dataset: AskDataset
  subscribed: boolean
  layout?: 'inline' | 'rail'
}) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const turnId = useRef(0)
  const transcript = useRef<HTMLDivElement>(null)
  const rail = layout === 'rail'

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
        const id = turnId.current
        turnId.current += 1
        setTurns((current) => [...current, { id, dataset: askedDataset, question: asked.trim(), answer: reply }])
        setQuestion('')
      } else {
        setAnswer(reply)
      }
    } catch (reason: unknown) {
      if (!rail) setAnswer('')
      setError(reason instanceof Error ? reason.message : 'The question could not be answered')
    } finally {
      setBusy(false)
    }
  }

  if (!subscribed) {
    const note = <p className="note">Questions about this account are part of the $5 monthly plan.</p>
    if (!rail) return note
    return <aside className="ask-rail" aria-label="Ask about this account">{note}</aside>
  }

  const form = (
    <form className="ask" onSubmit={(event) => void submit(event)}>
      {rail && <p className="ask-scope">Next question uses your {DATASET_RECORDS[dataset]}.</p>}
      <label>
        Ask about this account
        <input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1000} required />
      </label>
      <button type="submit" disabled={busy}>{busy ? 'Asking…' : 'Ask'}</button>
      {error && <p className="warn">{error}</p>}
      {!rail && answer && <p className="answer">{answer}</p>}
    </form>
  )

  if (!rail) return form

  return (
    <aside className="ask-rail" aria-label="Ask about this account">
      <div className="ask-transcript" ref={transcript}>
        {turns.map((turn) => (
          <article key={turn.id} className="ask-turn">
            <p className="ask-dataset">{DATASET_NAME[turn.dataset]}</p>
            <p className="ask-question">{turn.question}</p>
            <p className="answer">{turn.answer}</p>
          </article>
        ))}
      </div>
      {form}
    </aside>
  )
}
