import { useState } from 'react'
import type { CheckResult, CheckStatus, Finding, HostScanReport } from '../../shared/hostScan'

const STATUS_LABEL: Record<CheckStatus, string> = {
  clear: 'Clear',
  review: 'Review',
  unavailable: 'Could not run',
}

export function HostScan() {
  const [report, setReport] = useState<HostScanReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function scan() {
    const run = window.wifiMapping?.security?.scan
    if (!run) {
      setError('This scan runs in the Observer Mac app.')
      return
    }
    setBusy(true)
    setError('')
    try {
      setReport(await run())
    } catch (reason: unknown) {
      const raw = reason instanceof Error ? reason.message : 'The scan could not finish.'
      setError(raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ''))
    } finally {
      setBusy(false)
    }
  }

  const suspicious = report ? findings(report, 'suspicious') : []
  const review = report ? findings(report, 'review') : []
  const unread = report ? report.checks.filter((item) => item.status === 'unavailable') : []

  return (
    <section className="card host-scan">
      <div className="log-head">
        <div>
          <h2>This Mac</h2>
          <p>This scan looks for common persistence and weakened security settings on this Mac. It does not remove files or change settings.</p>
        </div>
        <button type="button" onClick={() => void scan()} disabled={busy}>{busy ? 'Scanning…' : 'Scan this Mac'}</button>
      </div>
      {error && <p className="warn">{error}</p>}
      {report && (
        <>
          <p>Scanned {new Date(report.scannedAt).toLocaleString()} on {report.hostname}.</p>
          <h3>Suspicious</h3>
          {suspicious.length === 0 ? <p>No suspicious startup items or extensions were found.</p> : <FindingList items={suspicious} />}
          <h3>Review</h3>
          {review.length === 0 ? <p>No third-party startup items or weakened settings were found.</p> : <FindingList items={review} />}
          <h3>Could not run</h3>
          {unread.length === 0 ? <p>Every check ran.</p> : (
            <ul className="diff-list">
              {unread.map((item) => (
                <li key={item.id}>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </li>
              ))}
            </ul>
          )}
          <h3>All checks</h3>
          <ul className="diff-list">
            {report.checks.map((item) => <CheckRow key={item.id} check={item} />)}
          </ul>
        </>
      )}
    </section>
  )
}

function FindingList({ items }: { items: Finding[] }) {
  return (
    <ul className="diff-list">
      {items.map((item) => (
        <li key={item.id}>
          <strong>{item.path}</strong>
          <p>{item.reason}</p>
        </li>
      ))}
    </ul>
  )
}

function CheckRow({ check }: { check: CheckResult }) {
  return (
    <li>
      <strong>{check.label}</strong>
      <span> {STATUS_LABEL[check.status]}</span>
      <p>{check.detail}</p>
    </li>
  )
}

function findings(report: HostScanReport, severity: Finding['severity']): Finding[] {
  return report.checks.flatMap((check) => check.findings.filter((item) => item.severity === severity))
}
