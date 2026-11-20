export const V_SLOW_MPS = 0.82
export const V_MAX_MPS = 44.704
export const MIN_SCAN_SECONDS = 30
export const DEFAULT_RADIUS_M = 91.4
export const MIN_RADIUS_M = 50
export const MAX_RADIUS_M = 500

export function clampRadius(meters: number | null): number {
  if (meters == null || !Number.isFinite(meters) || meters < 10) return DEFAULT_RADIUS_M
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, meters))
}

export function clampSpeed(speedMps: number | null): number {
  if (speedMps == null || !Number.isFinite(speedMps)) return V_MAX_MPS
  return Math.min(V_MAX_MPS, Math.max(V_SLOW_MPS, speedMps))
}

export function timingFor(radiusM: number, speedMps: number | null): {
  speed: number
  dwellSeconds: number
  scanPeriodSeconds: number
} {
  const speed = clampSpeed(speedMps)
  const dwellSeconds = (2 * radiusM) / speed
  return {
    speed,
    dwellSeconds,
    scanPeriodSeconds: Math.max(dwellSeconds, MIN_SCAN_SECONDS),
  }
}
