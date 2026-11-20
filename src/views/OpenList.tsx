import type { OpenRow } from '../types'

export function OpenList({
  rows,
  onShow,
}: {
  rows: OpenRow[]
  onShow: (row: OpenRow) => void
}) {
  if (rows.length === 0) return <p className="empty">No open or Enhanced Open networks saved yet.</p>
  return (
    <ul className="open-list">
      {rows.map((row) => (
        <li key={row.hidden ? row.bssids[0] : row.ssid}>
          <div>
            <strong>{row.label}</strong>
            <span>{row.security === 'owe' ? 'Enhanced Open' : 'Open'}</span>
          </div>
          <p>
            {row.bssidCount} radio{row.bssidCount === 1 ? '' : 's'} · best {row.bestRssi} dBm · channels {row.channels.join(', ') || 'unknown'}
          </p>
          <p>{row.address ?? 'Open a place card on the map to save an address.'}</p>
          {row.floor != null && <p>Floor {row.floor}</p>}
          {row.lat != null && row.lon != null && (
            <button type="button" onClick={() => onShow(row)}>Show on map</button>
          )}
        </li>
      ))}
    </ul>
  )
}
