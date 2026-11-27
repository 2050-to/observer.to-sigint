import assert from 'node:assert/strict'
import {
  IDLE_LOCK_SECONDS,
  SECURITY_CHECKS,
  airdropReading,
  applyMarked,
  fileVaultReading,
  firewallReading,
  gatekeeperReading,
  guestReading,
  idleReading,
  pendingAttempts,
  remoteReading,
  screenLockReading,
  securityReport,
  shouldAttempt,
  shouldSetDisplaySleep,
  shouldSetIdleDefault,
  sipReading,
  stealthReading,
  unreadableReading,
  updatesReading,
  userDefaultWrites,
  type DefaultsRead,
  type SecurityId,
  type SecurityReading,
} from '../../shared/macSecurity.js'

const missing: DefaultsRead = { state: 'missing', text: '' }
const power = [
  'Currently in use:',
  ' displaysleep            10',
  ' womp                 1',
].join('\n')

function allSecure(): SecurityReading[] {
  return SECURITY_CHECKS.map((check) => ({
    id: check.id,
    strictness: check.target,
    secure: true,
    value: 'On',
  }))
}

function replace(rows: SecurityReading[], next: SecurityReading): SecurityReading[] {
  return rows.map((row) => (row.id === next.id ? next : row))
}

const firewallOff = firewallReading('Firewall is disabled. (State = 0)')
const firewallOn = firewallReading('Firewall is enabled. (State = 1)')
assert.equal(firewallOff.secure, false)
assert.equal(firewallOn.secure, true)

const weaker = securityReport(replace(allSecure(), firewallOff), replace(allSecure(), firewallOn))
assert.deepEqual(weaker.improved.map((row) => row.id), ['firewall'])
assert.equal(weaker.alreadySecure.some((row) => row.id === 'firewall'), false)
assert.equal(weaker.improved[0]?.value, 'On')

const stayed = securityReport(allSecure(), allSecure())
assert.deepEqual(stayed.improved, [])
assert.equal(stayed.alreadySecure.length, SECURITY_CHECKS.length)
assert.equal(stayed.stillOpen.length, 0)

const airdropOff = airdropReading({ state: 'value', text: 'Off' })
assert.equal(airdropOff.secure, true)
assert.equal(airdropOff.strictness, 2)
assert.equal(shouldAttempt(airdropOff), false)

const idleSoon = idleReading({ state: 'value', text: '60' }, null)
assert.equal(idleSoon.secure, true)
assert.equal(idleSoon.value, '1 minute')
assert.equal(shouldAttempt(idleSoon), false)
assert.equal(shouldSetIdleDefault({ state: 'value', text: '60' }), false)

const idleLater = idleReading(missing, power)
assert.equal(idleLater.secure, false)
assert.equal(idleLater.value, '10 minutes')
assert.equal(shouldAttempt(idleLater), true)
assert.equal(shouldSetDisplaySleep(power), true)
assert.equal(shouldSetDisplaySleep(power.replace('10', '2')), false)
assert.equal(shouldSetIdleDefault(missing), true)
assert.equal(shouldSetIdleDefault({ state: 'value', text: String(IDLE_LOCK_SECONDS) }), false)

const airdropUnread = airdropReading(missing)
assert.equal(airdropUnread.secure, null)
assert.equal(shouldAttempt(airdropUnread), false)
assert.equal(shouldAttempt(idleReading({ state: 'unreadable', text: '' }, null)), false)

const everyone = airdropReading({ state: 'value', text: 'Everyone' })
assert.equal(shouldAttempt(everyone), true)
assert.deepEqual(pendingAttempts([airdropOff, everyone, fileVaultReading('FileVault is Off.')]).user, ['airdrop'])
assert.deepEqual(pendingAttempts([fileVaultReading('FileVault is Off.'), sipReading('System Integrity Protection status: disabled.')]).admin, [])
assert.equal(shouldAttempt(fileVaultReading('FileVault is Off.')), false)

