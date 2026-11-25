import { clearSession, sessionToken } from './session'
import type { Disposition, DispositionKind, DispositionStatus } from '../shared/disposition'
import type { OwnedChange } from '../shared/ownedDiff'
import type { WeeklyReview } from '../shared/review'
import type { SiteDraft, SiteRecord } from '../shared/sites'
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
  country?: string | null
  region?: string | null
  locality?: string | null
  postal?: string | null
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
  verify: async (token: string, client?: 'web' | 'mac' | 'android'): Promise<{ token: string; email: string }> =>
    request('/api/auth/verify', { method: 'POST', body: JSON.stringify({ token, client }) }).then((response) => response.json()),
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
  wifiSearch: async (filter: { zip?: string; state?: string; city?: string; country?: string; region?: string; locality?: string; postal?: string }): Promise<WifiPlace[]> => {
    const params = new URLSearchParams()
    if (filter.country) params.set('country', filter.country)
    if (filter.region) params.set('region', filter.region)
    if (filter.locality) params.set('locality', filter.locality)
    if (filter.postal) params.set('postal', filter.postal)
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
  saveLan: async (body: unknown): Promise<{ count: number; changes: OwnedChange[] }> =>
    request('/api/lan', { method: 'POST', body: JSON.stringify(body) }).then((response) => response.json()),
  lanInventories: async (siteId?: string | null): Promise<{ id: string; siteId: string | null; observedAt: string; count: number; changes: OwnedChange[] }[]> => {
    const params = siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''
    const body = await request(`/api/lan/inventories${params}`).then((response) => response.json() as Promise<{ inventories: { id: string; siteId: string | null; observedAt: string; count: number; changes: OwnedChange[] }[] }>)
    return body.inventories
  },
  lanChanges: async (): Promise<OwnedChange[]> => {
    const body = await request('/api/lan/changes').then((response) => response.json() as Promise<{ changes: OwnedChange[] }>)
    return body.changes
  },
  sites: async (): Promise<SiteRecord[]> => {
    const body = await request('/api/sites').then((response) => response.json() as Promise<{ sites: SiteRecord[] }>)
    return body.sites
  },
  createSite: async (body: SiteDraft): Promise<SiteRecord> => {
    const saved = await request('/api/sites', { method: 'POST', body: JSON.stringify(body) }).then((response) => response.json() as Promise<{ site: SiteRecord }>)
    return saved.site
  },
  updateSite: async (id: string, body: SiteDraft): Promise<SiteRecord> => {
    const saved = await request('/api/sites/update', { method: 'POST', body: JSON.stringify({ ...body, id }) }).then((response) => response.json() as Promise<{ site: SiteRecord }>)
    return saved.site
  },
  deleteSite: (id: string): Promise<void> =>
    request('/api/sites/delete', { method: 'POST', body: JSON.stringify({ id }) }).then(() => undefined),
  siteReport: (id: string): Promise<Blob> => request(`/api/sites/report.md?id=${encodeURIComponent(id)}`).then((response) => response.blob()),
  dispositions: async (): Promise<Disposition[]> => {
    const body = await request('/api/dispositions').then((response) => response.json() as Promise<{ dispositions: Disposition[] }>)
    return body.dispositions
  },
  saveDisposition: async (body: { kind: DispositionKind; id: string; status: DispositionStatus; note: string; model?: string; firmware?: string; assignee?: string; dueAt?: string | null }): Promise<Disposition> => {
    const saved = await request('/api/dispositions', { method: 'POST', body: JSON.stringify(body) }).then((response) => response.json() as Promise<{ disposition: Disposition }>)
    return saved.disposition
  },
  clearDisposition: (body: { kind: DispositionKind; id: string }): Promise<void> =>
    request('/api/dispositions/clear', { method: 'POST', body: JSON.stringify(body) }).then(() => undefined),
  review: async (id?: string): Promise<{ id?: string; builtAt: string | null; digest: WeeklyReview | null }> =>
    request(id ? `/api/review?id=${encodeURIComponent(id)}` : '/api/review').then((response) => response.json()),
  reviews: async (): Promise<{ id: string; builtAt: string }[]> => {
    const body = await request('/api/reviews').then((response) => response.json() as Promise<{ reviews: { id: string; builtAt: string }[] }>)
    return body.reviews
  },
  buildReview: async (): Promise<{ id: string; builtAt: string; digest: WeeklyReview }> =>
    request('/api/review', { method: 'POST' }).then((response) => response.json()),
  reviewFile: (id: string, kind: 'md' | 'csv'): Promise<Blob> =>
    request(`/api/review.${kind}?id=${encodeURIComponent(id)}`).then((response) => response.blob()),
  replay: async (from: string, to: string) => {
    const params = new URLSearchParams({ from, to })
    const body = await request(`/api/replay?${params}`).then((response) => response.json() as Promise<{ scans: import('../shared/replay').CompactScan[] }>)
    return body.scans
  },
  retention: async (): Promise<{ observationDays: number; reviewDays: number }> =>
    request('/api/retention').then((response) => response.json()),
  setRetention: async (observationDays: number): Promise<{ observationDays: number; reviewDays: number }> =>
    request('/api/retention', { method: 'POST', body: JSON.stringify({ observationDays }) }).then((response) => response.json()),
  deleteDrive: (driveId: string): Promise<void> =>
    request('/api/drives/delete', { method: 'POST', body: JSON.stringify({ driveId }) }).then(() => undefined),
  deleteRadio: (bssid: string): Promise<void> =>
    request('/api/radios/delete', { method: 'POST', body: JSON.stringify({ bssid }) }).then(() => undefined),
  deleteAdvertiser: (address: string): Promise<void> =>
    request('/api/advertisers/delete', { method: 'POST', body: JSON.stringify({ address }) }).then(() => undefined),
  labels: async (): Promise<{ id: string; name: string }[]> => {
    const body = await request('/api/labels').then((response) => response.json() as Promise<{ labels: { id: string; name: string }[] }>)
    return body.labels
  },
  saveLabels: async (labels: { id: string; name: string }[]): Promise<{ id: string; name: string }[]> => {
    const body = await request('/api/labels', { method: 'POST', body: JSON.stringify({ labels }) }).then((response) => response.json() as Promise<{ labels: { id: string; name: string }[] }>)
    return body.labels
  },
  questions: async (): Promise<{ id: string; askedAt: string; question: string; answer: string; excerpt: string }[]> => {
    const body = await request('/api/questions').then((response) => response.json() as Promise<{ questions: { id: string; askedAt: string; question: string; answer: string; excerpt: string }[] }>)
    return body.questions
  },
  sessions: async (): Promise<{ sessions: { id: string; client: string; label: string; createdAt: string; lastSeenAt: string }[]; current: string | null }> =>
    request('/api/sessions').then((response) => response.json()),
  revokeSession: (id: string): Promise<void> =>
    request('/api/sessions/revoke', { method: 'POST', body: JSON.stringify({ id }) }).then(() => undefined),
  revokeAllSessions: (): Promise<void> =>
    request('/api/sessions/revoke-all', { method: 'POST' }).then(() => undefined),
  walks: async (id: string) => {
    const body = await request(`/api/sites/walks?id=${encodeURIComponent(id)}`).then((response) => response.json() as Promise<{ walks: import('../shared/sites').SiteWalk[] }>)
    return body.walks
  },
  ask: async (dataset: 'wifi' | 'account', question: string): Promise<{ answer: string; excerpt: string; id: string; askedAt: string }> =>
    request('/api/ask', { method: 'POST', body: JSON.stringify({ dataset, question }) }).then((response) => response.json()),
}
