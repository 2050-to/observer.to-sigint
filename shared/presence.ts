import { groupAccessPoints, groupAdvertisers, type DeviceLike, type WifiLike } from './accessPoints.js'

export interface PresenceHit {
  kind: 'ap' | 'adv'
  id: string
  label: string
}

export function presenceKey(hit: Pick<PresenceHit, 'kind' | 'id'>): string {
  return `${hit.kind}:${hit.id}`
}

export function newlyHeard(known: ReadonlySet<string>, heard: readonly PresenceHit[]): PresenceHit[] {
  const seen = new Set<string>()
  const fresh: PresenceHit[] = []
  for (const hit of heard) {
    const key = presenceKey(hit)
    if (known.has(key) || seen.has(key)) continue
    seen.add(key)
    fresh.push(hit)
  }
  return fresh
}

export function heardPresence(networks: WifiLike[], devices: DeviceLike[]): PresenceHit[] {
  return [
    ...groupAccessPoints(networks).map((ap) => ({ kind: 'ap' as const, id: ap.id, label: ap.label })),
    ...groupAdvertisers(devices).map((group) => ({ kind: 'adv' as const, id: group.id, label: group.label })),
  ]
}
