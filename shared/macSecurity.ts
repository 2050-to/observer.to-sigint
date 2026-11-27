export type SecurityId =
  | 'firewall'
  | 'stealth'
  | 'gatekeeper'
  | 'screenLock'
  | 'idleLock'
  | 'guest'
  | 'remoteLogin'
  | 'remoteEvents'
  | 'wakeOnLan'
  | 'guestSharing'
  | 'automaticLogin'
  | 'securityUpdates'
  | 'airdrop'
  | 'filevault'
  | 'sip'

export type SecurityPrivilege = 'user' | 'admin' | 'none'

export interface SecurityCheck {
  id: SecurityId
  title: string
  detail: string
  secureSentence: string
  privilege: SecurityPrivilege
  target: number
}

export interface SecurityReading {
  id: SecurityId
  secure: boolean | null
  value: string
  strictness: number | null
}

export interface SecurityReport {
  improved: SecurityReading[]
  alreadySecure: SecurityReading[]
  stillOpen: SecurityReading[]
}

export interface MacSecurityApplyResult {
  readings: SecurityReading[]
  report: SecurityReport
  adminNote: string | null
}

export interface DefaultsRead {
  state: 'value' | 'missing' | 'unreadable'
  text: string
}

export interface UpdateReads {
  automaticCheck: DefaultsRead
  automaticDownload: DefaultsRead
  criticalUpdate: DefaultsRead
  configData: DefaultsRead
  autoUpdate: DefaultsRead
  schedule: string | null
}

export const IDLE_LOCK_SECONDS = 300

export function idleStrictness(seconds: number): number {
  if (seconds <= 0) return 0
  return 1_000_000 - seconds
}

export const SECURITY_CHECKS: SecurityCheck[] = [
  {
    id: 'firewall',
    title: 'Application firewall',
    detail: 'The firewall is on. Signed apps stay allowed.',
    secureSentence: 'The application firewall is on.',
    privilege: 'admin',
    target: 1,
  },
  {
    id: 'stealth',
    title: 'Firewall stealth mode',
    detail: 'This Mac does not answer probes that are looking for open ports.',
    secureSentence: 'Firewall stealth mode is on.',
    privilege: 'admin',
    target: 1,
  },
  {
    id: 'gatekeeper',
    title: 'Gatekeeper',
    detail: 'Gatekeeper allows identified developers and stays on.',
    secureSentence: 'Gatekeeper is on.',
    privilege: 'admin',
    target: 1,
  },
  {
    id: 'screenLock',
    title: 'Password after sleep',
    detail: 'A password is required as soon as the screen saver starts or the Mac wakes.',
    secureSentence: 'A password is required immediately after sleep or the screen saver.',
    privilege: 'admin',
    target: 2,
  },
  {
    id: 'idleLock',
    title: 'Lock after idle',
    detail: 'The screen locks after 5 minutes of idle, or sooner if it already does.',
    secureSentence: 'The screen locks after 5 minutes of idle, or sooner.',
    privilege: 'admin',
    target: idleStrictness(IDLE_LOCK_SECONDS),
  },
  {
    id: 'guest',
    title: 'Guest account',
    detail: 'The guest account is off.',
    secureSentence: 'The guest account is off.',
    privilege: 'admin',
    target: 1,
  },
  {
    id: 'remoteLogin',
    title: 'Remote Login',
    detail: 'Remote Login is off.',
    secureSentence: 'Remote Login is off.',
    privilege: 'admin',
    target: 1,
  },
  {
    id: 'remoteEvents',
    title: 'Remote Apple Events',
    detail: 'Remote Apple Events are off.',
    secureSentence: 'Remote Apple Events are off.',
    privilege: 'admin',
    target: 1,
  },
  {
    id: 'wakeOnLan',
    title: 'Wake for network access',
    detail: 'This Mac does not wake for network access.',
    secureSentence: 'Wake for network access is off.',
    privilege: 'admin',
    target: 1,
  },
  {
    id: 'guestSharing',
    title: 'Guest file sharing',
    detail: 'Guest access to shared folders is off.',
    secureSentence: 'Guest file sharing is off.',
    privilege: 'admin',
    target: 1,
  },
  {
    id: 'automaticLogin',
    title: 'Automatic login',
    detail: 'Automatic login is off.',
    secureSentence: 'Automatic login is off.',
    privilege: 'admin',
    target: 1,
  },
  {
    id: 'securityUpdates',
    title: 'Security updates',
    detail: 'Security and configuration updates download and install automatically. Major macOS upgrades stay manual.',
    secureSentence: 'Security and configuration updates install automatically.',
    privilege: 'admin',
    target: 1,
  },
  {
    id: 'airdrop',
    title: 'AirDrop',
    detail: 'AirDrop is limited to Contacts Only, or it is off.',
    secureSentence: 'AirDrop is limited to Contacts Only, or it is off.',
    privilege: 'user',
    target: 1,
  },
  {
    id: 'filevault',
    title: 'FileVault',
    detail: 'FileVault status is shown here. This button does not turn it on or off.',
    secureSentence: 'FileVault is on.',
    privilege: 'none',
    target: 1,
  },
  {
    id: 'sip',
    title: 'System Integrity Protection',
    detail: 'System Integrity Protection status is shown here. This button does not change it.',
    secureSentence: 'System Integrity Protection is on.',
    privilege: 'none',
    target: 1,
  },
]

