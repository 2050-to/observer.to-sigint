import assert from 'node:assert/strict'
import { appendAllowlist, isAllowlisted, parseAllowlist } from '../../shared/allowlist.js'
import { renderBaselineMarkdown } from '../../shared/baseline.js'
import type { ConnectionEntry } from '../../shared/connectionCatalog.js'
import {
  PROCESS_CAP,
  applyAlerts,
  dismissProcess,
  emptyProcessCatalog,
  fingerprintOf,
  foldProcesses,
  parseProcessCatalog,
  parsePsArgs,
  parsePsTable,
  platformSignature,
  processName,
  qualifiesProcess,
  signatureFromCodesign,
  sortProcessEntries,
  type ObservedProcess,
  type ProcessCatalog,
  type ProcessEntry,
  type ProcessSignature,
} from '../../shared/processCatalog.js'

const start = '2026-11-27T18:00:00.000Z'
const halfHour = '2026-11-27T18:30:00.000Z'
const almost = '2026-11-27T18:29:59.000Z'
const later = '2026-11-27T18:30:02.000Z'

function signature(overrides: Partial<ProcessSignature> = {}): ProcessSignature {
  return {
    status: 'developer',
    cdhash: 'abc',
    teamId: 'TEAM123456',
    identifier: 'tool',
    authority: 'Developer ID Application: Example (TEAM123456)',
    size: 10,
    mtimeMs: 1,
    ...overrides,
  }
}

function entry(overrides: Partial<Omit<ProcessEntry, 'signature'>> & { signature?: Partial<ProcessSignature> } = {}): ProcessEntry {
  const { signature: signatureOverride, ...rest } = overrides
  return {
    path: '/usr/bin/tool',
    name: 'tool',
    user: 'ben',
    signature: signature(signatureOverride),
    firstSeen: start,
    lastSeen: halfHour,
    samples: 50,
    pid: 10,
    alertedFingerprint: null,
    dismissedFingerprint: null,
    ...rest,
  }
}

function observed(overrides: Partial<ObservedProcess> = {}): ObservedProcess {
  return {
    pid: 10,
    ppid: 1,
    user: 'ben',
    state: 'S',
    cpu: 1,
    mem: 0.4,
    rssKb: 1000,
    time: '0:01.00',
    path: '/usr/bin/tool',
    ...overrides,
  }
}

function catalog(entries: ProcessEntry[], seededAt: string | null = start): ProcessCatalog {
  return { updatedAt: start, seededAt, entries }
}

const psText = [
  '    1     0 root             Ss     0.0  0.1   8592   4:27.73 /sbin/launchd',
  '54186 54168 ben              S      4.5  1.3 104976   0:30.43 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/158.0.8127.88/Helpers/Google Chrome Helper (Aperitif).app/Contents/MacOS/Google Chrome Helper (Aperitif)',
  '    0     0 root             Ss     0.0  0.0      0  12:00.00 kernel_task',
].join('\n')

const parsed = parsePsTable(psText)
assert.equal(parsed.length, 3)
assert.equal(parsed[0]?.path, '/sbin/launchd')
assert.equal(parsed[0]?.time, '4:27.73')
assert.equal(parsed[0]?.rssKb, 8592)
assert.equal(parsed[1]?.cpu, 4.5)
assert.equal(parsed[1]?.user, 'ben')
assert.equal(processName(parsed[1]?.path ?? ''), 'Google Chrome Helper (Aperitif)')
assert.equal(parsed[2]?.pid, 0)
assert.equal(parsed[2]?.path, 'kernel_task')

const args = parsePsArgs('    1 /sbin/launchd\n  340 /usr/libexec/UserEventAgent (System)\n')
assert.equal(args.get(1), '/sbin/launchd')
assert.equal(args.get(340), '/usr/libexec/UserEventAgent (System)')

const appleText = [
  'Identifier=com.apple.ls',
  'CDHash=b113e00f18eaeacbb4b77f1914e52f3ffdd07c0b',
  'Authority=macOS Software Signing',
  'Authority=Apple Code Signing Certification Authority',
  'Authority=Apple Root CA',
  'TeamIdentifier=not set',
].join('\n')
const apple = signatureFromCodesign({ text: appleText, verifyOk: true, size: 20, mtimeMs: 5, readable: true })
assert.equal(apple.status, 'apple')
assert.equal(apple.cdhash, 'b113e00f18eaeacbb4b77f1914e52f3ffdd07c0b')
assert.equal(apple.teamId, null)
assert.equal(apple.authority, 'macOS Software Signing')

const developer = signatureFromCodesign({
  text: 'Identifier=com.example.tool\nCDHash=def\nAuthority=Developer ID Application: Example (TEAM123456)\nTeamIdentifier=TEAM123456\n',
  verifyOk: true,
  size: 30,
  mtimeMs: 6,
  readable: true,
})
assert.equal(developer.status, 'developer')
assert.equal(developer.teamId, 'TEAM123456')

