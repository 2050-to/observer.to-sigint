import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { estimateLabelSize, labelEdgeTowardAnchor, leaderIsClear, spreadLabels } from '../../shared/labelLayout'
import { placeCovers, postalCellKey, postalLabel, samePostalCell, unionPostalCodes } from '../../shared/postal'
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

type MapPin = {
  key: string
  text: string
  marker: L.CircleMarker
  leader: L.Polyline
}

type PlaceCard = {
  title: string
  place: PlaceInfo | null
  postalCodes: string[]
  error: string
  floor: string | null
  ssid: string | null
  bestRssi: number | null
  lastSeen: string | null
  pinKey: string
  lat: number
  lon: number
}

function pinForCard(map: MapState, pinKey: string): {
  lat: number
  lon: number
  bssid?: string
  place: PlaceInfo | null
  level: string | null
  network: NetworkRecord | null
  codes: string[]
} | null {
  if (pinKey === 'phone') {
    if (map.phone.lat == null || map.phone.lon == null) return null
    return {
      lat: map.phone.lat,
      lon: map.phone.lon,
      place: null,
      level: levelLabel(map, null),
      network: null,
      codes: map.postalCodes ?? [],
    }
  }
  const network = map.networks.find((item) => item.bssid === pinKey)
  if (!network || network.bestLat == null || network.bestLon == null) return null
  return {
    lat: network.bestLat,
    lon: network.bestLon,
    bssid: network.bssid,
    place: network.place,
    level: levelLabel(map, network),
    network,
    codes: network.postalCodes ?? [],
  }
}

function markerColor(marker: L.CircleMarker): string {
  const fill = marker.options.fillColor
  return typeof fill === 'string' ? fill : '#8b909a'
}

function layoutPins(mapView: L.Map, pins: MapPin[], pickedKey: string | null) {
  if (pins.length === 0) return
  const size = mapView.getSize()
  const anchors = pins.map((pin, index) => {
    const point = mapView.latLngToContainerPoint(pin.marker.getLatLng())
    const element = pin.marker.getTooltip()?.getElement()
    const color = markerColor(pin.marker)
    if (element) {
      element.style.borderLeftColor = color
      element.style.borderLeftWidth = '3px'
      element.classList.toggle('is-picked', pin.key === pickedKey)
    }
    const estimated = estimateLabelSize(pin.text)
    return {
      id: String(index),
      text: pin.text,
      x: point.x,
      y: point.y,
      width: element && element.offsetWidth > 0 ? element.offsetWidth : estimated.width,
      height: element && element.offsetHeight > 0 ? element.offsetHeight : estimated.height,
    }
  })
  const frame = size.x >= 40 && size.y >= 40
    ? { width: size.x, height: size.y, margin: 8, topMargin: 70, bottomMargin: 24 }
    : undefined
  const placed = spreadLabels(anchors, frame)
  const boxes = placed.map((spot, index) => {
    const anchor = anchors[index]
    const cx = anchor.x + spot.dx
    const cy = anchor.y + spot.dy
    return {
      left: cx - anchor.width / 2,
      top: cy - anchor.height / 2,
      right: cx + anchor.width / 2,
      bottom: cy + anchor.height / 2,
    }
  })
  placed.forEach((spot, index) => {
    const pin = pins[index]
    const anchor = anchors[index]
    const tip = pin.marker.getTooltip()
    if (tip) {
      tip.options.direction = 'center'
      tip.options.offset = L.point(spot.dx, spot.dy)
      const at = tip.getLatLng()
      if (at) tip.setLatLng(at)
      if (pin.key === pickedKey) tip.bringToFront()
    }
    if (!spot.spread) {
      pin.leader.setStyle({ opacity: 0 })
      return
    }
    const edge = labelEdgeTowardAnchor(spot.dx, spot.dy, anchor.width, anchor.height)
    const start = mapView.latLngToContainerPoint(pin.marker.getLatLng())
    const end = edge ? L.point(start.x + edge.x, start.y + edge.y) : null
    const obstacles = boxes
      .filter((_, boxIndex) => boxIndex !== index)
      .map((box) => ({
        left: box.left + 1,
        top: box.top + 1,
        right: box.right - 1,
        bottom: box.bottom - 1,
      }))
    if (!end || !leaderIsClear(start.x, start.y, end.x, end.y, obstacles)) {
      pin.leader.setStyle({ opacity: 0 })
      return
    }
    pin.leader.setLatLngs([
      pin.marker.getLatLng(),
      mapView.containerPointToLatLng(end),
    ])
    pin.leader.setStyle({ opacity: 0.95, color: markerColor(pin.marker) })
  })
}