const CHECK_IDS = new Set<string>(SECURITY_CHECKS.map((check) => check.id))

export function checkFor(id: SecurityId): SecurityCheck {
  const check = SECURITY_CHECKS.find((item) => item.id === id)
  if (!check) throw new Error(`Unknown security check: ${id}`)
  return check
}

export function unreadableReading(id: SecurityId): SecurityReading {
  return { id, secure: null, strictness: null, value: 'Could not read' }
}

export function shouldAttempt(reading: SecurityReading): boolean {
  const check = checkFor(reading.id)
  if (check.privilege === 'none') return false
  if (reading.strictness == null) return reading.id !== 'airdrop' && reading.id !== 'idleLock'
  return reading.strictness < check.target
}

export function pendingAttempts(readings: SecurityReading[]): { user: SecurityId[]; admin: SecurityId[] } {
  const byId = new Map(readings.map((row) => [row.id, row]))
  const chosen = SECURITY_CHECKS.filter((check) => {
    const reading = byId.get(check.id)
    return reading != null && shouldAttempt(reading)
  })
  return {
    user: chosen.filter((check) => check.privilege === 'user').map((check) => check.id),
    admin: chosen.filter((check) => check.privilege === 'admin').map((check) => check.id),
  }
}

export function userDefaultWrites(readings: SecurityReading[], idle: DefaultsRead): Array<'screenLock' | 'idleLock' | 'airdrop'> {
  const byId = new Map(readings.map((row) => [row.id, row]))
  const writes: Array<'screenLock' | 'idleLock' | 'airdrop'> = []
  const screen = byId.get('screenLock')
  if (screen && shouldAttempt(screen)) writes.push('screenLock')
  const idleRow = byId.get('idleLock')
  if (idleRow && shouldAttempt(idleRow) && shouldSetIdleDefault(idle)) writes.push('idleLock')
  const drop = byId.get('airdrop')
  if (drop && shouldAttempt(drop)) writes.push('airdrop')
  return writes
}

export function securityReport(before: SecurityReading[], after: SecurityReading[]): SecurityReport {
  const beforeById = new Map(before.map((row) => [row.id, row]))
  const afterById = new Map(after.map((row) => [row.id, row]))
  const improved: SecurityReading[] = []
  const alreadySecure: SecurityReading[] = []
  const stillOpen: SecurityReading[] = []
  for (const check of SECURITY_CHECKS) {
    const next = afterById.get(check.id) ?? unreadableReading(check.id)
    const prev = beforeById.get(check.id)
    if (next.secure == null) stillOpen.push(next)
    else if (next.secure && prev?.secure === false) improved.push(next)
    else if (next.secure) alreadySecure.push(next)
    else stillOpen.push(next)
  }
  return { improved, alreadySecure, stillOpen }
}

export function displaySleepSeconds(power: string | null): number | null {
  if (power == null) return null
  const current = power.split(/currently in use:/i)[1] ?? power
  const match = /displaysleep\s+(\d+)/i.exec(current)
  if (!match) return null
  return Number(match[1]) * 60
}

export function shouldSetDisplaySleep(power: string | null): boolean {
  const seconds = displaySleepSeconds(power)
  if (seconds == null) return false
  return seconds <= 0 || seconds > IDLE_LOCK_SECONDS
}

export function shouldSetIdleDefault(read: DefaultsRead): boolean {
  if (read.state === 'unreadable') return false
  if (read.state === 'missing') return true
  const seconds = Number(read.text.trim())
  if (!Number.isFinite(seconds)) return false
  return seconds <= 0 || seconds > IDLE_LOCK_SECONDS
}

export function firewallReading(text: string | null): SecurityReading {
  return onOffReading('firewall', text, /firewall is disabled|state = 0/i, /firewall is enabled|state = 1/i)
}

export function stealthReading(text: string | null): SecurityReading {
  return onOffReading('stealth', text, /stealth mode is off|stealth mode disabled/i, /stealth mode is on|stealth mode enabled/i)
}

export function gatekeeperReading(text: string | null): SecurityReading {
  return onOffReading('gatekeeper', text, /assessments disabled/i, /assessments enabled/i)
}

