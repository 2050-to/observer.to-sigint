import { useEffect, useState } from 'react'
import {
  SECURITY_CHECKS,
  checkFor,
  shouldAttempt,
  type MacSecurityApplyResult,
  type SecurityReading,
} from '../../shared/macSecurity'

export function MacSecurity() {
  const [readings, setReadings] = useState<SecurityReading[] | null>(null)
  const [report, setReport] = useState<MacSecurityApplyResult['report'] | null>(null)
  const [adminNote, setAdminNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let stop = false
    void readChecklist().then((rows) => {
      if (!stop) setReadings(rows)
    }).catch((reason: unknown) => {
      if (!stop) setError(plainError(reason, 'The checklist could not be read.'))
    })
    return () => {
      stop = true
    }
  }, [])

  async function apply() {
    const run = window.wifiMapping?.security?.apply
    if (!run) {
      setError('This checklist runs in the Observer Mac app.')
      return
    }
    setBusy(true)
    setError('')
    setAdminNote('')
    try {
      const result = await run()
      setReadings(result.readings)
      setReport(result.report)
      setAdminNote(result.adminNote ?? '')
    } catch (reason: unknown) {
      setError(plainError(reason, 'The settings could not be applied.'))
    } finally {
      setBusy(false)
    }
  }

  const ready = readings != null
  const canApply = ready && readings.some(shouldAttempt)

  return (
    <section className="card host-scan">
      <div className="log-head">
        <div>
          <h2>Security checklist</h2>
          <p>Apply secure settings changes the listed settings on this Mac. A setting that is already stricter is left as it is. Wi-Fi and Bluetooth stay on.</p>
        </div>
        <button type="button" onClick={() => void apply()} disabled={busy || !canApply}>
          {busy ? 'Applying…' : 'Apply secure settings'}
        </button>
      </div>
      {error && <p className="warn">{error}</p>}
      {adminNote && <p className="note">{adminNote}</p>}
      {!ready && !error && <p>Reading this Mac.</p>}
      {report && <Report report={report} />}
      {readings && (
        <>
          <h3>Checklist</h3>
          <ul className="diff-list">
            {SECURITY_CHECKS.map((check) => {
              const reading = readings.find((row) => row.id === check.id)
              return <CheckRow key={check.id} id={check.id} reading={reading} />
            })}
          </ul>
        </>
      )}
    </section>
  )
}

async function readChecklist(): Promise<SecurityReading[]> {
  const read = window.wifiMapping?.security?.read
  if (!read) throw new Error('This checklist runs in the Observer Mac app.')
  return read()
}

function Report({ report }: { report: MacSecurityApplyResult['report'] }) {
  return (
    <>
      <h3>Now more secure</h3>
      {report.improved.length === 0 ? <p>No setting moved to a stricter value.</p> : <SentenceList rows={report.improved} />}
      <h3>Already secure</h3>
      {report.alreadySecure.length === 0 ? <p>No setting was already at the secure value.</p> : <SentenceList rows={report.alreadySecure} />}
      <h3>Still open</h3>
      {report.stillOpen.length === 0 ? <p>Every listed setting is at the secure value.</p> : (
        <ul className="diff-list">
          {report.stillOpen.map((row) => {
            const check = checkFor(row.id)
            return (
              <li key={row.id}>
                <strong>{check.title}</strong>
                <p>{row.value}</p>
                {check.privilege === 'none' && <p>{check.detail}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function SentenceList({ rows }: { rows: SecurityReading[] }) {
  return (
    <ul className="diff-list">
      {rows.map((row) => (
        <li key={row.id}>{checkFor(row.id).secureSentence}</li>
      ))}
    </ul>
  )
}

function CheckRow({ id, reading }: { id: SecurityReading['id']; reading: SecurityReading | undefined }) {
  const check = checkFor(id)
  const current = reading ?? { id, secure: null, strictness: null, value: 'Could not read' }
  return (
    <li>
      <strong>{check.title}</strong>
      <span> {statusLabel(check.privilege, current)}</span>
      <p>{check.detail}</p>
      <p>{current.value}</p>
    </li>
  )
}

function statusLabel(privilege: 'user' | 'admin' | 'none', reading: SecurityReading): string {
  if (reading.secure == null) return 'Could not read'
  if (reading.secure) return 'Secure'
  if (privilege === 'none') return 'Not changed by this button'
  return 'Will change'
}

function plainError(reason: unknown, fallback: string): string {
  const raw = reason instanceof Error ? reason.message : fallback
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
}