function attachLabel(marker: L.CircleMarker, text: string, key: string, group: L.LayerGroup): MapPin {
  marker.bindTooltip(text, {
    permanent: true,
    direction: 'center',
    className: 'map-label',
    offset: [0, -16],
    interactive: true,
    opacity: 1,
  })
  const here = marker.getLatLng()
  const leader = L.polyline([here, here], {
    pane: 'label-leaders',
    color: markerColor(marker),
    weight: 1.5,
    opacity: 0,
    interactive: false,
    lineCap: 'round',
  }).addTo(group)
  return { key, text, marker, leader }
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
  const pins = useRef<MapPin[]>([])
  const [card, setCard] = useState<PlaceCard | null>(null)
  const refreshKey = useRef<string | null>(null)
  const lookupGeneration = useRef(0)
  const [busy, setBusy] = useState(false)
  const [pickedKey, setPickedKey] = useState<string | null>(null)
  const pickedRef = useRef(pickedKey)
  pickedRef.current = pickedKey
  const remembered = useRef(new Map<string, PlaceInfo>())
  const viewed = useRef(false)
  const stacks = useMemo(
    () => (map ? stackSignals({ networks: map.networks, devices: map.devices, cells: map.cells, movers: map.movers, phone: map.phone }) : []),
    [map],
  )

  useLayoutEffect(() => {
    if (!host.current || leaflet.current) return
    const next = L.map(host.current, { zoomControl: true })
    const leaders = next.createPane('label-leaders')
    leaders.style.zIndex = '640'
    leaders.style.pointerEvents = 'none'
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

  useLayoutEffect(() => {
    const mapView = leaflet.current
    const group = layer.current
    if (!mapView || !group || !map) return
    group.clearLayers()
    const placed: MapPin[] = []
    const track = (marker: L.CircleMarker, text: string, key: string) => {
      const pin = attachLabel(marker, text, key, group)
      placed.push(pin)
      return pin
    }
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
        color: '#f1f1f2',
        fillColor: SIGNAL_COLORS.gps,
        fillOpacity: 1,
      }).addTo(group)
      track(phone, nameFor('phone', 'This device'), 'phone')
      phone.on('click', () => {
        setPickedKey('phone')
        void openCard(nameFor('phone', 'This device'), map.phone.lat!, map.phone.lon!, undefined, undefined, levelLabel(map, null), null, map.postalCodes ?? [])
      })
    }
    for (const network of map.networks) {
      if (network.bestLat == null || network.bestLon == null) continue
      const marker = L.circleMarker([network.bestLat, network.bestLon], {
        radius: circleBssids.has(network.bssid) ? 7 : 5,
        color: '#f1f1f2',
        fillColor: SIGNAL_COLORS.wifi,
        fillOpacity: 0.9,
      }).addTo(group)
      const title = network.hidden || !network.ssid ? network.bssid : network.ssid
      track(marker, nameFor(network.bssid, title), network.bssid)
      marker.on('click', () => {
        setPickedKey(network.bssid)
        void openCard(nameFor(network.bssid, title), network.bestLat!, network.bestLon!, network.bssid, network.place, levelLabel(map, network), network, network.postalCodes ?? [])
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
      track(marker, nameFor(device.address, title), device.address)
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
      track(marker, nameFor(room.id, room.originLabel), room.id)
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
        track(marker, nameFor(cell.key, label), cell.key)
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
      track(marker, nameFor(cell.key, `${label}, heard here`), cell.key)
      marker.on('click', () => setPickedKey(cell.key))
    }
    if (!viewed.current && map.phone.lat != null && map.phone.lon != null) {
      mapView.setView([map.phone.lat, map.phone.lon], 16)
      viewed.current = true
    }
    pins.current = placed
    mapView.invalidateSize()
    const layout = () => layoutPins(mapView, placed, pickedRef.current)
    const hideLeaders = () => {
      for (const pin of placed) pin.leader.setStyle({ opacity: 0 })
    }
    layout()
    const frame = requestAnimationFrame(layout)
    mapView.on('zoomstart', hideLeaders)
    mapView.on('zoomend', layout)
    mapView.on('resize', layout)
    return () => {
      cancelAnimationFrame(frame)
      mapView.off('zoomstart', hideLeaders)
      mapView.off('zoomend', layout)
      mapView.off('resize', layout)
      pins.current = []
    }
  }, [map, nameFor])

  useEffect(() => {
    for (const pin of pins.current) {
      const element = pin.marker.getTooltip()?.getElement()
      element?.classList.toggle('is-picked', pin.key === pickedKey)
      if (pin.key === pickedKey) pin.marker.getTooltip()?.bringToFront()
    }
  }, [pickedKey])

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
    codes: string[] = [],
  ) {
    const generation = ++lookupGeneration.current
    const pinKey = bssid ?? 'phone'
    const known = [cached, remembered.current.get(pinKey)].find((place) => place && placeCovers(place, lat, lon)) ?? null
    const ready = known && 'elevationM' in known ? known : null
    const facts = {
      ssid: network ? (network.ssid || 'Hidden') : null,
      bestRssi: network?.bestRssi ?? null,
      lastSeen: network?.lastSeen ?? null,
      postalCodes: codes,
      pinKey,
      lat,
      lon,
    }
    if (ready) {
      setCard({ title, place: ready, floor: level ?? null, ...facts, error: ready.crossStreets.length === 0 ? 'Cross streets were not available.' : '' })
      return
    }
    if (!navigator.onLine) {
      setCard({
        title,
        place: null,
        floor: level ?? null,
        ...facts,
        error: 'The address will be looked up when the device is online.',
      })
      return
    }
    setBusy(true)
    setCard({ title, place: null, floor: level ?? null, ...facts, error: '' })
    try {
      const result = await api.place({ bssid, lat, lon })
      if (generation !== lookupGeneration.current) return
      remembered.current.set(pinKey, result.place)
      const postalCodes = unionPostalCodes([codes, result.postalCodes, result.network?.postalCodes])
      setCard({ title, place: result.place, floor: level ?? null, ...facts, postalCodes, error: result.place.crossStreets.length === 0 ? 'Cross streets were not available.' : '' })
      onPlaceSaved?.()
    } catch (error) {
      if (generation !== lookupGeneration.current) return
      const offline = !navigator.onLine || error instanceof TypeError
      setCard({
        title,
        place: null,
        floor: level ?? null,
        ...facts,
        error: offline ? 'The address will be looked up when the device is online.' : error instanceof Error ? error.message : 'Lookup failed',
      })
    } finally {
      if (generation === lookupGeneration.current) setBusy(false)
    }
  }

  useEffect(() => {
    if (!map || !card) return
    const pin = pinForCard(map, card.pinKey)
    if (!pin) return
    if (!samePostalCell(card.lat, card.lon, pin.lat, pin.lon)) {
      const key = `${card.pinKey}:${postalCellKey(pin.lat, pin.lon)}`
      if (refreshKey.current === key) return
      refreshKey.current = key
      void openCard(card.title, pin.lat, pin.lon, pin.bssid, pin.place, pin.level, pin.network, pin.codes)
      return
    }
    refreshKey.current = null
    const postalCodes = unionPostalCodes([card.postalCodes, pin.codes])
    if (postalCodes.join('\n') === card.postalCodes.join('\n')) return
    setCard({ ...card, postalCodes })
  }, [map, card])

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
              {card.place.elevationM != null && <p>Ground elevation {card.place.elevationM.toFixed(1)} m (Open-Meteo)</p>}
            </>
          )}
          {postalLabel(card.postalCodes) && <p>{postalLabel(card.postalCodes)}</p>}
          {card.error && <p className="warn">{card.error}</p>}
        </article>
      )}
    </div>
  )
}
