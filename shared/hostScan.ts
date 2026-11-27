export type CheckId =
  | 'launchAgents'
  | 'launchDaemons'
  | 'helpers'
  | 'loginItems'
  | 'cron'
  | 'kexts'
  | 'systemExtensions'
  | 'sip'
  | 'gatekeeper'
  | 'filevault'
  | 'firewall'
  | 'xprotect'

export type CheckStatus = 'clear' | 'review' | 'unavailable'

export interface LaunchFields {
  label: string
  program: string
  programArguments: string[]
  environment: Record<string, string>
  plistPath: string
  unreadable?: boolean
}

export interface Finding {
  id: string
  check: CheckId
  severity: 'review' | 'suspicious'
  path: string
  reason: string
}

export interface CheckResult {
  id: CheckId
  label: string
  status: CheckStatus
  detail: string
  findings: Finding[]
}

export interface HostScanReport {
  scannedAt: string
  hostname: string
  checks: CheckResult[]
}

export interface HostScanInput {
  hostname: string
  scannedAt: string
  agents: LaunchFields[] | null
  daemons: LaunchFields[] | null
  helpers: LaunchFields[] | null
  loginText: string | null
  cronText: string | null
  kextText: string | null
  systemExtensionText: string | null
  sipText: string | null
  gatekeeperText: string | null
  filevaultText: string | null
  firewallText: string | null
  xprotectFound: boolean | null
}

const KNOWN_BAD_LABELS = [
  'com.apple.questd',
  'com.apple.icloud.sync.daemon',
  'com.apple.safari.proxy',
  'init_verx',
  'com.pcv.hlpramc',
]

const KNOWN_BAD_PREFIXES = [
  'com.mackeeper.',
  'com.zeobit.mackeeper',
  'com.bundlore.',
  'com.genieo.',
  'com.genieoinnovation.',
  'com.pirrit.',
  'com.adload.',
]

const APPLE_PREFIXES = ['/System/', '/usr/libexec/', '/usr/bin/', '/usr/sbin/', '/bin/', '/sbin/']

const UNREADABLE = 'This check could not be read.'

export function launchFieldsFromPlist(plistPath: string, jsonText: string): LaunchFields {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return unreadableLaunch(plistPath)
  }
  if (!parsed || typeof parsed !== 'object') return unreadableLaunch(plistPath)
  const record = parsed as Record<string, unknown>
  const label = typeof record.Label === 'string' ? record.Label : ''
  const program = typeof record.Program === 'string' ? record.Program : ''
  const programArguments = Array.isArray(record.ProgramArguments)
    ? record.ProgramArguments.filter((item): item is string => typeof item === 'string')
    : []
  const environment: Record<string, string> = {}
  if (record.EnvironmentVariables && typeof record.EnvironmentVariables === 'object') {
    for (const [key, value] of Object.entries(record.EnvironmentVariables as Record<string, unknown>)) {
      if (typeof value === 'string') environment[key] = value
    }
  }
  return {
    label,
    program: program || programArguments[0] || '',
    programArguments,
    environment,
    plistPath,
  }
}

export function classifyHostScan(input: HostScanInput): HostScanReport {
  return {
    scannedAt: input.scannedAt,
    hostname: input.hostname,
    checks: [
      launchCheck('launchAgents', 'Launch agents', input.agents, 'No third-party launch agents were found.'),
      launchCheck('launchDaemons', 'Launch daemons', input.daemons, 'No third-party launch daemons were found.'),
      launchCheck('helpers', 'Privileged helpers', input.helpers, 'No privileged helpers were found.'),
      loginCheck(input.loginText),
      cronCheck(input.cronText),
      extensionCheck('kexts', 'Kernel extensions', input.kextText, 'No third-party kernel extensions are loaded.'),
      extensionCheck('systemExtensions', 'System extensions', input.systemExtensionText, 'No third-party system extensions are loaded.'),
      settingCheck('sip', 'System Integrity Protection', input.sipText, sipState, 'System Integrity Protection is on.', 'System Integrity Protection is turned off.'),
      settingCheck('gatekeeper', 'Gatekeeper', input.gatekeeperText, gatekeeperState, 'Gatekeeper is on.', 'Gatekeeper is turned off.'),
      settingCheck('filevault', 'FileVault', input.filevaultText, filevaultState, 'FileVault is on.', 'FileVault is turned off.'),
      settingCheck('firewall', 'Application firewall', input.firewallText, firewallState, 'The application firewall is on.', 'The application firewall is turned off.'),
      xprotectCheck(input.xprotectFound),
    ],
  }
}

function unreadableLaunch(plistPath: string): LaunchFields {
  return { label: '', program: '', programArguments: [], environment: {}, plistPath, unreadable: true }
}

