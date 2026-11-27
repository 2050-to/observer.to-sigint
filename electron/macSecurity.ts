import { execFile } from 'node:child_process'
import {
  applyMarked,
  automaticLoginReading,
  airdropReading,
  fileVaultReading,
  firewallReading,
  gatekeeperReading,
  guestReading,
  guestSharingReading,
  idleReading,
  pendingAttempts,
  remoteReading,
  screenLockReading,
  securityReport,
  shouldSetDisplaySleep,
  sipReading,
  stealthReading,
  updatesReading,
  userDefaultWrites,
  wakeReading,
  type DefaultsRead,
  type MacSecurityApplyResult,
  type SecurityId,
  type SecurityReading,
} from '../shared/macSecurity.js'

interface CommandResult {
  ok: boolean
  stdout: string
  stderr: string
  message: string
}

interface Collected {
  readings: SecurityReading[]
  idle: DefaultsRead
  power: string | null
}

export async function readMacSecurity(): Promise<SecurityReading[]> {
  return (await collect()).readings
}

export async function applyMacSecurity(): Promise<MacSecurityApplyResult> {
  const before = await collect()
  const writes = userDefaultWrites(before.readings, before.idle)
  await applyUserDefaults(writes)
  const adminIds = pendingAttempts(before.readings).admin.filter((id) => id !== 'idleLock' || shouldSetDisplaySleep(before.power))
  let adminNote: string | null = null
  let adminOutput = ''
  if (adminIds.length > 0) {
    const result = await runAdmin(adminIds, before.power)
    adminOutput = `${result.stdout}\n${result.stderr}`
    adminNote = adminFailure(result)
  }
  let beforeReadings = before.readings
  let after = await collect()
  if (adminOutput && !adminNote) {
    beforeReadings = applyMarked(beforeReadings, adminOutput, 'BEFORE')
    after = { ...after, readings: applyMarked(after.readings, adminOutput, 'AFTER') }
  }
  return {
    readings: after.readings,
    report: securityReport(beforeReadings, after.readings),
    adminNote,
  }
}

async function collect(): Promise<Collected> {
  const [
    firewall,
    stealth,
    gatekeeper,
    askForPassword,
    askForPasswordDelay,
    screenStatus,
    idle,
    guest,
    remoteLogin,
    remoteEvents,
    powerResult,
    automaticCheck,
    automaticDownload,
    criticalUpdate,
    configData,
    autoUpdate,
    schedule,
    autoLogin,
    airdrop,
    guestSharing,
    filevault,
    sip,
  ] = await Promise.all([
    readText('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getglobalstate']),
    readText('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getstealthmode']),
    readText('/usr/sbin/spctl', ['--status']),
    readDefault('com.apple.screensaver', 'askForPassword'),
    readDefault('com.apple.screensaver', 'askForPasswordDelay'),
    readScreenLock(),
    readIdle(),
    readGuest(),
    readRemote('getremotelogin'),
    readRemote('getremoteappleevents'),
    run('/usr/bin/pmset', ['-g']),
    readDefault('/Library/Preferences/com.apple.SoftwareUpdate', 'AutomaticCheckEnabled'),
    readDefault('/Library/Preferences/com.apple.SoftwareUpdate', 'AutomaticDownload'),
    readDefault('/Library/Preferences/com.apple.SoftwareUpdate', 'CriticalUpdateInstall'),
    readDefault('/Library/Preferences/com.apple.SoftwareUpdate', 'ConfigDataInstall'),
    readDefault('/Library/Preferences/com.apple.commerce', 'AutoUpdate'),
    readText('/usr/sbin/softwareupdate', ['--schedule']),
    readDefault('/Library/Preferences/com.apple.loginwindow', 'autoLoginUser'),
    readDefault('com.apple.sharingd', 'DiscoverableMode'),
    readDefault('/Library/Preferences/SystemConfiguration/com.apple.smb.server', 'AllowGuestAccess'),
    readText('/usr/bin/fdesetup', ['status']),
    readText('/usr/bin/csrutil', ['status']),
  ])
  const power = commandText(powerResult)
  const readings: SecurityReading[] = [
    firewallReading(firewall),
    stealthReading(stealth),
    gatekeeperReading(gatekeeper),
    screenLockReading(screenStatus, askForPassword, askForPasswordDelay),
    idleReading(idle, power),
    guestReading(guest),
    remoteReading('remoteLogin', remoteLogin),
    remoteReading('remoteEvents', remoteEvents),
    wakeReading(power),
    guestSharingReading(guestSharing),
    automaticLoginReading(autoLogin),
    updatesReading({
      automaticCheck,
      automaticDownload,
      criticalUpdate,
      configData,
      autoUpdate,
      schedule,
    }),
    airdropReading(airdrop),
    fileVaultReading(filevault),
    sipReading(sip),
  ]
  return { readings, idle, power }
}

