import type { CellRecord, DeviceRecord, MotionTrack, NetworkRecord, RangeSnapshot, Room, SecurityLabel } from '../shared/types'

export type {
  AffiliatedLink,
  CellRecord,
  DeviceRecord,
  Fix,
  MotionTrack,
  NetworkRecord,
  OpenRow,
  PlaceInfo,
  RangeSnapshot,
  Room,
  ScanAp,
  ScanCell,
  ScanDevice,
  ScenePing,
  SecurityLabel,
} from '../shared/types'

export interface MapState {
  phone: RangeSnapshot['phone']
  radiusM: number
  dwellSeconds: number
  scanPeriodSeconds: number
  circle: NetworkRecord[]
  networks: NetworkRecord[]
  devices: DeviceRecord[]
  cells: CellRecord[]
  rooms: Room[]
  movers: MotionTrack[]
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
