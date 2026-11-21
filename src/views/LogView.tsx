import { useMemo, useState } from 'react'
import { catalogBundleCsv } from '../../shared/csv'
import { catalogForensicsMarkdown } from '../../shared/forensics'
import { enrichmentSearchText } from '../../shared/enrichment'
import { findRotatingAddresses, type RotationGroup } from '../../shared/rotation'
import { SIGNAL_COLORS, SIGNAL_KINDS, SIGNAL_NAMES, stackSignals, type SignalKind, type StackedDevice } from '../../shared/sources'
import { api } from '../api'
import { SignalStack } from '../SignalStack'
import type {
  AccessPoint,
  AdvertiserGroup,
  CellRecord,
  DeviceRecord,
  EnrichmentQueueStatus,
  Fix,
  MotionTrack,
  NetworkRecord,
  Room,
  ScenePing,
} from '../types'

function rotationNote(chains: RotationGroup[]): string {
  if (chains.length === 0) return ''
  if (chains.length === 1) {
    const [chain] = chains
    return `Rotating address · signal within ${chain.rssiDelta} dB · heard ${chain.separationM} m apart · ${chain.addresses.length} addresses`
  }
  const addresses = new Set(chains.flatMap((chain) => chain.addresses)).size
  return `Rotating addresses · ${chains.length} chains · ${addresses} addresses`
}

export function LogView({
  count,
  openCount,
  networks,
  accessPoints,
  devices,
  advertisers,
  cells,
  rooms,
  movers,
  phone,
  history,
  enrichmentStatus,
  nameForGroup,
  draftFor,
  rename,
}: {
  count: number
  openCount: number
  networks: NetworkRecord[]
  accessPoints: AccessPoint[]
  devices: DeviceRecord[]
  advertisers: AdvertiserGroup[]
  cells: CellRecord[]
  rooms: Room[]
  movers: MotionTrack[]
  phone: Fix | null
  history: ScenePing[]
  enrichmentStatus: EnrichmentQueueStatus | null
  nameForGroup: (ids: string[], fallback: string) => string
  draftFor: (id: string, fallback: string) => string
  rename: (id: string, value: string) => void
}) {
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<Set<SignalKind>>(() => new Set(SIGNAL_KINDS))
  const [rotatingOnly, setRotatingOnly] = useState(false)
  const [highRiskOnly, setHighRiskOnly] = useState(false)
  const [knownExploitedOnly, setKnownExploitedOnly] = useState(false)
  const rotations = useMemo(() => findRotatingAddresses(history), [history])
  const rotationByAddress = useMemo(() => {
    const map = new Map<string, RotationGroup>()
    for (const group of rotations) {
      for (const address of group.addresses) map.set(`${group.kind}:${address}`, group)
    }
    return map
  }, [rotations])
  const sources = useMemo(
    () => stackSignals({ networks, devices, cells, movers, phone, accessPoints, advertisers }),
    [networks, devices, cells, movers, phone, accessPoints, advertisers],
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
  function rotationsFor(source: StackedDevice): RotationGroup[] {
    const chains = new Set<RotationGroup>()
    for (const key of source.keys) {
      const match = rotationByAddress.get(`wifi:${key}`) ?? rotationByAddress.get(`bluetooth:${key}`)
      if (match) chains.add(match)
    }
    return [...chains]
  }

  const rotatingCount = sources.filter((source) => rotationsFor(source).length > 0).length
  const highRiskCount = sources.filter((source) => source.enrichments.some((item) => item.risk.level === 'high')).length
  const knownExploitedCount = sources.filter((source) =>
    source.enrichments.some((item) => item.vulnerabilities.some((vulnerability) => vulnerability.cisaKev || vulnerability.knownExploited)),
  ).length
  const needle = query.trim().toLowerCase()
  const shown = sources.flatMap((source) => {
    const chains = rotationsFor(source)
    if (rotatingOnly && chains.length === 0) return []
    if (highRiskOnly && !source.enrichments.some((item) => item.risk.level === 'high')) return []
    if (knownExploitedOnly && !source.enrichments.some((item) =>
      item.vulnerabilities.some((vulnerability) => vulnerability.cisaKev || vulnerability.knownExploited))) return []
    const signals = source.signals.filter((signal) => kinds.has(signal.kind))
    if (signals.length === 0) return []
    const note = rotationNote(chains)
    const title = nameForGroup(source.labelIds, source.label)
    const haystack = [
      title,
      source.label,
      ...source.keys,
      note,
      ...chains.flatMap((chain) => chain.addresses),
      ...signals.flatMap((signal) => [signal.title, signal.detail]),
      ...source.enrichments.map(enrichmentSearchText),
    ].join(' ').toLowerCase()
    if (needle && !haystack.includes(needle)) return []
    return [{ ...source, signals, note, title }]
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

  function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  async function download() {
    let blob: Blob
    try {
      blob = await api.csv()
    } catch {
      blob = new Blob([catalogBundleCsv(networks, { devices, cells, rooms })], { type: 'text/csv; charset=utf-8' })
    }
    saveBlob(blob, 'wifi-networks.csv')
  }

  async function downloadReport() {
    const extras = { devices, cells, rooms }
    let blob: Blob
    try {
      blob = await api.forensics()
    } catch {
      const markdown = await catalogForensicsMarkdown(networks, extras, new Date().toISOString())
      blob = new Blob([markdown], { type: 'text/markdown; charset=utf-8' })
    }
    saveBlob(blob, 'digital-forensics.md')
  }

  return (
    <section className="card log-view">
      <div className="log-head">
        <div>
          <h2>Catalog</h2>
          <p>
            {accessPoints.length} access points from {count} Wi-Fi radios. {openCount} open names.
            {' '}{advertisers.length} Bluetooth advertisers from {devices.length} addresses. {cells.length} towers. {rooms.length} rooms.
          </p>
          {enrichmentStatus && (
            <p>
              Enrichment {enrichmentStatus.enabled ? 'active' : 'disabled'} · {enrichmentStatus.complete} complete · {enrichmentStatus.pending + enrichmentStatus.processing} pending
              {enrichmentStatus.failed > 0 ? ` · ${enrichmentStatus.failed} failed` : ''}
            </p>
          )}
        </div>
        <div className="actions">
          <button type="button" onClick={() => void downloadReport()}>Download report</button>
          <button type="button" onClick={() => void download()}>Download CSV</button>
        </div>
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
          <button
            type="button"
            className={highRiskOnly ? 'filter-chip active' : 'filter-chip'}
            aria-pressed={highRiskOnly}
            onClick={() => setHighRiskOnly((current) => !current)}
          >
            High Risk
            <span>{highRiskCount}</span>
          </button>
          <button
            type="button"
            className={knownExploitedOnly ? 'filter-chip active' : 'filter-chip'}
            aria-pressed={knownExploitedOnly}
            onClick={() => setKnownExploitedOnly((current) => !current)}
          >
            Known Exploited
            <span>{knownExploitedCount}</span>
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
              <SignalStack
                id={source.id}
                fallback={source.title}
                signals={source.signals}
                enrichments={source.enrichments}
                note={source.note}
                draftFor={draftFor}
                rename={rename}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
