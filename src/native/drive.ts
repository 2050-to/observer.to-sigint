import { Capacitor, WebPlugin, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { JournalScan, LocalCatalog } from '../../shared/catalog'
import type { DeviceDetails, OwnedConsent, SubnetCatalog } from '../../shared/ownedNetwork'
import { emptyConnectionCatalog, type ConnectionCatalog, type ConnectionSnapshot } from '../../shared/connectionCatalog'
import { emptySnapshot } from '../../shared/secureLinks'

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
  catalogSubnet(options: { consent: boolean }): Promise<SubnetCatalog>
  deviceDetails(options: { consent: boolean; browser: string }): Promise<DeviceDetails>
  getOwnedPrefs(): Promise<OwnedConsent | null>
  setOwnedPrefs(options: OwnedConsent): Promise<OwnedConsent>
  clearOwnedPrefs(): Promise<void>
  getSecureLinks(): Promise<{ allowed: boolean }>
  setSecureLinks(options: { allowed: boolean }): Promise<{ allowed: boolean }>
  listConnections(options: { consent: boolean }): Promise<ConnectionSnapshot>
  getConnectionCatalog(): Promise<ConnectionCatalog>
  reviewConnectionCatalog(): Promise<ConnectionCatalog>
  clearConnectionCatalog(): Promise<ConnectionCatalog>
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

  async getOwnedPrefs(): Promise<OwnedConsent | null> {
    return null
  }

  async setOwnedPrefs(options: OwnedConsent): Promise<OwnedConsent> {
    return { addresses: options.addresses === true, details: options.addresses === true && options.details === true }
  }

  async clearOwnedPrefs(): Promise<void> {}

  async getSecureLinks(): Promise<{ allowed: boolean }> {
    return { allowed: false }
  }

  async setSecureLinks(options: { allowed: boolean }): Promise<{ allowed: boolean }> {
    return { allowed: options.allowed === true }
  }

  async listConnections(): Promise<ConnectionSnapshot> {
    return { ...emptySnapshot('The browser cannot read the socket table.'), catalog: emptyConnectionCatalog() }
  }

  async getConnectionCatalog(): Promise<ConnectionCatalog> {
    return emptyConnectionCatalog()
  }

  async reviewConnectionCatalog(): Promise<ConnectionCatalog> {
    return emptyConnectionCatalog()
  }

  async clearConnectionCatalog(): Promise<ConnectionCatalog> {
    return emptyConnectionCatalog()
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
  catalogSubnet(options: { consent: boolean }): Promise<SubnetCatalog>
  deviceDetails(options: { consent: boolean; browser: string }): Promise<DeviceDetails>
  getOwnedPrefs(): Promise<OwnedConsent | null>
  setOwnedPrefs(options: OwnedConsent): Promise<OwnedConsent>
  clearOwnedPrefs(): Promise<void>
  getSecureLinks(): Promise<{ allowed: boolean }>
  setSecureLinks(options: { allowed: boolean }): Promise<{ allowed: boolean }>
  listConnections(options: { consent: boolean }): Promise<ConnectionSnapshot>
  getConnectionCatalog(): Promise<ConnectionCatalog>
  reviewConnectionCatalog(): Promise<ConnectionCatalog>
  clearConnectionCatalog(): Promise<ConnectionCatalog>
  apiOrigin(): Promise<string>
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

  getOwnedPrefs(): Promise<OwnedConsent | null> {
    return this.bridge.getOwnedPrefs()
  }

  setOwnedPrefs(options: OwnedConsent): Promise<OwnedConsent> {
    return this.bridge.setOwnedPrefs(options)
  }

  clearOwnedPrefs(): Promise<void> {
    return this.bridge.clearOwnedPrefs()
  }

  getSecureLinks(): Promise<{ allowed: boolean }> {
    return this.bridge.getSecureLinks()
  }

  setSecureLinks(options: { allowed: boolean }): Promise<{ allowed: boolean }> {
    return this.bridge.setSecureLinks(options)
  }

  listConnections(options: { consent: boolean }): Promise<ConnectionSnapshot> {
    return this.bridge.listConnections(options)
  }

  getConnectionCatalog(): Promise<ConnectionCatalog> {
    return this.bridge.getConnectionCatalog()
  }

  reviewConnectionCatalog(): Promise<ConnectionCatalog> {
    return this.bridge.reviewConnectionCatalog()
  }

  clearConnectionCatalog(): Promise<ConnectionCatalog> {
    return this.bridge.clearConnectionCatalog()
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

export function promptLocation(): void {
  void macBridge()?.promptLocation()
}

export function onDevice(): boolean {
  return Capacitor.isNativePlatform() || desktop != null
}

export function onMacApp(): boolean {
  return desktop != null
}

export function macProcesses(): MacProcessesBridge | null {
  if (typeof window === 'undefined') return null
  return window.wifiMapping?.processes ?? null
}
