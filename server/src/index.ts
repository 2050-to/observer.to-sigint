import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRIVACY_VERSION, TOS_VERSION, isAdult, routeNeedsConsent } from '../../shared/legal.js'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { catalogBundleCsv } from '../../shared/csv.js'
import { catalogForensicsMarkdown } from '../../shared/forensics.js'
import { AlertWorker } from './alerts.js'
import { appOrigin, normalizeEmail, requestLogin, verifyLogin, verifySession } from './auth.js'
import { askAccount } from './ask.js'
import { acceptWebhook, startCheckout, startPortal } from './billing.js'
import { asOwnedDevice, asOwnedLan, asPlaceFilter, asSearchBody, asVisitBody } from './intake.js'
import { DeepSeekEnrichmentClient } from './enrichment/deepseek.js'
import { EnrichmentWorker } from './enrichment/worker.js'
import { lookupPlace } from './geocode.js'
import { ApiError } from './http.js'
import { Store, type ScanInput } from './store.js'
import type { PlaceInfo, ScanAp, ScanCell, ScanDevice } from './types.js'

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://localhost',
  'capacitor://localhost',
  appOrigin(),
])

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > 2_000_000) throw new ApiError(413, 'body too large')
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
  if (!body || typeof body !== 'object') throw new ApiError(400, 'scan body is required')
  const scan = body as Partial<ScanInput>
  if (!scan.scanId || !UUID.test(scan.scanId)) throw new ApiError(400, 'scanId must be a uuid')
  if (!scan.observedAt || Number.isNaN(Date.parse(scan.observedAt))) throw new ApiError(400, 'observedAt is invalid')
  if (!Array.isArray(scan.networks)) throw new ApiError(400, 'networks must be a list')
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
  if (!value || typeof value !== 'object') throw new ApiError(400, 'network entry is invalid')
  const ap = value as Partial<ScanAp>
  if (typeof ap.bssid !== 'string' || typeof ap.ssid !== 'string') throw new ApiError(400, 'ssid and bssid are required')
  if (!Number.isFinite(ap.rssi)) throw new ApiError(400, 'rssi is required')
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

