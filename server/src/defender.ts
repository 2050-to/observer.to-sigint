import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { chooseLanSite } from '../../shared/lanSite.js'
import { diffOwnedInventory, type OwnedChange } from '../../shared/ownedDiff.js'
import { asDispositionDraft, isDispositionKind, type Disposition } from '../../shared/disposition.js'
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
  const site: SiteRecord = {
    ...existing,
    name: draft.name,
    boundary: draft.boundary,
    claims: draft.claims,
    walkEveryDays: draft.walkEveryDays ?? existing.walkEveryDays,
  }
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
    await saveWalkSnapshot(db, userId, next)
    notices.push(...evilTwinNotices(site, next))
  }
  return notices
}

export async function saveWalkSnapshot(db: Db, userId: string, site: SiteRecord): Promise<void> {
  const walk = site.lastWalk
  if (!walk) return
  const sealed = encryptJson({ ...walk, name: site.name })
  await db.query(
    `INSERT INTO site_walks (user_id, site_id, started_at, walked_at, payload, nonce)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, site_id, started_at) DO UPDATE
     SET walked_at = EXCLUDED.walked_at, payload = EXCLUDED.payload, nonce = EXCLUDED.nonce`,
    [userId, site.id, walk.startedAt, walk.walkedAt, sealed.payload, sealed.nonce],
  )
}

export async function listWalks(db: Db, userId: string, siteId: string): Promise<SiteRecord['lastWalk'][]> {
  const result = await db.query<{ payload: Buffer; nonce: Buffer }>(
    `SELECT payload, nonce FROM site_walks
     WHERE user_id = $1 AND site_id = $2
     ORDER BY walked_at DESC
     LIMIT 100`,
    [userId, siteId],
  )
  return result.rows.flatMap((row) => {
    try {
      const walk = decryptJson<SiteRecord['lastWalk']>(row.payload, row.nonce)
      return walk ? [walk] : []
    } catch {
      return []
    }
  })
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
  if (!isDispositionKind(kind) || !id.trim()) return
  await db.query(
    'DELETE FROM dispositions WHERE user_id = $1 AND subject_hmac = $2',
    [userId, subjectHmac(kind, id.trim().toLowerCase())],
  )
}

export interface StoredReview {
  id: string
  builtAt: string
  digest: WeeklyReview
}

function reviewFrom(row: { review_id: string; payload: Buffer; nonce: Buffer; built_at: Date }): StoredReview | null {
  try {
    return {
      id: row.review_id,
      builtAt: new Date(row.built_at).toISOString(),
      digest: decryptJson<WeeklyReview>(row.payload, row.nonce),
    }
  } catch {
    return null
  }
}

export async function readReview(db: Db, userId: string): Promise<StoredReview | null> {
  const result = await db.query<{ review_id: string; payload: Buffer; nonce: Buffer; built_at: Date }>(
    `SELECT review_id, payload, nonce, built_at FROM reviews
     WHERE user_id = $1
     ORDER BY built_at DESC
     LIMIT 1`,
    [userId],
  )
  const row = result.rows[0]
  return row ? reviewFrom(row) : null
}

export async function readReviewById(db: Db, userId: string, reviewId: string): Promise<StoredReview | null> {
  const result = await db.query<{ review_id: string; payload: Buffer; nonce: Buffer; built_at: Date }>(
    `SELECT review_id, payload, nonce, built_at FROM reviews
     WHERE user_id = $1 AND review_id = $2`,
    [userId, reviewId],
  )
  const row = result.rows[0]
  return row ? reviewFrom(row) : null
}

export async function listReviews(db: Db, userId: string): Promise<{ id: string; builtAt: string }[]> {
  const result = await db.query<{ review_id: string; built_at: Date }>(
    `SELECT review_id, built_at FROM reviews
     WHERE user_id = $1
     ORDER BY built_at DESC
     LIMIT 100`,
    [userId],
  )
  return result.rows.map((row) => ({
    id: row.review_id,
    builtAt: new Date(row.built_at).toISOString(),
  }))
}

