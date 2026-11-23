import { asDeviceDetails, asSubnetCatalog } from '../../shared/ownedNetwork.js'
import { normalizeUrl, clipText, parseWhen } from '../../shared/imports.js'
import { cityName, stateCode, zipCode } from '../../shared/places.js'
import { ApiError } from './http.js'
import type { DnsQueryRow } from './personal.js'

export function asDnsBody(value: unknown): DnsQueryRow[] {
  const queries = arrayOf(value, 'queries')
  const rows: DnsQueryRow[] = []
  for (const entry of queries.slice(0, 200)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const name = clipText(record.name, 253)?.toLowerCase()
    const type = clipText(record.type, 16)?.toUpperCase()
    const observedAt = parseWhen(record.observedAt)
    if (!name || !type || !observedAt || !/^[a-z0-9.-]+$/.test(name)) continue
    rows.push({
      observedAt,
      name,
      type,
      rcode: clipText(record.rcode, 32),
    })
  }
  if (rows.length === 0) throw new ApiError(400, 'queries are required')
  return rows
}

export function asBookmarkBody(value: unknown): { title: string; url: string }[] {
  const items = arrayOf(value, 'items')
  const rows: { title: string; url: string }[] = []
  for (const entry of items.slice(0, 2000)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const url = normalizeUrl(record.url)
    const title = clipText(record.title, 300) ?? url
    if (!url || !title) continue
    rows.push({ title, url })
  }
  if (rows.length === 0) throw new ApiError(400, 'bookmarks are required')
  return rows
}

export function asSearchBody(value: unknown): { query: string; engine: string | null; queriedAt: string }[] {
  const items = arrayOf(value, 'items')
  const rows: { query: string; engine: string | null; queriedAt: string }[] = []
  for (const entry of items.slice(0, 2000)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const query = clipText(record.query, 500)
    const queriedAt = parseWhen(record.queriedAt)
    if (!query || !queriedAt) continue
    rows.push({ query, engine: clipText(record.engine, 40), queriedAt })
  }
  if (rows.length === 0) throw new ApiError(400, 'searches are required')
  return rows
}

export function asVisitBody(value: unknown): { url: string; title: string | null; visitedAt: string }[] {
  const items = arrayOf(value, 'items')
  const rows: { url: string; title: string | null; visitedAt: string }[] = []
  for (const entry of items.slice(0, 2000)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const url = normalizeUrl(record.url)
    const visitedAt = parseWhen(record.visitedAt)
    if (!url || !visitedAt) continue
    rows.push({ url, title: clipText(record.title, 300), visitedAt })
  }
  if (rows.length === 0) throw new ApiError(400, 'visits are required')
  return rows
}

export function asPlaceFilter(url: URL): { zip: string | null; state: string | null; city: string | null } {
  const zip = zipCode(url.searchParams.get('zip'))
  const state = stateCode(url.searchParams.get('state'))
  const city = cityName(url.searchParams.get('city'))
  if (url.searchParams.get('zip') && !zip) throw new ApiError(400, 'zip must be a US ZIP code')
  if (url.searchParams.get('state') && !state) throw new ApiError(400, 'state must be a US state')
  if (url.searchParams.get('city') && !city) throw new ApiError(400, 'city is invalid')
  if (!zip && !state && !city) throw new ApiError(400, 'zip, state, or city is required')
  return { zip, state, city }
}

export function asOwnedDevice(value: unknown) {
  const details = asDeviceDetails(value)
  if (!details) throw new ApiError(400, 'device details are invalid')
  return details
}

export function asOwnedLan(value: unknown) {
  const catalog = asSubnetCatalog(value)
  if (!catalog) throw new ApiError(400, 'network inventory is invalid')
  return catalog
}

function arrayOf(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== 'object') throw new ApiError(400, `${key} are required`)
  const items = (value as Record<string, unknown>)[key]
  if (!Array.isArray(items)) throw new ApiError(400, `${key} are required`)
  return items
}
