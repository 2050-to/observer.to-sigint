const ZIP = /^\d{5}(?:-\d{4})?$/

export function cleanPostalCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text || text.length > 16) return null
  return text
}

export function addPostalCode(existing: string[] | null | undefined, code: string | null): string[] {
  const codes = (existing ?? []).flatMap((item) => {
    const cleaned = cleanPostalCode(item)
    return cleaned ? [cleaned] : []
  })
  const next = cleanPostalCode(code)
  if (!next) return codes
  if (codes.some((item) => item.toLowerCase() === next.toLowerCase())) return codes
  return [...codes, next]
}

export function unionPostalCodes(lists: (string[] | null | undefined)[]): string[] {
  let codes: string[] = []
  for (const list of lists) {
    for (const code of list ?? []) codes = addPostalCode(codes, code)
  }
  return codes
}

export function postalCellKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)}:${lon.toFixed(3)}`
}

export function samePostalCell(lat: number, lon: number, otherLat: number, otherLon: number): boolean {
  return postalCellKey(lat, lon) === postalCellKey(otherLat, otherLon)
}

export function postalLabel(codes: string[] | null | undefined): string | null {
  const saved = unionPostalCodes([codes])
  if (saved.length === 0) return null
  const zip = saved.every((code) => ZIP.test(code))
  if (saved.length === 1) return zip ? `ZIP ${saved[0]}` : `Postal code ${saved[0]}`
  return zip ? `ZIPs ${saved.join(', ')}` : `Postal codes ${saved.join(', ')}`
}

export function withPostalCode<T extends { postalCodes?: string[] }>(record: T, code: string | null): T {
  return { ...record, postalCodes: addPostalCode(record.postalCodes, code) }
}
