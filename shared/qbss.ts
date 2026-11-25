export function channelLoadText(input: {
  stationCount?: number | null
  channelUtilization?: number | null
  admissionCapacity?: number | null
} | null | undefined): string | null {
  if (!input) return null
  const stations = finite(input.stationCount)
  const utilization = finite(input.channelUtilization)
  const admission = finite(input.admissionCapacity)
  if (stations == null && utilization == null && admission == null) return null
  const parts: string[] = []
  if (stations != null) parts.push(`${stations} station${stations === 1 ? '' : 's'}`)
  if (utilization != null) {
    const percent = Math.round((Math.min(255, Math.max(0, utilization)) / 255) * 100)
    parts.push(`utilization ${utilization}/255 (${percent}%)`)
  }
  if (admission != null) parts.push(`admission ${admission}`)
  return parts.join(' · ')
}

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