export function screenLockReading(status: string | null, ask: DefaultsRead, delay: DefaultsRead): SecurityReading {
  const parsed = parseScreenLockStatus(status)
  if (parsed) return parsed
  return screenLockFromDefaults(ask, delay)
}

export function idleReading(idle: DefaultsRead, power: string | null): SecurityReading {
  const fromPower = displaySleepSeconds(power)
  if (fromPower != null) return idleFromSeconds(fromPower)
  if (idle.state === 'unreadable') return unreadableReading('idleLock')
  if (idle.state === 'missing') return made('idleLock', false, 'Not set', 0)
  const seconds = Number(idle.text.trim())
  if (!Number.isFinite(seconds)) return unreadableReading('idleLock')
  return idleFromSeconds(seconds)
}

export function guestReading(text: string | null): SecurityReading {
  if (text == null) return unreadableReading('guest')
  if (/guest account disabled/i.test(text) || text.trim() === '0') return made('guest', true, 'Off', 1)
  if (/guest account enabled/i.test(text) || text.trim() === '1') return made('guest', false, 'On', 0)
  return unreadableReading('guest')
}

export function remoteReading(id: 'remoteLogin' | 'remoteEvents', text: string | null): SecurityReading {
  if (text == null || /administrator access/i.test(text)) return unreadableReading(id)
  const label = id === 'remoteLogin' ? 'Remote Login' : 'Remote Apple Events'
  if (new RegExp(`${label}:\\s*Off`, 'i').test(text)) return made(id, true, 'Off', 1)
  if (new RegExp(`${label}:\\s*On`, 'i').test(text)) return made(id, false, 'On', 0)
  return unreadableReading(id)
}

export function wakeReading(text: string | null): SecurityReading {
  if (text == null) return unreadableReading('wakeOnLan')
  const current = text.split(/currently in use:/i)[1] ?? text
  const match = /womp\s+([01])/.exec(current)
  if (!match) return unreadableReading('wakeOnLan')
  if (match[1] === '0') return made('wakeOnLan', true, 'Off', 1)
  return made('wakeOnLan', false, 'On', 0)
}

export function guestSharingReading(read: DefaultsRead): SecurityReading {
  if (read.state === 'unreadable') return unreadableReading('guestSharing')
  if (read.state === 'missing') return made('guestSharing', false, 'Not set', 0)
  const text = read.text.trim().toLowerCase()
  if (text === '0' || text === 'false') return made('guestSharing', true, 'Off', 1)
  if (text === '1' || text === 'true') return made('guestSharing', false, 'On', 0)
  return unreadableReading('guestSharing')
}

export function automaticLoginReading(read: DefaultsRead): SecurityReading {
  if (read.state === 'unreadable') return unreadableReading('automaticLogin')
  if (read.state === 'missing' || read.text.trim() === '') return made('automaticLogin', true, 'Off', 1)
  return made('automaticLogin', false, 'On', 0)
}

export function updatesReading(reads: UpdateReads): SecurityReading {
  const flags = [
    reads.automaticCheck,
    reads.automaticDownload,
    reads.criticalUpdate,
    reads.configData,
    reads.autoUpdate,
  ].map(enabledFlag)
  const schedule = scheduleState(reads.schedule)
  const parts = [...flags, schedule]
  if (parts.some((part) => part === 'off')) return made('securityUpdates', false, 'Off', 0)
  if (parts.every((part) => part === 'on')) return made('securityUpdates', true, 'On', 1)
  return unreadableReading('securityUpdates')
}

export function airdropReading(read: DefaultsRead): SecurityReading {
  if (read.state !== 'value') return unreadableReading('airdrop')
  const text = read.text.trim().toLowerCase()
  if (text === 'everyone') return made('airdrop', false, 'Everyone', 0)
  if (text === 'contacts only' || text === 'contactsonly') return made('airdrop', true, 'Contacts Only', 1)
  if (text === 'off') return made('airdrop', true, 'Off', 2)
  return unreadableReading('airdrop')
}

export function fileVaultReading(text: string | null): SecurityReading {
  if (text == null) return unreadableReading('filevault')
  if (/FileVault is Off/i.test(text)) return made('filevault', false, 'Off', 0)
  if (/FileVault is On/i.test(text) || /Encryption in progress/i.test(text)) return made('filevault', true, 'On', 1)
  return unreadableReading('filevault')
}

export function sipReading(text: string | null): SecurityReading {
  if (text == null) return unreadableReading('sip')
  if (/status:\s*disabled/i.test(text)) return made('sip', false, 'Off', 0)
  if (/status:\s*enabled/i.test(text)) return made('sip', true, 'On', 1)
  return unreadableReading('sip')
}

