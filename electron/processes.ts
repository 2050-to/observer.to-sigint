import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { ALLOWLIST_TEMPLATE, appendAllowlist, parseAllowlist } from '../shared/allowlist.js'
import { scheduleBaselineRewrite } from './baseline.js'
import {
  applyAlerts,
  dismissProcess,
  emptyProcessCatalog,
  emptySignature,
  foldProcesses,
  parseProcessCatalog,
  parsePsArgs,
  parsePsTable,
  platformSignature,
  signatureFromCodesign,
  type LiveProcess,
  type ProcessAlert,
  type ProcessCatalog,
  type ProcessSignature,
  type ProcessSnapshot,
} from '../shared/processCatalog.js'

const execFileAsync = promisify(execFile)
const CODESIGN_LIMIT = 4
const COMMAND_LIMIT = 4000

export interface ProcessFiles {
  catalog: string
  allowlist: string
  logging: string
}

interface FileStamp {
  size: number
  mtimeMs: number
}

let pending: Promise<void> = Promise.resolve()
let lastLive: LiveProcess[] = []
let lastError: string | null = null

export function readProcessSnapshot(files: ProcessFiles): ProcessSnapshot {
  return {
    allowed: readLoggingChoice(files.logging).allowed,
    catalog: readCatalog(files.catalog),
    live: lastLive,
    allowlistText: ensureAllowlist(files.allowlist),
    error: lastError,
  }
}

export function readLoggingChoice(file: string): { allowed: boolean } {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as { allowed?: unknown }
    return { allowed: value.allowed === true }
  } catch {
    return { allowed: false }
  }
}

export function writeLoggingChoice(file: string, allowed: boolean): { allowed: boolean } {
  const choice = { allowed: allowed === true }
  writeText(file, JSON.stringify(choice))
  return choice
}

export function saveAllowlist(files: ProcessFiles, text: string): Promise<{ text: string }> {
  return enqueue(async () => {
    writeText(files.allowlist, text)
    return { text }
  })
}

export function allowProcessName(files: ProcessFiles, name: string): Promise<{ text: string }> {
  return enqueue(async () => {
    const current = ensureAllowlist(files.allowlist)
    const next = appendAllowlist(current, name)
    if (next !== current) writeText(files.allowlist, next)
    return { text: next }
  })
}

export function dismissStoredProcess(files: ProcessFiles, path: string, fingerprint: string): Promise<ProcessCatalog> {
  return enqueue(async () => {
    const next = dismissProcess(readCatalog(files.catalog), path, fingerprint)
    writeCatalog(files.catalog, next)
    return next
  })
}

export function clearStoredProcesses(files: ProcessFiles): Promise<ProcessCatalog> {
  return enqueue(async () => {
    rmSync(files.catalog, { force: true })
    rmSync(`${files.catalog}.tmp`, { force: true })
    lastLive = []
    lastError = null
    scheduleBaselineRewrite()
    return emptyProcessCatalog()
  })
}

export function collectProcesses(files: ProcessFiles, stillAllowed: () => boolean): Promise<{ snapshot: ProcessSnapshot; alerts: ProcessAlert[] }> {
  return enqueue(() => runCollect(files, stillAllowed))
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = pending.then(work, work)
  pending = run.then(() => undefined, () => undefined)
  return run
}

async function runCollect(files: ProcessFiles, stillAllowed: () => boolean): Promise<{ snapshot: ProcessSnapshot; alerts: ProcessAlert[] }> {
  if (!stillAllowed()) return { snapshot: readProcessSnapshot(files), alerts: [] }
  let table = ''
  try {
    table = await readPs()
  } catch {
    lastError = 'The process table could not be read.'
    return { snapshot: readProcessSnapshot(files), alerts: [] }
  }
  const argsText = await readArgs()
  const observed = parsePsTable(table)
  const commands = parsePsArgs(argsText)
  const before = readCatalog(files.catalog)
  const signatures = new Map<string, ProcessSignature>()
  const checks: { path: string; stamp: FileStamp | null }[] = []
  for (const row of observed) {
    if (signatures.has(row.path) || checks.some((item) => item.path === row.path)) continue
    if (row.pid === 0) {
      signatures.set(row.path, platformSignature())
      continue
    }
    const stamp = readStamp(row.path)
    const existing = before.entries.find((entry) => entry.path === row.path)
    if (existing && stamp && sameStamp(existing.signature, stamp)) {
      signatures.set(row.path, existing.signature)
      continue
    }
    checks.push({ path: row.path, stamp })
  }
  const checked = await mapPool(checks, CODESIGN_LIMIT, async (item) => [item.path, await describePath(item.path, item.stamp)] as const)
  for (const [path, signature] of checked) signatures.set(path, signature)
  if (!stillAllowed()) return { snapshot: readProcessSnapshot(files), alerts: [] }
  const observedAt = new Date().toISOString()
  const folded = foldProcesses(before, observed, observedAt, signatures)
  const allowlistText = ensureAllowlist(files.allowlist)
  const { catalog, alerts } = applyAlerts(before, folded, [...signatures.keys()], parseAllowlist(allowlistText))
  if (!stillAllowed()) return { snapshot: readProcessSnapshot(files), alerts: [] }
  writeCatalog(files.catalog, catalog)
  scheduleBaselineRewrite()
  lastLive = observed.map((row) => ({
    ...row,
    command: commandFor(row.pid, row.path, commands),
  }))
  lastError = null
  return {
    snapshot: {
      allowed: true,
      catalog,
      live: lastLive,
      allowlistText,
      error: null,
    },
    alerts,
  }
}

