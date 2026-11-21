/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_TOKEN: string
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
  addListener(eventName: 'scanQueued' | 'scansSynced', listener: (event?: { count?: number }) => void): Promise<{ remove: () => Promise<void> }>
}

interface Window {
  wifiMapping?: { wardrive: MacWardriveBridge }
}
