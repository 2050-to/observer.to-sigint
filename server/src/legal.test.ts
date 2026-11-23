import assert from 'node:assert/strict'
import { ageYears, consentMatches, isAdult, routeNeedsConsent, PRIVACY_VERSION, TOS_VERSION } from '../../shared/legal.js'
import { stateCode, zipCode } from '../../shared/places.js'
import { dnsCaptureFilter, fromThisHost, parseDnsLine } from '../../shared/dns.js'

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
assert.equal(routeNeedsConsent('GET', '/api/dns'), true)
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

const line = '1700000000.1 IP 10.0.0.8.5353 > 1.1.1.1.53: 9+ A? only-a.example. (32)'
assert.deepEqual(parseDnsLine(line), { src: '10.0.0.8', name: 'only-a.example', type: 'A' })
assert.equal(parseDnsLine('IP 10.0.0.8.5353 > 1.1.1.1.53: 9+ A? printer.local. (20)'), null)
assert.equal(fromThisHost('10.0.0.8', ['10.0.0.8']), true)
assert.equal(fromThisHost('10.0.0.9', ['10.0.0.8']), false)
assert.equal(dnsCaptureFilter(['10.0.0.8', '192.168.1.4']), 'udp port 53 and ( src host 10.0.0.8 or src host 192.168.1.4 )')

console.log('legal checks passed')
