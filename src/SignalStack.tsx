import { SIGNAL_COLORS, SIGNAL_NAMES, signalKinds, type SignalRow } from '../shared/sources'

export function SignalLegend() {
  return (
    <ul className="legend">
      {(['wifi', 'bluetooth', 'gps', 'cell'] as const).map((kind) => (
        <li key={kind}><i style={{ background: SIGNAL_COLORS[kind] }} />{SIGNAL_NAMES[kind]}</li>
      ))}
    </ul>
  )
}

export function LabelField({
  id,
  fallback,
  draftFor,
  rename,
}: {
  id: string
  fallback: string
  draftFor: (id: string, fallback: string) => string
  rename: (id: string, value: string) => void
}) {
  return (
    <input
      className="label-field"
      aria-label={`Label for ${fallback}`}
      value={draftFor(id, fallback)}
      onChange={(event) => rename(id, event.target.value)}
    />
  )
}

export function SignalStack({
  id,
  fallback,
  signals,
  draftFor,
  rename,
}: {
  id: string
  fallback: string
  signals: SignalRow[]
  draftFor: (id: string, fallback: string) => string
  rename: (id: string, value: string) => void
}) {
  const kinds = signalKinds(signals)
  return (
    <div className="source-stack">
      <LabelField id={id} fallback={fallback} draftFor={draftFor} rename={rename} />
      <div className={kinds.length > 1 ? 'source-pile' : 'source-pile single'}>
        {signals.map((signal) => (
          <p key={`${signal.kind}:${signal.title}:${signal.detail}`} className="source-line" style={{ borderLeftColor: SIGNAL_COLORS[signal.kind] }}>
            <i style={{ background: SIGNAL_COLORS[signal.kind] }} />
            <strong>{SIGNAL_NAMES[signal.kind]}</strong>
            <span>{signal.title}</span>
            <span>{signal.detail}</span>
          </p>
        ))}
      </div>
    </div>
  )
}
