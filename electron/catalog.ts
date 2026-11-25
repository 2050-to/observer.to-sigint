import { readFileSync, renameSync, writeFileSync } from 'node:fs'

export interface StoredScan {
  scanId: string
  observedAt: string
  lat: number | null
  lon: number | null
  accuracy: number | null
  altitudeM: number | null
  verticalAccuracyM: number | null
  relativeM: number | null
  speedMps: number | null
  wifiOn: boolean
  bluetoothOn: boolean
  cellOn: boolean
  networks: { bssid?: string }[]
  devices: unknown[]
  cells: unknown[]
  driveId?: string | null
  scannerId?: string | null
  scannerLabel?: string | null
  uploaded?: boolean
}

export class CatalogStore {
  revision = 0

  constructor(
    private readonly catalogFile: string,
    private readonly journalFile: string,
  ) {}

  clear(): void {
    this.revision += 1
    writeText(this.catalogFile, '')
    writeText(this.journalFile, '[]')
  }

  replace(catalog: string, journal: string): void {
    this.revision += 1
    writeText(this.catalogFile, catalog)
    writeText(this.journalFile, journal.trim() ? journal : '[]')
  }

  readCatalog(): string {
    return readText(this.catalogFile)
  }

  readJournal(): string {
    const text = readText(this.journalFile)
    return text.trim() ? text : '[]'
  }

  saveCatalog(text: string): void {
    const incoming = parseObject(text)
    const existing = parseObject(readText(this.catalogFile))
    incoming.syncedBssids = union(existing.syncedBssids, incoming.syncedBssids)
    incoming.foldedScanIds = union(existing.foldedScanIds, incoming.foldedScanIds)
    writeText(this.catalogFile, JSON.stringify(incoming))
    this.compact()
  }

  markUploaded(scanIds: string[]): void {
    if (!scanIds.length) return
    const saved = new Set(scanIds)
    const queued = this.journal()
    for (const item of queued) {
      if (saved.has(item.scanId)) item.uploaded = true
    }
    this.writeJournal(queued)
    this.compact()
  }

  addSynced(bssids: string[]): void {
    const json = parseObject(readText(this.catalogFile))
    json.syncedBssids = union(json.syncedBssids, bssids)
    writeText(this.catalogFile, JSON.stringify(json))
  }

  append(scan: StoredScan): void {
    const queued = this.journal()
    queued.push(scan)
    this.writeJournal(queued)
  }

  enqueue(scans: StoredScan[]): void {
    if (!scans.length) return
    const queued = this.journal()
    queued.push(...scans)
    this.writeJournal(queued)
  }

  syncedBssids(): string[] {
    return asStrings(parseObject(readText(this.catalogFile)).syncedBssids).map((bssid) => bssid.toLowerCase())
  }

  unuploaded(): StoredScan[] {
    return this.journal().filter((item) => !item.uploaded).map((item) => ({ ...item }))
  }

  private compact(): void {
    const folded = new Set(asStrings(parseObject(readText(this.catalogFile)).foldedScanIds))
    const queued = this.journal()
    const kept = queued.filter((item) => !(item.uploaded && item.scanId && folded.has(item.scanId)))
    if (kept.length !== queued.length) this.writeJournal(kept)
  }

  private journal(): StoredScan[] {
    const text = readText(this.journalFile)
    if (!text.trim()) return []
    try {
      const value = JSON.parse(text) as StoredScan[]
      return Array.isArray(value) ? value : []
    } catch {
      return []
    }
  }

  private writeJournal(items: StoredScan[]): void {
    writeText(this.journalFile, JSON.stringify(items))
  }
}

function parseObject(text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  try {
    const value = JSON.parse(text) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

function union(left: unknown, right: unknown): string[] {
  return [...new Set([...asStrings(left), ...asStrings(right)])]
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function writeText(file: string, text: string): void {
  const temp = `${file}.tmp`
  writeFileSync(temp, text)
  renameSync(temp, file)
}
