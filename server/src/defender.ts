import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { diffOwnedInventory, type OwnedChange } from '../../shared/ownedDiff.js'
import { asDispositionDraft, type Disposition } from '../../shared/disposition.js'
import type { WeeklyReview } from '../../shared/review.js'
import { asStoredSite, asSiteDraft, evilTwinNotices, observeSite, type EvilTwinNotice, type SiteRecord, type SiteSighting } from '../../shared/sites.js'
import type { SubnetHost } from '../../shared/ownedNetwork.js'
import { bssidHmac, decryptJson, encryptJson } from './crypto.js'
import { replaceLanHosts } from './personal.js'

type Db = Pick<pg.Pool | pg.PoolClient, 'query'>

function asHost(value: unknown): SubnetHost | null {
  if (!value || typeof value !== 'object') return null
  const host = value as Partial<SubnetHost>
  if (typeof host.ip !== 'string' || typeof host.role !== 'string' || typeof host.present !== 'boolean') return null
  return {
    ip: host.ip,
    role: host.role as SubnetHost['role'],
    present: host.present,
    mac: host.mac ?? null,
    name: host.name ?? null,
    services: Array.isArray(host.services) ? host.services.filter((item): item is string => typeof item === 'string') : [],
    ports: Array.isArray(host.ports) ? host.ports.filter((item): item is number => typeof item === 'number') : [],
  }
}

export async function listSites(db: Db, userId: string): Promise<SiteRecord[]> {
  const result = await db.query<{ site_id: string; payload: Buffer; nonce: Buffer }>(
    'SELECT site_id, payload, nonce FROM sites WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId],
  )
  return result.rows.flatMap((row) => {
    try {
      const site = asStoredSite(row.site_id, decryptJson(row.payload, row.nonce))
      return site ? [site] : []
    } catch {
      return []
    }
  })
}

export async function saveSite(db: Db, userId: string, site: SiteRecord): Promise<void> {
  const sealed = encryptJson(site)
  await db.query(
    `INSERT INTO sites (user_id, site_id, payload, nonce, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, site_id) DO UPDATE
     SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
    [userId, site.id, sealed.payload, sealed.nonce],
  )
}

export async function createSite(db: Db, userId: string, value: unknown): Promise<SiteRecord | null> {
  const draft = asSiteDraft(value)
  if (!draft) return null
  const site: SiteRecord = { id: randomUUID(), ...draft, lastWalk: null, radios: [], events: [] }
  await saveSite(db, userId, site)
  return site
}

export async function updateSite(db: Db, userId: string, siteId: string, value: unknown): Promise<SiteRecord | null> {
  const draft = asSiteDraft(value)
  if (!draft) return null
  const existing = (await listSites(db, userId)).find((site) => site.id === siteId)
  if (!existing) return null
  const site: SiteRecord = { ...existing, name: draft.name, boundary: draft.boundary, claims: draft.claims }
  await saveSite(db, userId, site)
  return site
}

export async function deleteSite(db: Db, userId: string, siteId: string): Promise<boolean> {
  const result = await db.query('DELETE FROM sites WHERE user_id = $1 AND site_id = $2', [userId, siteId])
  return (result.rowCount ?? 0) > 0
}

export async function touchSites(db: Db, userId: string, sighting: SiteSighting): Promise<EvilTwinNotice[]> {
  if (sighting.lat == null || sighting.lon == null) return []
  const sites = await listSites(db, userId)
  const notices: EvilTwinNotice[] = []
  for (const site of sites) {
    const next = observeSite(site, sighting)
    if (next === site) continue
    await saveSite(db, userId, next)
    notices.push(...evilTwinNotices(site, next))
  }
  return notices
}

function subjectHmac(kind: string, id: string): Buffer {
  return bssidHmac(`disposition:${kind}:${id}`)
}

export async function listDispositions(db: Db, userId: string): Promise<Disposition[]> {
  const result = await db.query<{ payload: Buffer; nonce: Buffer; updated_at: Date }>(
    'SELECT payload, nonce, updated_at FROM dispositions WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId],
  )
  return result.rows.flatMap((row) => {
    try {
      const draft = asDispositionDraft(decryptJson(row.payload, row.nonce))
      if (!draft) return []
      return [{ ...draft, updatedAt: new Date(row.updated_at).toISOString() }]
    } catch {
      return []
    }
  })
}

export async function saveDisposition(db: Db, userId: string, value: unknown): Promise<Disposition | null> {
  const draft = asDispositionDraft(value)
  if (!draft) return null
  const sealed = encryptJson(draft)
  await db.query(
    `INSERT INTO dispositions (user_id, subject_hmac, payload, nonce, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, subject_hmac) DO UPDATE
     SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
    [userId, subjectHmac(draft.kind, draft.id), sealed.payload, sealed.nonce],
  )
  return draft
}