function launchCheck(id: CheckId, label: string, items: LaunchFields[] | null, clearDetail: string): CheckResult {
  if (items === null) return unread(id, label)
  return finish(id, label, items.flatMap((item) => {
    const finding = classifyLaunch(id, item)
    return finding ? [finding] : []
  }), clearDetail)
}

function classifyLaunch(check: CheckId, item: LaunchFields): Finding | null {
  if (item.unreadable) return makeFinding(check, 'review', item.plistPath, 'This startup file could not be read.')
  const reasons: string[] = []
  if (knownBadLabel(item.label)) reasons.push('Startup label matches known macOS malware persistence.')
  if (hasDyld(item)) reasons.push('Startup item sets DYLD_INSERT_LIBRARIES.')
  if (riskyLaunch(item)) reasons.push('Startup program is in a temporary directory or Downloads.')
  const path = item.plistPath || item.program || item.label
  if (reasons.length > 0) return makeFinding(check, 'suspicious', path, reasons.join(' '))
  if (isAppleOnly(item)) return null
  return makeFinding(check, 'review', path, 'Third-party startup item on this Mac.')
}

function isAppleOnly(item: LaunchFields): boolean {
  if (!isAppleSystemPath(item.program)) return false
  return !item.programArguments.some((argument) => isUserPath(argument))
}

