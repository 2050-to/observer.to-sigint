/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEVICE_API_URL?: string
}

interface MacWardriveBridge {
  startDrive(options: { apiUrl: string; token: string }): Promise<void>
  stopDrive(): Promise<void>
  getStatus(): Promise<{ running: boolean; message: string }>
  getLocalCatalog(): Promise<{ catalog: string; journal: string }>
  saveLocalCatalog(options: { catalog: string }): Promise<void>
  markUploaded(options: { scanIds: string }): Promise<void>
  enqueue(options: { scans: string }): Promise<void>
  clearLocal(): Promise<void>
  replaceLocal(options: { catalog: string; journal: string }): Promise<void>
  catalogSubnet(options: { consent: boolean }): Promise<{
    cidr: string
    interfacePrefix: number
    limited: boolean
    checked: number
    internetRoute: boolean
    hosts: { ip: string; role: 'network' | 'broadcast' | 'device' | 'host'; present: boolean; mac: string | null; name: string | null; services: string[]; ports: number[] }[]
  }>
  deviceDetails(options: { consent: boolean; browser: string }): Promise<{
    os: string
    browser: string
    ramBytes: number
    cpu: string
    hostname: string
    collectedAt: string
  }>
  apiOrigin(): Promise<string>
  getOwnedPrefs(): Promise<{ addresses: boolean; details: boolean } | null>
  setOwnedPrefs(options: { addresses: boolean; details: boolean }): Promise<{ addresses: boolean; details: boolean }>
  clearOwnedPrefs(): Promise<void>
  getSecureLinks(): Promise<{ allowed: boolean }>
  setSecureLinks(options: { allowed: boolean }): Promise<{ allowed: boolean }>
  listConnections(options: { consent: boolean }): Promise<import('../shared/connectionCatalog').ConnectionSnapshot>
  getConnectionCatalog(): Promise<import('../shared/connectionCatalog').ConnectionCatalog>
  reviewConnectionCatalog(): Promise<import('../shared/connectionCatalog').ConnectionCatalog>
  clearConnectionCatalog(): Promise<import('../shared/connectionCatalog').ConnectionCatalog>
  promptLocation(): Promise<void>
  addListener(eventName: 'scanQueued' | 'scansSynced', listener: (event?: { count?: number }) => void): Promise<{ remove: () => Promise<void> }>
}

interface MacSecurityBridge {
  scan(): Promise<import('../shared/hostScan').HostScanReport>
  read(): Promise<import('../shared/macSecurity').SecurityReading[]>
  apply(): Promise<import('../shared/macSecurity').MacSecurityApplyResult>
}

interface Window {
  wifiMapping?: {
    wardrive: MacWardriveBridge
    security?: MacSecurityBridge
  }
}