export async function deleteDisposition(db: Db, userId: string, kind: string, id: string): Promise<void> {
  if ((kind !== 'ap' && kind !== 'adv') || !id.trim()) return
  await db.query(
    'DELETE FROM dispositions WHERE user_id = $1 AND subject_hmac = $2',
    [userId, subjectHmac(kind, id.trim().toLowerCase())],
  )
}

export async function readReview(db: Db, userId: string): Promise<{ builtAt: string; digest: WeeklyReview } | null> {
  const result = await db.query<{ payload: Buffer; nonce: Buffer; built_at: Date }>(
    'SELECT payload, nonce, built_at FROM reviews WHERE user_id = $1',
    [userId],
  )
  const row = result.rows[0]
  if (!row) return null
  try {
    return {
      builtAt: new Date(row.built_at).toISOString(),
      digest: decryptJson<WeeklyReview>(row.payload, row.nonce),
    }
  } catch {
    return null
  }
}

export async function saveReview(db: Db, userId: string, digest: WeeklyReview): Promise<{ builtAt: string; digest: WeeklyReview }> {
  const sealed = encryptJson(digest)
  const result = await db.query<{ built_at: Date }>(
    `INSERT INTO reviews (user_id, payload, nonce, built_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE
     SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, built_at = now()
     RETURNING built_at`,
    [userId, sealed.payload, sealed.nonce],
  )
  await db.query('UPDATE users SET last_review_at = now() WHERE id = $1', [userId])
  return {
    builtAt: new Date(result.rows[0]?.built_at ?? new Date()).toISOString(),
    digest,
  }
}

export async function reviewCandidates(db: Db): Promise<{ id: string; lastReviewAt: string | null }[]> {
  const result = await db.query<{ id: string; last_review_at: Date | null }>(
    `SELECT users.id, users.last_review_at
     FROM users
     WHERE (users.last_review_at IS NULL OR users.last_review_at < now() - interval '7 days')
       AND (
         EXISTS (SELECT 1 FROM networks WHERE networks.user_id = users.id)
         OR EXISTS (SELECT 1 FROM devices WHERE devices.user_id = users.id)
         OR EXISTS (SELECT 1 FROM cells WHERE cells.user_id = users.id)
         OR EXISTS (SELECT 1 FROM sites WHERE sites.user_id = users.id)
         OR EXISTS (SELECT 1 FROM lan_hosts WHERE lan_hosts.user_id = users.id)
       )
     ORDER BY users.last_review_at NULLS FIRST
     LIMIT 50`,
  )
  return result.rows.map((row) => ({
    id: row.id,
    lastReviewAt: row.last_review_at ? new Date(row.last_review_at).toISOString() : null,
  }))
}

export async function listLanHosts(db: Db, userId: string): Promise<SubnetHost[]> {
  const result = await db.query<{ payload: Buffer; nonce: Buffer }>(
    'SELECT payload, nonce FROM lan_hosts WHERE user_id = $1',
    [userId],
  )
  return result.rows.flatMap((row) => {
    try {
      const host = asHost(decryptJson(row.payload, row.nonce))
      return host ? [host] : []
    } catch {
      return []
    }
  })
}

async function lanWasSaved(db: Db, userId: string): Promise<boolean> {
  const result = await db.query('SELECT 1 FROM lan_saved WHERE user_id = $1', [userId])
  return (result.rowCount ?? 0) > 0
}

export async function replaceLanInventory(db: Db, userId: string, hosts: SubnetHost[]): Promise<OwnedChange[]> {
  const seen = await lanWasSaved(db, userId)
  const previous = seen ? await listLanHosts(db, userId) : null
  const changes = diffOwnedInventory(previous, hosts)
  if (previous) {
    const sealed = encryptJson(previous)
    await db.query(
      `INSERT INTO lan_previous (user_id, payload, nonce, saved_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE
       SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, saved_at = now()`,
      [userId, sealed.payload, sealed.nonce],
    )
  }
  await replaceLanHosts(db, userId, hosts)
  const sealedChanges = encryptJson(changes)
  await db.query(
    `INSERT INTO lan_changes (user_id, payload, nonce, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE
     SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, updated_at = now()`,
    [userId, sealedChanges.payload, sealedChanges.nonce],
  )
  await db.query(
    `INSERT INTO lan_saved (user_id, saved_at) VALUES ($1, now())
     ON CONFLICT (user_id) DO UPDATE SET saved_at = now()`,
    [userId],
  )
  return changes
}

export async function readLanChanges(db: Db, userId: string): Promise<OwnedChange[]> {
  const result = await db.query<{ payload: Buffer; nonce: Buffer }>(
    'SELECT payload, nonce FROM lan_changes WHERE user_id = $1',
    [userId],
  )
  const row = result.rows[0]
  if (!row) return []
  try {
    const changes = decryptJson<OwnedChange[]>(row.payload, row.nonce)
    return Array.isArray(changes) ? changes : []
  } catch {
    return []
  }
}
