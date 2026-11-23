import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('wifiMapping', {
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
    importHistory: (options: { consent: boolean }) => ipcRenderer.invoke('wardrive:history', options),
    apiOrigin: () => ipcRenderer.invoke('wardrive:api-origin'),
    promptFullDiskAccess: () => ipcRenderer.invoke('wardrive:full-disk-access'),
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