async function applyUserDefaults(writes: Array<'screenLock' | 'idleLock' | 'airdrop'>): Promise<void> {
  if (writes.includes('screenLock')) {
    await run('/usr/bin/defaults', ['write', 'com.apple.screensaver', 'askForPassword', '-int', '1'])
    await run('/usr/bin/defaults', ['write', 'com.apple.screensaver', 'askForPasswordDelay', '-int', '0'])
  }
  if (writes.includes('idleLock')) {
    await run('/usr/bin/defaults', ['-currentHost', 'write', 'com.apple.screensaver', 'idleTime', '-int', '300'])
  }
  if (writes.includes('airdrop')) {
    await run('/usr/bin/defaults', ['write', 'com.apple.sharingd', 'DiscoverableMode', '-string', 'Contacts Only'])
  }
}

async function runAdmin(ids: SecurityId[], power: string | null): Promise<CommandResult> {
  const lines = ['set +e', ...adminLines(ids, power), 'exit 0']
  const shell = lines.join('; ')
  const source = `do shell script ${appleQuote(shell)} with administrator privileges`
  return run('/usr/bin/osascript', ['-e', source], 180_000)
}

function adminLines(ids: SecurityId[], power: string | null): string[] {
  const lines: string[] = []
  for (const id of ids) {
    if (id === 'remoteLogin') lines.push('echo OBSERVER_BEFORE remoteLogin', '/usr/sbin/systemsetup -getremotelogin 2>&1', 'echo OBSERVER_BEFORE_END')
    if (id === 'remoteEvents') lines.push('echo OBSERVER_BEFORE remoteEvents', '/usr/sbin/systemsetup -getremoteappleevents 2>&1', 'echo OBSERVER_BEFORE_END')
  }
  for (const id of ids) lines.push(...setLines(id, power))
  for (const id of ids) {
    if (id === 'remoteLogin') lines.push('echo OBSERVER_AFTER remoteLogin', '/usr/sbin/systemsetup -getremotelogin 2>&1', 'echo OBSERVER_AFTER_END')
    if (id === 'remoteEvents') lines.push('echo OBSERVER_AFTER remoteEvents', '/usr/sbin/systemsetup -getremoteappleevents 2>&1', 'echo OBSERVER_AFTER_END')
  }
  return lines
}

