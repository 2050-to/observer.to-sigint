import { useState, type FormEvent } from 'react'
import { api } from './api'

export function AskBox({
  dataset,
  subscribed,
}: {
  dataset: 'dns' | 'wifi' | 'bookmarks' | 'search' | 'browsing'
  subscribed: boolean
}) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      setAnswer(await api.ask(dataset, question))
    } catch (reason: unknown) {
      setAnswer('')
      setError(reason instanceof Error ? reason.message : 'The question could not be answered')
    } finally {
      setBusy(false)
    }
  }

  if (!subscribed) {
    return <p className="note">Questions about this account are part of the $5 monthly plan.</p>
  }

  return (
    <form className="ask" onSubmit={(event) => void submit(event)}>
      <label>
        Ask about this account
        <input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1000} required />
      </label>
      <button type="submit" disabled={busy}>{busy ? 'Asking…' : 'Ask'}</button>
      {error && <p className="warn">{error}</p>}
      {answer && <p className="answer">{answer}</p>}
    </form>
  )
}