const adhoc = signatureFromCodesign({
  text: 'Identifier=a.out\nCodeDirectory v=20400 size=1 flags=0x2(adhoc) hashes=1\nCDHash=aaa\nSignature=adhoc\n',
  verifyOk: true,
  size: 4,
  mtimeMs: 7,
  readable: true,
})
assert.equal(adhoc.status, 'adhoc')

const unsigned = signatureFromCodesign({
  text: '/tmp/tool: code object is not signed at all\n',
  verifyOk: false,
  size: 8,
  mtimeMs: 8,
  readable: true,
})
assert.equal(unsigned.status, 'unsigned')

const invalid = signatureFromCodesign({
  text: 'Identifier=com.example.tool\nCDHash=bbb\nAuthority=Developer ID Application: Example (TEAM123456)\n',
  verifyOk: false,
  size: 9,
  mtimeMs: 9,
  readable: true,
})
assert.equal(invalid.status, 'invalid')
assert.equal(signatureFromCodesign({ text: '', verifyOk: false, size: null, mtimeMs: null, readable: false }).status, 'unreadable')

assert.equal(qualifiesProcess(entry({ samples: 49 })), false)
assert.equal(qualifiesProcess(entry({ lastSeen: almost })), false)
assert.equal(qualifiesProcess(entry()), true)
assert.equal(qualifiesProcess(entry({ signature: { status: 'invalid', cdhash: 'bbb' } })), false)
assert.equal(qualifiesProcess(entry({ signature: { status: 'unsigned', cdhash: null, teamId: null, authority: null, size: null } })), false)
assert.equal(qualifiesProcess(entry({ signature: { status: 'unsigned', cdhash: null, teamId: null, authority: null, size: 8, mtimeMs: 8 } })), true)
assert.equal(qualifiesProcess(entry({ signature: platformSignature() })), true)

const names = parseAllowlist('# comment\n\nCursor Helper\ncursor helper\n')
assert.deepEqual(names, ['Cursor Helper'])
assert.equal(isAllowlisted(names, 'Cursor Helper'), true)
assert.equal(isAllowlisted(names, 'cursor helper'), true)
assert.equal(isAllowlisted(names, 'Cursor'), false)
assert.equal(appendAllowlist('# Example:\n# Cursor Helper\n', 'Cursor Helper'), '# Example:\n# Cursor Helper\nCursor Helper\n')
assert.equal(appendAllowlist('# Example:\n# Cursor Helper\nCursor Helper\n', 'cursor helper'), '# Example:\n# Cursor Helper\nCursor Helper\n')

const signatures = new Map([['/usr/bin/tool', signature()]])
const once = foldProcesses(emptyProcessCatalog(), [observed(), observed({ pid: 11, cpu: 3 })], start, signatures)
assert.equal(once.entries.length, 1)
assert.equal(once.entries[0]?.samples, 1)
assert.equal(once.entries[0]?.pid, 11)
assert.equal(once.seededAt, start)
assert.equal(emptyProcessCatalog().entries.length, 0)
const twice = foldProcesses(once, [observed()], later, signatures)
assert.equal(twice.entries[0]?.samples, 2)
assert.equal(once.entries[0]?.samples, 1)
assert.equal(foldProcesses(emptyProcessCatalog(), [], start, signatures).seededAt, null)

const kernel = foldProcesses(emptyProcessCatalog(), [observed({ pid: 0, path: 'kernel_task', user: 'root' })], start, new Map())
assert.equal(kernel.entries[0]?.signature.status, 'platform')
assert.deepEqual(kernel.entries[0]?.signature, platformSignature())

const seeded = catalog([])
const arrived = catalog([entry({
  path: '/tmp/new',
  name: 'new',
  samples: 1,
  firstSeen: later,
  lastSeen: later,
  signature: { status: 'unsigned', cdhash: null, teamId: null, authority: null, size: 3, mtimeMs: 3 },
})], start)
const firstAlerts = applyAlerts(catalog([entry()], null), once, ['/usr/bin/tool'], [])
assert.equal(firstAlerts.alerts.length, 0)

const fresh = applyAlerts(seeded, arrived, ['/tmp/new'], [])
assert.equal(fresh.alerts.length, 1)
assert.equal(fresh.alerts[0]?.reason, 'new')
assert.equal(fresh.alerts[0]?.name, 'new')
assert.equal(fresh.catalog.entries[0]?.alertedFingerprint, fresh.alerts[0]?.fingerprint)
const again = applyAlerts(seeded, fresh.catalog, ['/tmp/new'], [])
assert.equal(again.alerts.length, 0)
const allowed = applyAlerts(seeded, arrived, ['/tmp/new'], ['new'])
assert.equal(allowed.alerts.length, 0)

