import { useEffect, useRef, useState } from 'react'
import { chooseLanSite } from '../../shared/lanSite'
import { pointInSite, type SiteRecord } from '../../shared/sites'
import type { Disposition, DispositionKind, DispositionStatus } from '../../shared/disposition'
import type { Fix } from '../types'
import { api } from '../api'
import { DispositionControl } from '../DispositionControl'
import { sessionToken } from '../session'
import { Wardrive } from '../native/drive'
import { EMPTY_OWNED, resolveOwnedPrefs, saveOwnedChoice, writeOwnedPrefs, type OwnedPrefs } from '../ownedPrefs'
import {
  OWNED_NETWORK_DISCLAIMER,
  allowOwned,
  asDeviceDetails,
  asSubnetCatalog,
  formatBytes,
  roleLabel,
  toggleAddresses,
  toggleDetails,
  type OwnedPrompt,
  type SubnetCatalog,
  type SubnetHost,
} from '../../shared/ownedNetwork'
import { classifyRecorder } from '../../shared/recorders'
import { ownedChangeText, type OwnedChange } from '../../shared/ownedDiff'

export function OwnedNetwork({
  active,
  resetToken,
  phone,
  dispositions,
  onDisposition,
}: {
  active: boolean
  resetToken: number
  phone: Fix | null
  dispositions: Disposition[]
  onDisposition: (kind: DispositionKind, id: string, status: DispositionStatus | null, note: string) => Promise<void>
}) {
  const [prefs, setPrefs] = useState<OwnedPrefs>(EMPTY_OWNED)
  const [prompt, setPrompt] = useState<OwnedPrompt | null>(null)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [detailsBusy, setDetailsBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [changes, setChanges] = useState<OwnedChange[]>([])
  const [sites, setSites] = useState<SiteRecord[]>([])
  const [siteId, setSiteId] = useState('')
  const [inventories, setInventories] = useState<{ id: string; siteId: string | null; observedAt: string; count: number }[]>([])
  const catalogLife = useRef(0)
  const detailsLife = useRef(0)
  const choiceRef = useRef(EMPTY_OWNED)

  useEffect(() => {
    let stop = false
    setPrompt(null)
    setError('')
    setCatalogBusy(false)
    setDetailsBusy(false)
    setShowAll(false)
    setChanges([])
    setInventories([])
    if (sessionToken()) {
      void api.lanChanges().then((next) => {
        if (!stop) setChanges(next)
      }).catch(() => undefined)
      void api.sites().then((next) => {
        if (stop) return
        setSites(next)
        const inside = phone?.lat != null && phone.lon != null
          ? next.filter((site) => pointInSite(phone.lat!, phone.lon!, site.boundary)).map((site) => site.id)
          : []
        const chosen = chooseLanSite(next.map((site) => site.id), null, inside)
        if (chosen) setSiteId(chosen)
      }).catch(() => undefined)
      void api.lanInventories().then((next) => {
        if (!stop) setInventories(next)
      }).catch(() => undefined)
    }
    if (!active) {
      choiceRef.current = EMPTY_OWNED
      setPrefs(EMPTY_OWNED)
      setStatus('')
      return () => {
        stop = true
        catalogLife.current += 1
        detailsLife.current += 1
      }
    }
    void resolveOwnedPrefs().then((saved) => {
      if (stop) return
      choiceRef.current = saved
      setPrefs(saved)
      setStatus(saved.catalog ? catalogStatus(saved.catalog) : '')
      if (!saved.addresses) return
      const catalogTicket = ++catalogLife.current
      const detailsTicket = ++detailsLife.current
      void runCatalog(catalogTicket)
      if (saved.details) void runDetails(detailsTicket)
    }).catch(() => {
      if (!stop) setError('The saved network choices could not be loaded.')
    })
    return () => {
      stop = true
      catalogLife.current += 1
      detailsLife.current += 1
    }
  }, [active, resetToken])

  async function runCatalog(ticket?: number) {
    const current = ticket ?? ++catalogLife.current
    setCatalogBusy(true)
    setError('')
    try {
      const catalog = asSubnetCatalog(await Wardrive.catalogSubnet({ consent: true }))
      if (current !== catalogLife.current) return
      if (!catalog) throw new Error('The subnet catalog was incomplete')
      setPrefs((prev) => {
        if (!choiceRef.current.addresses) return prev
        const next = { ...prev, catalog }
        choiceRef.current = next
        writeOwnedPrefs(next)
        return next
      })
      setStatus(catalogStatus(catalog))
      if (sessionToken()) {
        try {
          const listed = sites.length > 0 ? sites : await api.sites()
          const inside = phone?.lat != null && phone.lon != null
            ? listed.filter((site) => pointInSite(phone.lat as number, phone.lon as number, site.boundary)).map((site) => site.id)
            : []
          if (listed.length > 1 && inside.length !== 1 && !siteId) {
            if (current === catalogLife.current) setError('Choose the site this network belongs to.')
            return
          }
          const chosen = chooseLanSite(listed.map((site) => site.id), siteId || null, inside)
          const saved = await api.saveLan({ ...catalog, siteId: chosen })
          if (current === catalogLife.current) {
            setChanges(saved.changes)
            setInventories(await api.lanInventories(chosen))
          }
        } catch {
          if (current === catalogLife.current) setError('Saved on this device. The account copy could not be updated.')
        }
      }
    } catch (reason: unknown) {
      if (current !== catalogLife.current) return
      setError(reason instanceof Error ? reason.message : 'The subnet could not be cataloged')
    } finally {
      if (current === catalogLife.current) setCatalogBusy(false)
    }
  }

  async function runDetails(ticket?: number) {
    const current = ticket ?? ++detailsLife.current
    setDetailsBusy(true)
    setError('')
    try {
      const device = asDeviceDetails(await Wardrive.deviceDetails({
        consent: true,
        browser: navigator.userAgent,
      }))
      if (current !== detailsLife.current) return
      if (!device) throw new Error('Device details were incomplete')
      setPrefs((prev) => {
        if (!choiceRef.current.details) return prev
        const next = { ...prev, device }
        choiceRef.current = next
        writeOwnedPrefs(next)
        return next
      })
      if (sessionToken()) {
        try {
          await api.saveDevice(device)
        } catch {
          if (current === detailsLife.current) setError('Saved on this device. The account copy could not be updated.')
        }
      }
    } catch (reason: unknown) {
      if (current !== detailsLife.current) return
      setError(reason instanceof Error ? reason.message : 'Device details could not be read')
    } finally {
      if (current === detailsLife.current) setDetailsBusy(false)
    }
  }

  function disableAddresses() {
    catalogLife.current += 1
    detailsLife.current += 1
    commit(EMPTY_OWNED)
    setPrompt(null)
    setCatalogBusy(false)
    setDetailsBusy(false)
    setStatus('')
    setError('')
    setShowAll(false)
  }

  function disableDetails() {
    detailsLife.current += 1
    commit({ ...choiceRef.current, details: false, device: null })
    setDetailsBusy(false)
  }

  function onAddresses() {
    const next = toggleAddresses(prefs)
    if (!next.prompt) disableAddresses()
    else setPrompt(next.prompt)
  }

  function onDetails() {
    const next = toggleDetails(prefs)
    if (!next.prompt) disableDetails()
    else setPrompt(next.prompt)
  }

  function allow() {
    if (!prompt) return
    const next = allowOwned(prefs, prompt)
    if (prompt === 'addresses') {
      commit({ ...next.consent, catalog: null, device: null })
      setPrompt(next.prompt)
      void runCatalog()
      return
    }
    if (!next.consent.details) {
      setPrompt(null)
      return
    }
    commit({ ...prefs, ...next.consent })
    setPrompt(null)
    void runDetails()
  }

  function commit(next: OwnedPrefs) {
    choiceRef.current = next
    setPrefs(next)
    writeOwnedPrefs(next)
    void saveOwnedChoice({ addresses: next.addresses, details: next.details }).catch(() => {
      setError('Saved on this device. The account copy could not be updated.')
    })
  }

  if (!active) {
    return (
      <section className="card owned-network">
        <h2>Network you own</h2>
        <p className="disclaimer">{OWNED_NETWORK_DISCLAIMER}</p>
        <p className="owned-help">The Android and macOS apps ask before cataloging addresses or collecting device details.</p>
        {changes.length > 0 && (
          <>
            <h2>Changes since the previous inventory</h2>
            <ul className="diff-list">
              {changes.map((change) => <li key={`${change.kind}:${change.ip}:${change.name ?? ''}`}>{ownedChangeText(change)}</li>)}
            </ul>
          </>
        )}
      </section>
    )
  }

  const catalog = prefs.catalog
  const visible = catalog
    ? catalog.hosts.filter((host) => showAll || host.present || classifyRecorder(host) != null)
    : []
  const busy = catalogBusy || detailsBusy

  return (
    <section className="card owned-network">
      <h2>Network you own</h2>
      <p className="disclaimer">{OWNED_NETWORK_DISCLAIMER}</p>
      {sites.length > 0 && (
        <label>
          Site for this inventory
          <select aria-label="Site for this inventory" value={siteId} onChange={(event) => setSiteId(event.target.value)}>
            <option value="">Unassigned</option>
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
      )}
      {inventories.length > 0 && (
        <ul className="diff-list">
          {inventories.slice(0, 8).map((row) => (
            <li key={row.id}>{new Date(row.observedAt).toLocaleString()} · {row.count} hosts{row.siteId ? '' : ' · unassigned'}</li>
          ))}
        </ul>
      )}
      <fieldset className="owned-options">
        <legend className="owned-help">Optional features</legend>
        <label>
          <input type="checkbox" checked={prefs.addresses} disabled={prompt != null} onChange={onAddresses} />
          Catalog IP addresses on this subnet
        </label>
        <label>
          <input
            type="checkbox"
            checked={prefs.details}
            disabled={!prefs.addresses || prompt != null}
            onChange={onDetails}
          />
          Collect operating system, browser, RAM, CPU, and name
        </label>
      </fieldset>
      {!prefs.addresses && <p className="owned-help">Device details stay off until address cataloging is allowed.</p>}
      {prompt && (
        <div className="prompt" role="alertdialog" aria-labelledby="owned-prompt-title">
          <div>
            <h3 id="owned-prompt-title">
              {prompt === 'addresses' ? 'Catalog IP addresses on this subnet?' : 'Collect device details?'}
            </h3>
            <p>
              {prompt === 'addresses'
                ? 'Observer.to will list every IPv4 address on the Wi-Fi or Ethernet subnet this device is using. It will keep a hardware address or name this device already has, listen for camera and recorder names those devices announce, and check whether each address accepts a connection on ports 554, 8554, and 37777. It does not open video or audio, try passwords, or record traffic. Allow this only for a network you own.'
                : 'Observer.to will record this device\'s operating system, browser, RAM, CPU, and name. Allow this only for a network you own.'}
            </p>
          </div>
          <div className="actions">
            <button type="button" onClick={() => setPrompt(null)}>Don't allow</button>
            <button type="button" onClick={allow}>Allow</button>
          </div>
        </div>
      )}
      {prefs.addresses && (
        <div className="owned-actions">
          <button type="button" onClick={() => refresh()} disabled={busy || prompt != null}>
            {catalogBusy ? 'Cataloging…' : detailsBusy ? 'Collecting details…' : 'Refresh'}
          </button>
        </div>
      )}
      {status && <p className="owned-help" aria-live="polite">{status}</p>}
      {error && <p className="warn" aria-live="polite">{error}</p>}
      {changes.length > 0 && (
        <>
          <h2>Changes since the previous inventory</h2>
          <ul className="diff-list">
            {changes.map((change) => <li key={`${change.kind}:${change.ip}:${change.name ?? ''}`}>{ownedChangeText(change)}</li>)}
          </ul>
        </>
      )}
      {catalog && (
        <>
          {catalog.limited && (
            <p className="owned-help">
              This device is using a /{catalog.interfacePrefix} prefix. The catalog covers {catalog.cidr}, the block that contains this device.
            </p>
          )}
          <p className="owned-help">Present means the address answered a ping, announced a camera service, accepted a camera port, or this device has its hardware address.</p>
          <p className="owned-help">A flag means the name, vendor, announced service, or a camera port looks like a camera or recorder. This cannot see a device that is not on this network, cannot tell a camera you installed from one you did not, and does not open video or audio.</p>
          <HostTable hosts={visible} dispositions={dispositions} onDisposition={onDisposition} />
          <button type="button" onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Show present addresses' : `Show every address (${catalog.hosts.length})`}
          </button>
        </>
      )}
      {prefs.device && (
        <dl className="meta">
          <div>
            <dt>Name</dt>
            <dd>{prefs.device.hostname}</dd>
          </div>
          <div>
            <dt>Operating system</dt>
            <dd>{prefs.device.os}</dd>
          </div>
          <div>
            <dt>Browser</dt>
            <dd>{prefs.device.browser}</dd>
          </div>
          <div>
            <dt>RAM</dt>
            <dd>{formatBytes(prefs.device.ramBytes)}</dd>
          </div>
          <div>
            <dt>CPU</dt>
            <dd>{prefs.device.cpu}</dd>
          </div>
        </dl>
      )}
    </section>
  )

  function refresh() {
    const catalogTicket = ++catalogLife.current
    const detailsTicket = ++detailsLife.current
    void runCatalog(catalogTicket)
    if (prefs.details) void runDetails(detailsTicket)
  }
}

function catalogStatus(catalog: SubnetCatalog): string {
  const flagged = catalog.hosts.filter((host) => classifyRecorder(host) != null).length
  const label = flagged === 1 ? '1 likely camera or recorder' : `${flagged} likely cameras or recorders`
  const route = catalog.internetRoute
    ? 'This network has a route to the internet, so a flagged device can use it.'
    : 'This network has no default internet route.'
  return `${label} on ${catalog.cidr}. ${route}`
}

function HostTable({
  hosts,
  dispositions,
  onDisposition,
}: {
  hosts: SubnetHost[]
  dispositions: Disposition[]
  onDisposition: (kind: DispositionKind, id: string, status: DispositionStatus | null, note: string) => Promise<void>
}) {
  const rows = hosts
    .map((host, index) => ({ host, index, flag: classifyRecorder(host) }))
    .sort((left, right) => {
      const leftFlag = left.flag ? 0 : 1
      const rightFlag = right.flag ? 0 : 1
      if (leftFlag !== rightFlag) return leftFlag - rightFlag
      return left.index - right.index
    })
  if (!rows.length) return <p className="owned-help">No addresses are present yet.</p>
  return (
    <div className="host-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Address</th>
            <th scope="col">Kind</th>
            <th scope="col">Present</th>
            <th scope="col">Name</th>
            <th scope="col">Hardware address</th>
            <th scope="col">Notice</th>
            <th scope="col" className="row-actions">Work</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ host, flag }) => (
            <tr key={host.ip} className={flag ? 'host-flagged' : undefined}>
              <td>{host.ip}</td>
              <td>{roleLabel(host.role)}</td>
              <td>{host.present ? 'Yes' : 'No'}</td>
              <td>{host.name ?? ''}</td>
              <td>{host.mac ?? ''}</td>
              <td>
                {flag && (
                  <>
                    <span className="host-notice">{flag.kind === 'recorder' ? 'Likely recorder' : 'Likely camera'}</span>
                    <span className="host-reasons">{flag.reasons.join(', ')}</span>
                  </>
                )}
              </td>
              <td className="row-actions">
                <DispositionControl
                  kind="lan_host"
                  id={(host.mac || host.ip).toLowerCase()}
                  disposition={dispositions.find((item) => item.kind === 'lan_host' && item.id === (host.mac || host.ip).toLowerCase()) ?? null}
                  onSave={onDisposition}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
