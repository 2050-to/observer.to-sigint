import type { EnrichmentQueueStatus, MapState, NetworkRecord, OpenRow, PlaceInfo, RangeSnapshot } from './types'

const token = import.meta.env.VITE_API_TOKEN

async function request(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init?.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers })
  if (!response.ok) {
    let message = response.statusText
    try {
      const body = await response.json() as { error?: string }
      if (body.error) message = body.error
    } catch {
      message = response.statusText
    }
    throw new Error(message)
  }
  return response
}

export const api = {
  range: async (): Promise<RangeSnapshot> => request('/api/range').then((response) => response.json()),
  map: async (): Promise<MapState> => request('/api/map').then((response) => response.json()),
  open: async (): Promise<OpenRow[]> => request('/api/open').then(async (response) => {
    const body = await response.json() as { networks: OpenRow[] }
    return body.networks
  }),
  summary: async (): Promise<{ count: number; openCount: number; snapshot: RangeSnapshot }> =>
    request('/api/summary').then((response) => response.json()),
  enrichmentStatus: async (): Promise<EnrichmentQueueStatus> =>
    request('/api/enrichment/status').then((response) => response.json()),
  scan: async (body: unknown): Promise<RangeSnapshot & { applied: boolean }> =>
    request('/api/scans', { method: 'POST', body: JSON.stringify(body) }).then((response) => response.json()),
  place: async (body: { bssid?: string; lat: number; lon: number }): Promise<{ place: PlaceInfo; network?: NetworkRecord; postalCodes?: string[] }> =>
    request('/api/place', { method: 'POST', body: JSON.stringify(body) }).then((response) => response.json()),
  csv: async (): Promise<Blob> => request('/api/export.csv').then((response) => response.blob()),
  forensics: async (): Promise<Blob> => request('/api/export.md').then((response) => response.blob()),
  reset: (): Promise<void> => request('/api/reset', { method: 'POST' }).then(() => undefined),
}
