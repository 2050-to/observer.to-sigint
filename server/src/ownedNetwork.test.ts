import assert from 'node:assert/strict'
import {
  assembleCatalog,
  allowOwned,
  formatBytes,
  normalizeOwnedConsent,
  parseArpTable,
  presentFrom,
  toggleAddresses,
  toggleDetails,
} from '../../shared/ownedNetwork.js'
import {
  chooseLanInterface,
  netmaskToPrefix,
  normalizeMac,
  planSubnet,
  type LanCandidate,
} from '../../shared/subnet.js'

const lan: LanCandidate = {
  name: 'en0',
  address: '192.168.1.20',
  prefix: 24,
  mac: 'aa:bb:cc:dd:ee:01',
  internal: false,
  tunnel: false,
}

assert.equal(netmaskToPrefix('255.255.255.0'), 24)
assert.equal(netmaskToPrefix('255.255.0.0'), 16)
assert.equal(netmaskToPrefix('255.0.255.0'), null)
assert.equal(normalizeMac('0:1:2:3:4:5'), '00:01:02:03:04:05')
assert.equal(normalizeMac('02:00:00:00:00:00'), null)
assert.equal(normalizeMac('00:00:00:00:00:00'), null)

const home = planSubnet('192.168.1.20', 24)
assert.ok(home)
assert.equal(home.cidr, '192.168.1.0/24')
assert.equal(home.limited, false)
assert.equal(home.addresses.length, 256)
assert.equal(home.addresses.filter((item) => item.role === 'host').length, 253)
assert.equal(home.addresses[0].role, 'network')
assert.equal(home.addresses.find((item) => item.ip === '192.168.1.20')?.role, 'device')
assert.equal(home.addresses[255].role, 'broadcast')

const wide = planSubnet('10.1.2.3', 16)
assert.ok(wide)
assert.equal(wide.limited, true)
assert.equal(wide.interfacePrefix, 16)
assert.equal(wide.cidr, '10.1.2.0/24')
assert.equal(wide.addresses[0].ip, '10.1.2.0')
assert.equal(wide.addresses[255].ip, '10.1.2.255')

const alone = planSubnet('10.0.0.1', 32)
assert.ok(alone)
assert.deepEqual(alone.addresses, [{ ip: '10.0.0.1', role: 'device' }])

const pair = planSubnet('10.0.0.1', 31)
assert.ok(pair)
assert.deepEqual(pair.addresses.map((item) => item.role), ['host', 'device'])

assert.equal(planSubnet('192.168.01.1', 24), null)
assert.equal(planSubnet('224.0.0.1', 24), null)
assert.equal(planSubnet('0.0.0.0', 24), null)
assert.equal(planSubnet('192.168.1.1', 33), null)
assert.equal(planSubnet('10.1.2.3', -1), null)

const chosen = chooseLanInterface([
  { name: 'utun0', address: '10.8.0.2', prefix: 24, mac: null, internal: false, tunnel: true },
  { name: 'en0', address: '169.254.1.4', prefix: 16, mac: null, internal: false, tunnel: false },
  lan,
], 'utun0')
assert.equal(chosen?.address, '192.168.1.20')
assert.equal(chooseLanInterface([
  { name: 'utun3', address: '10.8.0.2', prefix: 24, mac: null, internal: false, tunnel: true },
], 'utun3'), null)

const arp = parseArpTable(`
gateway.local (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]
? (192.168.1.2) at (incomplete) on en0 ifscope [ethernet]
? (192.168.1.3) at 0:1:2:3:4:5 on en0 ifscope [ethernet]
IP address       HW type     Flags       HW address            Mask     Device
192.168.1.4      0x1         0x2         de:ad:be:ef:00:01     *        wlan0
192.168.1.5      0x1         0x0         00:00:00:00:00:00     *        wlan0
192.168.1.6      0x1         0x2         02:00:00:00:00:00     *        wlan0
`)
assert.equal(arp['192.168.1.1']?.name, 'gateway.local')
assert.equal(arp['192.168.1.1']?.mac, 'aa:bb:cc:dd:ee:ff')
assert.equal(arp['192.168.1.2'], undefined)
assert.equal(arp['192.168.1.3']?.mac, '00:01:02:03:04:05')
assert.equal(arp['192.168.1.4']?.mac, 'de:ad:be:ef:00:01')
assert.equal(arp['192.168.1.5'], undefined)
assert.equal(arp['192.168.1.6'], undefined)

const small = planSubnet('192.168.1.2', 30)
assert.ok(small)
const hosts = small.addresses.filter((item) => item.role === 'host').map((item) => item.ip)
const present = presentFrom(['192.168.1.9'], { '192.168.1.1': { mac: 'aa:bb:cc:dd:ee:10', name: 'printer.local' } }, hosts)
assert.deepEqual([...present], ['192.168.1.1'])
const catalog = assembleCatalog(small, present, {
  '192.168.1.1': { mac: 'aa:bb:cc:dd:ee:10', name: 'printer.local' },
}, { mac: 'aa:bb:cc:dd:ee:01', name: 'This Mac' })
assert.equal(catalog.checked, 1)
assert.equal(catalog.hosts.find((item) => item.role === 'network')?.present, false)
assert.equal(catalog.hosts.find((item) => item.role === 'broadcast')?.present, false)
assert.equal(catalog.hosts.find((item) => item.role === 'device')?.name, 'This Mac')
assert.equal(catalog.hosts.find((item) => item.ip === '192.168.1.1')?.present, true)
assert.equal(catalog.hosts.find((item) => item.ip === '192.168.1.1')?.mac, 'aa:bb:cc:dd:ee:10')

assert.deepEqual(toggleAddresses({ addresses: false, details: false }), {
  consent: { addresses: false, details: false },
  prompt: 'addresses',
})
assert.deepEqual(toggleAddresses({ addresses: true, details: true }), {
  consent: { addresses: false, details: false },
  prompt: null,
})
assert.deepEqual(toggleDetails({ addresses: false, details: false }), {
  consent: { addresses: false, details: false },
  prompt: null,
})
assert.deepEqual(toggleDetails({ addresses: true, details: false }), {
  consent: { addresses: true, details: false },
  prompt: 'details',
})
assert.deepEqual(allowOwned({ addresses: false, details: false }, 'addresses'), {
  consent: { addresses: true, details: false },
  prompt: 'details',
})
assert.deepEqual(allowOwned({ addresses: true, details: false }, 'details'), {
  consent: { addresses: true, details: true },
  prompt: null,
})
assert.deepEqual(allowOwned({ addresses: false, details: false }, 'details'), {
  consent: { addresses: false, details: false },
  prompt: null,
})
assert.deepEqual(normalizeOwnedConsent({ addresses: true, details: true }), { addresses: true, details: true })
assert.deepEqual(normalizeOwnedConsent({ addresses: false, details: true }), { addresses: false, details: false })
assert.deepEqual(normalizeOwnedConsent(null), { addresses: false, details: false })
assert.equal(formatBytes(8 * 1024 * 1024 * 1024), '8.0 GB')
assert.equal(formatBytes(512 * 1024 * 1024), '512 MB')
