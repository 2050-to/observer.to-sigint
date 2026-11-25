import { useState } from 'react'
import { shownReasons, type Disposition } from '../shared/disposition'
import { SIGNAL_COLORS, SIGNAL_NAMES, signalKinds, type SignalRow } from '../shared/sources'
import type { DeviceEnrichment, EvidenceSource } from './types'

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
  enrichments = [],
  note,
  disposition = null,
  draftFor,
  rename,
}: {
  id: string
  fallback: string
  signals: SignalRow[]
  enrichments?: DeviceEnrichment[]
  note?: string
  disposition?: Disposition | null
  draftFor: (id: string, fallback: string) => string
  rename: (id: string, value: string) => void
}) {
  const kinds = signalKinds(signals)
  return (
    <div className="source-stack">
      <LabelField id={id} fallback={fallback} draftFor={draftFor} rename={rename} />
      {note && <p className="rotation-note">{note}</p>}
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
      {enrichments.map((enrichment) => (
        <EnrichmentPanel
          key={`${enrichment.queryTitle}:${enrichment.manufacturer}:${enrichment.model}:${enrichment.lookedUpAt}`}
          enrichment={enrichment}
          disposition={disposition}
        />
      ))}
    </div>
  )
}

function EnrichmentPanel({ enrichment, disposition }: { enrichment: DeviceEnrichment; disposition: Disposition | null }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const links = uniqueSources(enrichment)
  const knownExploited = enrichment.vulnerabilities.some((item) => item.cisaKev || item.knownExploited)

  async function copyPrompt() {
    try {
      await copyText(enrichment.remediationPrompt)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    window.setTimeout(() => setCopyState('idle'), 2500)
  }

  return (
    <section className={`enrichment-card risk-${enrichment.risk.level}`}>
      <div className="enrichment-heading">
        <strong>{[enrichment.manufacturer, enrichment.model].filter(Boolean).join(' ') || enrichment.category}</strong>
        <span>{enrichment.confidence} confidence</span>
      </div>
      <div className="enrichment-tags">
        {enrichment.tags.map((tag) => <span key={tag} className={tag === 'High Risk' ? 'risk-tag' : ''}>{tag}</span>)}
        {knownExploited && !enrichment.tags.includes('Known Exploited') && <span className="risk-tag">Known Exploited</span>}
        {enrichment.status === 'inconclusive' && <span>Inconclusive</span>}
      </div>
      {enrichment.summary && <p className="enrichment-summary">{enrichment.summary}</p>}
      <dl className="enrichment-meta">
        <div><dt>Category</dt><dd>{enrichment.category}</dd></div>
        <div><dt>Support</dt><dd>{supportLabel(enrichment.supportStatus)}</dd></div>
        <div><dt>Risk</dt><dd>{enrichment.risk.level}</dd></div>
        <div>
          <dt>Latest published release</dt>
          <dd>{enrichment.newestRelease
            ? `${enrichment.newestRelease.kind}${enrichment.newestRelease.version ? ` ${enrichment.newestRelease.version}` : ''} · ${enrichment.newestRelease.publishedAt} · ${enrichment.newestRelease.ageBand}`
            : 'Not verified'}</dd>
        </div>
      </dl>
      {shownReasons(enrichment.risk.reasons, disposition).length > 0 && (
        <ul className="enrichment-reasons">
          {shownReasons(enrichment.risk.reasons, disposition).map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
      {enrichment.vulnerabilities.length > 0 && (
        <div className="vulnerability-list">
          <strong>Potentially applicable vulnerabilities</strong>
          <p className="enrichment-caveat">
            {disposition?.model && disposition.firmware
              ? `Recorded model ${disposition.model}, firmware ${disposition.firmware}. High risk stays until the disposition is closed.`
              : 'Installed firmware is unknown. Verify the exact model and version before treating these as applicable.'}
          </p>
          <ul>
            {enrichment.vulnerabilities.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.id}</strong>
                  <span>{item.severity}{item.cvss == null ? '' : ` · CVSS ${item.cvss.toFixed(1)}`}</span>
                  {(item.cisaKev || item.knownExploited) && <span className="risk-tag">Known Exploited</span>}
                  {item.publicExploit && <span>Public exploit reference</span>}
                </div>
                <p>{item.title}</p>
                {item.fixedVersion && <p>Fixed version: {item.fixedVersion}</p>}
                {item.mitigation && <p>Mitigation: {item.mitigation}</p>}
                <div className="artifact-links">
                  {item.links.map((link) => <SourceLink key={`${item.id}:${link.kind}:${link.url}`} source={link} />)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="enrichment-links">
        {enrichment.officialSupportUrl && (
          <a href={enrichment.officialSupportUrl} target="_blank" rel="noreferrer">Official support</a>
        )}
        {links.map((source) => <SourceLink key={`${source.kind}:${source.url}`} source={source} />)}
      </div>
      <div className="remediation-actions">
        <button type="button" onClick={() => void copyPrompt()}>Copy remediation prompt</button>
        <span role="status">
          {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : ''}
        </span>
      </div>
      <p className="enrichment-caveat">Verify the exact model and installed firmware before applying any change.</p>
    </section>
  )
}

function SourceLink({ source }: { source: EvidenceSource }) {
  return (
    <a href={source.url} target="_blank" rel="noreferrer">
      {evidenceLabel(source)}
    </a>
  )
}

function evidenceLabel(source: EvidenceSource): string {
  if (source.kind === 'cisa_kev') return 'CISA KEV'
  if (source.kind === 'nvd') return 'NVD'
  if (source.kind === 'public_exploit' || source.kind === 'poc') return 'Public exploit reference'
  if (source.kind === 'vendor_advisory') return 'Vendor advisory'
  if (source.kind === 'patch_notes') return 'Patch notes'
  return source.title || source.kind.replaceAll('_', ' ')
}

function supportLabel(value: DeviceEnrichment['supportStatus']): string {
  if (value === 'end_of_support') return 'End of support'
  if (value === 'supported') return 'Supported'
  return 'Unknown'
}

function uniqueSources(enrichment: DeviceEnrichment): EvidenceSource[] {
  const artifactUrls = new Set(enrichment.vulnerabilities.flatMap((item) => item.links.map((link) => link.url)))
  const seen = new Set<string>()
  return enrichment.sources.filter((source) => {
    if (source.url === enrichment.officialSupportUrl || artifactUrls.has(source.url) || seen.has(source.url)) return false
    seen.add(source.url)
    return true
  })
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('clipboard unavailable')
}
