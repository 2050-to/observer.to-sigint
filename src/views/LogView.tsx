import { useMemo, useState } from 'react'
import { catalogBundleCsv } from '../../shared/csv'
import { findRotatingAddresses, type RotationGroup } from '../../shared/rotation'
import { SIGNAL_COLORS, SIGNAL_KINDS, SIGNAL_NAMES, stackSignals, type SignalKind, type StackedDevice } from '../../shared/sources'
import { api } from '../api'
import { SignalStack } from '../SignalStack'
import type { CellRecord, DeviceRecord, Fix, MotionTrack, NetworkRecord, Room, ScenePing } from '../types'

export function LogView({
  count,
  openCount,
  networks,
  devices,
  cells,
  rooms,
  movers,
  phone,
  history,
  draftFor,
  rename,
}: {
  count: number
  openCount: number
  networks: NetworkRecord[]
  devices: DeviceRecord[]
  cells: CellRecord[]
  rooms: Room[]
  movers: MotionTrack[]
  phone: Fix | null
  history: ScenePing[]
  draftFor: (id: string, fallback: string) => string
  rename: (id: string, value: string) => void
}) {
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<Set<SignalKind>>(() => new Set(SIGNAL_KINDS))
  const [rotatingOnly, setRotatingOnly] = useState(false)
  const rotations = useMemo(() => findRotatingAddresses(history), [history])
  const rotationByAddress = useMemo(() => {
    const map = new Map<string, RotationGroup>()
    for (const group of rotations) {
      for (const address of group.addresses) map.set(`${group.kind}:${address}`, group)
    }
    return map
  }, [rotations])
  const sources = useMemo(
    () => stackSignals({ networks, devices, cells, movers, phone }),
    [networks, devices, cells, movers, phone],
  )
  const counts = useMemo(() => {
    const tally = Object.fromEntries(SIGNAL_KINDS.map((kind) => [kind, 0])) as Record<SignalKind, number>
    for (const source of sources) {
      for (const kind of SIGNAL_KINDS) {
        if (source.signals.some((signal) => signal.kind === kind)) tally[kind] += 1
      }
    }
    return tally
  }, [sources])
  function rotationFor(source: StackedDevice): RotationGroup | null {
    for (const key of source.keys) {
      const match = rotationByAddress.get(`wifi:${key}`) ?? rotationByAddress.get(`bluetooth:${key}`)
      if (match) return match
    }
    return null
  }

  const rotatingCount = sources.filter((source) => rotationFor(source)).length
  const needle = query.trim().toLowerCase()
  const shown = sources.flatMap((source) => {
    const group = rotationFor(source)
    if (rotatingOnly && !group) return []
    const signals = source.signals.filter((signal) => kinds.has(signal.kind))
    if (signals.length === 0) return []
    const note = group
      ? `Rotating address · signal within ${group.rssiDelta} dB · heard ${group.separationM} m apart · ${group.addresses.length} addresses`
      : ''
    const haystack = [source.label, ...source.keys, note, ...(group?.addresses ?? []), ...signals.flatMap((signal) => [signal.title, signal.detail])].join(' ').toLowerCase()
    if (needle && !haystack.includes(needle)) return []
    return [{ ...source, signals, note }]
  })
  const allKinds = kinds.size === SIGNAL_KINDS.length

  function toggleKind(kind: SignalKind) {
    setKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  async function download() {
    let blob: Blob
    try {
      blob = await api.csv()
    } catch {
      blob = new Blob([catalogBundleCsv(networks, { devices, cells, rooms })], { type: 'text/csv; charset=utf-8' })
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'wifi-networks.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="card log-view">
      <div className="log-head">
        <div>
          <h2>Catalog</h2>
          <p>{count} unique access points. {openCount} open names. {devices.length} Bluetooth advertisements. {cells.length} towers. {rooms.length} rooms.</p>
        </div>
        <button type="button" onClick={() => void download()}>Download CSV</button>
      </div>
      <div className="datasources">
        <div className="log-head">
          <h2>Datasources</h2>
          <p>{shown.length} of {sources.length}</p>
        </div>
        <div className="datasource-bar">
          <input
            type="search"
            value={query}
            placeholder="Filter by name, address, or detail"
            aria-label="Filter datasources"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className={allKinds ? 'active' : ''} aria-pressed={allKinds} onClick={() => setKinds(new Set(SIGNAL_KINDS))}>All</button>
          {SIGNAL_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={kinds.has(kind) ? 'filter-chip active' : 'filter-chip'}
              aria-pressed={kinds.has(kind)}
              onClick={() => toggleKind(kind)}
            >
              <i style={{ background: SIGNAL_COLORS[kind] }} />
              {SIGNAL_NAMES[kind]}
              <span>{counts[kind]}</span>
            </button>
          ))}
          <button
            type="button"
            className={rotatingOnly ? 'filter-chip active' : 'filter-chip'}
            aria-pressed={rotatingOnly}
            onClick={() => setRotatingOnly((current) => !current)}
          >
            Rotating
            <span>{rotatingCount}</span>
          </button>
        </div>
        {sources.length > 0 && (
          <div className="rotations">
            <h2>Rotating addresses</h2>
            <p>A random address is marked here when it stops and another starts within two minutes, the signal stays near the level it left off, and the place it was heard still fits the same path-loss range. A longer gap has to match more closely. Each address stays its own record.</p>
            {rotations.length === 0 && <p className="empty">No rotating addresses in this survey.</p>}
            <ul className="rotation-list">
              {rotations.map((group) => (
                <li key={group.id}>
                  <strong>{group.kind === 'wifi' ? 'Wi-Fi' : 'Bluetooth'}</strong>
                  <span>{group.addresses.length} addresses</span>
                  <span>signal within {group.rssiDelta} dB</span>
                  <span>heard {group.separationM} m apart</span>
                  <code>{group.addresses.join(' → ')}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
        {sources.length === 0 && <p className="empty">No signals saved yet.</p>}
        {sources.length > 0 && shown.length === 0 && <p className="empty">No datasources match this filter.</p>}
        <ul className="datasource-grid">
          {shown.map((source) => (
            <li key={source.id}>
              <SignalStack id={source.id} fallback={source.label} signals={source.signals} note={source.note} draftFor={draftFor} rename={rename} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
