import { postalLabel } from '../../shared/postal'
import type { SignalRow } from '../../shared/sources'
import { SignalLegend, SignalStack } from '../SignalStack'
import type { OpenRow } from '../types'

export function OpenList({
  rows,
  onShow,
  nameFor,
  draftFor,
  rename,
}: {
  rows: OpenRow[]
  onShow: (row: OpenRow) => void
  nameFor: (id: string, fallback: string) => string
  draftFor: (id: string, fallback: string) => string
  rename: (id: string, value: string) => void
}) {
  if (rows.length === 0) return <p className="empty">No open or Enhanced Open networks saved yet.</p>
  return (
    <div className="panel">
      <SignalLegend />
      <ul className="open-list">
        {rows.map((row) => {
          const id = row.hidden ? row.bssids[0] : `ssid:${row.ssid}`
          const signals: SignalRow[] = [{ kind: 'wifi', title: row.label, detail: `${row.bestRssi} dBm · ${row.bssidCount} radio${row.bssidCount === 1 ? '' : 's'}` }]
          if (row.lat != null && row.lon != null) signals.push({ kind: 'gps', title: 'Fix', detail: `${row.lat.toFixed(5)}, ${row.lon.toFixed(5)}` })
          return (
            <li key={id}>
              <SignalStack id={id} fallback={row.label} signals={signals} draftFor={draftFor} rename={rename} />
              <p>{row.security === 'owe' ? 'Enhanced Open' : 'Open'} · channels {row.channels.join(', ') || 'unknown'}</p>
              <p>{row.address ?? 'Open a place card on the map to save an address.'}</p>
              {row.elevationM != null && <p>Ground elevation {row.elevationM.toFixed(1)} m (Open-Meteo)</p>}
              {postalLabel(row.postalCodes) && <p>{postalLabel(row.postalCodes)}</p>}
              {row.floor != null && <p>Floor {row.floor}</p>}
              {row.lat != null && row.lon != null && (
                <button type="button" onClick={() => onShow({ ...row, label: nameFor(id, row.label) })}>Show on map</button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
