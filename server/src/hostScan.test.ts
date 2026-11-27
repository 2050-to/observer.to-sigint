import assert from 'node:assert/strict'
import { classifyHostScan, type CheckId, type HostScanInput, type LaunchFields } from '../../shared/hostScan.js'

function launch(overrides: Partial<LaunchFields> = {}): LaunchFields {
  return {
    label: 'com.example.agent',
    program: '/Applications/Example.app/Contents/MacOS/Example',
    programArguments: ['/Applications/Example.app/Contents/MacOS/Example'],
    environment: {},
    plistPath: '/Users/ada/Library/LaunchAgents/com.example.agent.plist',
    ...overrides,
  }
}

function input(overrides: Partial<HostScanInput> = {}): HostScanInput {
  return {
    hostname: 'mac',
    scannedAt: '2026-11-27T00:00:00.000Z',
    agents: [],
    daemons: [],
    helpers: [],
    loginText: '',
    cronText: '',
    kextText: '1 1 0x1 0x1 0x1 com.apple.kpi.bsd (1) AA <>',
    systemExtensionText: '0 extension(s)',
    sipText: 'System Integrity Protection status: enabled.',
    gatekeeperText: 'assessments enabled',
    filevaultText: 'FileVault is On.',
    firewallText: 'Firewall is enabled. (State = 1)',
    xprotectFound: true,
    ...overrides,
  }
}

function check(report: ReturnType<typeof classifyHostScan>, id: CheckId) {
  const found = report.checks.find((item) => item.id === id)
  assert.ok(found, id)
  return found
}

const clean = classifyHostScan(input())
assert.equal(clean.checks.every((item) => item.status === 'clear'), true)
assert.equal(clean.checks.length, 12)

const temp = classifyHostScan(input({
  agents: [launch({
    program: '/tmp/update',
    programArguments: ['/bin/bash', '/tmp/update'],
  })],
}))
const tempAgents = check(temp, 'launchAgents')
assert.equal(tempAgents.status, 'review')
assert.equal(tempAgents.findings.length, 1)
assert.equal(tempAgents.findings[0]?.severity, 'suspicious')
assert.match(tempAgents.findings[0]?.reason ?? '', /temporary directory or Downloads/)

const downloads = classifyHostScan(input({
  agents: [launch({
    program: '/Users/ada/Downloads/Helper.app/Contents/MacOS/Helper',
    programArguments: ['/Users/ada/Downloads/Helper.app/Contents/MacOS/Helper'],
  })],
}))
assert.equal(check(downloads, 'launchAgents').findings[0]?.severity, 'suspicious')
assert.match(check(downloads, 'launchAgents').findings[0]?.reason ?? '', /Downloads/)

const dyld = classifyHostScan(input({
  agents: [launch({
    environment: { DYLD_INSERT_LIBRARIES: '/Applications/Example.app/Contents/MacOS/injected.dylib' },
  })],
}))
const dyldAgents = check(dyld, 'launchAgents')
assert.equal(dyldAgents.findings.length, 1)
assert.equal(dyldAgents.findings[0]?.severity, 'suspicious')
assert.match(dyldAgents.findings[0]?.reason ?? '', /DYLD_INSERT_LIBRARIES/)

const known = classifyHostScan(input({
  daemons: [launch({
    label: 'com.apple.questd',
    program: '/Users/ada/Library/AppQuest/com.apple.questd',
    programArguments: ['/Users/ada/Library/AppQuest/com.apple.questd'],
    plistPath: '/Library/LaunchDaemons/com.apple.questd.plist',
  })],
}))
const knownDaemons = check(known, 'launchDaemons')
assert.equal(knownDaemons.findings.length, 1)
assert.equal(knownDaemons.findings[0]?.severity, 'suspicious')
assert.match(knownDaemons.findings[0]?.reason ?? '', /known macOS malware persistence/)

const script = classifyHostScan(input({
  agents: [launch({
    program: '/bin/bash',
    programArguments: ['/bin/bash', '/tmp/payload.sh'],
  })],
}))
assert.equal(check(script, 'launchAgents').findings[0]?.severity, 'suspicious')

const spreadsheet = classifyHostScan(input({
  agents: [launch({
    program: '/usr/bin/python3',
    programArguments: ['/usr/bin/python3', '/Users/ada/security/canary.py', '/Users/ada/Downloads/passwords_export.csv'],
  })],
}))
const spreadsheetAgents = check(spreadsheet, 'launchAgents')
assert.equal(spreadsheetAgents.findings.length, 1)
assert.equal(spreadsheetAgents.findings[0]?.severity, 'review')

const normal = classifyHostScan(input({ agents: [launch()] }))
const normalAgents = check(normal, 'launchAgents')
assert.equal(normalAgents.status, 'review')
assert.equal(normalAgents.findings.length, 1)
assert.equal(normalAgents.findings[0]?.severity, 'review')
assert.match(normalAgents.findings[0]?.reason ?? '', /Third-party startup item/)

const firewall = classifyHostScan(input({
  firewallText: 'Firewall is disabled. (State = 0)',
}))
const firewallCheck = check(firewall, 'firewall')
assert.equal(firewallCheck.status, 'review')
assert.equal(firewallCheck.findings.length, 1)
assert.equal(firewallCheck.findings[0]?.severity, 'review')
assert.match(firewallCheck.findings[0]?.reason ?? '', /turned off/)
assert.equal(check(firewall, 'gatekeeper').status, 'clear')

const unreadable = classifyHostScan(input({ agents: null }))
const unreadableAgents = check(unreadable, 'launchAgents')
assert.equal(unreadableAgents.status, 'unavailable')
assert.deepEqual(unreadableAgents.findings, [])
assert.match(unreadableAgents.detail, /could not be read/)
assert.equal(check(unreadable, 'firewall').status, 'clear')
assert.equal(check(unreadable, 'xprotect').status, 'clear')

const extensions = classifyHostScan(input({
  kextText: [
    '1 1 0x1 0x1 0x1 com.apple.kpi.bsd (1) AA <>',
    '12 0 0x1 0x1 0x1 com.example.driver.Foo (1.0) BB <1>',
  ].join('\n'),
}))
const kexts = check(extensions, 'kexts')
assert.equal(kexts.findings.length, 1)
assert.equal(kexts.findings[0]?.severity, 'suspicious')
assert.equal(kexts.findings[0]?.path, 'com.example.driver.Foo')
assert.match(kexts.findings[0]?.reason ?? '', /not signed by Apple/)

const disabledWord = classifyHostScan(input({
  sipText: 'System Integrity Protection status: disabled.',
}))
assert.equal(check(disabledWord, 'sip').findings[0]?.severity, 'review')
assert.match(check(disabledWord, 'sip').detail, /turned off/)

console.log('host scan checks passed')
