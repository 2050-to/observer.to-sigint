import { api } from './api'
import { Wardrive } from './native/drive'
import {
  emptyCatalog,
  foldScans,
  presentCatalog,
  reconcileCatalog,
  type JournalScan,
  type LocalCatalog,
} from '../shared/catalog'
import { unionPostalCodes } from '../shared/postal'
import type { MapState, OpenRow, RangeSnapshot } from './types'

export type RefreshMode = 'local' | 'sync' | 'pull'

export interface LocalView {
  range: RangeSnapshot
  map: MapState
  openRows: OpenRow[]
  count: number
  waiting: number
  syncedNow: number
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseCatalog(text: string): LocalCatalog {
  if (!text.trim()) return emptyCatalog()
  const value = JSON.parse(text) as Partial<LocalCatalog>
  const empty = emptyCatalog()
  return {
    networks: Array.isArray(value.networks) ? value.networks : [],
    devices: Array.isArray(value.devices) ? value.devices : [],
    cells: Array.isArray(value.cells) ? value.cells : [],
    history: Array.isArray(value.history) ? value.history : [],
    heardBssids: Array.isArray(value.heardBssids) ? value.heardBssids : [],
    phone: value.phone ?? empty.phone,
    postalCodes: unionPostalCodes([Array.isArray(value.postalCodes) ? value.postalCodes : []]),
    foldedScanIds: Array.isArray(value.foldedScanIds) ? value.foldedScanIds : [],
    syncedBssids: normalizeBssids(value.syncedBssids ?? []),
    speedMps: numberOrNull(value.speedMps),
  }
}

export function parseJournal(text: string): JournalScan[] {
  if (!text.trim()) return []
  const value = JSON.parse(text) as JournalScan[]
  if (!Array.isArray(value)) return []
  return value.filter((scan) => scan && typeof scan.scanId === 'string').map((scan) => ({
    ...scan,
    networks: Array.isArray(scan.networks) ? scan.networks : [],
    devices: Array.isArray(scan.devices) ? scan.devices : [],
    cells: Array.isArray(scan.cells) ? scan.cells : [],
    uploaded: Boolean(scan.uploaded),
  }))
}

function normalizeBssids(bssids: string[]): string[] {
  return [...new Set(bssids.map((bssid) => bssid.trim().toLowerCase()).filter(Boolean))]
}

async function readState(): Promise<{ catalog: LocalCatalog; journal: JournalScan[] }> {
  const raw = await Wardrive.getLocalCatalog()
  return {
    catalog: parseCatalog(raw.catalog ?? ''),
    journal: parseJournal(raw.journal ?? '[]'),
  }
}

async function uploadPending(journal: JournalScan[]): Promise<{ journal: JournalScan[]; bssids: string[]; uploadedCount: number }> {
  const next: JournalScan[] = []
  const uploadedIds: string[] = []
  const bssids: string[] = []
  let stopped = false
  for (const scan of journal) {
    if (stopped || scan.uploaded) {
      next.push(scan)
      continue
    }
    try {
      const body = { ...scan, uploaded: undefined }
      await api.scan(body)
      next.push({ ...scan, uploaded: true })
      uploadedIds.push(scan.scanId)
      for (const network of scan.networks) {
        if (network.bssid) bssids.push(network.bssid.toLowerCase())
      }
    } catch {
      next.push(scan)
      stopped = true
    }
  }
  if (uploadedIds.length > 0) await Wardrive.markUploaded({ scanIds: JSON.stringify(uploadedIds) })
  return { journal: next, bssids, uploadedCount: uploadedIds.length }
}

async function fetchServer(): Promise<{ networks: LocalCatalog['networks']; devices: LocalCatalog['devices']; cells: LocalCatalog['cells']; snapshot: RangeSnapshot } | null> {
  try {
    const [snapshot, map] = await Promise.all([api.range(), api.map()])
    return { networks: map.networks, devices: map.devices ?? [], cells: map.cells ?? [], snapshot }
  } catch {
    return null
  }
}

export async function loadView(mode: RefreshMode): Promise<LocalView> {
  const first = await readState()
  let journal = first.journal
  let catalog = foldScans(first.catalog, journal)
  let syncedNow = 0
  let nextMode = mode
  if (nextMode === 'sync' && (await Wardrive.getStatus()).running) nextMode = 'local'
  if (nextMode === 'sync') {
    const uploaded = await uploadPending(journal)
    journal = uploaded.journal
    syncedNow = uploaded.uploadedCount
    catalog = {
      ...catalog,
      syncedBssids: normalizeBssids([...catalog.syncedBssids, ...uploaded.bssids]),
    }
  }
  if (nextMode === 'sync' || nextMode === 'pull') {
    const remote = await fetchServer()
    const latest = await readState()
    catalog = reconcileCatalog(
      { ...catalog, syncedBssids: normalizeBssids([...catalog.syncedBssids, ...latest.catalog.syncedBssids]) },
      latest.journal,
      remote,
    )
    journal = latest.journal
  }
  await Wardrive.saveLocalCatalog({ catalog: JSON.stringify(catalog) })
  const presented = presentCatalog(catalog)
  return {
    range: presented.range,
    map: {
      phone: presented.range.phone,
      postalCodes: presented.range.postalCodes,
      radiusM: presented.range.radiusM,
      dwellSeconds: presented.range.dwellSeconds,
      scanPeriodSeconds: presented.range.scanPeriodSeconds,
      circle: presented.circle,
      networks: presented.networks,
      devices: catalog.devices,
      cells: catalog.cells,
      rooms: presented.range.rooms,
      movers: presented.range.movers,
    },
    openRows: presented.openRows,
    count: presented.count,
    waiting: journal.filter((scan) => !scan.uploaded).length,
    syncedNow,
  }
}
