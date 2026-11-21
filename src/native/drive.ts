import { Capacitor, WebPlugin, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { JournalScan, LocalCatalog } from '../../shared/catalog'

export interface DriveStatus {
  running: boolean
  message: string
}

export interface LocalCatalogFile {
  catalog: string
  journal: string
}

interface WardrivePlugin {
  startDrive(options: { apiUrl: string; token: string }): Promise<void>
  stopDrive(): Promise<void>
  getStatus(): Promise<DriveStatus>
  getLocalCatalog(): Promise<LocalCatalogFile>
  saveLocalCatalog(options: { catalog: string }): Promise<void>
  markUploaded(options: { scanIds: string }): Promise<void>
  enqueue(options: { scans: string }): Promise<void>
  clearLocal(): Promise<void>
  replaceLocal(options: { catalog: string; journal: string }): Promise<void>
  addListener(eventName: 'scanQueued', listenerFunc: () => void): Promise<PluginListenerHandle>
  addListener(eventName: 'scansSynced', listenerFunc: (event: { count: number }) => void): Promise<PluginListenerHandle>
}

class WardriveWeb extends WebPlugin implements WardrivePlugin {
  private running = false
  private catalog = ''
  private journal = '[]'

  async startDrive(): Promise<void> {
    this.running = true
  }

  async stopDrive(): Promise<void> {
    this.running = false
  }

  async getStatus(): Promise<DriveStatus> {
    return {
      running: this.running,
      message: this.running
        ? 'This browser cannot scan Wi-Fi. Use Load sample drive, or run the Android app.'
        : 'Drive is stopped.',
    }
  }

  async getLocalCatalog(): Promise<LocalCatalogFile> {
    return { catalog: this.catalog, journal: this.journal }
  }

  async saveLocalCatalog(options: { catalog: string }): Promise<void> {
    this.catalog = options.catalog
    const folded = new Set(foldedIds(options.catalog))
    const items = parseJournal(this.journal)
    this.journal = JSON.stringify(items.filter((item) => !(item.uploaded && item.scanId && folded.has(item.scanId))))
  }

  async markUploaded(options: { scanIds: string }): Promise<void> {
    const ids = new Set(JSON.parse(options.scanIds) as string[])
    const items = parseJournal(this.journal)
    this.journal = JSON.stringify(items.map((item) => ids.has(item.scanId) ? { ...item, uploaded: true } : item))
  }

  async enqueue(options: { scans: string }): Promise<void> {
    const items = parseJournal(this.journal)
    items.push(...parseJournal(options.scans))
    this.journal = JSON.stringify(items)
    this.notifyListeners('scanQueued', {})
  }

  async clearLocal(): Promise<void> {
    this.running = false
    this.catalog = ''
    this.journal = '[]'
  }

  async replaceLocal(options: { catalog: string; journal: string }): Promise<void> {
    this.catalog = options.catalog
    this.journal = options.journal.trim() ? options.journal : '[]'
  }
}

function parseJournal(text: string): JournalScan[] {
  if (!text.trim()) return []
  const value = JSON.parse(text) as JournalScan[]
  return Array.isArray(value) ? value : []
}

function foldedIds(catalog: string): string[] {
  if (!catalog.trim()) return []
  const value = JSON.parse(catalog) as LocalCatalog
  return Array.isArray(value.foldedScanIds) ? value.foldedScanIds : []
}

interface MacBridge {
  startDrive(options: { apiUrl: string; token: string }): Promise<void>
  stopDrive(): Promise<void>
  getStatus(): Promise<DriveStatus>
  getLocalCatalog(): Promise<LocalCatalogFile>
  saveLocalCatalog(options: { catalog: string }): Promise<void>
  markUploaded(options: { scanIds: string }): Promise<void>
  enqueue(options: { scans: string }): Promise<void>
  clearLocal(): Promise<void>
  replaceLocal(options: { catalog: string; journal: string }): Promise<void>
  addListener(eventName: 'scanQueued' | 'scansSynced', listener: (event?: { count?: number }) => void): Promise<PluginListenerHandle>
}

class WardriveMac extends WebPlugin {
  constructor(private readonly bridge: MacBridge) {
    super()
  }

  startDrive(options: { apiUrl: string; token: string }): Promise<void> {
    return this.bridge.startDrive(options)
  }

  stopDrive(): Promise<void> {
    return this.bridge.stopDrive()
  }

  getStatus(): Promise<DriveStatus> {
    return this.bridge.getStatus()
  }

  getLocalCatalog(): Promise<LocalCatalogFile> {
    return this.bridge.getLocalCatalog()
  }

  saveLocalCatalog(options: { catalog: string }): Promise<void> {
    return this.bridge.saveLocalCatalog(options)
  }

  markUploaded(options: { scanIds: string }): Promise<void> {
    return this.bridge.markUploaded(options)
  }

  enqueue(options: { scans: string }): Promise<void> {
    return this.bridge.enqueue(options)
  }

  clearLocal(): Promise<void> {
    return this.bridge.clearLocal()
  }

  replaceLocal(options: { catalog: string; journal: string }): Promise<void> {
    return this.bridge.replaceLocal(options)
  }

  addListener(eventName: 'scanQueued' | 'scansSynced', listenerFunc: (event?: { count?: number }) => void): Promise<PluginListenerHandle> {
    return this.bridge.addListener(eventName, listenerFunc)
  }
}

function macBridge(): MacBridge | null {
  if (typeof window === 'undefined') return null
  return window.wifiMapping?.wardrive ?? null
}

const desktop = macBridge()

export const Wardrive: WardrivePlugin = desktop
  ? new WardriveMac(desktop) as WardrivePlugin
  : registerPlugin<WardrivePlugin>('Wardrive', { web: () => new WardriveWeb() })

export function onDevice(): boolean {
  return Capacitor.isNativePlatform() || desktop != null
}
