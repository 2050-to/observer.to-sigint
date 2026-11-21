import assert from 'node:assert/strict'
import { assembleCatalog, asSubnetCatalog } from '../../shared/ownedNetwork.js'
import {
  applySightings,
  classifyRecorder,
  encodeMdnsQuery,
  parseMdnsPacket,
  parseSsdpMessage,
  sightingsFromMdns,
} from '../../shared/recorders.js'
import { planSubnet } from '../../shared/subnet.js'

const host = {
  role: 'host' as const,
  mac: null,
  name: null,
  services: [] as string[],
  ports: [] as number[],
}

const hikvision = classifyRecorder({ ...host, mac: 'BC:AD:28:11:22:33' })
assert.equal(hikvision?.kind, 'camera')
assert.equal(hikvision?.confidence, 'high')
assert.deepEqual(hikvision?.reasons, ['Hikvision'])

const named = classifyRecorder({ ...host, name: 'ipcam-hall' })
assert.equal(named?.kind, 'camera')
assert.equal(named?.confidence, 'medium')
assert.deepEqual(named?.reasons, ['ipcam-hall'])

const storage = classifyRecorder({ ...host, name: 'storage-nvr' })
assert.equal(storage?.kind, 'recorder')
assert.equal(storage?.confidence, 'medium')
assert.deepEqual(storage?.reasons, ['storage-nvr'])

assert.equal(classifyRecorder({ ...host, name: 'campus-wifi' }), null)
assert.equal(classifyRecorder({ ...host, name: 'classroom' }), null)
assert.equal(classifyRecorder({ ...host, mac: '00:11:22:33:44:55' }), null)
assert.equal(classifyRecorder({ ...host, ports: [80, 443, 8080] }), null)
assert.equal(classifyRecorder({ ...host, services: ['airplay', 'googlecast'] }), null)
assert.equal(classifyRecorder({ ...host, role: 'device', mac: 'bc:ad:28:11:22:33' }), null)
assert.equal(classifyRecorder({ ...host, role: 'network', name: 'ipcam' }), null)
assert.equal(classifyRecorder({ ...host, role: 'broadcast', ports: [554] }), null)

const rtsp = classifyRecorder({ ...host, services: ['rtsp'] })
assert.equal(rtsp?.confidence, 'high')
assert.deepEqual(rtsp?.reasons, ['Announced RTSP'])

const onvif = classifyRecorder({ ...host, services: ['ONVIF'] })
assert.equal(onvif?.kind, 'camera')
assert.deepEqual(onvif?.reasons, ['Announced ONVIF'])

assert.deepEqual(classifyRecorder({ ...host, ports: [554] })?.reasons, ['554'])
assert.equal(classifyRecorder({ ...host, ports: [8554] })?.kind, 'camera')
assert.deepEqual(classifyRecorder({ ...host, ports: [8554] })?.reasons, ['8554'])

const dvrPort = classifyRecorder({ ...host, ports: [37777] })
assert.equal(dvrPort?.kind, 'recorder')
assert.equal(dvrPort?.confidence, 'high')
assert.deepEqual(dvrPort?.reasons, ['37777'])

const namedRecorder = classifyRecorder({ ...host, name: 'lobby-nvr', ports: [554], services: ['rtsp'] })
assert.equal(namedRecorder?.kind, 'recorder')
assert.equal(namedRecorder?.confidence, 'high')
assert.deepEqual(namedRecorder?.reasons, ['lobby-nvr', 'Announced RTSP', '554'])

const mixed = classifyRecorder({ ...host, mac: 'ec:71:db:00:00:01', ports: [37777] })
assert.equal(mixed?.kind, 'camera')
assert.deepEqual(mixed?.reasons, ['Reolink', '37777'])

const home = planSubnet('192.168.1.20', 24)
assert.ok(home)
const quiet = assembleCatalog(home, new Set(), {}, { mac: null, name: null })
const found = applySightings(quiet, [{
  ip: '192.168.1.50',
  name: 'ipcam',
  services: ['rtsp', 'printer'],
  ports: [554, 80],
}])
const camera = found.hosts.find((item) => item.ip === '192.168.1.50')
assert.equal(camera?.present, true)
assert.equal(camera?.name, 'ipcam')
assert.deepEqual(camera?.services, ['rtsp'])
assert.deepEqual(camera?.ports, [554])
assert.equal(classifyRecorder(camera!)?.kind, 'camera')

const outside = applySightings(quiet, [{ ip: '10.0.0.5', name: 'ipcam', services: ['rtsp'], ports: [554] }])
assert.equal(outside.hosts.some((item) => item.ip === '10.0.0.5'), false)

const nameOnly = applySightings(quiet, [{ ip: '192.168.1.51', name: 'ipcam', services: [], ports: [] }])
assert.equal(nameOnly.hosts.find((item) => item.ip === '192.168.1.51')?.present, false)

const network = applySightings(quiet, [{ ip: '192.168.1.0', name: 'ipcam', services: ['rtsp'], ports: [554] }])
assert.equal(network.hosts.find((item) => item.ip === '192.168.1.0')?.present, false)

const device = applySightings(quiet, [{ ip: '192.168.1.20', name: 'ipcam', services: ['rtsp'], ports: [554] }])
assert.deepEqual(device.hosts.find((item) => item.ip === '192.168.1.20')?.services, [])

