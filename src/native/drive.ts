import { Capacitor, WebPlugin, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { JournalScan, LocalCatalog } from '../../shared/catalog'
import type { DeviceDetails, OwnedConsent, SubnetCatalog } from '../../shared/ownedNetwork'

export interface DriveStatus {
  running: boolean
  message: string
}

export interface LocalCatalogFile {
  catalog: string
  journal: string
}

export interface LocalHistoryImport {
  visits: { url: string; title: string | null; visitedAt: string }[]
  searches: { query: string; engine: string | null; queriedAt: string }[]
  sources: string[]
  skipped: string[]
  accessDenied: boolean
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
  catalogSubnet(options: { consent: boolean }): Promise<SubnetCatalog>
  deviceDetails(options: { consent: boolean; browser: string }): Promise<DeviceDetails>
  importHistory(options: { consent: boolean }): Promise<LocalHistoryImport>
  getOwnedPrefs(): Promise<OwnedConsent | null>
  setOwnedPrefs(options: OwnedConsent): Promise<OwnedConsent>
  clearOwnedPrefs(): Promise<void>
  apiOrigin(): Promise<string>
  addListener(eventName: 'scanQueued', listenerFunc: () => void): Promise<PluginListenerHandle>
  addListener(eventName: 'scansSynced', listenerFunc: (event: { count: number }) => void): Promise<PluginListenerHandle>
}

class WardriveWeb extends WebPlugin implements WardrivePlugin {
  private running = false
  private catalog = ''
  private journal = '[]'

  async apiOrigin(): Promise<string> {
    const configured = import.meta.env.VITE_DEVICE_API_URL
    if (configured?.startsWith('https://')) return configured
    return import.meta.env.DEV ? 'https://127.0.0.1:9453' : 'https://observer.to'
  }

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

  async catalogSubnet(): Promise<SubnetCatalog> {
    throw new Error('The browser cannot catalog a subnet. Use the Android or macOS app on a network you own.')
  }

  async deviceDetails(): Promise<DeviceDetails> {
    throw new Error('The browser cannot read device details. Use the Android or macOS app on a network you own.')
  }

  async importHistory(): Promise<LocalHistoryImport> {
    throw new Error('This browser cannot read history stored by other browsers. Use the macOS app, or import a file.')
  }

  async getOwnedPrefs(): Promise<OwnedConsent | null> {
    return null
  }

  async setOwnedPrefs(options: OwnedConsent): Promise<OwnedConsent> {
    return { addresses: options.addresses === true, details: options.addresses === true && options.details === true }
  }

  async clearOwnedPrefs(): Promise<void> {}
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
  catalogSubnet(options: { consent: boolean }): Promise<SubnetCatalog>
  deviceDetails(options: { consent: boolean; browser: string }): Promise<DeviceDetails>
  importHistory(options: { consent: boolean }): Promise<LocalHistoryImport>
  getOwnedPrefs(): Promise<OwnedConsent | null>
  setOwnedPrefs(options: OwnedConsent): Promise<OwnedConsent>
  clearOwnedPrefs(): Promise<void>
  apiOrigin(): Promise<string>
  promptFullDiskAccess(): Promise<void>
  promptLocation(): Promise<void>
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

  catalogSubnet(options: { consent: boolean }): Promise<SubnetCatalog> {
    return this.bridge.catalogSubnet(options)
  }

  deviceDetails(options: { consent: boolean; browser: string }): Promise<DeviceDetails> {
    return this.bridge.deviceDetails(options)
  }

  importHistory(options: { consent: boolean }): Promise<LocalHistoryImport> {
    return this.bridge.importHistory(options)
  }

  getOwnedPrefs(): Promise<OwnedConsent | null> {
    return this.bridge.getOwnedPrefs()
  }

  setOwnedPrefs(options: OwnedConsent): Promise<OwnedConsent> {
    return this.bridge.setOwnedPrefs(options)
  }

  clearOwnedPrefs(): Promise<void> {
    return this.bridge.clearOwnedPrefs()
  }

  apiOrigin(): Promise<string> {
    return this.bridge.apiOrigin()
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

export function promptFullDiskAccess(): void {
  void macBridge()?.promptFullDiskAccess()
}

export function promptLocation(): void {
  void macBridge()?.promptLocation()
}

export function onDevice(): boolean {
  return Capacitor.isNativePlatform() || desktop != null
}

export function onMacApp(): boolean {
  return desktop != null
}
