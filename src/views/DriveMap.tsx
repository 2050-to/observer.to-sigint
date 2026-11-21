import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { roomSignals, SIGNAL_COLORS, stackFor, stackSignals, type SignalRow } from '../../shared/sources'
import { api } from '../api'
import { floorLabel, gpsGround, plottedHeight } from '../height'
import { SignalLegend, SignalStack } from '../SignalStack'
import { streetTiles } from '../tiles'
import type { MapState, NetworkRecord, PlaceInfo } from '../types'

function levelLabel(map: MapState, network: NetworkRecord | null): string | null {
  const ground = gpsGround([
    { altitudeM: map.phone.altitudeM ?? null },
    ...map.networks.map((item) => ({ altitudeM: item.bestAltitudeM ?? null })),
  ])
  const point = network
    ? {
        altitudeM: network.bestAltitudeM ?? null,
        verticalAccuracyM: network.bestVerticalAccuracyM ?? null,
        relativeM: network.bestRelativeM ?? null,
      }
    : {
        altitudeM: map.phone.altitudeM ?? null,
        verticalAccuracyM: map.phone.verticalAccuracyM ?? null,
        relativeM: map.phone.relativeM ?? null,
      }
  return floorLabel(plottedHeight(point, ground))
}

function pin(marker: L.CircleMarker, text: string) {
  marker.bindTooltip(text, { permanent: true, direction: 'top', className: 'map-label', offset: [0, -8] })
}

