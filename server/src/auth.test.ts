import assert from 'node:assert/strict'
import { appOrigin, signInUrl, signSession, verifySession } from './auth.js'

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
const flipped = signature.startsWith('a') ? `b${signature.slice(1)}` : `a${signature.slice(1)}`
assert.equal(await verifySession(`Bearer ${header}.${body}.${flipped}`), null)

const webLink = `${appOrigin()}/auth/verify?token=abc`
assert.equal(signInUrl(undefined, 'abc'), webLink)
assert.equal(signInUrl(null, 'abc'), webLink)
assert.equal(signInUrl('', 'abc'), webLink)
assert.equal(signInUrl('web', 'abc'), webLink)
assert.equal(signInUrl('mac', 'abc'), 'observer://auth/verify?token=abc')
assert.equal(signInUrl('mac', 'a b'), 'observer://auth/verify?token=a%20b')
assert.throws(() => signInUrl('android', 'abc'), /invalid client/)
assert.throws(() => signInUrl('https://evil.example/auth/verify', 'abc'), /invalid client/)

console.log('auth checks passed')
