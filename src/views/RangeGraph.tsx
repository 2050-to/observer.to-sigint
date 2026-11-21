import { useEffect, useRef, useState } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import { SIGNAL_COLORS, type SignalRow } from '../../shared/sources'
import { SignalLegend, SignalStack } from '../SignalStack'
import { SECURITY_COLORS, type NetworkRecord, type SecurityLabel } from '../types'

export interface SsidGroup {
  id: string
  label: string
  security: SecurityLabel
  bestRssi: number
  networks: NetworkRecord[]
}

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

export function RangeGraph({
  heard,
  nameFor,
  draftFor,
  rename,
}: {
  heard: NetworkRecord[]
  nameFor: (id: string, fallback: string) => string
  draftFor: (id: string, fallback: string) => string
  rename: (id: string, value: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const graph = useRef<Core | null>(null)
  const [selected, setSelected] = useState<SsidGroup | null>(null)
  const groups = groupHeard(heard)

  useEffect(() => {
    setSelected((current) => (current ? groups.find((group) => group.id === current.id) ?? null : null))
  }, [heard])

  useEffect(() => {
    if (!host.current) return
    graph.current?.destroy()
    const cy = cytoscape({
      container: host.current,
      elements: [
        { data: { id: 'phone', label: nameFor('phone', 'This phone'), color: SIGNAL_COLORS.gps, size: 36 }, position: { x: 0, y: 0 } },
        ...groups.flatMap((group, index) => {
          const distance = (5 - ring(group.bestRssi)) * 130 + 110
          const angle = (index / Math.max(groups.length, 1)) * Math.PI * 2 - Math.PI / 2
          return [
            {
              data: {
                id: group.id,
                label: nameFor(group.id, group.label),
                color: SIGNAL_COLORS.wifi,
                size: 28 + Math.min(group.networks.length, 6) * 8,
              },
              position: { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance },
            },
            { data: { id: `edge-${group.id}`, source: 'phone', target: group.id } },
          ]
        }),
      ],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'background-color': 'data(color)',
            color: '#e7f0ea',
            'font-size': 11,
            'text-valign': 'bottom',
            'text-margin-y': 6,
            width: 'data(size)',
            height: 'data(size)',
            'text-outline-width': 2,
            'text-outline-color': '#121714',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': '#3d4f46',
            opacity: 0.8,
          },
        },
      ],
      layout: { name: 'preset', fit: true, padding: 48 },
      userZoomingEnabled: true,
    })
    cy.on('tap', 'node', (event) => {
      const id = event.target.id() as string
      setSelected(groups.find((group) => group.id === id) ?? null)
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
  }, [heard, nameFor])

  return (
    <div className="panel">
      <div ref={host} className="graph" />
      {groups.length === 0 && <p className="empty">No networks in the latest scan.</p>}
      <SignalLegend />
      <ul className="legend">
        {(Object.keys(SECURITY_COLORS) as SecurityLabel[]).map((label) => (
          <li key={label}><i style={{ background: SECURITY_COLORS[label] }} />{label}</li>
        ))}
      </ul>
      {selected && (
        <article className="card">
          <SignalStack id={selected.id} fallback={selected.label} signals={[{ kind: 'wifi', title: selected.label, detail: `${selected.security} · best ${selected.bestRssi} dBm` }]} draftFor={draftFor} rename={rename} />
          <p>{selected.networks.length} BSSID{selected.networks.length === 1 ? '' : 's'}</p>
          {selected.networks.map((network) => (
            <SignalStack key={network.bssid} id={network.bssid} fallback={network.hidden || !network.ssid ? network.bssid : network.ssid} signals={networkSignals(network)} draftFor={draftFor} rename={rename} />
          ))}
          <table>
            <thead>
              <tr><th>BSSID</th><th>Channel</th><th>RSSI</th><th>Seen</th></tr>
            </thead>
            <tbody>
              {selected.networks.map((network) => (
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
            <div><dt>Standard</dt><dd>{selected.networks[0].wifiStandard}</dd></div>
            <div><dt>Width</dt><dd>{selected.networks[0].channelWidthMhz} MHz</dd></div>
            <div><dt>Country</dt><dd>{selected.networks[0].countryCode ?? 'Unknown'}</dd></div>
            <div><dt>Max rate</dt><dd>{selected.networks[0].maxRateMbps ?? 'Unknown'} Mbps</dd></div>
            <div><dt>Capabilities</dt><dd>{selected.networks[0].capabilities || 'Open beacon'}</dd></div>
          </dl>
        </article>
      )}
    </div>
  )
}
