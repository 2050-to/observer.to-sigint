import assert from 'node:assert/strict'
import { ageYears, consentMatches, isAdult, routeNeedsConsent, PRIVACY_VERSION, TOS_VERSION } from '../../shared/legal.js'
import { stateCode, zipCode } from '../../shared/places.js'

const now = new Date('2026-11-23T12:00:00Z')
assert.equal(ageYears('2000-01-01', now), 26)
assert.equal(isAdult('2008-11-23', now), true)
assert.equal(isAdult('2008-11-24', now), false)
assert.equal(isAdult('2015-06-01', now), false)
assert.equal(ageYears('2020-02-31', now), null)
assert.equal(consentMatches({
  bornOn: '1990-05-01',
  tosVersion: TOS_VERSION,
  privacyVersion: PRIVACY_VERSION,
}, now), true)
assert.equal(consentMatches({
  bornOn: '1990-05-01',
  tosVersion: 'old',
  privacyVersion: PRIVACY_VERSION,
}, now), false)
assert.equal(consentMatches({
  bornOn: '2015-01-01',
  tosVersion: TOS_VERSION,
  privacyVersion: PRIVACY_VERSION,
}, now), false)

assert.equal(routeNeedsConsent('GET', '/api/map'), true)
assert.equal(routeNeedsConsent('GET', '/api/search-history'), true)
assert.equal(routeNeedsConsent('POST', '/api/ask'), true)
assert.equal(routeNeedsConsent('GET', '/api/me'), false)
assert.equal(routeNeedsConsent('GET', '/api/legal'), false)
assert.equal(routeNeedsConsent('POST', '/api/legal/accept'), false)
assert.equal(routeNeedsConsent('POST', '/api/auth/verify'), false)
assert.equal(routeNeedsConsent('GET', '/health'), false)

assert.equal(stateCode('wa'), 'WA')
assert.equal(stateCode('Washington'), 'WA')
assert.equal(stateCode('France'), null)
assert.equal(zipCode('98109-1234'), '98109')
assert.equal(zipCode('ABCDE'), null)

console.log('legal checks passed')
