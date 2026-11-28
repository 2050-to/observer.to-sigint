export const ALLOWLIST_TEMPLATE = [
  '# Processes treated as expected',
  '# One process name per line. Blank lines and lines starting with # are ignored.',
  '# Example:',
  '# Cursor Helper',
  '',
].join('\n')

export function parseAllowlist(text: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(trimmed)
  }
  return names
}

export function isAllowlisted(names: readonly string[], processName: string): boolean {
  const key = processName.trim().toLowerCase()
  if (!key) return false
  return names.some((name) => name.toLowerCase() === key)
}

export function appendAllowlist(text: string, name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return text
  if (isAllowlisted(parseAllowlist(text), trimmed)) return text
  const base = text.length === 0 || text.endsWith('\n') ? text : `${text}\n`
  return `${base}${trimmed}\n`
}
