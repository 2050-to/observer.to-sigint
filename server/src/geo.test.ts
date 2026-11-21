import assert from 'node:assert/strict'
import { addPostalCode, postalLabel, samePostalCell } from '../../shared/postal.js'
import { elevationFrom, postalCodeFrom } from './geocode.js'

assert.equal(elevationFrom({ elevation: [56.04] }), 56)
assert.equal(elevationFrom({ elevation: [56.05] }), 56.1)
assert.equal(elevationFrom({ elevation: [-10.04] }), -10)
assert.equal(elevationFrom({ elevation: [] }), null)
assert.equal(elevationFrom({ elevation: ['56'] }), null)
assert.equal(elevationFrom({ elevation: [Number.NaN] }), null)
assert.equal(elevationFrom({}), null)
assert.equal(elevationFrom(null), null)

assert.equal(postalCodeFrom({ address: { postcode: '98109' } }), '98109')
assert.equal(postalCodeFrom({ address: { postcode: '  SW1A  1AA ' } }), 'SW1A 1AA')
assert.equal(postalCodeFrom({ address: {} }), null)
assert.equal(postalCodeFrom({ address: { postcode: '   ' } }), null)
assert.equal(postalCodeFrom({}), null)
assert.equal(postalCodeFrom(null), null)

assert.deepEqual(addPostalCode(['98109'], '98109'), ['98109'])
assert.deepEqual(addPostalCode(['98109'], ' 98107 '), ['98109', '98107'])
assert.deepEqual(addPostalCode(['98109'], null), ['98109'])
assert.deepEqual(addPostalCode(['98109'], '   '), ['98109'])
assert.deepEqual(addPostalCode(undefined, null), [])

assert.equal(postalLabel(['98109']), 'ZIP 98109')
assert.equal(postalLabel(['98109', '98107-1234']), 'ZIPs 98109, 98107-1234')
assert.equal(postalLabel(['SW1A 1AA']), 'Postal code SW1A 1AA')
assert.equal(postalLabel(['98109', 'SW1A 1AA']), 'Postal codes 98109, SW1A 1AA')
assert.equal(postalLabel([]), null)

assert.equal(samePostalCell(47.6204, -122.3494, 47.6201, -122.3491), true)
assert.equal(samePostalCell(47.6204, -122.3494, 47.6214, -122.3494), false)