const screenDelay = screenLockReading('2026-11-27 sysadminctl screenLock delay is 300 seconds', missing, missing)
assert.equal(screenDelay.secure, false)
assert.equal(shouldAttempt(screenDelay), true)
const screenNow = screenLockReading('screenLock delay is 0 seconds', missing, missing)
assert.equal(screenNow.secure, true)
assert.equal(shouldAttempt(screenNow), false)
assert.deepEqual(userDefaultWrites([screenDelay, idleLater, airdropOff], missing), ['screenLock', 'idleLock'])
assert.deepEqual(userDefaultWrites([screenNow, idleSoon, airdropOff], { state: 'value', text: '60' }), [])

assert.equal(stealthReading('Firewall stealth mode is off').secure, false)
assert.equal(stealthReading('Firewall stealth mode is on').secure, true)
assert.equal(gatekeeperReading('assessments enabled').secure, true)
assert.equal(gatekeeperReading('assessments disabled').secure, false)
assert.equal(guestReading('Guest account disabled.').secure, true)
assert.equal(guestReading('Guest account enabled.').secure, false)
assert.equal(fileVaultReading('FileVault is On.').secure, true)
assert.equal(sipReading('System Integrity Protection status: enabled.').secure, true)
assert.equal(sipReading('System Integrity Protection status: disabled.').value, 'Off')

const updatesOff = updatesReading({
  automaticCheck: missing,
  automaticDownload: { state: 'value', text: '1' },
  criticalUpdate: { state: 'value', text: '1' },
  configData: { state: 'value', text: '1' },
  autoUpdate: { state: 'value', text: '1' },
  schedule: 'Automatic checking for updates is turned on',
})
assert.equal(updatesOff.secure, false)
const updatesOn = updatesReading({
  automaticCheck: { state: 'value', text: '1' },
  automaticDownload: { state: 'value', text: '1' },
  criticalUpdate: { state: 'value', text: '1' },
  configData: { state: 'value', text: '1' },
  autoUpdate: { state: 'value', text: '1' },
  schedule: 'Automatic checking for updates is turned on',
})
assert.equal(updatesOn.secure, true)
assert.equal(updatesReading({
  automaticCheck: { state: 'unreadable', text: '' },
  automaticDownload: { state: 'unreadable', text: '' },
  criticalUpdate: { state: 'unreadable', text: '' },
  configData: { state: 'unreadable', text: '' },
  autoUpdate: { state: 'unreadable', text: '' },
  schedule: null,
}).secure, null)

const remoteUnread = remoteReading('remoteLogin', 'You need administrator access to run this tool... exiting!')
assert.equal(remoteUnread.secure, null)
assert.equal(shouldAttempt(remoteUnread), true)
const failed = securityReport(replace(allSecure(), remoteUnread), replace(allSecure(), remoteUnread))
assert.equal(failed.stillOpen.find((row) => row.id === 'remoteLogin')?.secure, null)
assert.equal(failed.improved.some((row) => row.id === 'remoteLogin'), false)
assert.equal(failed.alreadySecure.some((row) => row.id === 'gatekeeper'), true)

const marked = [
  'OBSERVER_BEFORE remoteLogin',
  'Remote Login: On',
  'OBSERVER_BEFORE_END',
  'OBSERVER_AFTER remoteLogin',
  'Remote Login: Off',
  'OBSERVER_AFTER_END',
].join('\n')
const beforeMarked = applyMarked(replace(allSecure(), unreadableReading('remoteLogin')), marked, 'BEFORE')
const afterMarked = applyMarked(replace(allSecure(), unreadableReading('remoteLogin')), marked, 'AFTER')
assert.equal(beforeMarked.find((row) => row.id === 'remoteLogin')?.secure, false)
assert.equal(afterMarked.find((row) => row.id === 'remoteLogin')?.value, 'Off')
const remoteReport = securityReport(beforeMarked, afterMarked)
assert.deepEqual(remoteReport.improved.map((row) => row.id), ['remoteLogin'])

const kept = applyMarked(replace(allSecure(), firewallOn), 'OBSERVER_BEFORE firewall\nFirewall is disabled. (State = 0)\nOBSERVER_BEFORE_END', 'BEFORE')
assert.equal(kept.find((row) => row.id === 'firewall')?.secure, true)

const knownIds = new Set<SecurityId>(SECURITY_CHECKS.map((check) => check.id))
assert.equal(knownIds.size, 15)

console.log('mac security checks passed')