export async function saveReview(db: Db, userId: string, digest: WeeklyReview): Promise<StoredReview> {
  const sealed = encryptJson(digest)
  const reviewId = randomUUID()
  const result = await db.query<{ built_at: Date }>(
    `INSERT INTO reviews (review_id, user_id, payload, nonce, built_at)
     VALUES ($1, $2, $3, $4, now())
     RETURNING built_at`,
    [reviewId, userId, sealed.payload, sealed.nonce],
  )
  await db.query('UPDATE users SET last_review_at = now() WHERE id = $1', [userId])
  return {
    id: reviewId,
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

interface InventoryBody {
  hosts: SubnetHost[]
  changes: OwnedChange[]
  siteId: string | null
}

export async function replaceLanInventory(
  db: Db,
  userId: string,
  hosts: SubnetHost[],
  requestedSiteId: string | null = null,
): Promise<OwnedChange[] | null> {
  const siteIds = (await listSites(db, userId)).map((site) => site.id)
  if (requestedSiteId && !siteIds.includes(requestedSiteId)) return null
  const siteId = chooseLanSite(siteIds, requestedSiteId, [])
  const previous = await previousInventory(db, userId, siteId)
  const changes = diffOwnedInventory(previous, hosts)
  const body: InventoryBody = { hosts, changes, siteId }
  const sealed = encryptJson(body)
  await db.query(
    `INSERT INTO lan_inventories (inventory_id, user_id, site_id, observed_at, payload, nonce)
     VALUES ($1, $2, $3, now(), $4, $5)`,
    [randomUUID(), userId, siteId, sealed.payload, sealed.nonce],
  )
  if (previous) {
    const prior = encryptJson(previous)
    await db.query(
      `INSERT INTO lan_previous (user_id, payload, nonce, saved_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE
       SET payload = EXCLUDED.payload, nonce = EXCLUDED.nonce, saved_at = now()`,
      [userId, prior.payload, prior.nonce],
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

async function previousInventory(db: Db, userId: string, siteId: string | null): Promise<SubnetHost[] | null> {
  const latest = await db.query<{ payload: Buffer; nonce: Buffer }>(
    `SELECT payload, nonce FROM lan_inventories
     WHERE user_id = $1 AND site_id IS NOT DISTINCT FROM $2
     ORDER BY observed_at DESC
     LIMIT 1`,
    [userId, siteId],
  )
  const row = latest.rows[0]
  if (row) {
    try {
      const body = decryptJson<InventoryBody>(row.payload, row.nonce)
      return Array.isArray(body.hosts) ? body.hosts : null
    } catch {
      return null
    }
  }
  const any = await db.query('SELECT 1 FROM lan_inventories WHERE user_id = $1 LIMIT 1', [userId])
  if ((any.rowCount ?? 0) > 0) return null
  if (!await lanWasSaved(db, userId)) return null
  return listLanHosts(db, userId)
}

export interface LanInventorySummary {
  id: string
  siteId: string | null
  observedAt: string
  count: number
  changes: OwnedChange[]
}

export async function listLanInventories(db: Db, userId: string, siteId: string | null): Promise<LanInventorySummary[]> {
  const result = await db.query<{ inventory_id: string; site_id: string | null; observed_at: Date; payload: Buffer; nonce: Buffer }>(
    `SELECT inventory_id, site_id, observed_at, payload, nonce
     FROM lan_inventories
     WHERE user_id = $1 AND ($2::uuid IS NULL OR site_id = $2)
     ORDER BY observed_at DESC
     LIMIT 50`,
    [userId, siteId],
  )
  return result.rows.flatMap((row) => {
    try {
      const body = decryptJson<InventoryBody>(row.payload, row.nonce)
      return [{
        id: row.inventory_id,
        siteId: row.site_id,
        observedAt: new Date(row.observed_at).toISOString(),
        count: Array.isArray(body.hosts) ? body.hosts.length : 0,
        changes: Array.isArray(body.changes) ? body.changes : [],
      }]
    } catch {
      return []
    }
  })
}

export async function readLanChanges(db: Db, userId: string): Promise<OwnedChange[]> {
  const result = await db.query<{ payload: Buffer; nonce: Buffer }>(
    `SELECT DISTINCT ON (site_id) payload, nonce
     FROM lan_inventories
     WHERE user_id = $1
     ORDER BY site_id, observed_at DESC`,
    [userId],
  )
  if (result.rowCount) {
    return result.rows.flatMap((row) => {
      try {
        const body = decryptJson<InventoryBody>(row.payload, row.nonce)
        return Array.isArray(body.changes) ? body.changes : []
      } catch {
        return []
      }
    })
  }
  const legacy = await db.query<{ payload: Buffer; nonce: Buffer }>(
    'SELECT payload, nonce FROM lan_changes WHERE user_id = $1',
    [userId],
  )
  const row = legacy.rows[0]
  if (!row) return []
  try {
    const changes = decryptJson<OwnedChange[]>(row.payload, row.nonce)
    return Array.isArray(changes) ? changes : []
  } catch {
    return []
  }
}