async function handle(store: Store, enrichmentEnabled: boolean, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = req.headers.origin
  if (origin && ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
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
  if (req.method === 'POST' && url.pathname === '/api/billing/webhook') {
    const signature = req.headers['stripe-signature']
    await acceptWebhook(await readBody(req), Array.isArray(signature) ? signature[0] : signature, store)
    send(res, 200, { received: true })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/request') {
    let email: string | null = null
    let client: unknown
    try {
      const body = JSON.parse(await readBody(req)) as { email?: unknown; client?: unknown }
      email = normalizeEmail(body.email)
      client = body.client
    } catch {
      email = null
    }
    if (email) {
      try {
        await requestLogin(store, email, client)
      } catch (error) {
        if (error instanceof ApiError) throw error
        console.error('sign-in email failed', error instanceof Error ? error.message : error)
        throw new ApiError(500, 'email could not be sent')
      }
    }
    send(res, 200, { ok: true })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/verify') {
    const body = JSON.parse(await readBody(req)) as { token?: unknown }
    send(res, 200, await verifyLogin(store, body.token))
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/legal') {
    send(res, 200, legalDocuments())
    return
  }
  const session = await verifySession(typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined)
  if (!session || !UUID.test(session.id)) throw new ApiError(401, 'unauthorized')
  const user = await store.userById(session.id)
  if (!user) throw new ApiError(401, 'unauthorized')
  if (req.method === 'POST' && url.pathname === '/api/legal/accept') {
    const body = JSON.parse(await readBody(req)) as { bornOn?: unknown; tosVersion?: unknown; privacyVersion?: unknown }
    const bornOn = typeof body.bornOn === 'string' ? body.bornOn : ''
    if (!isAdult(bornOn)) {
      await store.deleteAccount(user.id)
      throw new ApiError(403, 'age restricted')
    }
    if (body.tosVersion !== TOS_VERSION || body.privacyVersion !== PRIVACY_VERSION) {
      throw new ApiError(409, 'terms have changed')
    }
    await store.acceptLegal(user.id, bornOn, TOS_VERSION, PRIVACY_VERSION)
    send(res, 200, { ok: true })
    return
  }
  if (routeNeedsConsent(req.method ?? 'GET', url.pathname)) {
    const consent = await store.consentFor(user.id)
    if (!consent.accepted) throw new ApiError(403, 'consent required')
  }
  if (req.method === 'GET' && (url.pathname === '/api/me' || url.pathname === '/api/billing')) {
    const consent = await store.consentFor(user.id)
    const alerts = await store.subscriptionFor(user.id)
    send(res, 200, {
      id: user.id,
      email: user.email,
      alerts: {
        status: alerts.status,
        currentPeriodEnd: alerts.currentPeriodEnd,
        portal: Boolean(alerts.stripeCustomerId),
      },
      consent: {
        accepted: consent.accepted,
        bornOn: consent.bornOn,
        tosVersion: consent.tosVersion,
        privacyVersion: consent.privacyVersion,
        currentTosVersion: TOS_VERSION,
        currentPrivacyVersion: PRIVACY_VERSION,
      },
    })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/billing/checkout') {
    send(res, 200, { url: await startCheckout(store, user) })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/billing/portal') {
    send(res, 200, { url: await startPortal(store, user.id) })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/reset') {
    await store.wipe(user.id)
    send(res, 200, { ok: true })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/scans') {
    const scan = asScan(JSON.parse(await readBody(req)) as unknown)
    const result = await store.ingest(user.id, scan)
    send(res, 200, { applied: result.applied, ...result.snapshot })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/postal') {
    const body = JSON.parse(await readBody(req)) as { lat?: number; lon?: number }
    const lat = numberOrNull(body.lat)
    const lon = numberOrNull(body.lon)
    if (lat == null || lon == null) throw new ApiError(400, 'lat and lon are required')
    send(res, 200, { postalCode: await store.postalCodeFor(user.id, lat, lon) })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/place') {
    const body = JSON.parse(await readBody(req)) as { bssid?: string; lat?: number; lon?: number }
    const lat = numberOrNull(body.lat)
    const lon = numberOrNull(body.lon)
    if (lat == null || lon == null) throw new ApiError(400, 'lat and lon are required')
    const lookedUp = await lookupPlace(lat, lon)
    await store.rememberPostalCode(user.id, lat, lon, lookedUp.postalCode)
    const place: PlaceInfo = {
      address: lookedUp.address,
      crossStreets: lookedUp.crossStreets,
      elevationM: lookedUp.elevationM,
      fetchedAt: new Date().toISOString(),
      lat,
      lon,
    }
    if (body.bssid) {
      const codes = await store.appearanceCodes(user.id, body.bssid, lat, lon, lookedUp.postalCode)
      const record = await store.saveNetworkPlace(user.id, body.bssid, place, codes)
      send(res, 200, { place, network: record, postalCodes: record.postalCodes ?? [] })
      return
    }
    const postalCodes = await store.savePhonePlace(user.id, place, lookedUp.postalCode)
    send(res, 200, { place, postalCodes })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/range') {
    send(res, 200, await store.range(user.id))
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/map') {
    const map = await store.map(user.id)
    send(res, 200, {
      phone: map.snapshot.phone,
      postalCodes: map.snapshot.postalCodes ?? [],
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
    send(res, 200, { networks: await store.open(user.id) })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/summary') {
    send(res, 200, await store.summary(user.id))
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/enrichment/status') {
    send(res, 200, await store.enrichmentStatus(enrichmentEnabled))
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/wifi') {
    send(res, 200, { networks: await store.searchWifi(user.id, asPlaceFilter(url)) })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/search-history') {
    send(res, 200, { items: await store.listSearches(user.id, url.searchParams.get('q') ?? '') })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/search-history') {
    const body = asSearchBody(JSON.parse(await readBody(req)) as unknown)
    const count = await store.saveSearches(user.id, body.items, body.replace)
    send(res, 200, { count })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/browsing-history') {
    send(res, 200, { items: await store.listVisits(user.id, url.searchParams.get('q') ?? '') })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/browsing-history') {
    const body = asVisitBody(JSON.parse(await readBody(req)) as unknown)
    const count = await store.saveVisits(user.id, body.items, body.replace)
    send(res, 200, { count })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/device') {
    await store.saveDeviceProfile(user.id, asOwnedDevice(JSON.parse(await readBody(req)) as unknown))
    send(res, 200, { ok: true })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/lan') {
    const catalog = asOwnedLan(JSON.parse(await readBody(req)) as unknown)
    await store.replaceLanHosts(user.id, catalog.hosts)
    send(res, 200, { count: catalog.hosts.length })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/ask') {
    send(res, 200, await askAccount(store, user.id, JSON.parse(await readBody(req)) as unknown))
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/export.csv') {
    const snapshot = await store.range(user.id)
    send(res, 200, catalogBundleCsv(await store.catalog(user.id), {
      devices: await store.devices(user.id),
      cells: await store.cells(user.id),
      rooms: snapshot.rooms,
    }), 'text/csv; charset=utf-8')
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/export.md') {
    const snapshot = await store.range(user.id)
    const markdown = await catalogForensicsMarkdown(await store.catalog(user.id), {
      devices: await store.devices(user.id),
      cells: await store.cells(user.id),
      rooms: snapshot.rooms,
    }, new Date().toISOString())
    res.setHeader('Content-Disposition', 'attachment; filename="digital-forensics.md"')
    send(res, 200, markdown, 'text/markdown; charset=utf-8')
    return
  }
  send(res, 404, { error: 'not found' })
}

function legalDocuments(): {
  tosVersion: string
  privacyVersion: string
  terms: string
  privacy: string
} {
  return {
    tosVersion: TOS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    terms: readFileSync(resolve(repoRoot, 'legal/terms.md'), 'utf8'),
    privacy: readFileSync(resolve(repoRoot, 'legal/privacy.md'), 'utf8'),
  }
}

async function main(): Promise<void> {
  const cert = process.env.TLS_CERT
  const key = process.env.TLS_KEY
  if (Boolean(cert) !== Boolean(key)) throw new Error('TLS_CERT and TLS_KEY must be set together')
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required')
  const store = await Store.connect()
  await store.migrate()
  const deepSeekKey = process.env.DEEPSEEK_API_KEY?.trim()
  const enrichmentWorker = deepSeekKey
    ? new EnrichmentWorker(
      store,
      new DeepSeekEnrichmentClient({
        apiKey: deepSeekKey,
        model: process.env.DEEPSEEK_MODEL,
      }),
      {
        refreshDays: Number(process.env.ENRICHMENT_REFRESH_DAYS ?? 30),
      },
    )
    : null
  const alertWorker = new AlertWorker(store)
  const port = Number(process.env.PORT ?? 8443)
  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    handle(store, Boolean(enrichmentWorker), req, res).catch((error: unknown) => {
      const status = error instanceof ApiError ? error.status : 500
      const message = error instanceof Error ? error.message : 'request failed'
      if (status === 500) console.error(error)
      if (!res.headersSent) send(res, status, { error: message })
      else res.end()
    })
  }
  const server = cert && key
    ? createHttpsServer({ cert: readFileSync(cert), key: readFileSync(key), minVersion: 'TLSv1.2' }, onRequest)
    : createHttpServer(onRequest)
  server.listen(port, process.env.BIND_HOST || '0.0.0.0', () => {
    console.log(`listening on ${port}`)
    enrichmentWorker?.start()
    alertWorker.start()
  })
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await enrichmentWorker?.stop()
    alertWorker.stop()
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    await store.close()
  }
  process.once('SIGINT', () => void close())
  process.once('SIGTERM', () => void close())
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'startup failed')
  process.exit(1)
})
