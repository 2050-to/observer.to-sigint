import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { renderBaselineMarkdown } from '../shared/baseline.js'
import { parseConnectionCatalog } from '../shared/connectionCatalog.js'
import { parseProcessCatalog } from '../shared/processCatalog.js'

const BASELINE_INTERVAL_MS = 60_000

export interface BaselineFiles {
  processes: string
  connections: string
  baseline: string
}

let files: BaselineFiles | null = null
let writtenAt = 0
let timer: ReturnType<typeof setTimeout> | null = null

export function bindBaselineFiles(next: BaselineFiles): void {
  files = next
}

export function scheduleBaselineRewrite(): void {
  if (!files) return
  const now = Date.now()
  if (now - writtenAt >= BASELINE_INTERVAL_MS) {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    writeBaselineFile()
    writtenAt = Date.now()
    return
  }
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    writeBaselineFile()
    writtenAt = Date.now()
  }, BASELINE_INTERVAL_MS - (now - writtenAt))
}

export function discardBaselineFile(): void {
  if (timer) clearTimeout(timer)
  timer = null
  writtenAt = 0
  if (!files) return
  rmSync(files.baseline, { force: true })
  rmSync(`${files.baseline}.tmp`, { force: true })
}

function writeBaselineFile(): void {
  if (!files) return
  try {
    const processes = parseProcessCatalog(readText(files.processes))
    const connections = parseConnectionCatalog(readText(files.connections))
    const text = renderBaselineMarkdown(processes.entries, connections.entries)
    if (!text.includes('\n- ')) {
      rmSync(files.baseline, { force: true })
      rmSync(`${files.baseline}.tmp`, { force: true })
      return
    }
    mkdirSync(dirname(files.baseline), { recursive: true })
    const temp = `${files.baseline}.tmp`
    writeFileSync(temp, text)
    renameSync(temp, files.baseline)
  } catch {
    // The catalog remains the source of truth. A later update tries again.
  }
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}
