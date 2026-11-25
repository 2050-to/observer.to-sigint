import { useEffect, useState } from 'react'
import { dispositionLabel, type Disposition, type DispositionKind, type DispositionStatus } from '../shared/disposition'

export function DispositionControl({
  kind,
  id,
  disposition,
  onSave,
}: {
  kind: DispositionKind
  id: string
  disposition: Disposition | null
  onSave: (kind: DispositionKind, id: string, status: DispositionStatus | null, note: string) => Promise<void>
}) {
  const [status, setStatus] = useState<DispositionStatus | ''>(disposition?.status ?? '')
  const [note, setNote] = useState(disposition?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setStatus(disposition?.status ?? '')
    setNote(disposition?.note ?? '')
  }, [disposition?.status, disposition?.note, id])

  async function save() {
    setBusy(true)
    setError('')
    try {
      await onSave(kind, id, status || null, note.trim())
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The disposition could not be saved')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="disposition">
      <label>
        Disposition
        <select aria-label={`Disposition for ${id}`} value={status} onChange={(event) => setStatus(event.target.value as DispositionStatus | '')}>
          <option value="">Open</option>
          <option value="verified">{dispositionLabel('verified')}</option>
          <option value="false_match">{dispositionLabel('false_match')}</option>
          <option value="patched">{dispositionLabel('patched')}</option>
          <option value="accepted">{dispositionLabel('accepted')}</option>
        </select>
      </label>
      <input
        aria-label={`Note for ${id}`}
        value={note}
        maxLength={2000}
        placeholder="Note"
        onChange={(event) => setNote(event.target.value)}
      />
      <button type="button" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      {error && <p className="warn">{error}</p>}
    </div>
  )
}