const trusted = entry({ signature: { cdhash: 'old' } })
const replaced = entry({ signature: { cdhash: 'new' } })
const changed = applyAlerts(catalog([trusted]), catalog([replaced]), ['/usr/bin/tool'], [])
assert.equal(changed.alerts.length, 1)
assert.equal(changed.alerts[0]?.reason, 'changed')

const appleBefore = entry({ name: 'launchd', path: '/sbin/launchd', signature: { status: 'apple', cdhash: 'one', teamId: null, authority: 'Software Signing' } })
const appleAfter = entry({ name: 'launchd', path: '/sbin/launchd', signature: { status: 'apple', cdhash: 'two', teamId: null, authority: 'Software Signing' } })
assert.equal(applyAlerts(catalog([appleBefore]), catalog([appleAfter]), ['/sbin/launchd'], []).alerts.length, 0)

const broken = entry({ signature: { status: 'invalid', cdhash: 'bad', size: 9, mtimeMs: 9 } })
const dismissed = dismissProcess(catalog([broken]), broken.path, fingerprintOf(broken.signature))
assert.equal(dismissed.entries[0]?.dismissedFingerprint, fingerprintOf(broken.signature))
assert.equal(dismissProcess(catalog([entry()]), '/usr/bin/tool', fingerprintOf(entry().signature)).entries[0]?.dismissedFingerprint, null)
const quiet = applyAlerts(catalog([dismissed.entries[0]!]), catalog([broken]), [broken.path], [])
assert.equal(quiet.alerts.length, 0)
const moved = entry({ signature: { status: 'invalid', cdhash: 'worse', size: 11, mtimeMs: 11 } })
const reopen = applyAlerts(catalog([{ ...broken, dismissedFingerprint: fingerprintOf(broken.signature) }]), catalog([moved]), [moved.path], [])
assert.equal(reopen.alerts.length, 1)
assert.equal(reopen.alerts[0]?.reason, 'changed')

const ordered = sortProcessEntries([
  entry({ name: 'Cursor Helper', path: '/Applications/Cursor Helper', samples: 651 }),
  entry({ name: 'rare', path: '/tmp/rare', samples: 1, signature: { status: 'unsigned', cdhash: null, teamId: null, authority: null, size: 2, mtimeMs: 2 } }),
])
assert.equal(ordered[0]?.name, 'rare')
assert.equal(ordered[1]?.name, 'Cursor Helper')

const commonConnection: ConnectionEntry = {
  process: 'Cursor Helper',
  protocol: 'tcp',
  flags: ['443'],
  listen: false,
  destination: { host: '52.21.130.202', port: 443 },
  local: { host: '10.0.0.14', port: 51633 },
  pid: 56180,
  state: 'ESTABLISHED',
  firstSeen: '2026-11-27T19:52:35.000Z',
  lastSeen: '2026-11-27T20:43:31.000Z',
  samples: 651,
  openCount: 1,
}
const rareConnection: ConnectionEntry = { ...commonConnection, process: 'once', samples: 1, destination: { host: '203.0.113.5', port: 443 } }
const baseline = renderBaselineMarkdown(
  [entry(), entry({ path: '/tmp/rare', name: 'rare', samples: 49 })],
  [commonConnection, rareConnection],
)
assert.match(baseline, /\/usr\/bin\/tool: developer, cdhash abc/)
assert.doesNotMatch(baseline, /\/tmp\/rare/)
assert.match(baseline, /Cursor Helper TCP 52\.21\.130\.202:443: 651 samples/)
assert.doesNotMatch(baseline, /once TCP/)

const crowded: ProcessEntry[] = [entry({ path: '/bin/keep', lastSeen: '2026-01-01T00:00:00.000Z', firstSeen: '2025-12-31T23:00:00.000Z' })]
for (let index = 0; index < PROCESS_CAP; index += 1) {
  crowded.push(entry({
    path: `/tmp/n${index}`,
    name: `n${index}`,
    samples: 1,
    firstSeen: start,
    lastSeen: new Date(Date.parse('2026-02-01T00:00:00.000Z') + index * 1000).toISOString(),
    signature: { status: 'unsigned', cdhash: null, teamId: null, authority: null, size: 1, mtimeMs: index + 1 },
  }))
}
const capped = parseProcessCatalog(JSON.stringify({ updatedAt: start, seededAt: start, entries: crowded }))
assert.equal(capped.entries.length, PROCESS_CAP)
assert.ok(capped.entries.some((item) => item.path === '/bin/keep'))
assert.ok(!capped.entries.some((item) => item.path === '/tmp/n0'))
assert.deepEqual(parseProcessCatalog('not json'), emptyProcessCatalog())

console.log('process catalog checks passed')
