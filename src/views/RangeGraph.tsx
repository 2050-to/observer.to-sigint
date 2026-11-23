import { useEffect, useMemo, useRef, useState } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import { labelIds, onlyHeard } from '../../shared/accessPoints'
import { SIGNAL_COLORS, type SignalRow } from '../../shared/sources'
import { SignalLegend, SignalStack } from '../SignalStack'
import {
  SECURITY_COLORS,
  type AccessPoint,
  type AdvertiserGroup,
  type DeviceRecord,
  type NetworkRecord,
  type SecurityLabel,
} from '../types'

type Selection = { kind: 'wifi' | 'bluetooth'; id: string }

function ring(rssi: number): number {
  if (rssi >= -50) return 4
  if (rssi >= -60) return 3
  if (rssi >= -70) return 2
  return 1
}

function advertiserSignals(group: AdvertiserGroup): SignalRow[] {
  const count = group.devices.length
  const signals: SignalRow[] = group.named
    ? group.devices.map((device): SignalRow => ({
      kind: 'bluetooth',
      title: device.name?.trim() || group.label,
      detail: `${device.lastRssi} dBm · ${device.address}`,
    }))
    : [{ kind: 'bluetooth', title: group.label, detail: `${count} address${count === 1 ? '' : 'es'} · strongest ${group.best.bestRssi} dBm` }]
  const spot = group.devices.find((device) => device.bestLat != null && device.bestLon != null)
  if (spot?.bestLat != null && spot.bestLon != null) {
    signals.push({ kind: 'gps', title: 'Fix', detail: `${spot.bestLat.toFixed(5)}, ${spot.bestLon.toFixed(5)}` })
  }
  return signals
}

function addressTypeLabel(addressType: DeviceRecord['addressType']): string {
  return addressType === 'public' ? 'Public' : 'Random'
}

