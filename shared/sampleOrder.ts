export const BASELINE_MIN_SAMPLES = 50
export const BASELINE_MIN_SPAN_MS = 30 * 60 * 1000

export function compareBySamples(
  left: { samples: number; name: string; key: string },
  right: { samples: number; name: string; key: string },
): number {
  return left.samples - right.samples
    || left.name.localeCompare(right.name)
    || left.key.localeCompare(right.key)
}

export function meetsBaselineGate(samples: number, firstSeen: string, lastSeen: string): boolean {
  if (!Number.isFinite(samples) || samples < BASELINE_MIN_SAMPLES) return false
  const start = Date.parse(firstSeen)
  const end = Date.parse(lastSeen)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  return end - start >= BASELINE_MIN_SPAN_MS
}