const known = assembleCatalog(home, new Set(['192.168.1.40']), {
  '192.168.1.40': { mac: 'aa:bb:cc:dd:ee:10', name: 'lobby' },
}, { mac: null, name: null })
const kept = applySightings(known, [
  { ip: '192.168.1.40', name: 'ipcam', services: ['onvif'], ports: [] },
  { ip: '192.168.1.40', name: 'other', services: [], ports: [37777] },
])
const lobby = kept.hosts.find((item) => item.ip === '192.168.1.40')
assert.equal(lobby?.name, 'lobby')
assert.deepEqual(lobby?.services, ['onvif'])
assert.deepEqual(lobby?.ports, [37777])

const saved = asSubnetCatalog({
  cidr: '192.168.1.0/24',
  interfacePrefix: 24,
  limited: false,
  checked: 1,
  hosts: [{
    ip: '192.168.1.50',
    role: 'host',
    present: true,
    mac: 'bc:ad:28:00:00:09',
    name: 'old-name',
  }],
})
assert.equal(saved?.internetRoute, false)
assert.deepEqual(saved?.hosts[0]?.services, [])
assert.deepEqual(saved?.hosts[0]?.ports, [])

const parsed = asSubnetCatalog({
  cidr: '192.168.1.0/24',
  interfacePrefix: 24,
  limited: false,
  checked: 1,
  internetRoute: true,
  hosts: [{
    ip: '192.168.1.50',
    role: 'host',
    present: true,
    mac: null,
    name: null,
    services: ['rtsp', 'airplay', 'onvif'],
    ports: [80, 554, 37777, 8554],
  }],
})
assert.equal(parsed?.internetRoute, true)
assert.deepEqual(parsed?.hosts[0]?.services, ['rtsp', 'onvif'])
assert.deepEqual(parsed?.hosts[0]?.ports, [554, 8554, 37777])

const query = encodeMdnsQuery('_rtsp._tcp.local')
assert.equal(parseMdnsPacket(query).length, 0)

const response = mdnsResponse()
const records = parseMdnsPacket(response)
assert.equal(records.length, 3)
const sightings = sightingsFromMdns(records)
assert.deepEqual(sightings, [{ ip: '192.168.1.50', name: 'ipcam', services: ['rtsp'], ports: [] }])

const compressed = sightingsFromMdns(parseMdnsPacket(compressedMdns()))
assert.equal(compressed[0]?.ip, '192.168.1.50')
assert.equal(compressed[0]?.services[0], 'onvif')

assert.equal(parseMdnsPacket(Uint8Array.from([1, 2, 3])).length, 0)
assert.deepEqual(sightingsFromMdns([{ name: 'phone.local', type: 1, ptr: null, target: null, ip: '192.168.1.9' }]), [])

const announced = parseSsdpMessage([
  'HTTP/1.1 200 OK',
  'LOCATION: http://192.168.1.50:80/onvif/device_service',
  'SERVER: Linux/3.10 UPnP/1.0 Hikvision/1.0',
  'ST: urn:schemas-onvif-org:device:NetworkVideoTransmitter:1',
  '',
].join('\r\n'))
assert.equal(announced?.ip, '192.168.1.50')
assert.deepEqual(announced?.services, ['onvif'])
assert.match(announced?.name ?? '', /Hikvision/)

const fromSource = parseSsdpMessage([
  'NOTIFY * HTTP/1.1',
  'SERVER: ipcam',
  'NT: upnp:rootdevice',
  '',
].join('\r\n'), '192.168.1.60')
assert.equal(fromSource?.ip, '192.168.1.60')
assert.deepEqual(fromSource?.services, [])

assert.equal(parseSsdpMessage([
  'HTTP/1.1 200 OK',
  'LOCATION: http://192.168.1.1:5000/rootDesc.xml',
  'SERVER: Linux/3.0 UPnP/1.0 MiniUPnPd/2.1',
  'ST: upnp:rootdevice',
  '',
].join('\r\n')), null)
assert.equal(parseSsdpMessage('camera'), null)

const marked = applySightings(quiet, announced ? [announced] : [])
assert.equal(marked.hosts.find((item) => item.ip === '192.168.1.50')?.present, true)

function mdnsResponse(): Uint8Array {
  const ptr = record(dns('_rtsp._tcp.local'), 12, dns('ipcam._rtsp._tcp.local'))
  const srv = record(dns('ipcam._rtsp._tcp.local'), 33, [...[0, 0, 0, 0, 0x02, 0x2a], ...dns('ipcam.local')])
  const address = record(dns('ipcam.local'), 1, [192, 168, 1, 50])
  return packet(3, [...ptr, ...srv, ...address])
}

function compressedMdns(): Uint8Array {
  const target = dns('ipcam.local')
  const ptr = record(dns('_onvif._tcp.local'), 12, dns('porch._onvif._tcp.local'))
  const targetAt = 12 + ptr.length + dns('porch._onvif._tcp.local').length + 10 + 6
  const srv = record(dns('porch._onvif._tcp.local'), 33, [0, 0, 0, 0, 0x02, 0x2a, ...target])
  const pointer = record([0xc0, targetAt], 1, [192, 168, 1, 50])
  return packet(3, [...ptr, ...srv, ...pointer])
}

function packet(answers: number, body: number[]): Uint8Array {
  return Uint8Array.from([
    0, 0,
    0x84, 0,
    0, 0,
    0, answers,
    0, 0,
    0, 0,
    ...body,
  ])
}

function record(name: number[], type: number, rdata: number[]): number[] {
  return [
    ...name,
    type >> 8, type & 0xff,
    0x00, 0x01,
    0, 0, 0, 120,
    rdata.length >> 8, rdata.length & 0xff,
    ...rdata,
  ]
}

function dns(name: string): number[] {
  const bytes: number[] = []
  for (const label of name.split('.')) {
    bytes.push(label.length)
    for (const char of label) bytes.push(char.charCodeAt(0))
  }
  bytes.push(0)
  return bytes
}
