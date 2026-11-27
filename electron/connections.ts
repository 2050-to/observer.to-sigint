import { execFile } from 'node:child_process'
import { userInfo } from 'node:os'
import { promisify } from 'node:util'
import {
  buildSnapshot,
  defaultRouteInterface,
  parseLsof,
  vpnRouteFrom,
  type SecureLinkSnapshot,
} from '../shared/secureLinks.js'

const execFileAsync = promisify(execFile)

export async function readSecureConnections(): Promise<SecureLinkSnapshot> {
  const [table, routeText] = await Promise.all([readLsof(), readDefaultRoute()])
  return buildSnapshot(parseLsof(table), vpnRouteFrom(defaultRouteInterface(routeText)))
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
