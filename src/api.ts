import { clearSession, sessionToken } from './session'
import type { EnrichmentQueueStatus, MapState, NetworkRecord, OpenRow, PlaceInfo, RangeSnapshot } from './types'

export interface Account {
  id: string
  email: string
  alerts: { status: string; currentPeriodEnd: string | null; portal: boolean }
  consent: {
    accepted: boolean
    bornOn: string | null
    tosVersion: string | null
    privacyVersion: string | null
    currentTosVersion: string
    currentPrivacyVersion: string
  }
  owned: {
    addresses: boolean
    details: boolean
  }
}

export interface LegalDocuments {
  tosVersion: string
  privacyVersion: string
  terms: string
  privacy: string
}

export interface WifiPlace {
  bssid: string
  ssid: string
  channel: number | null
  security: string | null
  lat: number | null
  lon: number | null
  city: string | null
  state: string | null
  zip: string | null
  lastSeen: string
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const token = sessionToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init?.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers })
  if (response.status === 401 && token && !path.startsWith('/api/auth/')) {
    clearSession()
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
  requestLink: (email: string, client?: 'mac'): Promise<void> =>
    request('/api/auth/request', {
      method: 'POST',
      body: JSON.stringify(client ? { email, client } : { email }),
    }).then(() => undefined),
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
  map: async (): Promise<Omit<MapState, 'accessPoints' | 'advertisers'>> => request('/api/map').then((response) => response.json()),
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
  legal: async (): Promise<LegalDocuments> => request('/api/legal').then((response) => response.json()),
  acceptLegal: (body: { bornOn: string; tosVersion: string; privacyVersion: string }): Promise<void> =>
    request('/api/legal/accept', { method: 'POST', body: JSON.stringify(body) }).then(() => undefined),
  wifiSearch: async (filter: { zip?: string; state?: string; city?: string }): Promise<WifiPlace[]> => {
    const params = new URLSearchParams()
    if (filter.zip) params.set('zip', filter.zip)
    if (filter.state) params.set('state', filter.state)
    if (filter.city) params.set('city', filter.city)
    const body = await request(`/api/wifi?${params}`).then((response) => response.json() as Promise<{ networks: WifiPlace[] }>)
    return body.networks
  },
  saveDevice: (body: unknown): Promise<void> =>
    request('/api/device', { method: 'POST', body: JSON.stringify(body) }).then(() => undefined),
  saveOwned: (body: { addresses: boolean; details: boolean }): Promise<{ addresses: boolean; details: boolean }> =>
    request('/api/owned', { method: 'POST', body: JSON.stringify(body) }).then((response) => response.json()),
  saveLan: (body: unknown): Promise<void> =>
    request('/api/lan', { method: 'POST', body: JSON.stringify(body) }).then(() => undefined),
  ask: async (dataset: 'wifi', question: string): Promise<string> => {
    const body = await request('/api/ask', { method: 'POST', body: JSON.stringify({ dataset, question }) }).then((response) => response.json() as Promise<{ answer: string }>)
    return body.answer
  },
}
