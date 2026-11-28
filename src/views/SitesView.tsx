import { useEffect, useMemo, useState } from 'react'
import { accessPointByBssid } from '../../shared/accessPoints'
import { siteEventId, type Disposition, type DispositionKind, type DispositionStatus } from '../../shared/disposition'
import {
  SECURITY_LABELS,
  asSiteDraft,
  baselineFor,
  boundaryLabel,
  securityChangeText,
  siteDiff,
  ssidKey,
  strongestSecurity,
  walkBoundary,
  walkDue,
  walkIntervalDays,
  type HeardBeacon,
  type SiteWalk,
  type SiteBoundary,
  type SiteClaim,
  type SiteDraft,
  type SiteRecord,
} from '../../shared/sites'
import { api } from '../api'
import { isDemoMode } from '../demo'
import { demoSite } from '../demoData'
import { DispositionControl } from '../DispositionControl'
import { sessionToken } from '../session'
import { Wardrive } from '../native/drive'
import type { AccessPoint, Fix } from '../types'

export function SitesView({
  phone,
  accessPoints,
  dispositions,
  onDisposition,
}: {
  phone: Fix | null
  accessPoints: AccessPoint[]
  dispositions: Disposition[]
  onDisposition: (kind: DispositionKind, id: string, status: DispositionStatus | null, note: string) => Promise<void>
}) {
  const demo = isDemoMode()
  const [sites, setSites] = useState<SiteRecord[]>(() => (demo ? [demoSite()] : []))
  const [selected, setSelected] = useState<string | null>(() => (demo ? demoSite().id : null))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [radiusM, setRadiusM] = useState(150)
  const [boundary, setBoundary] = useState<SiteBoundary | null>(null)
  const signedIn = Boolean(sessionToken())
  const site = sites.find((item) => item.id === selected) ?? null
  const points = useMemo(() => new Map(accessPointByBssid(accessPoints)), [accessPoints])

  async function load() {
    const next = await api.sites()
    setSites(next)
    setSelected((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id ?? null)
  }

  useEffect(() => {
    if (demo || !signedIn) return
    let stopped = false
    const refresh = () => {
      void load().catch((reason: unknown) => {
        if (!stopped) setError(reason instanceof Error ? reason.message : 'Sites could not be loaded')
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 30_000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [signedIn, demo])

  async function createSite() {
    setBusy(true)
    setError('')
    try {
      const nextBoundary = boundary ?? (phone?.lat != null && phone.lon != null
        ? { kind: 'radius' as const, lat: phone.lat, lon: phone.lon, radiusM }
        : null)
      const draft = asSiteDraft({ name, boundary: nextBoundary, claims: [] })
      if (!draft) throw new Error('Name the site and choose a radius or a walk')
      const created = await api.createSite(draft)
      setName('')
      setBoundary(null)
      await load()
      setSelected(created.id)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The site could not be saved')
    } finally {
      setBusy(false)
    }
  }

  async function useDrive() {
    setError('')
    try {
      const local = await Wardrive.getLocalCatalog()
      const scans = JSON.parse(local.journal || '[]') as { lat?: number | null; lon?: number | null }[]
      const next = walkBoundary(scans.flatMap((scan) => (
        scan.lat != null && scan.lon != null ? [{ lat: scan.lat, lon: scan.lon }] : []
      )))
      if (!next) throw new Error('This drive has no GPS points yet')
      setBoundary(next)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The drive could not be read')
    }
  }

  if (!signedIn && !demo) {
    return <section className="card"><h2>Sites</h2><p>Sign in to keep a site on this account.</p></section>
  }

  return (
    <section className="card site-view">
      <h2>Sites</h2>
      <p>A site is the radius or walk you are responsible for, and the radios you claim there.</p>
      {demo && <p className="owned-help">Sample site. Nothing is saved.</p>}
      {error && <p className="warn">{error}</p>}
      {!demo && <div className="site-create">
        <input aria-label="Site name" value={name} placeholder="Site name" maxLength={80} onChange={(event) => setName(event.target.value)} />
        <label>
          Radius
          <input
            aria-label="Site radius in meters"
            type="number"
            min={50}
            max={2000}
            value={radiusM}
            onChange={(event) => {
              setRadiusM(Number(event.target.value))
              setBoundary(null)
            }}
          />
        </label>
        <button type="button" onClick={() => void useDrive()}>Use this drive</button>
        <button type="button" onClick={() => void createSite()} disabled={busy}>{busy ? 'Saving…' : 'Save site'}</button>
        {boundary?.kind === 'walk' && <p className="owned-help">{boundaryLabel(boundary)} selected.</p>}
        {boundary == null && phone?.lat != null && <p className="owned-help">Radius uses the current position.</p>}
      </div>}
      {sites.length === 0 && <p className="empty">No sites yet.</p>}
      <div className="actions">
        {sites.map((item) => (
          <button key={item.id} type="button" className={item.id === site?.id ? 'active' : ''} onClick={() => setSelected(item.id)}>
            {item.name}
          </button>
        ))}
      </div>
      {site && (
        <SiteDetail
          site={site}
          readOnly={demo}
          points={points}
          dispositions={dispositions}
          onDisposition={onDisposition}
          onChange={async (next) => {
            setSites((current) => current.map((item) => item.id === next.id ? next : item))
          }}
          onDelete={async () => {
            await api.deleteSite(site.id)
            await load()
          }}
        />
      )}
    </section>
  )
}

function SiteDetail({
  site,
  readOnly = false,
  points,
  dispositions,
  onDisposition,
  onChange,
  onDelete,
}: {
  site: SiteRecord
  readOnly?: boolean
  points: Map<string, AccessPoint>
  dispositions: Disposition[]
  onDisposition: (kind: DispositionKind, id: string, status: DispositionStatus | null, note: string) => Promise<void>
  onChange: (site: SiteRecord) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const diff = siteDiff(site)
  const [claims, setClaims] = useState<SiteClaim[]>(site.claims)
  const [walks, setWalks] = useState<SiteWalk[]>(() => (readOnly && site.lastWalk ? [site.lastWalk] : []))
  const [everyDays, setEveryDays] = useState(String(walkIntervalDays(site)))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const due = walkDue(site)
  useEffect(() => {
    setClaims(site.claims)
    setEveryDays(String(walkIntervalDays(site)))
  }, [site])
  useEffect(() => {
    if (readOnly) {
      setWalks(site.lastWalk ? [site.lastWalk] : [])
      return
    }
    let stop = false
    void api.walks(site.id).then((next) => {
      if (!stop) setWalks(next ?? [])
    }).catch(() => undefined)
    return () => {
      stop = true
    }
  }, [readOnly, site.id, site.lastWalk])
  const heard = site.lastWalk?.heard ?? []
  const groups = groupHeard(heard)

  function claimedBssid(bssid: string): boolean {
    return claims.some((claim) => claim.bssid === bssid)
  }

  function toggleBssid(beacon: HeardBeacon, baseline: SiteClaim['baseline']) {
    setClaims((current) => {
      if (current.some((claim) => claim.bssid === beacon.bssid)) {
        return current.filter((claim) => claim.bssid !== beacon.bssid)
      }
      return [...current, { ssid: beacon.ssid, bssid: beacon.bssid, baseline }]
    })
  }

  function toggleName(ssid: string, baseline: SiteClaim['baseline']) {
    const key = ssidKey(ssid)
    setClaims((current) => {
      if (current.some((claim) => !claim.bssid && ssidKey(claim.ssid) === key)) {
        return current.filter((claim) => claim.bssid || ssidKey(claim.ssid) !== key)
      }
      return [...current, { ssid, bssid: null, baseline }]
    })
  }

  function setBaseline(ssid: string, baseline: SiteClaim['baseline']) {
    const key = ssidKey(ssid)
    setClaims((current) => current.map((claim) => ssidKey(claim.ssid) === key ? { ...claim, baseline } : claim))
  }

  async function saveInterval() {
    const draft = asSiteDraft({ name: site.name, boundary: site.boundary, claims, walkEveryDays: Number(everyDays) })
    if (!draft) {
      setError('The re-walk interval must be 1 to 90 days')
      return
    }
    try {
      const saved = await api.updateSite(site.id, draft)
      await onChange(saved)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The interval could not be saved')
    }
  }

  async function saveClaims() {
    setBusy(true)
    setError('')
    try {
      const draft: SiteDraft = { name: site.name, boundary: site.boundary, claims }
      const saved = await api.updateSite(site.id, draft)
      await onChange(saved)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The claims could not be saved')
    } finally {
      setBusy(false)
    }
  }

  async function download() {
    const blob = await api.siteReport(site.id)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'site-report.md'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="site-detail">
      <div className="log-head">
        <div>
          <h2>{site.name}</h2>
          <p>{boundaryLabel(site.boundary)}. Last walked {site.lastWalk ? new Date(site.lastWalk.walkedAt).toLocaleString() : 'not yet'}.</p>
          {due.overdue && <p className="warn">Re-walk due {new Date(due.dueAt).toLocaleDateString()}.</p>}
        </div>
        {!readOnly && (
          <div className="actions">
            <button type="button" onClick={() => void download()}>Download site report</button>
            <button type="button" className="danger" onClick={() => void onDelete()}>Delete site</button>
          </div>
        )}
      </div>
      {!readOnly && (
        <label>
          Re-walk every
          <input
            aria-label="Re-walk interval in days"
            type="number"
            min={1}
            max={90}
            value={everyDays}
            onChange={(event) => setEveryDays(event.target.value)}
            onBlur={() => void saveInterval()}
          />
          days
        </label>
      )}
      <h2>Walks</h2>
      {walks.length === 0 ? <p className="empty">No stored walks in the observation window.</p> : (
        <ul className="diff-list">
          {walks.map((walk) => (
            <li key={`${walk.startedAt}:${walk.walkedAt}`}>{new Date(walk.walkedAt).toLocaleString()} · {walk.heard.length} Wi-Fi · {walk.heardDevices?.length ?? 0} Bluetooth</li>
          ))}
        </ul>
      )}
      <h2>Events</h2>
      {(site.events ?? []).length === 0 ? <p className="empty">None yet. A walk inside this site records arrivals, departures, and critical findings.</p> : (
        <ul className="diff-list">
          {[...(site.events ?? [])].reverse().map((event) => {
            const radio = (site.radios ?? []).find((item) => item.bssid === event.bssid)
            const first = radio?.firstSeen ?? event.at
            const last = radio?.lastSeen ?? event.at
            return (
              <li key={`${event.kind}:${event.bssid}:${event.episode}`} className={event.severity === 'critical' ? 'warn' : undefined}>
                {event.detail} ({event.bssid}). First seen {new Date(first).toLocaleString()}. Last seen {new Date(last).toLocaleString()}.
                <DispositionControl
                  kind="site_event"
                  id={siteEventId(site.id, event)}
                  disposition={dispositions.find((item) => item.kind === 'site_event' && item.id === siteEventId(site.id, event)) ?? null}
                  onSave={onDisposition}
                />
              </li>
            )
          })}
        </ul>
      )}
      <DiffList title="Heard and expected" rows={diff.heardAndExpected.map((beacon) => `${beacon.ssid || beacon.bssid} (${beacon.security})`)} />
      <DiffList title="Heard and not on the list" rows={diff.heardNotListed.map((beacon) => beacon.ssid || beacon.bssid)} />
      {diff.heardNotListed.map((beacon) => (
        <RowDisposition key={beacon.bssid} beacon={beacon} points={points} dispositions={dispositions} onDisposition={onDisposition} />
      ))}
      <DiffList title="Expected and missing" rows={diff.expectedMissing.map((claim) => claim.ssid || claim.bssid || 'Claimed radio')} />
      <DiffList title="Security change" rows={diff.securityChanges.map(securityChangeText)} />
      {diff.securityChanges.map((change) => (
        <RowDisposition key={`security-${change.beacon.bssid}`} beacon={change.beacon} points={points} dispositions={dispositions} onDisposition={onDisposition} />
      ))}
      <h2>Claims</h2>
      <p className="owned-help">Claiming a BSSID arms evil-twin and channel checks for that radio.</p>
      {heard.length === 0 && <p className="empty">Walk this site to hear beacons, then claim the ones you are responsible for.</p>}
      {groups.map((group) => {
        const baseline = baselineFor(claims, group.ssid) ?? strongestSecurity(group.beacons.map((beacon) => beacon.security))
        const nameClaimed = claims.some((claim) => !claim.bssid && ssidKey(claim.ssid) === ssidKey(group.ssid))
        return (
          <div key={group.ssid || group.beacons[0].bssid} className="claim-group">
            <div className="actions">
              <strong>{group.ssid || 'Hidden network'}</strong>
              <label>
                Baseline
                <select aria-label={`Baseline for ${group.ssid || 'hidden network'}`} value={baseline} disabled={readOnly} onChange={(event) => setBaseline(group.ssid, event.target.value as SiteClaim['baseline'])}>
                  {SECURITY_LABELS.map((label) => <option key={label} value={label}>{label}</option>)}
                </select>
              </label>
              {group.ssid && (
                <label>
                  <input type="checkbox" checked={nameClaimed} disabled={readOnly} onChange={() => toggleName(group.ssid, baseline)} />
                  Expect this name
                </label>
              )}
            </div>
            {group.beacons.map((beacon) => (
              <label key={beacon.bssid}>
                <input type="checkbox" checked={claimedBssid(beacon.bssid)} disabled={readOnly} onChange={() => toggleBssid(beacon, baseline)} />
                {beacon.bssid} ({beacon.security}). Claim this BSSID to arm evil-twin and channel checks.
              </label>
            ))}
          </div>
        )
      })}
      {error && <p className="warn">{error}</p>}
      {!readOnly && heard.length > 0 && <button type="button" onClick={() => void saveClaims()} disabled={busy}>{busy ? 'Saving…' : 'Save claims'}</button>}
    </div>
  )
}

function RowDisposition({
  beacon,
  points,
  dispositions,
  onDisposition,
}: {
  beacon: HeardBeacon
  points: Map<string, AccessPoint>
  dispositions: Disposition[]
  onDisposition: (kind: DispositionKind, id: string, status: DispositionStatus | null, note: string) => Promise<void>
}) {
  const id = points.get(beacon.bssid)?.id ?? beacon.bssid
  const disposition = dispositions.find((item) => item.kind === 'ap' && item.id === id) ?? null
  return <DispositionControl kind="ap" id={id} disposition={disposition} onSave={onDisposition} />
}

function DiffList({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div>
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="empty">None</p> : (
        <ul className="diff-list">
          {rows.map((row) => <li key={row}>{row}</li>)}
        </ul>
      )}
    </div>
  )
}

function groupHeard(heard: HeardBeacon[]): { ssid: string; beacons: HeardBeacon[] }[] {
  const groups = new Map<string, HeardBeacon[]>()
  for (const beacon of heard) {
    const key = ssidKey(beacon.ssid)
    const list = groups.get(key) ?? []
    list.push(beacon)
    groups.set(key, list)
  }
  return [...groups.entries()].map(([ssid, beacons]) => ({ ssid: beacons[0]?.ssid || ssid, beacons }))
}
