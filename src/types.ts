import type { NetworkRecord, RangeSnapshot, SecurityLabel } from '../shared/types'

export type {
  AffiliatedLink,
  Fix,
  NetworkRecord,
  OpenRow,
  PlaceInfo,
  RangeSnapshot,
  ScanAp,
  SecurityLabel,
} from '../shared/types'

export interface MapState {
  phone: RangeSnapshot['phone']
  radiusM: number
  dwellSeconds: number
  scanPeriodSeconds: number
  circle: NetworkRecord[]
  networks: NetworkRecord[]
}

export const SECURITY_COLORS: Record<SecurityLabel, string> = {
  open: '#e85d4c',
  owe: '#e6a23c',
  wep: '#c47b2b',
  wpa: '#d4a017',
  wpa2: '#3d8bfd',
  wpa3: '#3cbf8f',
  enterprise: '#8b6cf0',
}