export function DriveMap({
  map,
  focus,
  onPlaceSaved,
  nameFor,
  draftFor,
  rename,
}: {
  map: MapState | null
  focus: { lat: number; lon: number; label: string } | null
  onPlaceSaved?: () => void
  nameFor: (id: string, fallback: string) => string
  draftFor: (id: string, fallback: string) => string
  rename: (id: string, value: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const leaflet = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const [card, setCard] = useState<{
    title: string
    place: PlaceInfo | null
    error: string
    floor: string | null
    ssid: string | null
    bestRssi: number | null
    lastSeen: string | null
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [pickedKey, setPickedKey] = useState<string | null>(null)
  const remembered = useRef(new Map<string, PlaceInfo>())
  const viewed = useRef(false)
  const stacks = useMemo(
    () => (map ? stackSignals({ networks: map.networks, devices: map.devices, cells: map.cells, movers: map.movers, phone: map.phone }) : []),
    [map],
  )

  useEffect(() => {
    if (!host.current || leaflet.current) return
    const next = L.map(host.current, { zoomControl: true })
    streetTiles().addTo(next)
    next.setView([47.62, -122.35], 15)
    layer.current = L.layerGroup().addTo(next)
    leaflet.current = next
    const observer = new ResizeObserver(() => next.invalidateSize())
    observer.observe(host.current)
    return () => {
      observer.disconnect()
      next.remove()
      leaflet.current = null
    }
  }, [])

  useEffect(() => {
    const mapView = leaflet.current
    const group = layer.current
    if (!mapView || !group || !map) return
    group.clearLayers()
    const circleBssids = new Set(map.circle.map((network) => network.bssid))
    if (map.phone.lat != null && map.phone.lon != null) {
      L.circle([map.phone.lat, map.phone.lon], {
        radius: map.radiusM,
        color: '#7dcea0',
        weight: 1,
        fillOpacity: 0.08,
      }).addTo(group)
      const phone = L.circleMarker([map.phone.lat, map.phone.lon], {
        radius: 8,
        color: '#e7f0ea',
        fillColor: SIGNAL_COLORS.gps,
        fillOpacity: 1,
      }).addTo(group)
      pin(phone, nameFor('phone', 'This phone'))
      phone.on('click', () => {
        setPickedKey('phone')
        void openCard(nameFor('phone', 'This phone'), map.phone.lat!, map.phone.lon!, undefined, undefined, levelLabel(map, null), null)
      })
    }
    for (const network of map.networks) {
      if (network.bestLat == null || network.bestLon == null) continue
      const marker = L.circleMarker([network.bestLat, network.bestLon], {
        radius: circleBssids.has(network.bssid) ? 7 : 5,
        color: '#e7f0ea',
        fillColor: SIGNAL_COLORS.wifi,
        fillOpacity: 0.9,
      }).addTo(group)
      const title = network.hidden || !network.ssid ? network.bssid : network.ssid
      pin(marker, nameFor(network.bssid, title))
      marker.on('click', () => {
        setPickedKey(network.bssid)
        void openCard(nameFor(network.bssid, title), network.bestLat!, network.bestLon!, network.bssid, network.place, levelLabel(map, network), network)
      })
    }
    for (const device of map.devices ?? []) {
      if (device.bestLat == null || device.bestLon == null) continue
      const marker = L.circleMarker([device.bestLat, device.bestLon], {
        radius: 5,
        color: SIGNAL_COLORS.bluetooth,
        fillColor: SIGNAL_COLORS.bluetooth,
        fillOpacity: 0.95,
      }).addTo(group)
      const title = device.name || device.address
      pin(marker, nameFor(device.address, title))
      marker.on('click', () => setPickedKey(device.address))
    }
    for (const room of map.rooms) {
      if (room.lat == null || room.lon == null) continue
      const marker = L.circleMarker([room.lat, room.lon], {
        radius: 6,
        color: SIGNAL_COLORS[room.originKind],
        fillColor: SIGNAL_COLORS[room.originKind],
        fillOpacity: 0.85,
      }).addTo(group)
      pin(marker, nameFor(room.id, room.originLabel))
      marker.on('click', () => setPickedKey(room.id))
    }
    for (const cell of map.cells ?? []) {
      const serving = cell.role === 'serving'
      const color = SIGNAL_COLORS.cell
      const label = serving ? 'Serving tower' : 'Remote tower'
      if (cell.siteLat != null && cell.siteLon != null) {
        const marker = L.circleMarker([cell.siteLat, cell.siteLon], {
          radius: 8,
          color,
          fillColor: color,
          fillOpacity: 0.95,
        }).addTo(group)
        pin(marker, nameFor(cell.key, label))
        marker.on('click', () => setPickedKey(cell.key))
        continue
      }
      if (cell.bestLat == null || cell.bestLon == null) continue
      const heard = [...cell.observations].reverse().find((item) => item.distanceM != null)
      const radius = Math.min(cell.timingAdvanceM ?? heard?.distanceM ?? 800, 2000)
      L.circle([cell.bestLat, cell.bestLon], {
        radius,
        color,
        weight: 1,
        fillOpacity: 0.05,
      }).addTo(group)
      const marker = L.circleMarker([cell.bestLat, cell.bestLon], {
        radius: 5,
        color,
        fillColor: color,
        fillOpacity: 0.75,
      }).addTo(group)
      pin(marker, nameFor(cell.key, `${label}, heard here`))
      marker.on('click', () => setPickedKey(cell.key))
    }
    if (!viewed.current && map.phone.lat != null && map.phone.lon != null) {
      mapView.setView([map.phone.lat, map.phone.lon], 16)
      viewed.current = true
    }
    mapView.invalidateSize()
  }, [map, nameFor])

  useEffect(() => {
    if (!focus || !leaflet.current) return
    leaflet.current.flyTo([focus.lat, focus.lon], 17)
  }, [focus])

  async function openCard(
    title: string,
    lat: number,
    lon: number,
    bssid?: string,
    cached?: PlaceInfo | null,
    level?: string | null,
    network?: NetworkRecord | null,
  ) {
    const key = bssid ?? 'phone'
    const known = cached ?? remembered.current.get(key)
    const facts = {
      ssid: network ? (network.ssid || 'Hidden') : null,
      bestRssi: network?.bestRssi ?? null,
      lastSeen: network?.lastSeen ?? null,
    }
    if (known) {
      setCard({ title, place: known, floor: level ?? null, ...facts, error: known.crossStreets.length === 0 ? 'Cross streets were not available.' : '' })
      return
    }
    if (!navigator.onLine) {
      setCard({ title, place: null, floor: level ?? null, ...facts, error: 'The address will be looked up when the phone is online.' })
      return
    }
    setBusy(true)
    setCard({ title, place: null, floor: level ?? null, ...facts, error: '' })
    try {
      const result = await api.place({ bssid, lat, lon })
      remembered.current.set(key, result.place)
      setCard({ title, place: result.place, floor: level ?? null, ...facts, error: result.place.crossStreets.length === 0 ? 'Cross streets were not available.' : '' })
      onPlaceSaved?.()
    } catch (error) {
      const offline = !navigator.onLine || error instanceof TypeError
      setCard({
        title,
        place: null,
        floor: level ?? null,
        ...facts,
        error: offline ? 'The address will be looked up when the phone is online.' : error instanceof Error ? error.message : 'Lookup failed',
      })
    } finally {
      setBusy(false)
    }
  }

  const pickedRoom = map?.rooms.find((room) => room.id === pickedKey) ?? null
  const pickedStack = pickedKey ? stackFor(stacks, pickedKey) : null
  const pickedSignals: SignalRow[] = pickedRoom ? roomSignals(pickedRoom) : pickedStack?.signals ?? []
  const pickedId = pickedRoom?.id ?? pickedStack?.id ?? pickedKey ?? ''
  const pickedFallback = pickedRoom?.originLabel ?? pickedStack?.label ?? card?.title ?? 'Selection'

  return (
    <div className="panel">
      <SignalLegend />
      <div ref={host} className="map" />
      {pickedSignals.length > 0 && (
        <article className="card">
          <SignalStack id={pickedId} fallback={pickedFallback} signals={pickedSignals} draftFor={draftFor} rename={rename} />
        </article>
      )}
      {card && (
        <article className="card">
          <h2>{nameFor(pickedId || 'place', card.title)}</h2>
          {card.ssid && <p>SSID {card.ssid}</p>}
          {card.bestRssi != null && <p>Best signal {card.bestRssi} dBm</p>}
          {card.lastSeen && <p>Last seen {new Date(card.lastSeen).toLocaleString()}</p>}
          {busy && <p>Looking up the address.</p>}
          {card.floor && <p>{card.floor}</p>}
          {card.place && (
            <>
              <p>{card.place.address}</p>
              <p>Cross streets: {card.place.crossStreets.length > 0 ? card.place.crossStreets.join(' and ') : 'None found'}</p>
            </>
          )}
          {card.error && <p className="warn">{card.error}</p>}
        </article>
      )}
    </div>
  )
}
