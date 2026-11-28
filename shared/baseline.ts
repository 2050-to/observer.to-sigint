import { meetsBaselineGate } from './sampleOrder.js'
import type { ConnectionEntry } from './connectionCatalog.js'
import { qualifiesProcess, sortProcessEntries, type ProcessEntry } from './processCatalog.js'

export function renderBaselineMarkdown(
  processes: readonly ProcessEntry[],
  connections: readonly ConnectionEntry[],
): string {
  const processRows = sortProcessEntries(processes.filter(qualifiesProcess))
    .sort((left, right) => right.samples - left.samples || left.path.localeCompare(right.path))
  const connectionRows = connections
    .filter((entry) => meetsBaselineGate(entry.samples, entry.firstSeen, entry.lastSeen))
    .sort((left, right) => right.samples - left.samples || connectionLine(left).localeCompare(connectionLine(right)))
  const lines = [
    '# Baseline',
    '',
    'Processes and connections seen often enough to treat as normal. Rare rows are omitted.',
    '',
    '## Processes',
    '',
  ]
  if (processRows.length === 0) lines.push('None yet.')
  else {
    for (const entry of processRows) {
      lines.push(`- ${entry.path}: ${entry.signature.status}, cdhash ${entry.signature.cdhash ?? 'none'}, user ${entry.user}, ${entry.samples} samples, first ${entry.firstSeen}, last ${entry.lastSeen}`)
    }
  }
  lines.push('', '## Connections', '')
  if (connectionRows.length === 0) lines.push('None yet.')
  else {
    for (const entry of connectionRows) lines.push(`- ${connectionLine(entry)}: ${entry.samples} samples`)
  }
  lines.push('')
  return lines.join('\n')
}

function connectionLine(entry: ConnectionEntry): string {
  return `${entry.process} ${entry.protocol.toUpperCase()} ${endpointText(entry)}`
}

function endpointText(entry: ConnectionEntry): string {
  const host = entry.destination.host.includes(':') && !entry.destination.host.startsWith('[')
    ? `[${entry.destination.host}]`
    : entry.destination.host
  return entry.destination.port == null ? host : `${host}:${entry.destination.port}`
}
