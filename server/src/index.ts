import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { catalogBundleCsv } from '../../shared/csv.js'
import { lookupPlace } from './geocode.js'
import { Store, type ScanInput } from './store.js'
import { bearerOk } from './crypto.js'
import type { ScanAp, ScanCell, ScanDevice } from './types.js'

function loadEnv(path: string): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const split = trimmed.indexOf('=')
    if (split < 0) continue
    const key = trimmed.slice(0, split)
    if (process.env[key] == null) process.env[key] = trimmed.slice(split + 1)
  }
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
loadEnv(resolve(repoRoot, '.env'))
for (const key of ['PGSSLROOTCERT', 'REDIS_CA', 'TLS_CERT', 'TLS_KEY']) {
  const value = process.env[key]
  if (value && !value.startsWith('/')) process.env[key] = resolve(repoRoot, value)
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://localhost',
  'capacitor://localhost',
])

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > 2_000_000) throw new HttpError(413, 'body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asScan(body: unknown): ScanInput {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'scan body is required')
  const scan = body as Partial<ScanInput>
  if (!scan.scanId || !UUID.test(scan.scanId)) throw new HttpError(400, 'scanId must be a uuid')
  if (!scan.observedAt || Number.isNaN(Date.parse(scan.observedAt))) throw new HttpError(400, 'observedAt is invalid')
  if (!Array.isArray(scan.networks)) throw new HttpError(400, 'networks must be a list')
  return {
    scanId: scan.scanId,
    observedAt: new Date(scan.observedAt).toISOString(),
    lat: numberOrNull(scan.lat),
    lon: numberOrNull(scan.lon),
    accuracy: numberOrNull(scan.accuracy),
    altitudeM: numberOrNull(scan.altitudeM),
    verticalAccuracyM: numberOrNull(scan.verticalAccuracyM),
    relativeM: numberOrNull(scan.relativeM),
    speedMps: numberOrNull(scan.speedMps),
    wifiOn: Boolean(scan.wifiOn),
    bluetoothOn: Boolean(scan.bluetoothOn),
    cellOn: Boolean(scan.cellOn),
    networks: scan.networks.map(asAp),
    devices: asDevices(scan.devices),
    cells: asCells(scan.cells),
  }
}

function asDevices(value: unknown): ScanDevice[] {
  if (!Array.isArray(value)) return []
  const devices: ScanDevice[] = []
  for (const entry of value) {
    const device = asDevice(entry)
    if (device) devices.push(device)
  }
  return devices
}

function asDevice(value: unknown): ScanDevice | null {
  if (!value || typeof value !== 'object') return null
  const device = value as Partial<ScanDevice>
  if (typeof device.address !== 'string' || !Number.isFinite(device.rssi)) return null
  const addressType = device.addressType === 'public' ? 'public' : 'random'
  return {
    address: device.address,
    addressType,
    name: typeof device.name === 'string' ? device.name : null,
    rssi: Number(device.rssi),
    txPower: numberOrNull(device.txPower),
    serviceUuids: Array.isArray(device.serviceUuids) ? device.serviceUuids.map(String) : [],
    broadcastLat: numberOrNull(device.broadcastLat),
    broadcastLon: numberOrNull(device.broadcastLon),
  }
}

function asCells(value: unknown): ScanCell[] {
  if (!Array.isArray(value)) return []
  const cells: ScanCell[] = []
  for (const entry of value) {
    const cell = asCell(entry)
    if (cell) cells.push(cell)
  }
  return cells
}

function asCell(value: unknown): ScanCell | null {
  if (!value || typeof value !== 'object') return null
  const cell = value as Partial<ScanCell>
  if (cell.radio !== 'lte' && cell.radio !== 'nr' && cell.radio !== 'wcdma' && cell.radio !== 'gsm') return null
  if (typeof cell.mcc !== 'string' || typeof cell.mnc !== 'string') return null
  if (typeof cell.area !== 'string' || typeof cell.cellId !== 'string') return null
  if (!Number.isFinite(cell.rssi)) return null
  return {
    radio: cell.radio,
    registered: Boolean(cell.registered),
    mcc: cell.mcc,
    mnc: cell.mnc,
    area: cell.area,
    cellId: cell.cellId,
    pci: numberOrNull(cell.pci),
    rssi: Number(cell.rssi),
    timingAdvanceM: numberOrNull(cell.timingAdvanceM),
  }
}

