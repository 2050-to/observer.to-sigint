export function chooseLanSite(
  siteIds: string[],
  requested: string | null,
  inside: string[],
): string | null {
  if (requested) return siteIds.includes(requested) ? requested : null
  if (inside.length === 1 && siteIds.includes(inside[0])) return inside[0]
  if (siteIds.length === 1) return siteIds[0]
  return null
}