export function readingFromText(id: SecurityId, text: string): SecurityReading {
  switch (id) {
    case 'firewall':
      return firewallReading(text)
    case 'stealth':
      return stealthReading(text)
    case 'gatekeeper':
      return gatekeeperReading(text)
    case 'remoteLogin':
      return remoteReading('remoteLogin', text)
    case 'remoteEvents':
      return remoteReading('remoteEvents', text)
    case 'wakeOnLan':
      return wakeReading(text)
    case 'guest':
      return guestReading(text)
    case 'filevault':
      return fileVaultReading(text)
    case 'sip':
      return sipReading(text)
    default:
      return unreadableReading(id)
  }
}

export function applyMarked(readings: SecurityReading[], output: string, phase: 'BEFORE' | 'AFTER'): SecurityReading[] {
  const marks = markedText(output, phase)
  return readings.map((reading) => {
    if (reading.secure != null) return reading
    const text = marks[reading.id]
    if (!text) return reading
    return readingFromText(reading.id, text)
  })
}

function markedText(output: string, phase: 'BEFORE' | 'AFTER'): Partial<Record<SecurityId, string>> {
  const found: Partial<Record<SecurityId, string>> = {}
  const pattern = new RegExp(`OBSERVER_${phase} ([A-Za-z]+)\\n([\\s\\S]*?)OBSERVER_${phase}_END`, 'g')
  for (const match of output.matchAll(pattern)) {
    const id = match[1] ?? ''
    if (!isSecurityId(id)) continue
    const body = match[2] ?? ''
    if (/administrator access/i.test(body) || !body.trim()) continue
    found[id] = body
  }
  return found
}

function isSecurityId(value: string): value is SecurityId {
  return CHECK_IDS.has(value)
}

function onOffReading(id: SecurityId, text: string | null, off: RegExp, on: RegExp): SecurityReading {
  if (text == null) return unreadableReading(id)
  if (off.test(text)) return made(id, false, 'Off', 0)
  if (on.test(text)) return made(id, true, 'On', 1)
  return unreadableReading(id)
}

function parseScreenLockStatus(status: string | null): SecurityReading | null {
  if (status == null) return null
  if (/screenLock delay is immediate/i.test(status) || /screenLock delay is 0 seconds/i.test(status)) {
    return made('screenLock', true, 'Immediate', 2)
  }
  const match = /screenLock delay is (\d+) seconds/i.exec(status)
  if (match) {
    const seconds = Number(match[1])
    if (seconds <= 0) return made('screenLock', true, 'Immediate', 2)
    return made('screenLock', false, 'After a delay', 1)
  }
  if (/screenLock delay is off/i.test(status)) return made('screenLock', false, 'Not required', 0)
  return null
}

function screenLockFromDefaults(ask: DefaultsRead, delay: DefaultsRead): SecurityReading {
  if (ask.state === 'unreadable' || delay.state === 'unreadable') return unreadableReading('screenLock')
  const askOn = ask.state === 'value' && /^(1|true)$/i.test(ask.text.trim())
  if (!askOn) return made('screenLock', false, 'Not required', 0)
  if (delay.state === 'missing') return made('screenLock', true, 'Immediate', 2)
  const seconds = Number(delay.text.trim())
  if (!Number.isFinite(seconds)) return unreadableReading('screenLock')
  if (seconds <= 0) return made('screenLock', true, 'Immediate', 2)
  return made('screenLock', false, 'After a delay', 1)
}

function idleFromSeconds(seconds: number): SecurityReading {
  if (seconds <= 0) return made('idleLock', false, 'Never', 0)
  const strictness = idleStrictness(seconds)
  const secure = strictness >= idleStrictness(IDLE_LOCK_SECONDS)
  return made('idleLock', secure, idleLabel(seconds), strictness)
}

function idleLabel(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60
    return minutes === 1 ? '1 minute' : `${minutes} minutes`
  }
  return seconds === 1 ? '1 second' : `${seconds} seconds`
}

function enabledFlag(read: DefaultsRead): 'on' | 'off' | 'unreadable' {
  if (read.state === 'unreadable') return 'unreadable'
  if (read.state === 'missing') return 'off'
  const text = read.text.trim().toLowerCase()
  if (text === '1' || text === 'true' || text === 'yes') return 'on'
  if (text === '0' || text === 'false' || text === 'no') return 'off'
  return 'unreadable'
}

function scheduleState(text: string | null): 'on' | 'off' | 'unreadable' {
  if (text == null) return 'unreadable'
  if (/turned off|check is off|checking for updates is turned off/i.test(text)) return 'off'
  if (/turned on|check is on|checking for updates is turned on/i.test(text)) return 'on'
  return 'unreadable'
}

function made(id: SecurityId, secure: boolean, value: string, strictness: number): SecurityReading {
  return { id, secure, value, strictness }
}