function asAp(value: unknown): ScanAp {
  if (!value || typeof value !== 'object') throw new HttpError(400, 'network entry is invalid')
  const ap = value as Partial<ScanAp>
  if (typeof ap.bssid !== 'string' || typeof ap.ssid !== 'string') throw new HttpError(400, 'ssid and bssid are required')
  if (!Number.isFinite(ap.rssi)) throw new HttpError(400, 'rssi is required')
  return {
    ssid: ap.ssid,
    bssid: ap.bssid,
    rssi: Number(ap.rssi),
    frequencyMhz: Number(ap.frequencyMhz ?? 0),
    channel: Number(ap.channel ?? 0),
    band: String(ap.band ?? 'unknown'),
    channelWidthMhz: Number(ap.channelWidthMhz ?? 20),
    centerFreq0: Number(ap.centerFreq0 ?? 0),
    centerFreq1: Number(ap.centerFreq1 ?? 0),
    wifiStandard: String(ap.wifiStandard ?? 'unknown'),
    capabilities: String(ap.capabilities ?? ''),
    securityTypes: Array.isArray(ap.securityTypes) ? ap.securityTypes.map(String) : [],
    passpoint: Boolean(ap.passpoint),
    responder80211mc: Boolean(ap.responder80211mc),
    responder80211az: Boolean(ap.responder80211az),
    twtResponder: Boolean(ap.twtResponder),
    secureHeLtf: Boolean(ap.secureHeLtf),
    rangingFrameProtection: Boolean(ap.rangingFrameProtection),
    apMldMac: ap.apMldMac ?? null,
    apMloLinkId: numberOrNull(ap.apMloLinkId),
    affiliatedLinks: Array.isArray(ap.affiliatedLinks) ? ap.affiliatedLinks : [],
    operatorName: ap.operatorName ?? null,
    venueName: ap.venueName ?? null,
    countryCode: ap.countryCode ?? null,
    maxRateMbps: numberOrNull(ap.maxRateMbps),
    stationCount: numberOrNull(ap.stationCount),
    channelUtilization: numberOrNull(ap.channelUtilization),
    admissionCapacity: numberOrNull(ap.admissionCapacity),
    vendorOuis: Array.isArray(ap.vendorOuis) ? ap.vendorOuis.map(String) : [],
  }
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  const payload = type === 'application/json' ? JSON.stringify(body) : String(body)
  res.writeHead(status, { 'Content-Type': type })
  res.end(payload)
}

async function handle(store: Store, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = req.headers.origin
  if (origin && ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Strict-Transport-Security', 'max-age=15552000')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  const url = new URL(req.url ?? '/', 'https://localhost')
  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { ok: true })
    return
  }
  const token = process.env.API_TOKEN
  if (!token || !bearerOk(req.headers.authorization, token)) {
    send(res, 401, { error: 'unauthorized' })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/scans') {
    const scan = asScan(JSON.parse(await readBody(req)) as unknown)
    const result = await store.ingest(scan)
    send(res, 200, { applied: result.applied, ...result.snapshot })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/place') {
    const body = JSON.parse(await readBody(req)) as { bssid?: string; lat?: number; lon?: number }
    const lat = numberOrNull(body.lat)
    const lon = numberOrNull(body.lon)
    if (lat == null || lon == null) throw new HttpError(400, 'lat and lon are required')
    const lookedUp = await lookupPlace(lat, lon)
    const place = { ...lookedUp, fetchedAt: new Date().toISOString() }
    if (body.bssid) {
      const record = await store.saveNetworkPlace(body.bssid, place)
      send(res, 200, { place, network: record })
      return
    }
    await store.savePhonePlace(place)
    send(res, 200, { place })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/range') {
    send(res, 200, await store.range())
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/map') {
    const map = await store.map()
    send(res, 200, {
      phone: map.snapshot.phone,
      radiusM: map.snapshot.radiusM,
      dwellSeconds: map.snapshot.dwellSeconds,
      scanPeriodSeconds: map.snapshot.scanPeriodSeconds,
      circle: map.circle,
      networks: map.networks,
      devices: map.devices,
      cells: map.cells,
      rooms: map.snapshot.rooms,
      movers: map.snapshot.movers,
    })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/open') {
    send(res, 200, { networks: await store.open() })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/summary') {
    send(res, 200, await store.summary())
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/export.csv') {
    const snapshot = await store.range()
    send(res, 200, catalogBundleCsv(await store.catalog(), {
      devices: await store.devices(),
      cells: await store.cells(),
      rooms: snapshot.rooms,
    }), 'text/csv; charset=utf-8')
    return
  }
  send(res, 404, { error: 'not found' })
}

async function main(): Promise<void> {
  const cert = process.env.TLS_CERT
  const key = process.env.TLS_KEY
  if (!cert || !key) throw new Error('TLS_CERT and TLS_KEY are required')
  const store = await Store.connect()
  await store.migrate()
  const port = Number(process.env.PORT ?? 8443)
  const server = createServer(
    { cert: readFileSync(cert), key: readFileSync(key), minVersion: 'TLSv1.2' },
    (req, res) => {
      handle(store, req, res).catch((error: unknown) => {
        const status = error instanceof HttpError ? error.status : 500
        const message = error instanceof Error ? error.message : 'request failed'
        if (status === 500) console.error('request failed')
        if (!res.headersSent) send(res, status, { error: message })
        else res.end()
      })
    },
  )
  server.listen(port, '0.0.0.0', () => {
    console.log(`listening on ${port}`)
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'startup failed')
  process.exit(1)
})
