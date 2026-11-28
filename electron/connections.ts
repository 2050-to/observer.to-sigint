import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { scheduleBaselineRewrite } from './baseline.js'
import {
  emptyConnectionCatalog,
  foldCatalog,
  markReviewed,
  parseConnectionCatalog,
  type ConnectionCatalog,
  type ConnectionSnapshot,
} from '../shared/connectionCatalog.js'
import {
  buildSnapshot,
  defaultRouteInterface,
  flagSockets,
  parseLsof,
  vpnRouteFrom,
} from '../shared/secureLinks.js'

const execFileAsync = promisify(execFile)
let pending: Promise<void> = Promise.resolve()

export function readSecureConnections(catalogFile: string, stillAllowed: () => boolean): Promise<ConnectionSnapshot> {
  return enqueue(() => collectSecureConnections(catalogFile, stillAllowed))
}

export function readStoredConnections(catalogFile: string): Promise<ConnectionCatalog> {
  return enqueue(async () => readCatalog(catalogFile))
}

export function reviewStoredConnections(catalogFile: string): Promise<ConnectionCatalog> {
  return enqueue(async () => {
    const next = markReviewed(readCatalog(catalogFile))
    writeCatalog(catalogFile, next)
    return next
  })
}

export function clearStoredConnections(catalogFile: string): Promise<ConnectionCatalog> {
  return enqueue(async () => {
    rmSync(catalogFile, { force: true })
    rmSync(`${catalogFile}.tmp`, { force: true })
    scheduleBaselineRewrite()
    return emptyConnectionCatalog()
  })
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = pending.then(work)
  pending = run.then(() => undefined, () => undefined)
  return run
}

async function collectSecureConnections(catalogFile: string, stillAllowed: () => boolean): Promise<ConnectionSnapshot> {
  const [table, routeText] = await Promise.all([readLsof(), readDefaultRoute()])
  const parsed = parseLsof(table)
  const vpnRoute = vpnRouteFrom(defaultRouteInterface(routeText))
  const snapshot = buildSnapshot(parsed, vpnRoute)
  if (!stillAllowed()) return { ...snapshot, catalog: readCatalog(catalogFile) }
  const catalog = foldCatalog(readCatalog(catalogFile), flagSockets(parsed), vpnRoute, new Date().toISOString())
  if (!stillAllowed()) return { ...snapshot, catalog: readCatalog(catalogFile) }
  writeCatalog(catalogFile, catalog)
  return { ...snapshot, catalog }
}

function readCatalog(file: string): ConnectionCatalog {
  try {
    return parseConnectionCatalog(readFileSync(file, 'utf8'))
  } catch {
    return emptyConnectionCatalog()
  }
}

function writeCatalog(file: string, catalog: ConnectionCatalog): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    writeFileSync(temp, JSON.stringify(catalog))
    renameSync(temp, file)
  } catch {
    throw new Error('The connection catalog could not be saved.')
  }
  scheduleBaselineRewrite()
}

async function readLsof(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('/usr/sbin/lsof', [
      '-nP',
      '+c0',
      '-u',
      String(userInfo().uid),
      '-iTCP',
      '-iUDP',
      '-F',
      'pcPnT',
    ], { encoding: 'utf8', timeout: 8000, maxBuffer: 16 * 1024 * 1024 })
    return stdout
  } catch (error) {
    const failed = commandFailure(error)
    if (failed.stdout.trim()) return failed.stdout
    if (failed.code === 1) return ''
    throw new Error('The socket table could not be read.')
  }
}

async function readDefaultRoute(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('route', ['-n', 'get', 'default'], {
      encoding: 'utf8',
      timeout: 2000,
      maxBuffer: 64 * 1024,
    })
    return stdout
  } catch (error) {
    return commandFailure(error).stdout
  }
}

function commandFailure(error: unknown): { code: string | number | null; stdout: string } {
  if (!error || typeof error !== 'object') return { code: null, stdout: '' }
  const record = error as { code?: unknown; stdout?: unknown }
  const code = typeof record.code === 'string' || typeof record.code === 'number' ? record.code : null
  const stdout = typeof record.stdout === 'string' ? record.stdout : ''
  return { code, stdout }
}
