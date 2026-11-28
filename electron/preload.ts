import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('wifiMapping', {
  security: {
    scan: () => ipcRenderer.invoke('security:scan'),
    read: () => ipcRenderer.invoke('mac-security:read'),
    apply: () => ipcRenderer.invoke('mac-security:apply'),
  },
  wardrive: {
    startDrive: (options: { apiUrl: string; token: string }) => ipcRenderer.invoke('wardrive:start', options),
    stopDrive: () => ipcRenderer.invoke('wardrive:stop'),
    getStatus: () => ipcRenderer.invoke('wardrive:status'),
    getLocalCatalog: () => ipcRenderer.invoke('wardrive:catalog'),
    saveLocalCatalog: (options: { catalog: string }) => ipcRenderer.invoke('wardrive:save', options),
    markUploaded: (options: { scanIds: string }) => ipcRenderer.invoke('wardrive:uploaded', options),
    enqueue: (options: { scans: string }) => ipcRenderer.invoke('wardrive:enqueue', options),
    clearLocal: () => ipcRenderer.invoke('wardrive:clear'),
    replaceLocal: (options: { catalog: string; journal: string }) => ipcRenderer.invoke('wardrive:replace', options),
    catalogSubnet: (options: { consent: boolean }) => ipcRenderer.invoke('wardrive:subnet', options),
    deviceDetails: (options: { consent: boolean; browser: string }) => ipcRenderer.invoke('wardrive:details', options),
    getOwnedPrefs: () => ipcRenderer.invoke('wardrive:owned-get'),
    setOwnedPrefs: (options: { addresses: boolean; details: boolean }) => ipcRenderer.invoke('wardrive:owned-set', options),
    clearOwnedPrefs: () => ipcRenderer.invoke('wardrive:owned-clear'),
    getSecureLinks: () => ipcRenderer.invoke('wardrive:secure-get'),
    setSecureLinks: (options: { allowed: boolean }) => ipcRenderer.invoke('wardrive:secure-set', options),
    listConnections: (options: { consent: boolean }) => ipcRenderer.invoke('wardrive:connections', options),
    getConnectionCatalog: () => ipcRenderer.invoke('wardrive:connections-catalog'),
    reviewConnectionCatalog: () => ipcRenderer.invoke('wardrive:connections-review'),
    clearConnectionCatalog: () => ipcRenderer.invoke('wardrive:connections-clear'),
    apiOrigin: () => ipcRenderer.invoke('wardrive:api-origin'),
    promptLocation: () => ipcRenderer.invoke('wardrive:prompt-location'),
    addListener: (eventName: 'scanQueued' | 'scansSynced', listener: (event?: { count?: number }) => void) => {
      const channel = eventName === 'scansSynced' ? 'wardrive:synced' : 'wardrive:queued'
      const wrapped = (_event: IpcRendererEvent, payload: { count?: number }) => listener(payload ?? {})
      ipcRenderer.on(channel, wrapped)
      return Promise.resolve({
        remove: () => {
          ipcRenderer.removeListener(channel, wrapped)
          return Promise.resolve()
        },
      })
    },
  },
})
