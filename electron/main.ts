import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Agent } from 'node:https'
import { join } from 'node:path'
import { request as httpsRequest } from 'node:https'
import { app, BrowserWindow, ipcMain, powerSaveBlocker } from 'electron'
import { CatalogStore, type StoredScan } from './catalog'
import { catalogLocalSubnet, localDeviceDetails } from './ownedNetwork'
import { listen } from './server'

const require = createRequire(__filename)
const API_ORIGIN = 'https://127.0.0.1:9453'
const MIN_PERIOD_MS = 30_000
const V_SLOW = 0.82
const V_MAX = 44.704

interface ScannerModule {
  start(callback: (json: string) => void): void
  stop(): void
  setPeriod(ms: number): void
}

interface NativeScan {
  message?: string
  lat?: number | null
  lon?: number | null
  accuracy?: number | null
  altitudeM?: number | null
  verticalAccuracyM?: number | null
  relativeM?: number | null
  speedMps?: number | null
  wifiOn?: boolean
  bluetoothOn?: boolean
  cellOn?: boolean
  networks?: { bssid?: string; rssi?: number }[]
  devices?: unknown[]
  cells?: unknown[]
}

interface ScanReply {
  radiusM?: number
}

let window: BrowserWindow | null = null
let store: CatalogStore
let scanner: ScannerModule | null = null
let running = false
let quitting = false
let sleepBlocker = -1
let message = 'Drive is stopped.'
let apiUrl = ''
let token = ''
let radiusM = 91.4
let lastSpeed: number | null = null
let flushing = false
let flushAgain = false
let discarding = false
let chain = Promise.resolve()
let serverClose: (() => Promise<void>) | null = null

function exclusive<T>(fn: () => T): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(() => undefined, () => undefined)
  return run
}

function scannerPath(): string {
  const packed = join(process.resourcesPath, 'app.asar.unpacked', 'macos', 'addon', 'build', 'Release', 'scanner.node')
  const dev = join(app.getAppPath(), 'macos', 'addon', 'build', 'Release', 'scanner.node')
  return existsSync(packed) ? packed : dev
}