function isUserPath(value: string): boolean {
  const path = value.trim().replace(/^['"]+|['";]+$/g, '')
  if (path.includes('://')) return false
  if (!path.startsWith('/') && !path.startsWith('~')) return false
  return !isAppleSystemPath(path)
}

function loginCheck(text: string | null): CheckResult {
  if (text === null) return unread('loginItems', 'Login items')
  const findings = parseLoginItems(text).map((item) => {
    const reasons: string[] = []
    if (knownBadLabel(item.name)) reasons.push('Login item matches known macOS malware persistence.')
    if (isRiskyPath(item.path)) reasons.push('Login item is in a temporary directory or Downloads.')
    const path = item.path || item.name
    if (reasons.length > 0) return makeFinding('loginItems', 'suspicious', path, reasons.join(' '))
    return makeFinding('loginItems', 'review', path, 'Login item on this Mac.')
  })
  return finish('loginItems', 'Login items', findings, 'No login items were found.')
}

function cronCheck(text: string | null): CheckResult {
  if (text === null) return unread('cron', 'Crontab')
  const findings = parseCronEntries(text).map((entry) => {
    const reasons: string[] = []
    if (entry.includes('DYLD_INSERT_LIBRARIES')) reasons.push('Crontab entry sets DYLD_INSERT_LIBRARIES.')
    if (tokens(entry).some((token) => isRiskyPath(token) && looksLikeProgram(token))) reasons.push('Crontab entry runs from a temporary directory or Downloads.')
    if (tokens(entry).some((token) => knownBadLabel(token))) reasons.push('Crontab entry matches known macOS malware persistence.')
    if (reasons.length > 0) return makeFinding('cron', 'suspicious', entry, reasons.join(' '))
    return makeFinding('cron', 'review', entry, 'User crontab entry on this Mac.')
  })
  return finish('cron', 'Crontab', findings, 'No user crontab entries were found.')
}

function extensionCheck(id: CheckId, label: string, text: string | null, clearDetail: string): CheckResult {
  if (text === null) return unread(id, label)
  const findings = bundleNames(text)
    .filter((name) => !signedByApple(name))
    .map((name) => makeFinding(id, 'suspicious', name, 'Loaded extension is not signed by Apple.'))
  return finish(id, label, findings, clearDetail)
}

function settingCheck(
  id: CheckId,
  label: string,
  text: string | null,
  read: (text: string) => 'on' | 'off' | null,
  onDetail: string,
  offReason: string,
): CheckResult {
  if (text === null) return unread(id, label)
  const state = read(text)
  if (state === null) return unread(id, label, 'This check did not return a known status.')
  if (state === 'on') return { id, label, status: 'clear', detail: onDetail, findings: [] }
  return finish(id, label, [makeFinding(id, 'review', label, offReason)], onDetail, offReason)
}

function xprotectCheck(found: boolean | null): CheckResult {
  if (found === null) return unread('xprotect', 'XProtect')
  if (found) return { id: 'xprotect', label: 'XProtect', status: 'clear', detail: 'XProtect is present.', findings: [] }
  return finish('xprotect', 'XProtect', [makeFinding('xprotect', 'review', 'XProtect', 'XProtect was not found on this Mac.')], 'XProtect is present.', 'XProtect was not found on this Mac.')
}

function finish(id: CheckId, label: string, findings: Finding[], clearDetail: string, detail?: string): CheckResult {
  const ordered = [...findings].sort((left, right) => {
    if (left.severity === right.severity) return 0
    return left.severity === 'suspicious' ? -1 : 1
  })
  if (ordered.length === 0) return { id, label, status: 'clear', detail: clearDetail, findings: [] }
  const suspicious = ordered.filter((item) => item.severity === 'suspicious').length
  const review = ordered.length - suspicious
  const parts: string[] = []
  if (suspicious > 0) parts.push(`${suspicious} suspicious`)
  if (review > 0) parts.push(`${review} to review`)
  return { id, label, status: 'review', detail: detail ?? `${parts.join(', ')}.`, findings: ordered }
}

function unread(id: CheckId, label: string, detail = UNREADABLE): CheckResult {
  return { id, label, status: 'unavailable', detail, findings: [] }
}

function makeFinding(check: CheckId, severity: Finding['severity'], path: string, reason: string): Finding {
  return { id: `${check}:${severity}:${path}:${reason}`, check, severity, path, reason }
}

function knownBadLabel(label: string): boolean {
  const value = label.trim().toLowerCase()
  if (!value) return false
  if (KNOWN_BAD_LABELS.includes(value)) return true
  return KNOWN_BAD_PREFIXES.some((prefix) => value.startsWith(prefix))
}

function hasDyld(item: LaunchFields): boolean {
  if (Object.keys(item.environment).some((key) => key === 'DYLD_INSERT_LIBRARIES')) return true
  return [item.program, ...item.programArguments].join('\n').includes('DYLD_INSERT_LIBRARIES')
}

const PROGRAM_EXTENSIONS = new Set(['sh', 'bash', 'command', 'py', 'pyc', 'pl', 'rb', 'js', 'dylib', 'so', 'app', 'exe', 'bin', 'scpt', 'kext'])

function riskyLaunch(item: LaunchFields): boolean {
  if (isRiskyPath(item.program)) return true
  return item.programArguments.some((argument) => isRiskyPath(argument) && looksLikeProgram(argument))
}

function looksLikeProgram(path: string): boolean {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return true
  return PROGRAM_EXTENSIONS.has(base.slice(dot + 1).toLowerCase())
}

function isRiskyPath(value: string): boolean {
  const path = value.trim().replace(/^['"]+|['";]+$/g, '')
  if (!path || path.includes('://')) return false
  const lower = path.toLowerCase()
  if (lower === '/tmp' || lower.startsWith('/tmp/')) return true
  if (lower === '/var/tmp' || lower.startsWith('/var/tmp/')) return true
  if (lower === '/private/tmp' || lower.startsWith('/private/tmp/')) return true
  if (lower === '/private/var/tmp' || lower.startsWith('/private/var/tmp/')) return true
  return /(?:^|\/)downloads(?:\/|$)/i.test(path)
}

function isAppleSystemPath(program: string): boolean {
  return APPLE_PREFIXES.some((prefix) => program.startsWith(prefix))
}

function parseLoginItems(text: string): { name: string; path: string }[] {
  const items: { name: string; path: string }[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const tab = trimmed.indexOf('\t')
    if (tab === -1) items.push({ name: trimmed, path: '' })
    else items.push({ name: trimmed.slice(0, tab).trim(), path: trimmed.slice(tab + 1).trim() })
  }
  return items
}

function parseCronEntries(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => {
    if (!line || line.startsWith('#')) return false
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(line) && !line.includes(' ')) return false
    return true
  })
}

function tokens(line: string): string[] {
  return line.split(/\s+/).map((token) => token.replace(/^['"]+|['";]+$/g, '')).filter(Boolean)
}

function bundleNames(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/\b(com\.[A-Za-z0-9._-]+)\b/g)) {
    const name = match[1]
    if (name.startsWith('com.apple.system_extension.')) continue
    found.add(name)
  }
  return [...found]
}

function signedByApple(name: string): boolean {
  return name.startsWith('com.apple.')
}

function sipState(text: string): 'on' | 'off' | null {
  if (/status:\s*disabled/i.test(text)) return 'off'
  if (/status:\s*enabled/i.test(text)) return 'on'
  return null
}

function gatekeeperState(text: string): 'on' | 'off' | null {
  if (/assessments disabled/i.test(text)) return 'off'
  if (/assessments enabled/i.test(text)) return 'on'
  return null
}

function filevaultState(text: string): 'on' | 'off' | null {
  if (/filevault is off/i.test(text)) return 'off'
  if (/filevault is on/i.test(text)) return 'on'
  return null
}

function firewallState(text: string): 'on' | 'off' | null {
  if (/firewall is disabled/i.test(text) || /state\s*=\s*0\b/i.test(text)) return 'off'
  if (/firewall is enabled/i.test(text) || /state\s*=\s*1\b/i.test(text)) return 'on'
  return null
}