function sameStamp(signature: ProcessSignature, stamp: FileStamp): boolean {
  return signature.status !== 'pending' && signature.size === stamp.size && signature.mtimeMs === stamp.mtimeMs
}

function commandFor(pid: number, path: string, commands: Map<number, string>): string {
  const command = commands.get(pid)?.trim()
  if (!command) return path
  if (command.length <= COMMAND_LIMIT) return command
  return `${command.slice(0, COMMAND_LIMIT)}...`
}

async function describePath(path: string, stamp: FileStamp | null): Promise<ProcessSignature> {
  if (!stamp) return emptySignature('unreadable')
  const [display, verify] = await Promise.all([
    runCodesign(['-d', '--verbose=4', '--', path]),
    runCodesign(['--verify', '--strict', '--', path]),
  ])
  if (display.missing || verify.missing) return emptySignature('unreadable')
  return signatureFromCodesign({
    text: display.text,
    verifyOk: verify.ok,
    size: stamp.size,
    mtimeMs: stamp.mtimeMs,
    readable: true,
  })
}

function readStamp(file: string): FileStamp | null {
  try {
    const info = statSync(file)
    if (!info.isFile()) return null
    return { size: info.size, mtimeMs: Math.round(info.mtimeMs) }
  } catch {
    return null
  }
}

async function readPs(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('/bin/ps', [
      '-axww',
      '-o', 'pid=',
      '-o', 'ppid=',
      '-o', 'user=',
      '-o', 'state=',
      '-o', '%cpu=',
      '-o', '%mem=',
      '-o', 'rss=',
      '-o', 'time=',
      '-o', 'comm=',
    ], { encoding: 'utf8', timeout: 8000, maxBuffer: 16 * 1024 * 1024 })
    return stdout
  } catch (error) {
    const failed = commandFailure(error)
    if (failed.stdout.trim()) return failed.stdout
    throw new Error('The process table could not be read.')
  }
}

async function readArgs(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('/bin/ps', ['-axww', '-o', 'pid=', '-o', 'args='], {
      encoding: 'utf8',
      timeout: 8000,
      maxBuffer: 16 * 1024 * 1024,
    })
    return stdout
  } catch (error) {
    return commandFailure(error).stdout
  }
}

async function runCodesign(args: string[]): Promise<{ text: string; ok: boolean; missing: boolean }> {
  try {
    const { stdout, stderr } = await execFileAsync('/usr/bin/codesign', args, {
      encoding: 'utf8',
      timeout: 8000,
      maxBuffer: 1024 * 1024,
    })
    return { text: `${stdout}\n${stderr}`, ok: true, missing: false }
  } catch (error) {
    const failed = commandFailure(error)
    if (failed.code === 'ENOENT') return { text: '', ok: false, missing: true }
    return { text: `${failed.stdout}\n${failed.stderr}`, ok: false, missing: false }
  }
}

function commandFailure(error: unknown): { code: string | number | null; stdout: string; stderr: string } {
  if (!error || typeof error !== 'object') return { code: null, stdout: '', stderr: '' }
  const record = error as { code?: unknown; stdout?: unknown; stderr?: unknown }
  const code = typeof record.code === 'string' || typeof record.code === 'number' ? record.code : null
  const stdout = typeof record.stdout === 'string' ? record.stdout : ''
  const stderr = typeof record.stderr === 'string' ? record.stderr : ''
  return { code, stdout, stderr }
}

async function mapPool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await work(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

function readCatalog(file: string): ProcessCatalog {
  try {
    return parseProcessCatalog(readFileSync(file, 'utf8'))
  } catch {
    return emptyProcessCatalog()
  }
}

function ensureAllowlist(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    const code = errorCode(error)
    if (code !== 'ENOENT') return ALLOWLIST_TEMPLATE
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, ALLOWLIST_TEMPLATE, { flag: 'wx' })
    } catch (writeError) {
      if (errorCode(writeError) === 'EEXIST') {
        try {
          return readFileSync(file, 'utf8')
        } catch {
          return ALLOWLIST_TEMPLATE
        }
      }
    }
    return ALLOWLIST_TEMPLATE
  }
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return ''
  return String(error.code)
}

function writeCatalog(file: string, catalog: ProcessCatalog): void {
  try {
    writeText(file, JSON.stringify(catalog))
  } catch {
    throw new Error('The process catalog could not be saved.')
  }
}

function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, text)
  renameSync(temp, file)
}
