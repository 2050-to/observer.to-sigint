import assert from 'node:assert/strict'
import {
  CONNECTION_CAP,
  emptyConnectionCatalog,
  foldCatalog,
  markReviewed,
  parseConnectionCatalog,
  reviewChanges,
  type ConnectionCatalog,
} from '../../shared/connectionCatalog.js'
import type { ClassifiedSocket, VpnRoute } from '../../shared/secureLinks.js'

const vpn: VpnRoute = { active: false, interfaceName: null }
const tunnel: VpnRoute = { active: true, interfaceName: 'utun4' }
const t1 = '2026-11-27T18:00:00.000Z'
const t2 = '2026-11-27T18:00:05.000Z'
const t3 = '2026-11-27T18:00:10.000Z'

function flagged(overrides: Partial<ClassifiedSocket> = {}): ClassifiedSocket {
  return {
    process: 'Google Chrome',
    pid: 1,
    protocol: 'tcp',
    local: { host: '10.0.0.2', port: 50000 },
    remote: { host: '1.2.3.4', port: 443 },
    state: 'ESTABLISHED',
    flags: ['443'],
    ...overrides,
  }
}

function fold(catalog: ConnectionCatalog, sockets: ClassifiedSocket[], at: string, route: VpnRoute = vpn): ConnectionCatalog {
  return foldCatalog(catalog, sockets, route, at)
}

const chrome = flagged()
const otherLocal = flagged({ pid: 9, local: { host: '10.0.0.2', port: 50001 } })
const once = fold(emptyConnectionCatalog(), [chrome], t1)
assert.equal(once.entries.length, 1)
assert.equal(once.entries[0]?.samples, 1)
assert.equal(once.entries[0]?.openCount, 1)
assert.equal(once.entries[0]?.firstSeen, t1)
assert.equal(once.entries[0]?.local.port, 50000)
assert.equal(once.updatedAt, t1)
assert.equal(emptyConnectionCatalog().entries.length, 0)

const samePoll = fold(emptyConnectionCatalog(), [chrome, otherLocal], t1)
assert.equal(samePoll.entries.length, 1)
assert.equal(samePoll.entries[0]?.samples, 1)
assert.equal(samePoll.entries[0]?.openCount, 2)
assert.equal(samePoll.entries[0]?.pid, 9)
assert.equal(samePoll.entries[0]?.local.port, 50001)

const again = fold(once, [otherLocal], t2)
assert.equal(again.entries.length, 1)
assert.equal(again.entries[0]?.samples, 2)
assert.equal(again.entries[0]?.openCount, 1)
assert.equal(again.entries[0]?.firstSeen, t1)
assert.equal(again.entries[0]?.lastSeen, t2)
assert.equal(again.entries[0]?.local.port, 50001)
assert.equal(again.entries[0]?.pid, 9)
assert.equal(once.entries[0]?.samples, 1)
assert.equal(once.entries[0]?.local.port, 50000)

const otherHost = flagged({ remote: { host: '5.6.7.8', port: 443 }, local: { host: '10.0.0.2', port: 50002 } })
const twoHosts = fold(emptyConnectionCatalog(), [chrome, otherHost], t1)
assert.equal(twoHosts.entries.length, 2)

const quiet = fold(again, [], t3)
assert.equal(quiet.entries[0]?.openCount, 0)
assert.equal(quiet.entries[0]?.lastSeen, t2)
assert.equal(quiet.entries[0]?.samples, 2)
assert.equal(quiet.entries[0]?.firstSeen, t1)

const listenLow = flagged({
  process: 'tor',
  flags: ['tor'],
  local: { host: '127.0.0.1', port: 9050 },
  remote: null,
  state: 'LISTEN',
})
const listenHigh = flagged({
  process: 'tor',
  flags: ['tor'],
  local: { host: '127.0.0.1', port: 9051 },
  remote: null,
  state: 'LISTEN',
})
const torRemote = flagged({
  process: 'tor',
  flags: ['tor'],
  local: { host: '10.0.0.2', port: 40000 },
  remote: { host: '1.2.3.4', port: 9050 },
})
const listened = fold(emptyConnectionCatalog(), [listenLow, listenHigh, torRemote], t1)
assert.equal(listened.entries.length, 3)
const listens = listened.entries.filter((entry) => entry.listen)
assert.deepEqual(listens.map((entry) => entry.destination.port).sort((left, right) => (left ?? 0) - (right ?? 0)), [9050, 9051])
assert.equal(listens.find((entry) => entry.destination.port === 9050)?.destination.host, '127.0.0.1')
const outbound = listened.entries.find((entry) => !entry.listen)
assert.equal(outbound?.destination.host, '1.2.3.4')
assert.equal(outbound?.destination.port, 9050)
assert.equal(outbound?.local.port, 40000)

assert.equal(fold(emptyConnectionCatalog(), [{ ...chrome, flags: [] }], t1).entries.length, 0)

const routed = fold(emptyConnectionCatalog(), [chrome], t1, tunnel)
assert.deepEqual(routed.vpnRoute, tunnel)

let crowded = emptyConnectionCatalog()
for (let index = 0; index < CONNECTION_CAP + 1; index += 1) {
  const at = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
  crowded = fold(crowded, [flagged({
    remote: { host: `h${index}`, port: 443 },
    local: { host: '10.0.0.2', port: 40000 },
  })], at)
}
assert.equal(crowded.entries.length, CONNECTION_CAP)
assert.ok(!crowded.entries.some((entry) => entry.destination.host === 'h0'))
assert.ok(crowded.entries.some((entry) => entry.destination.host === `h${CONNECTION_CAP}`))

const fresh = reviewChanges(again)
assert.equal(fresh.unreviewed.length, 1)
assert.equal(fresh.appeared.length, 0)
assert.equal(fresh.quiet.length, 0)

const reviewed = markReviewed(again)
assert.equal(reviewed.reviewedAt, t2)
assert.equal(reviewed.updatedAt, t2)
const atReview = reviewChanges(reviewed)
assert.equal(atReview.unreviewed.length, 0)
assert.equal(atReview.appeared.length, 0)
assert.equal(atReview.quiet.length, 0)

const stayed = fold(reviewed, [chrome], t3)
const stayedChanges = reviewChanges(stayed)
assert.equal(stayedChanges.appeared.length, 0)
assert.equal(stayedChanges.quiet.length, 0)
assert.equal(stayed.entries[0]?.firstSeen, t1)
assert.equal(stayed.entries[0]?.lastSeen, t3)

const changed = fold(reviewed, [otherHost], t3)
const changedReview = reviewChanges(changed)
assert.equal(changedReview.appeared.length, 1)
assert.equal(changedReview.appeared[0]?.destination.host, '5.6.7.8')
assert.equal(changedReview.quiet.length, 1)
assert.equal(changedReview.quiet[0]?.destination.host, '1.2.3.4')
assert.equal(changedReview.quiet[0]?.openCount, 0)
assert.equal(changedReview.quiet[0]?.lastSeen, t2)
assert.equal(changedReview.quiet[0]?.samples, 2)
assert.deepEqual(reviewChanges(parseConnectionCatalog(JSON.stringify(changed))), changedReview)
assert.deepEqual(parseConnectionCatalog('not json'), emptyConnectionCatalog())

console.log('connection catalog checks passed')
