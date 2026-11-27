import assert from 'node:assert/strict'
import {
  SOCKET_CAP,
  buildSnapshot,
  classifySocket,
  defaultRouteInterface,
  markFresh,
  parseLsof,
  socketKey,
  vpnRouteFrom,
  type ParsedSocket,
} from '../../shared/secureLinks.js'

function socket(overrides: Partial<ParsedSocket> & Pick<ParsedSocket, 'process'>): ParsedSocket {
  return {
    pid: 1,
    protocol: 'tcp',
    local: { host: '10.0.0.2', port: 50000 },
    remote: { host: '1.2.3.4', port: 80 },
    state: 'ESTABLISHED',
    ...overrides,
  }
}

const chrome443 = socket({
  process: 'Google Chrome',
  remote: { host: '1.2.3.4', port: 443 },
})
const quic = socket({
  process: 'Google Chrome',
  protocol: 'udp',
  local: { host: '10.0.0.2', port: 50001 },
  remote: { host: '1.2.3.4', port: 443 },
  state: null,
})

assert.deepEqual(classifySocket(chrome443), ['443'])
assert.deepEqual(classifySocket(quic), ['443'])
assert.equal(chrome443.protocol, 'tcp')
assert.equal(quic.protocol, 'udp')

assert.deepEqual(classifySocket(socket({
  process: 'tor',
  remote: { host: '1.2.3.4', port: 443 },
})), ['443', 'tor'])
assert.deepEqual(classifySocket(socket({
  process: 'Tor Browser',
  remote: { host: '127.0.0.1', port: 80 },
})), ['tor'])
assert.deepEqual(classifySocket(socket({
  process: 'curl',
  local: { host: '127.0.0.1', port: 40000 },
  remote: { host: '127.0.0.1', port: 9050 },
})), ['tor'])
assert.deepEqual(classifySocket(socket({
  process: 'curl',
  remote: { host: '1.2.3.4', port: 9001 },
})), ['tor'])
assert.deepEqual(classifySocket(socket({
  process: 'curl',
  remote: { host: '1.2.3.4', port: 9030 },
})), ['tor'])
assert.deepEqual(classifySocket(socket({
  process: 'python',
  local: { host: '*', port: 9001 },
  remote: null,
  state: 'LISTEN',
})), [])
assert.deepEqual(classifySocket(socket({
  process: 'Tornado',
  remote: { host: '1.2.3.4', port: 80 },
})), [])

const route = vpnRouteFrom(defaultRouteInterface('   interface: utun4\n'))
assert.deepEqual(route, { active: true, interfaceName: 'utun4' })
assert.deepEqual(vpnRouteFrom(defaultRouteInterface('interface: en0\n')), { active: false, interfaceName: null })
assert.deepEqual(vpnRouteFrom(defaultRouteInterface('interface: bridge0\n')), { active: false, interfaceName: null })
assert.equal(defaultRouteInterface('gateway: 10.0.0.1\n'), null)
assert.deepEqual(classifySocket(chrome443), ['443'])
assert.deepEqual(buildSnapshot([chrome443], route).vpnRoute, route)

assert.deepEqual(classifySocket(socket({
  process: 'openvpn',
  protocol: 'udp',
  remote: { host: '1.2.3.4', port: 1194 },
  state: null,
})), ['vpn'])
assert.deepEqual(classifySocket(socket({
  process: 'Tunnelblick',
  remote: { host: '1.2.3.4', port: 443 },
})), ['443', 'vpn'])
for (const port of [500, 4500, 51820, 1701, 1723]) {
  assert.deepEqual(classifySocket(socket({
    process: 'kernel',
    protocol: port === 500 || port === 4500 || port === 51820 ? 'udp' : 'tcp',
    remote: { host: '1.2.3.4', port },
    state: null,
  })), ['vpn'], `port ${port}`)
}

