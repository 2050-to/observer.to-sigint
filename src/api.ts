import { clearSession, sessionToken } from './session'
import type { EnrichmentQueueStatus, MapState, NetworkRecord, OpenRow, PlaceInfo, RangeSnapshot } from './types'

export interface Account {
  id: string
  email: string
  alerts: { status: string; currentPeriodEnd: string | null }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const token = sessionToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init?.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers })
  if (response.status === 401 && token && !path.startsWith('/api/auth/')) {
    clearSession()
    if (window.location.pathname.startsWith('/app')) window.location.assign('/')
  }
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
  me: async (): Promise<Account> => request('/api/me').then((response) => response.json()),
  requestLink: (email: string): Promise<void> =>
    request('/api/auth/request', { method: 'POST', body: JSON.stringify({ email }) }).then(() => undefined),
  verify: async (token: string): Promise<{ token: string; email: string }> =>
    request('/api/auth/verify', { method: 'POST', body: JSON.stringify({ token }) }).then((response) => response.json()),
  checkout: async (): Promise<string> =>
    request('/api/billing/checkout', { method: 'POST' }).then(async (response) => {
      const body = await response.json() as { url: string }
      return body.url
    }),
  portal: async (): Promise<string> =>
    request('/api/billing/portal', { method: 'POST' }).then(async (response) => {
      const body = await response.json() as { url: string }
      return body.url
    }),
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
  postal: async (body: { lat: number; lon: number }): Promise<{ postalCode: string | null }> =>
    request('/api/postal', { method: 'POST', body: JSON.stringify(body) }).then((response) => response.json()),
  place: async (body: { bssid?: string; lat: number; lon: number }): Promise<{ place: PlaceInfo; network?: NetworkRecord; postalCodes?: string[] }> =>
    request('/api/place', { method: 'POST', body: JSON.stringify(body) }).then((response) => response.json()),
  csv: async (): Promise<Blob> => request('/api/export.csv').then((response) => response.blob()),
  forensics: async (): Promise<Blob> => request('/api/export.md').then((response) => response.blob()),
  reset: (): Promise<void> => request('/api/reset', { method: 'POST' }).then(() => undefined),
}
