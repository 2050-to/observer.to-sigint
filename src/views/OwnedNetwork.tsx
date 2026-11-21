import { useEffect, useRef, useState } from 'react'
import { Wardrive } from '../native/drive'
import { EMPTY_OWNED, readOwnedPrefs, writeOwnedPrefs, type OwnedPrefs } from '../ownedPrefs'
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
  type SubnetHost,
} from '../../shared/ownedNetwork'

export function OwnedNetwork({ active, resetToken }: { active: boolean; resetToken: number }) {
  const [prefs, setPrefs] = useState<OwnedPrefs>(EMPTY_OWNED)
  const [prompt, setPrompt] = useState<OwnedPrompt | null>(null)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [detailsBusy, setDetailsBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [showAll, setShowAll] = useState(false)
  const catalogLife = useRef(0)
  const detailsLife = useRef(0)

  useEffect(() => {
    const saved = active ? readOwnedPrefs() : EMPTY_OWNED
    setPrefs(saved)
    setPrompt(null)
    setError('')
    setCatalogBusy(false)
    setDetailsBusy(false)
    setShowAll(false)
    if (saved.catalog) {
      const present = saved.catalog.hosts.filter((host) => host.present).length
      setStatus(`${present} present on ${saved.catalog.cidr}`)
    } else {
      setStatus('')
    }
    return () => {
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
        if (!prev.addresses) return prev
        const next = { ...prev, catalog }
        writeOwnedPrefs(next)
        return next
      })
      const present = catalog.hosts.filter((host) => host.present).length
      setStatus(`${present} present on ${catalog.cidr}`)
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
        if (!prev.details) return prev
        const next = { ...prev, device }
        writeOwnedPrefs(next)
        return next
      })
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
    const next = EMPTY_OWNED
    setPrefs(next)
    writeOwnedPrefs(next)
    setPrompt(null)
    setCatalogBusy(false)
    setDetailsBusy(false)
    setStatus('')
    setError('')
    setShowAll(false)
  }

  function disableDetails() {
    detailsLife.current += 1
    setPrefs((prev) => {
      const next = { ...prev, details: false, device: null }
      writeOwnedPrefs(next)
      return next
    })
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
      const saved: OwnedPrefs = { ...next.consent, catalog: null, device: null }
      setPrefs(saved)
      writeOwnedPrefs(saved)
      setPrompt(next.prompt)
      void runCatalog()
      return
    }
    if (!next.consent.details) {
      setPrompt(null)
      return
    }
    const saved: OwnedPrefs = { ...prefs, ...next.consent }
    setPrefs(saved)
    writeOwnedPrefs(saved)
    setPrompt(null)
    void runDetails()
  }

  if (!active) {
    return (
      <section className="card owned-network">
        <h2>Network you own</h2>
        <p className="disclaimer">{OWNED_NETWORK_DISCLAIMER}</p>
        <p className="owned-help">The Android and macOS apps ask before cataloging addresses or collecting device details.</p>
      </section>
    )
  }

  const catalog = prefs.catalog
  const visible = catalog ? (showAll ? catalog.hosts : catalog.hosts.filter((host) => host.present)) : []
  const busy = catalogBusy || detailsBusy

  return (
    <section className="card owned-network">
      <h2>Network you own</h2>
      <p className="disclaimer">{OWNED_NETWORK_DISCLAIMER}</p>
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
                ? 'Wi-Fi Mapping will list every IPv4 address on the Wi-Fi or Ethernet subnet this device is using, including a hardware address or name this device already has. Allow this only for a network you own.'
                : 'Wi-Fi Mapping will record this device\'s operating system, browser, RAM, CPU, and name. Allow this only for a network you own.'}
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
      {catalog && (
        <>
          {catalog.limited && (
            <p className="owned-help">
              This device is using a /{catalog.interfacePrefix} prefix. The catalog covers {catalog.cidr}, the block that contains this device.
            </p>
          )}
          <p className="owned-help">Present means the address answered a ping or this device has its hardware address.</p>
          <HostTable hosts={visible} />
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

function HostTable({ hosts }: { hosts: SubnetHost[] }) {
  if (!hosts.length) return <p className="owned-help">No addresses are present yet.</p>
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
          </tr>
        </thead>
        <tbody>
          {hosts.map((host) => (
            <tr key={host.ip}>
              <td>{host.ip}</td>
              <td>{roleLabel(host.role)}</td>
              <td>{host.present ? 'Yes' : 'No'}</td>
              <td>{host.name ?? ''}</td>
              <td>{host.mac ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
