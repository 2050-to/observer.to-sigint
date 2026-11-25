import type { DispositionStatus } from './disposition.js'
import type { SiteEventKind, SiteFinding, SiteSeverity } from './sites.js'

export interface ReviewRisk {
  name: string
  reason: string
  kind: 'ap' | 'adv' | null
  id: string | null
  status: DispositionStatus | null
}

export interface ReviewOpen {
  name: string
  security: string
  lastSeen: string
  place: string | null
}

export interface ReviewSiteEvent {
  site: string
  kind: SiteEventKind
  severity: SiteSeverity
  at: string
  bssid: string
  label: string
}

export interface WeeklyReview {
  openNetworks: ReviewOpen[]
  highRisk: ReviewRisk[]
  newAccessPoints: number
  newAdvertisers: number
  newCells: number
  observationCount: number
  siteFindings: SiteFinding[]
  siteEvents: ReviewSiteEvent[]
  ownedChanges: { text: string }[]
}

export function emptyReview(): WeeklyReview {
  return {
    openNetworks: [],
    highRisk: [],
    newAccessPoints: 0,
    newAdvertisers: 0,
    newCells: 0,
    observationCount: 0,
    siteFindings: [],
    siteEvents: [],
    ownedChanges: [],
  }
}
