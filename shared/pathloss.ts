export const PATH_EXPONENT = 2.2
export const DEFAULT_TX_DBM = -59
export const MAX_RANGE_M = 30

export function distanceFromRssi(rssi: number, txPower: number | null): number {
  const tx = txPower ?? DEFAULT_TX_DBM
  const raw = 10 ** ((tx - rssi) / (10 * PATH_EXPONENT))
  if (!Number.isFinite(raw)) return MAX_RANGE_M
  return Math.min(MAX_RANGE_M, Math.max(0.3, raw))
}

export function coarseCellRangeM(rssi: number): number {
  const raw = 10 ** ((-40 - rssi) / 35)
  if (!Number.isFinite(raw)) return 2000
  return Math.min(2000, Math.max(50, raw))
}
