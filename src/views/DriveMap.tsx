import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { api } from '../api'
import { floorLabel, gpsGround, plottedHeight } from '../height'
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

export function DriveMap({
  map,
  focus,
  onPlaceSaved,
}: {
  map: MapState | null
  focus: { lat: number; lon: number; label: string } | null
  onPlaceSaved?: () => void
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
  const remembered = useRef(new Map<string, PlaceInfo>())

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
        fillColor: '#7dcea0',
        fillOpacity: 1,
      }).addTo(group)
      phone.on('click', () => {
        void openCard('This phone', map.phone.lat!, map.phone.lon!, undefined, undefined, levelLabel(map, null), null)
      })
    }
    for (const network of map.networks) {
      if (network.bestLat == null || network.bestLon == null) continue
      const marker = L.circleMarker([network.bestLat, network.bestLon], {
        radius: circleBssids.has(network.bssid) ? 7 : 5,
        color: circleBssids.has(network.bssid) ? '#e7f0ea' : '#8aa398',
        fillColor: circleBssids.has(network.bssid) ? '#e85d4c' : '#3d8bfd',
        fillOpacity: 0.9,
      }).addTo(group)
      const title = network.hidden || !network.ssid ? network.bssid : network.ssid
      marker.bindTooltip(title)
      marker.on('click', () => {
        void openCard(title, network.bestLat!, network.bestLon!, network.bssid, network.place, levelLabel(map, network), network)
      })
    }
    if (map.phone.lat != null && map.phone.lon != null) {
      mapView.setView([map.phone.lat, map.phone.lon], 16)
    }
    mapView.invalidateSize()
  }, [map])

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

  return (
    <div className="panel">
      <div ref={host} className="map" />
      {card && (
        <article className="card">
          <h2>{card.title}</h2>
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
