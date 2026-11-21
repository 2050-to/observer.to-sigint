import { useEffect, useRef, useState } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import { SIGNAL_COLORS, type SignalRow } from '../../shared/sources'
import { SignalLegend, SignalStack } from '../SignalStack'
import { SECURITY_COLORS, type DeviceRecord, type NetworkRecord, type SecurityLabel } from '../types'

export interface SsidGroup {
  id: string
  label: string
  security: SecurityLabel
  bestRssi: number
  networks: NetworkRecord[]
}

type Selection =
  | { kind: 'wifi'; group: SsidGroup }
  | { kind: 'bluetooth'; device: DeviceRecord }

function ring(rssi: number): number {
  if (rssi >= -50) return 4
  if (rssi >= -60) return 3
  if (rssi >= -70) return 2
  return 1
}

export function groupHeard(heard: NetworkRecord[]): SsidGroup[] {
  const groups = new Map<string, NetworkRecord[]>()
  for (const network of heard) {
    const key = network.hidden || !network.ssid ? `hidden:${network.bssid}` : `ssid:${network.ssid}`
    const list = groups.get(key) ?? []
    list.push(network)
    groups.set(key, list)
  }
  return [...groups.entries()].map(([id, networks]) => {
    const best = networks.reduce((a, b) => (a.bestRssi >= b.bestRssi ? a : b))
    const hex = best.bssid.replace(/:/g, '').slice(-4).toUpperCase()
    return {
      id,
      label: best.hidden || !best.ssid ? `Hidden ${hex}` : best.ssid,
      security: best.security,
      bestRssi: best.bestRssi,
      networks,
    }
  })
}

function networkSignals(network: NetworkRecord): SignalRow[] {
  const title = network.hidden || !network.ssid ? network.bssid : network.ssid
  const signals: SignalRow[] = [{ kind: 'wifi', title, detail: `${network.bestRssi} dBm · ${network.bssid}` }]
  if (network.bestLat != null && network.bestLon != null) {
    signals.push({ kind: 'gps', title: 'Fix', detail: `${network.bestLat.toFixed(5)}, ${network.bestLon.toFixed(5)}` })
  }
  return signals
}

function deviceTitle(device: DeviceRecord): string {
  return device.name?.trim() || device.address
}

function deviceSignals(device: DeviceRecord): SignalRow[] {
  const signals: SignalRow[] = [{
    kind: 'bluetooth',
    title: deviceTitle(device),
    detail: `${device.lastRssi} dBm · ${device.address}`,
  }]
  if (device.bestLat != null && device.bestLon != null) {
    signals.push({ kind: 'gps', title: 'Fix', detail: `${device.bestLat.toFixed(5)}, ${device.bestLon.toFixed(5)}` })
  }
  return signals
}

function addressTypeLabel(addressType: DeviceRecord['addressType']): string {
  return addressType === 'public' ? 'Public' : 'Random'
}

