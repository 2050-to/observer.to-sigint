import { useEffect, useMemo, useState } from 'react'
import { api, type DnsQuery } from '../api'
import { AskBox } from '../AskBox'

function localDay(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function dayRange(day: string): { from: string; to: string } | null {
  const start = new Date(`${day}T00:00:00`)
  if (Number.isNaN(start.getTime())) return null
  return { from: start.toISOString(), to: new Date(start.getTime() + 86_400_000).toISOString() }
}

export function DnsView({ subscribed }: { subscribed: boolean }) {
  const [day, setDay] = useState(localDay)
  const [hour, setHour] = useState<number | null>(null)
  const [minute, setMinute] = useState<number | null>(null)
  const [queries, setQueries] = useState<DnsQuery[]>([])
  const [error, setError] = useState('')
  const [capture, setCapture] = useState('')

  useEffect(() => {
    const range = dayRange(day)
    if (!range) return
    let stop = false
    setError('')
    void api.dns(range.from, range.to).then((rows) => {
      if (!stop) setQueries(rows)
    }).catch((reason: unknown) => {
      if (!stop) setError(reason instanceof Error ? reason.message : 'The DNS log could not be loaded')
    })
    return () => { stop = true }
  }, [day])

  useEffect(() => {
    const bridge = window.wifiMapping?.wardrive
    if (!bridge?.dnsStatus) return
    let stop = false
    const read = () => {
      void bridge.dnsStatus().then((status) => {
        if (!stop) setCapture(status.message)
      }).catch(() => undefined)
    }
    read()
    const timer = window.setInterval(read, 4000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [])

  const hours = useMemo(() => counts(queries, (query) => new Date(query.observedAt).getHours(), 24), [queries])
  const minutes = useMemo(() => {
    if (hour == null) return []
    const inHour = queries.filter((query) => new Date(query.observedAt).getHours() === hour)
    return counts(inHour, (query) => new Date(query.observedAt).getMinutes(), 60)
  }, [queries, hour])
  const visible = queries.filter((query) => {
    const when = new Date(query.observedAt)
    if (hour != null && when.getHours() !== hour) return false
    if (minute != null && when.getMinutes() !== minute) return false
    return true
  })

  return (
    <section className="panel">
      <p className="disclaimer">
        This log is DNS lookups from this account's Mac. It does not include other devices, and encrypted DNS does not appear.
      </p>
      {capture && <p className="note">{capture}</p>}
      <form className="signin" onSubmit={(event) => event.preventDefault()}>
        <label>
          Day
          <input type="date" value={day} onChange={(event) => { setDay(event.target.value); setHour(null); setMinute(null) }} />
        </label>
      </form>
      <div className="actions">
        {hours.map((bucket) => (
          <button
            key={bucket.index}
            type="button"
            className={hour === bucket.index ? 'active' : ''}
            onClick={() => { setHour(bucket.index); setMinute(null) }}
          >
            {String(bucket.index).padStart(2, '0')}:00 ({bucket.count})
          </button>
        ))}
      </div>
      {hour != null && (
        <div className="actions">
          {minutes.filter((bucket) => bucket.count > 0).map((bucket) => (
            <button
              key={bucket.index}
              type="button"
              className={minute === bucket.index ? 'active' : ''}
              onClick={() => setMinute(bucket.index)}
            >
              :{String(bucket.index).padStart(2, '0')} ({bucket.count})
            </button>
          ))}
        </div>
      )}
      {error && <p className="warn">{error}</p>}
      {visible.length === 0 ? <p className="empty">No DNS lookups in this window.</p> : (
        <table>
          <thead>
            <tr><th>Time</th><th>Type</th><th>Name</th></tr>
          </thead>
          <tbody>
            {visible.map((query) => (
              <tr key={`${query.observedAt}:${query.name}:${query.type}`}>
                <td>{new Date(query.observedAt).toLocaleTimeString()}</td>
                <td>{query.type}</td>
                <td>{query.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AskBox dataset="dns" subscribed={subscribed} />
    </section>
  )
}

function counts(queries: DnsQuery[], pick: (query: DnsQuery) => number, size: number): { index: number; count: number }[] {
  const buckets = Array.from({ length: size }, (_, index) => ({ index, count: 0 }))
  for (const query of queries) {
    const index = pick(query)
    if (buckets[index]) buckets[index].count += 1
  }
  return buckets
}