function caPath(): string | null {
  const candidates = [
    join(process.resourcesPath, 'ca.crt'),
    join(app.getAppPath(), 'certs', 'ca.crt'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function loadScanner(): ScannerModule | null {
  try {
    return require(scannerPath()) as ScannerModule
  } catch (error) {
    console.error('scanner addon unavailable', error instanceof Error ? error.message : error)
    return null
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function periodFor(radius: number, speedMps: number | null): number {
  const speed = speedMps == null ? V_MAX : Math.min(V_MAX, Math.max(V_SLOW, speedMps))
  return Math.max((2 * radius / speed) * 1000, MIN_PERIOD_MS)
}

function applyPeriod(): void {
  scanner?.setPeriod(Math.round(periodFor(radiusM, lastSpeed)))
}

function holdAwake(active: boolean): void {
  if (active) {
    if (!powerSaveBlocker.isStarted(sleepBlocker)) sleepBlocker = powerSaveBlocker.start('prevent-app-suspension')
    return
  }
  if (powerSaveBlocker.isStarted(sleepBlocker)) powerSaveBlocker.stop(sleepBlocker)
  sleepBlocker = -1
}

function waitingStatus(count: number): string {
  const noun = count === 1 ? 'scan' : 'scans'
  const pronoun = count === 1 ? 'It' : 'They'
  return `${count} ${noun} on this Mac. ${pronoun} will sync when a saved network is in range.`
}

function hearsSaved(networks: { bssid?: string }[], saved: string[]): boolean {
  if (!saved.length) return false
  const known = new Set(saved)
  return networks.some((network) => {
    const bssid = network.bssid?.trim().toLowerCase()
    return Boolean(bssid && known.has(bssid))
  })
}

function toScan(payload: NativeScan): StoredScan {
  return {
    scanId: randomUUID(),
    observedAt: new Date().toISOString(),
    lat: numberOrNull(payload.lat),
    lon: numberOrNull(payload.lon),
    accuracy: numberOrNull(payload.accuracy),
    altitudeM: numberOrNull(payload.altitudeM),
    verticalAccuracyM: numberOrNull(payload.verticalAccuracyM),
    relativeM: numberOrNull(payload.relativeM),
    speedMps: numberOrNull(payload.speedMps),
    wifiOn: Boolean(payload.wifiOn),
    bluetoothOn: Boolean(payload.bluetoothOn),
    cellOn: Boolean(payload.cellOn),
    networks: Array.isArray(payload.networks) ? payload.networks : [],
    devices: Array.isArray(payload.devices) ? payload.devices : [],
    cells: Array.isArray(payload.cells) ? payload.cells : [],
  }
}

function postScan(scan: StoredScan): Promise<ScanReply | null> {
  const { uploaded, ...body } = scan
  void uploaded
  return new Promise((resolve) => {
    let target: URL
    try {
      target = new URL('/api/scans', apiUrl)
    } catch {
      resolve(null)
      return
    }
    const payload = Buffer.from(JSON.stringify(body))
    const ca = caPath()
    const req = httpsRequest({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
      },
      servername: 'localhost',
      ca: ca ? readFileSync(ca) : undefined,
      rejectUnauthorized: true,
      timeout: 15000,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve(null)
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as ScanReply)
        } catch {
          resolve(null)
        }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.end(payload)
  })
}

async function flush(): Promise<void> {
  if (flushing) {
    flushAgain = true
    return
  }
  flushing = true
  let accepted = 0
  try {
    let again = true
    while (again) {
      flushAgain = false
      const pending = await exclusive(() => ({ items: store.unuploaded(), revision: store.revision }))
      const uploadedIds: string[] = []
      const synced: string[] = []
      let failed = false
      for (const scan of pending.items) {
        if (discarding) {
          failed = true
          break
        }
        const response = await postScan(scan)
        if (!response) {
          failed = true
          break
        }
        uploadedIds.push(scan.scanId)
        for (const network of scan.networks) {
          const bssid = network.bssid?.trim().toLowerCase()
          if (bssid) synced.push(bssid)
        }
        if (typeof response.radiusM === 'number' && response.radiusM > 0) radiusM = response.radiusM
      }
      if (uploadedIds.length) {
        const wrote = await exclusive(() => {
          if (discarding || store.revision !== pending.revision) return false
          store.markUploaded(uploadedIds)
          store.addSynced(synced)
          return true
        })
        if (wrote) accepted += uploadedIds.length
      }
      if (failed) break
      again = flushAgain
    }
  } finally {
    flushing = false
  }
  if (accepted > 0) {
    const noun = accepted === 1 ? 'scan' : 'scans'
    message = `Synced ${accepted} ${noun}.`
    window?.webContents.send('wardrive:synced', { count: accepted })
  } else {
    const pending = await exclusive(() => store.unuploaded().length)
    if (pending > 0) message = waitingStatus(pending)
  }
  applyPeriod()
}

async function onNativeScan(json: string): Promise<void> {
  if (!running) return
  let payload: NativeScan
  try {
    payload = JSON.parse(json) as NativeScan
  } catch {
    return
  }
  if (payload.message) message = payload.message
  lastSpeed = numberOrNull(payload.speedMps)
  applyPeriod()
  const networks = (Array.isArray(payload.networks) ? payload.networks : []).filter((network) => network.bssid?.trim())
  if (!networks.length) {
    window?.webContents.send('wardrive:queued', {})
    return
  }
  const saved = await exclusive(() => {
    if (!running || discarding) return false
    const scan = toScan(payload)
    store.append(scan)
    const heard = hearsSaved(networks, store.syncedBssids())
    if (!heard) message = waitingStatus(store.unuploaded().length)
    return heard
  })
  window?.webContents.send('wardrive:queued', {})
  if (saved) await flush()
}

function registerIpc(): void {
  ipcMain.handle('wardrive:start', async (_event, options: { apiUrl?: string; token?: string }) => {
    const nextUrl = options?.apiUrl ?? ''
    const nextToken = options?.token ?? ''
    if (!nextUrl.startsWith('https://')) throw new Error('apiUrl must be https')
    if (!nextToken) throw new Error('token is required')
    if (!scanner) throw new Error('The Wi-Fi scanner is unavailable')
    apiUrl = nextUrl
    token = nextToken
    running = true
    radiusM = 91.4
    lastSpeed = null
    message = 'Scanning nearby networks.'
    holdAwake(true)
    scanner.stop()
    scanner.start((json) => {
      void onNativeScan(json)
    })
  })
  ipcMain.handle('wardrive:stop', async () => {
    running = false
    message = 'Drive is stopped.'
    holdAwake(false)
    scanner?.stop()
  })
  ipcMain.handle('wardrive:status', async () => ({ running, message }))
  ipcMain.handle('wardrive:catalog', async () => exclusive(() => ({
    catalog: store.readCatalog(),
    journal: store.readJournal(),
  })))
  ipcMain.handle('wardrive:save', async (_event, options: { catalog?: string }) => {
    await exclusive(() => store.saveCatalog(options?.catalog ?? ''))
  })
  ipcMain.handle('wardrive:uploaded', async (_event, options: { scanIds?: string }) => {
    const ids = JSON.parse(options?.scanIds || '[]') as string[]
    await exclusive(() => store.markUploaded(Array.isArray(ids) ? ids : []))
  })
  ipcMain.handle('wardrive:enqueue', async (_event, options: { scans?: string }) => {
    const scans = JSON.parse(options?.scans || '[]') as StoredScan[]
    await exclusive(() => store.enqueue(Array.isArray(scans) ? scans : []))
    window?.webContents.send('wardrive:queued', {})
  })
  ipcMain.handle('wardrive:replace', async (_event, options: { catalog?: string; journal?: string }) => {
    discarding = true
    try {
      await exclusive(() => store.replace(options?.catalog ?? '', options?.journal ?? '[]'))
    } finally {
      discarding = false
    }
  })
  ipcMain.handle('wardrive:subnet', async (_event, options: { consent?: boolean }) => {
    if (options?.consent !== true) throw new Error('Cataloging IP addresses stays off until you allow it for a network you own.')
    return catalogLocalSubnet()
  })
  ipcMain.handle('wardrive:details', async (_event, options: { consent?: boolean; browser?: string }) => {
    if (options?.consent !== true) throw new Error('Device details stay off until you allow them for a network you own.')
    return localDeviceDetails(options?.browser ?? '')
  })
  ipcMain.handle('wardrive:clear', async () => {
    running = false
    message = 'Drive is stopped.'
    holdAwake(false)
    scanner?.stop()
    discarding = true
    try {
      while (flushing) {
        flushAgain = false
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      await exclusive(() => store.clear())
    } finally {
      discarding = false
    }
  })
}

async function openWindow(): Promise<void> {
  const directory = app.getPath('userData')
  mkdirSync(directory, { recursive: true })
  store = new CatalogStore(join(directory, 'catalog.json'), join(directory, 'journal.json'))
  scanner = loadScanner()
  const ca = caPath()
  const agent = new Agent({
    ca: ca ? readFileSync(ca) : undefined,
    rejectUnauthorized: true,
    servername: 'localhost',
  })
  const ui = await listen(join(app.getAppPath(), 'dist'), API_ORIGIN, agent)
  serverClose = ui.close
  window = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Wi-Fi Mapping',
    backgroundColor: '#111214',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.on('close', (event) => {
    if (running && !quitting) {
      event.preventDefault()
      window?.hide()
    }
  })
  await window.loadURL(`http://127.0.0.1:${ui.port}/`)
}

app.whenReady().then(() => {
  registerIpc()
  return openWindow()
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  app.quit()
})

app.on('activate', () => {
  window?.show()
})

app.on('window-all-closed', () => {
  if (!running) app.quit()
})

app.on('before-quit', () => {
  quitting = true
  running = false
  holdAwake(false)
  scanner?.stop()
  void serverClose?.()
})