export function RangeGraph({
  heard,
  devices,
  nameFor,
  draftFor,
  rename,
}: {
  heard: NetworkRecord[]
  devices: DeviceRecord[]
  nameFor: (id: string, fallback: string) => string
  draftFor: (id: string, fallback: string) => string
  rename: (id: string, value: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const graph = useRef<Core | null>(null)
  const [selected, setSelected] = useState<Selection | null>(null)
  const groups = groupHeard(heard)

  useEffect(() => {
    setSelected((current) => {
      if (!current) return null
      if (current.kind === 'wifi') {
        const group = groupHeard(heard).find((item) => item.id === current.group.id)
        return group ? { kind: 'wifi', group } : null
      }
      const device = devices.find((item) => item.address === current.device.address)
      return device ? { kind: 'bluetooth', device } : null
    })
  }, [heard, devices])

  useEffect(() => {
    if (!host.current) return
    graph.current?.destroy()
    const spots = [
      ...groups.map((group) => ({
        id: group.id,
        label: nameFor(group.id, group.label),
        color: SIGNAL_COLORS.wifi,
        size: 28 + Math.min(group.networks.length, 6) * 8,
        rssi: group.bestRssi,
      })),
      ...devices.map((device) => ({
        id: `bluetooth:${device.address}`,
        label: nameFor(device.address, deviceTitle(device)),
        color: SIGNAL_COLORS.bluetooth,
        size: 28,
        rssi: device.bestRssi,
      })),
    ]
    const cy = cytoscape({
      container: host.current,
      elements: [
        { data: { id: 'phone', label: nameFor('phone', 'This device'), color: SIGNAL_COLORS.gps, size: 36 }, position: { x: 0, y: 0 } },
        ...spots.flatMap((spot, index) => {
          const distance = (5 - ring(spot.rssi)) * 130 + 110
          const angle = (index / Math.max(spots.length, 1)) * Math.PI * 2 - Math.PI / 2
          return [
            {
              data: {
                id: spot.id,
                label: spot.label,
                color: spot.color,
                size: spot.size,
              },
              position: { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance },
            },
            { data: { id: `edge-${spot.id}`, source: 'phone', target: spot.id } },
          ]
        }),
      ],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'background-color': 'data(color)',
            color: '#f1f1f2',
            'font-size': 11,
            'text-valign': 'bottom',
            'text-margin-y': 6,
            width: 'data(size)',
            height: 'data(size)',
            'text-outline-width': 2,
            'text-outline-color': '#111214',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': '#3d4046',
            opacity: 0.8,
          },
        },
      ],
      layout: { name: 'preset', fit: true, padding: 48 },
      userZoomingEnabled: true,
    })
    cy.on('tap', 'node', (event) => {
      const id = event.target.id() as string
      const group = groups.find((item) => item.id === id)
      if (group) {
        setSelected({ kind: 'wifi', group })
        return
      }
      const device = devices.find((item) => `bluetooth:${item.address}` === id)
      setSelected(device ? { kind: 'bluetooth', device } : null)
    })
    const fit = () => {
      cy.resize()
      cy.fit(undefined, 40)
    }
    requestAnimationFrame(fit)
    graph.current = cy
    return () => {
      cy.destroy()
      graph.current = null
    }
  }, [heard, devices, nameFor])

  const wifi = selected?.kind === 'wifi' ? selected.group : null
  const bluetooth = selected?.kind === 'bluetooth' ? selected.device : null

  return (
    <div className="panel">
      <div ref={host} className="graph" />
      {groups.length === 0 && devices.length === 0 && <p className="empty">Nothing heard in the latest scan.</p>}
      <SignalLegend />
      <ul className="legend">
        {(Object.keys(SECURITY_COLORS) as SecurityLabel[]).map((label) => (
          <li key={label}><i style={{ background: SECURITY_COLORS[label] }} />{label}</li>
        ))}
      </ul>
      {wifi && (
        <article className="card">
          <SignalStack id={wifi.id} fallback={wifi.label} signals={[{ kind: 'wifi', title: wifi.label, detail: `${wifi.security} · best ${wifi.bestRssi} dBm` }]} draftFor={draftFor} rename={rename} />
          <p>{wifi.networks.length} BSSID{wifi.networks.length === 1 ? '' : 's'}</p>
          {wifi.networks.map((network) => (
            <SignalStack key={network.bssid} id={network.bssid} fallback={network.hidden || !network.ssid ? network.bssid : network.ssid} signals={networkSignals(network)} draftFor={draftFor} rename={rename} />
          ))}
          <table>
            <thead>
              <tr><th>BSSID</th><th>Channel</th><th>RSSI</th><th>Seen</th></tr>
            </thead>
            <tbody>
              {wifi.networks.map((network) => (
                <tr key={network.bssid}>
                  <td>{nameFor(network.bssid, network.hidden || !network.ssid ? network.bssid : network.ssid)}</td>
                  <td>{network.channel} {network.band} GHz</td>
                  <td>{network.lastRssi} dBm</td>
                  <td>{network.seenCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="meta">
            <div><dt>Standard</dt><dd>{wifi.networks[0].wifiStandard}</dd></div>
            <div><dt>Width</dt><dd>{wifi.networks[0].channelWidthMhz} MHz</dd></div>
            <div><dt>Country</dt><dd>{wifi.networks[0].countryCode ?? 'Unknown'}</dd></div>
            <div><dt>Max rate</dt><dd>{wifi.networks[0].maxRateMbps ?? 'Unknown'} Mbps</dd></div>
            <div><dt>Capabilities</dt><dd>{wifi.networks[0].capabilities || 'Open beacon'}</dd></div>
          </dl>
        </article>
      )}
      {bluetooth && (
        <article className="card">
          <SignalStack
            id={bluetooth.address}
            fallback={deviceTitle(bluetooth)}
            signals={deviceSignals(bluetooth)}
            enrichments={bluetooth.enrichment ? [bluetooth.enrichment] : []}
            draftFor={draftFor}
            rename={rename}
          />
          <dl className="meta">
            <div><dt>Address</dt><dd>{bluetooth.address}</dd></div>
            <div><dt>Address type</dt><dd>{addressTypeLabel(bluetooth.addressType)}</dd></div>
            <div><dt>RSSI</dt><dd>{bluetooth.lastRssi} dBm</dd></div>
            <div><dt>Transmit power</dt><dd>{bluetooth.txPower == null ? 'Unknown' : `${bluetooth.txPower} dBm`}</dd></div>
            <div><dt>Seen</dt><dd>{bluetooth.seenCount}</dd></div>
            <div><dt>Services</dt><dd>{bluetooth.serviceUuids.length ? bluetooth.serviceUuids.join(', ') : 'None'}</dd></div>
          </dl>
        </article>
      )}
    </div>
  )
}
