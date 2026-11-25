import assert from 'node:assert/strict'
import { diffOwnedInventory, ownedChangeText } from '../../shared/ownedDiff.js'
import type { SubnetHost } from '../../shared/ownedNetwork.js'

function host(ip: string, name: string | null, present = true): SubnetHost {
  return { ip, role: 'host', present, mac: null, name, services: [], ports: [] }
}

const baseline = [host('10.0.0.2', 'printer'), host('10.0.0.3', null)]
assert.deepEqual(diffOwnedInventory(null, baseline), [])

const next = [
  host('10.0.0.2', 'printer'),
  host('10.0.0.4', 'lobby camera'),
  host('10.0.0.3', 'front-desk'),
]
const changes = diffOwnedInventory(baseline, next)
assert.deepEqual(changes.map((change) => change.kind), ['new_address', 'recorder_appeared', 'new_name'])
assert.match(ownedChangeText(changes[1]), /Recorder name appeared: lobby camera/)

const gone = diffOwnedInventory(next, [host('10.0.0.2', 'printer')])
assert.equal(gone.some((change) => change.kind === 'recorder_disappeared' && change.ip === '10.0.0.4'), true)
assert.equal(gone.some((change) => change.kind === 'new_address'), false)

const quiet = diffOwnedInventory(
  [host('10.0.0.8', 'phone', false), host('10.0.0.9', 'switch')],
  [host('10.0.0.8', 'phone', true)],
)
assert.deepEqual(quiet.map((change) => change.kind), ['new_address'])

console.log('owned diff checks passed')