export function RangeGraph({
  heard,
  devices,
  accessPoints,
  advertisers,
  nameFor,
  nameForGroup,
  draftFor,
  rename,
}: {
  heard: NetworkRecord[]
  devices: DeviceRecord[]
  accessPoints: AccessPoint[]
  advertisers: AdvertiserGroup[]
  nameFor: (id: string, fallback: string) => string
  nameForGroup: (ids: string[], fallback: string) => string
  draftFor: (id: string, fallback: string) => string
  rename: (id: string, value: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const graph = useRef<Core | null>(null)
  const [selected, setSelected] = useState<Selection | null>(null)
  const heardAps = useMemo(() => onlyHeard(accessPoints, heard.map((network) => network.bssid)), [accessPoints, heard])
  const heardGroups = useMemo(() => onlyHeard(advertisers, devices.map((device) => device.address)), [advertisers, devices])

  useEffect(() => {
    if (!host.current) return
    graph.current?.destroy()
    const spots = [
      ...heardAps.map((ap) => ({
        id: ap.id,
        label: nameForGroup(labelIds(ap), ap.label),
        color: SIGNAL_COLORS.wifi,
        size: 28 + Math.min(ap.networks.length, 6) * 8,
        rssi: ap.best.bestRssi,
      })),
      ...heardGroups.map((group) => {
        const name = nameForGroup(labelIds(group), group.label)
        return {
          id: `bluetooth:${group.id}`,
          label: group.named ? name : `${name} · ${group.devices.length}`,
          color: SIGNAL_COLORS.bluetooth,
          size: 28 + Math.min(group.devices.length - 1, 6) * 8,
          rssi: group.best.bestRssi,
        }
      }),
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
      if (heardAps.some((ap) => ap.id === id)) {
        setSelected({ kind: 'wifi', id })
        return
      }
      const group = heardGroups.find((item) => `bluetooth:${item.id}` === id)
      setSelected(group ? { kind: 'bluetooth', id: group.id } : null)
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
  }, [heardAps, heardGroups, nameFor, nameForGroup])

  const wifi = selected?.kind === 'wifi' ? heardAps.find((ap) => ap.id === selected.id) ?? null : null
  const bluetooth = selected?.kind === 'bluetooth' ? heardGroups.find((group) => group.id === selected.id) ?? null : null
  const wifiTitle = wifi ? nameForGroup(labelIds(wifi), wifi.label) : ''
  const radioCount = wifi ? accessPoints.find((ap) => ap.id === wifi.id)?.networks.length ?? wifi.networks.length : 0
  const services = bluetooth ? [...new Set(bluetooth.devices.flatMap((device) => device.serviceUuids))] : []

  return (
    <div className="panel fill-view">
      <div ref={host} className="graph" />
      {heardAps.length === 0 && heardGroups.length === 0 && <p className="empty">Nothing heard in the latest scan.</p>}
      <SignalLegend />
      <ul className="legend">
        {(Object.keys(SECURITY_COLORS) as SecurityLabel[]).map((label) => (
          <li key={label}><i style={{ background: SECURITY_COLORS[label] }} />{label}</li>
        ))}
      </ul>
      {wifi && (
        <article className="card">
          <SignalStack
            id={wifi.id}
            fallback={wifiTitle}
            signals={[{ kind: 'wifi', title: wifiTitle, detail: `${wifi.best.security} · best ${wifi.best.bestRssi} dBm` }]}
            draftFor={draftFor}
            rename={rename}
          />
          {wifi.ssids.length > 0 && <p>{wifi.ssids.length === 1 ? 'SSID' : 'SSIDs'} {wifi.ssids.join(', ')}</p>}
          <p>{wifi.networks.length} of {radioCount} radio{radioCount === 1 ? '' : 's'} in the latest scan</p>
          <table>
            <thead>
              <tr><th>BSSID</th><th>SSID</th><th>Band</th><th>Channel</th><th>RSSI</th><th>Seen</th></tr>
            </thead>
            <tbody>
              {wifi.networks.map((network) => (
                <tr key={network.bssid}>
                  <td>{network.bssid}</td>
                  <td>{network.hidden || !network.ssid ? 'Hidden' : network.ssid}</td>
                  <td>{network.band} GHz</td>
                  <td>{network.channel}</td>
                  <td>{network.lastRssi} dBm</td>
                  <td>{network.seenCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="meta">
            <div><dt>Standard</dt><dd>{wifi.best.wifiStandard}</dd></div>
            <div><dt>Width</dt><dd>{wifi.best.channelWidthMhz} MHz</dd></div>
            <div><dt>Country</dt><dd>{wifi.best.countryCode ?? 'Unknown'}</dd></div>
            <div><dt>Max rate</dt><dd>{wifi.best.maxRateMbps ?? 'Unknown'} Mbps</dd></div>
            <div><dt>Capabilities</dt><dd>{wifi.best.capabilities || 'Open beacon'}</dd></div>
          </dl>
        </article>
      )}
      {bluetooth && (
        <article className="card">
          <SignalStack
            id={bluetooth.id}
            fallback={nameForGroup(labelIds(bluetooth), bluetooth.label)}
            signals={advertiserSignals(bluetooth)}
            enrichments={bluetooth.devices.flatMap((device) => (device.enrichment ? [device.enrichment] : []))}
            draftFor={draftFor}
            rename={rename}
          />
          {bluetooth.named ? (
            <dl className="meta">
              <div>
                <dt>{bluetooth.devices.length === 1 ? 'Address' : 'Addresses'}</dt>
                <dd>{bluetooth.devices.map((device) => device.address).join(', ')}</dd>
              </div>
              <div><dt>Address type</dt><dd>{addressTypeLabel(bluetooth.best.addressType)}</dd></div>
              <div><dt>RSSI</dt><dd>{bluetooth.best.lastRssi} dBm</dd></div>
              <div><dt>Transmit power</dt><dd>{bluetooth.best.txPower == null ? 'Unknown' : `${bluetooth.best.txPower} dBm`}</dd></div>
              <div><dt>Seen</dt><dd>{bluetooth.devices.reduce((sum, device) => sum + device.seenCount, 0)}</dd></div>
              <div><dt>Services</dt><dd>{services.length ? services.join(', ') : 'None'}</dd></div>
            </dl>
          ) : (
            <dl className="meta">
              <div><dt>Addresses</dt><dd>{bluetooth.devices.length}</dd></div>
              <div><dt>Strongest</dt><dd>{bluetooth.best.bestRssi} dBm</dd></div>
            </dl>
          )}
        </article>
      )}
    </div>
  )
}
