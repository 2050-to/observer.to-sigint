import { haversineMeters } from './geo.js'

export interface PlaceLookup {
  address: string
  crossStreets: string[]
}

const USER_AGENT = 'wifi-mapping/0.1 (local wardrive)'

interface NominatimResponse {
  display_name?: string
  address?: {
    house_number?: string
    road?: string
    city?: string
    town?: string
    village?: string
    hamlet?: string
  }
}

interface OverpassElement {
  tags?: { name?: string }
  center?: { lat: number; lon: number }
}

export async function lookupPlace(lat: number, lon: number): Promise<PlaceLookup> {
  const [address, crossStreets] = await Promise.all([
    reverseAddress(lat, lon),
    nearestRoads(lat, lon).catch(() => [] as string[]),
  ])
  return { address, crossStreets }
}

async function reverseAddress(lat: number, lon: number): Promise<string> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lon))
  url.searchParams.set('addressdetails', '1')
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`address lookup failed (${response.status})`)
  const body = (await response.json()) as NominatimResponse
  const city = body.address?.city || body.address?.town || body.address?.village || body.address?.hamlet
  const parts = [body.address?.house_number, body.address?.road, city].filter(Boolean)
  if (parts.length > 0) return parts.join(' ')
  if (body.display_name) return body.display_name
  throw new Error('address lookup returned no place')
}

const OVERPASS_ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]

async function nearestRoads(lat: number, lon: number): Promise<string[]> {
  const query = `[out:json][timeout:6];way(around:40,${lat},${lon})["highway"]["name"];out tags center;`
  const settled = await Promise.allSettled(OVERPASS_ENDPOINTS.map((endpoint) => overpass(endpoint, query)))
  const valid = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  const withNames = valid.find((body) => (body.elements ?? []).some((element) => element.tags?.name && element.center))
  if (!withNames && valid.length === 0) throw new Error('cross street lookup failed')
  return rankRoads(lat, lon, withNames ?? valid[0])
}

async function overpass(endpoint: string, query: string): Promise<{ elements?: OverpassElement[]; osm3s?: { timestamp_osm_base?: string } }> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'text/plain' },
    body: query,
    signal: AbortSignal.timeout(7000),
  })
  if (!response.ok) throw new Error(`cross street lookup failed (${response.status})`)
  const body = (await response.json()) as { elements?: OverpassElement[]; osm3s?: { timestamp_osm_base?: string } }
  if (!/^\d{4}-\d{2}-\d{2}/.test(body.osm3s?.timestamp_osm_base ?? '')) {
    throw new Error('cross street lookup returned an unusable result')
  }
  return body
}

function rankRoads(lat: number, lon: number, body: { elements?: OverpassElement[] }): string[] {
  const ranked = (body.elements ?? [])
    .map((element) => {
      const name = element.tags?.name?.trim()
      if (!name || !element.center) return null
      return {
        name,
        distance: haversineMeters(lat, lon, element.center.lat, element.center.lon),
      }
    })
    .filter((item): item is { name: string; distance: number } => item !== null)
    .sort((a, b) => a.distance - b.distance)
  const names: string[] = []
  for (const item of ranked) {
    if (!names.includes(item.name)) names.push(item.name)
    if (names.length === 2) break
  }
  return names
}
