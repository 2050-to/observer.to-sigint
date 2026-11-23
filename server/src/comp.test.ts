import assert from 'node:assert/strict'
import { COMP_EMAILS, entitledStatus, isCompEmail } from './comp.js'

assert.deepEqual([...COMP_EMAILS], [
  'ben@2050.to',
  'alicia@2050.to',
  'vicanwulika@gmail.com',
])
assert.equal(isCompEmail('Ben@2050.to'), true)
assert.equal(isCompEmail(' alicia@2050.to '), true)
assert.equal(isCompEmail('vicanwulika@gmail.com'), true)
assert.equal(isCompEmail('other@2050.to'), false)
assert.equal(entitledStatus('ben@2050.to', null), 'active')
assert.equal(entitledStatus('ben@2050.to', 'disputed'), 'active')
assert.equal(entitledStatus('ben@2050.to', 'canceled'), 'active')
assert.equal(entitledStatus('ben@2050.to', 'refunded'), 'active')
assert.equal(entitledStatus('ben@2050.to', 'fraud_warning'), 'active')
assert.equal(entitledStatus('ben@2050.to', 'past_due'), 'active')
assert.equal(entitledStatus('person@example.com', null), 'none')
assert.equal(entitledStatus('person@example.com', 'active'), 'active')
assert.equal(entitledStatus('person@example.com', 'past_due'), 'past_due')
assert.equal(entitledStatus(null, null), 'none')

console.log('comp checks passed')
