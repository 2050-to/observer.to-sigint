import assert from 'node:assert/strict'
import { heardPresence, newlyHeard, presenceKey } from '../../shared/presence.js'

const known = heardPresence(
  [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', hidden: false, bestRssi: -40, bestLat: 1, bestLon: 2 }],
  [{ address: '11:22:33:44:55:01', name: 'Badge', bestRssi: -50, bestLat: 1, bestLon: 2 }],
)
const knownIds = new Set(known.map(presenceKey))
assert.deepEqual(newlyHeard(knownIds, known), [])

const heard = heardPresence(
  [
    { bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office', hidden: false, bestRssi: -40, bestLat: 1, bestLon: 2 },
    { bssid: '11:22:33:44:55:66', ssid: 'Cafe', hidden: false, bestRssi: -55, bestLat: 1, bestLon: 2 },
  ],
  [
    { address: '11:22:33:44:55:01', name: 'Badge', bestRssi: -50, bestLat: 1, bestLon: 2 },
    { address: 'aa:bb:cc:dd:ee:99', name: 'Speaker', bestRssi: -60, bestLat: 1, bestLon: 2 },
  ],
)
const fresh = newlyHeard(knownIds, heard)
assert.deepEqual(fresh.map((hit) => hit.kind), ['ap', 'adv'])
assert.equal(fresh[0]?.label, 'Cafe')
assert.equal(fresh[1]?.label, 'Speaker')
assert.deepEqual(newlyHeard(new Set([...knownIds, ...fresh.map(presenceKey)]), heard), [])

console.log('presence checks passed')