const other: Array<[number, string]> = [
  [22, 'ssh'],
  [853, 'dot'],
  [465, 'mail'],
  [993, 'mail'],
  [995, 'mail'],
  [636, 'ldaps'],
  [989, 'ftps'],
  [990, 'ftps'],
  [992, 'telnets'],
  [5061, 'sips'],
  [6697, 'ircs'],
  [8443, 'alt-tls'],
  [9443, 'alt-tls'],
  [5223, 'apns'],
]
for (const [port, flag] of other) {
  assert.deepEqual(classifySocket(socket({
    process: 'app',
    remote: { host: '1.2.3.4', port },
  })), [flag], `port ${port}`)
}
assert.deepEqual(classifySocket(socket({
  process: 'sshd',
  local: { host: '*', port: 22 },
  remote: null,
  state: 'LISTEN',
})), ['ssh'])

const parsed = parseLsof([
  'p10',
  'cGoogle Chrome',
  'f4',
  'PTCP',
  'n10.0.0.2:50000->1.2.3.4:443',
  'TST=ESTABLISHED',
  'TQR=0',
  'f5',
  'PUDP',
  'n[2601:283::1]:50001->[2600:1901:1:3b2::]:443',
  'p12',
  'ctor',
  'f6',
  'PTCP',
  'n127.0.0.1:9050',
  'TST=LISTEN',
  'p13',
  'cSpotify Helper',
  'f7',
  'PTCP',
  'n10.0.0.2:50002->1.2.3.4:80',
  'TST=ESTABLISHED',
  'p14',
  'cidentityservicesd',
  'f8',
  'PUDP',
  'n*:*',
].join('\n'))

assert.equal(parsed.length, 5)
assert.equal(parsed[0]?.process, 'Google Chrome')
assert.equal(parsed[0]?.protocol, 'tcp')
assert.equal(parsed[0]?.state, 'ESTABLISHED')
assert.deepEqual(parsed[0]?.remote, { host: '1.2.3.4', port: 443 })
assert.equal(parsed[1]?.protocol, 'udp')
assert.equal(parsed[1]?.state, null)
assert.deepEqual(parsed[1]?.local, { host: '2601:283::1', port: 50001 })
assert.deepEqual(parsed[1]?.remote, { host: '2600:1901:1:3b2::', port: 443 })
assert.equal(parsed[2]?.process, 'tor')
assert.deepEqual(parsed[2]?.local, { host: '127.0.0.1', port: 9050 })
assert.equal(parsed[2]?.remote, null)
assert.equal(parsed[3]?.process, 'Spotify Helper')
assert.equal(parsed[4]?.local.port, null)

const snapshot = buildSnapshot(parsed, { active: false, interfaceName: null })
assert.equal(snapshot.note, null)
assert.equal(snapshot.truncated, false)
assert.deepEqual(snapshot.sockets.map((item) => item.process), ['Google Chrome', 'Google Chrome', 'tor'])
assert.deepEqual(snapshot.counts, [
  { flag: '443', count: 2 },
  { flag: 'tor', count: 1 },
])
assert.deepEqual(classifySocket(snapshot.sockets[0]!), ['443'])
assert.ok(!snapshot.sockets.some((item) => item.process === 'Spotify Helper'))

const both = buildSnapshot([
  socket({ process: 'tor', remote: { host: '1.2.3.4', port: 443 } }),
], { active: false, interfaceName: null })
assert.deepEqual(both.counts, [
  { flag: '443', count: 1 },
  { flag: 'tor', count: 1 },
])

const many = Array.from({ length: SOCKET_CAP + 1 }, (_, index) => socket({
  process: 'Google Chrome',
  local: { host: '10.0.0.2', port: 40000 + index },
  remote: { host: '1.2.3.4', port: 443 },
}))
const capped = buildSnapshot(many, { active: false, interfaceName: null })
assert.equal(capped.truncated, true)
assert.equal(capped.sockets.length, SOCKET_CAP)
assert.deepEqual(capped.counts, [{ flag: '443', count: SOCKET_CAP + 1 }])

const seen = new Set([socketKey(chrome443)])
const marked = markFresh([chrome443, quic], seen)
assert.equal(marked[0]?.fresh, false)
assert.equal(marked[1]?.fresh, true)
assert.equal(markFresh([chrome443], null)[0]?.fresh, false)

console.log('secure link checks passed')
