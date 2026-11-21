import assert from 'node:assert/strict'
import { signSession, verifySession } from './auth.js'

process.env.JWT_SECRET ??= 'test-jwt-secret'

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'ada@example.com' }
const token = await signSession(user)
const session = await verifySession(`Bearer ${token}`)
assert.deepEqual(session, user)
assert.equal(await verifySession(undefined), null)
assert.equal(await verifySession('Bearer '), null)
assert.equal(await verifySession(`Bearer ${token}x`), null)

const expired = await signSession(user, Math.floor(Date.now() / 1000) - 10)
assert.equal(await verifySession(`Bearer ${expired}`), null)

const [header, body, signature] = token.split('.')
const flipped = signature.endsWith('a') ? `${signature.slice(0, -1)}b` : `${signature.slice(0, -1)}a`
assert.equal(await verifySession(`Bearer ${header}.${body}.${flipped}`), null)

console.log('auth checks passed')