function setLines(id: SecurityId, power: string | null): string[] {
  switch (id) {
    case 'firewall':
      return ['/usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on 2>&1']
    case 'stealth':
      return ['/usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on 2>&1']
    case 'gatekeeper':
      return ['/usr/sbin/spctl --global-enable 2>&1', '/usr/sbin/spctl --master-enable 2>&1']
    case 'screenLock':
      return ['/usr/sbin/sysadminctl -screenLock immediate 2>&1']
    case 'idleLock':
      return shouldSetDisplaySleep(power) ? ['/usr/bin/pmset -a displaysleep 5 2>&1'] : []
    case 'guest':
      return ['/usr/sbin/sysadminctl -guestAccount off 2>&1']
    case 'remoteLogin':
      return ['/usr/sbin/systemsetup -setremotelogin off 2>&1']
    case 'remoteEvents':
      return ['/usr/sbin/systemsetup -setremoteappleevents off 2>&1']
    case 'wakeOnLan':
      return ['/usr/bin/pmset -a womp 0 2>&1']
    case 'guestSharing':
      return ['/usr/bin/defaults write /Library/Preferences/SystemConfiguration/com.apple.smb.server AllowGuestAccess -bool false 2>&1']
    case 'automaticLogin':
      return ['/usr/bin/defaults delete /Library/Preferences/com.apple.loginwindow autoLoginUser 2>&1']
    case 'securityUpdates':
      return [
        '/usr/sbin/softwareupdate --schedule on 2>&1',
        '/usr/bin/defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticCheckEnabled -bool true 2>&1',
        '/usr/bin/defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticDownload -bool true 2>&1',
        '/usr/bin/defaults write /Library/Preferences/com.apple.SoftwareUpdate CriticalUpdateInstall -bool true 2>&1',
        '/usr/bin/defaults write /Library/Preferences/com.apple.SoftwareUpdate ConfigDataInstall -bool true 2>&1',
        '/usr/bin/defaults write /Library/Preferences/com.apple.commerce AutoUpdate -bool true 2>&1',
      ]
    default:
      return []
  }
}

function adminFailure(result: CommandResult): string | null {
  if (result.ok) return null
  const blob = `${result.stdout}\n${result.stderr}\n${result.message}`
  if (/user cancel/i.test(blob) || /-128/.test(blob)) {
    return 'The administrator dialog was canceled. Settings that do not need that password were still applied.'
  }
  return 'The administrator changes did not finish. Settings that do not need that password were still applied.'
}

function appleQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

async function readScreenLock(): Promise<string | null> {
  const result = await run('/usr/sbin/sysadminctl', ['-screenLock', 'status'])
  const blob = `${result.stdout}\n${result.stderr}`
  return /screenLock delay/i.test(blob) ? blob : null
}

async function readGuest(): Promise<string | null> {
  const result = await run('/usr/sbin/sysadminctl', ['-guestAccount', 'status'])
  const blob = `${result.stdout}\n${result.stderr}`
  if (/guest account/i.test(blob)) return blob
  const enabled = await readDefault('/Library/Preferences/com.apple.loginwindow', 'GuestEnabled')
  if (enabled.state !== 'value') return null
  return enabled.text.trim() === '1' ? 'Guest account enabled' : 'Guest account disabled'
}

async function readRemote(flag: 'getremotelogin' | 'getremoteappleevents'): Promise<string | null> {
  const result = await run('/usr/sbin/systemsetup', [`-${flag}`])
  const blob = `${result.stdout}\n${result.stderr}`
  if (/administrator access/i.test(blob) || /Remote (Login|Apple Events):/i.test(blob)) return blob
  return null
}

async function readIdle(): Promise<DefaultsRead> {
  const host = await readDefault('com.apple.screensaver', 'idleTime', true)
  if (host.state === 'value') return host
  const user = await readDefault('com.apple.screensaver', 'idleTime', false)
  if (user.state === 'value') return user
  if (host.state === 'missing' || user.state === 'missing') return { state: 'missing', text: '' }
  return { state: 'unreadable', text: '' }
}

async function readDefault(domain: string, key: string, currentHost = false): Promise<DefaultsRead> {
  const args = currentHost ? ['-currentHost', 'read', domain, key] : ['read', domain, key]
  const result = await run('/usr/bin/defaults', args)
  if (result.ok) return { state: 'value', text: result.stdout.trim() }
  const blob = `${result.stdout}\n${result.stderr}\n${result.message}`
  if (/does not exist|could not find key|domain .+ not found/i.test(blob)) return { state: 'missing', text: '' }
  return { state: 'unreadable', text: '' }
}

async function readText(command: string, args: string[]): Promise<string | null> {
  const result = await run(command, args)
  return commandText(result)
}

function commandText(result: CommandResult): string | null {
  const blob = `${result.stdout}\n${result.stderr}`.trim()
  if (result.ok) return blob || null
  return blob || null
}

function run(command: string, args: string[], timeout = 8000): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        message: error instanceof Error ? error.message : '',
      })
    })
  })
}
