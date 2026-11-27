import { execFile } from 'node:child_process'
import { readdir, access } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { classifyHostScan, launchFieldsFromPlist, type LaunchFields } from '../shared/hostScan.js'

const XPROTECT_PATHS = [
  '/Library/Apple/System/Library/CoreServices/XProtect.bundle',
  '/System/Library/CoreServices/XProtect.bundle',
]

const LOGIN_SCRIPT = [
  'tell application "System Events"',
  'if (count of login items) is 0 then return ""',
  'set output to ""',
  'repeat with itemRef in login items',
  'set itemName to name of itemRef',
  'set itemPath to ""',
  'try',
  'set itemPath to path of itemRef',
  'end try',
  'set output to output & itemName & tab & itemPath & linefeed',
  'end repeat',
  'return output',
  'end tell',
].join('\n')

interface CommandResult {
  ok: boolean
  stdout: string
  stderr: string
}

export async function scanThisMac() {
  const [agents, daemons, helpers, cronText, loginText, kextText, systemExtensionText, sipText, gatekeeperText, filevaultText, firewallText, xprotectFound] = await Promise.all([
    readLaunchDirs([join(homedir(), 'Library', 'LaunchAgents'), '/Library/LaunchAgents']),
    readLaunchDirs([join(homedir(), 'Library', 'LaunchDaemons'), '/Library/LaunchDaemons']),
    readHelpers('/Library/PrivilegedHelperTools'),
    readCron(),
    readLoginItems(),
    readKexts(),
    readText('/usr/bin/systemextensionsctl', ['list']),
    readText('/usr/bin/csrutil', ['status']),
    readText('/usr/sbin/spctl', ['--status']),
    readText('/usr/bin/fdesetup', ['status']),
    readText('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getglobalstate']),
    readXprotect(),
  ])
  return classifyHostScan({
    hostname: hostname(),
    scannedAt: new Date().toISOString(),
    agents,
    daemons,
    helpers,
    loginText,
    cronText,
    kextText,
    systemExtensionText,
    sipText,
    gatekeeperText,
    filevaultText,
    firewallText,
    xprotectFound,
  })
}

async function readLaunchDirs(dirs: string[]): Promise<LaunchFields[] | null> {
  const parts = await Promise.all(dirs.map((dir) => readLaunchDir(dir)))
  if (parts.every((part) => part === null)) return null
  return parts.flatMap((part, index) => part ?? [unreadable(dirs[index] ?? '')])
}

async function readLaunchDir(dir: string): Promise<LaunchFields[] | null> {
  const names = await listFiles(dir)
  if (names === null) return null
  const plists = names.filter((name) => name.endsWith('.plist') || name.endsWith('.plist.disabled'))
  return mapPool(plists, 8, async (name) => {
    const plistPath = join(dir, name)
    const converted = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath])
    if (!converted.ok) return unreadable(plistPath)
    return launchFieldsFromPlist(plistPath, converted.stdout)
  })
}

async function readHelpers(dir: string): Promise<LaunchFields[] | null> {
  const names = await listFiles(dir)
  if (names === null) return null
  return names.map((name) => ({
    label: name,
    program: join(dir, name),
    programArguments: [],
    environment: {},
    plistPath: join(dir, name),
  }))
}

async function listFiles(dir: string): Promise<string[] | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile() || entry.isSymbolicLink()).map((entry) => entry.name)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    return null
  }
}

async function readCron(): Promise<string | null> {
  const result = await run('/usr/bin/crontab', ['-l'])
  if (result.ok) return result.stdout
  if (/no crontab/i.test(`${result.stdout}\n${result.stderr}`)) return ''
  return null
}

async function readLoginItems(): Promise<string | null> {
  const result = await run('/usr/bin/osascript', ['-e', LOGIN_SCRIPT], 8000)
  if (!result.ok) return null
  return result.stdout
}

async function readKexts(): Promise<string | null> {
  const attempts: [string, string[]][] = [
    ['/usr/sbin/kextstat', ['-l']],
    ['/usr/bin/kmutil', ['showloaded']],
  ]
  for (const [command, args] of attempts) {
    const result = await run(command, args)
    if (result.ok && (result.stdout || result.stderr)) return `${result.stdout}\n${result.stderr}`
  }
  return null
}

async function readText(command: string, args: string[]): Promise<string | null> {
  const result = await run(command, args)
  if (!result.ok) return null
  return `${result.stdout}\n${result.stderr}`
}

async function readXprotect(): Promise<boolean | null> {
  let denied = false
  for (const path of XPROTECT_PATHS) {
    try {
      await access(path)
      return true
    } catch (error) {
      const code = errorCode(error)
      if (code === 'EACCES' || code === 'EPERM') denied = true
    }
  }
  return denied ? null : false
}

function unreadable(plistPath: string): LaunchFields {
  return { label: '', program: '', programArguments: [], environment: {}, plistPath, unreadable: true }
}

function run(command: string, args: string[], timeout = 5000): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
      })
    })
  })
}

async function mapPool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      const item = items[index]
      if (item !== undefined) results[index] = await task(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}
