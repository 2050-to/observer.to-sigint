import { createHmac, randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { hmacKey } from './crypto.js'
import { ApiError } from './http.js'
import { sendEmail } from './mail.js'
import type { Store } from './store.js'

const recentLinks = new Map<string, number>()
const LINK_WINDOW_MS = 60_000
const LINK_TTL_MS = 15 * 60_000

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return null
  return email
}

export function appOrigin(): string {
  return (process.env.APP_ORIGIN || 'http://localhost:5173').replace(/\/$/, '')
}

function jwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('missing JWT_SECRET')
  return new TextEncoder().encode(secret)
}

export function loginToken(): { raw: string; hmac: Buffer } {
  const raw = randomBytes(32).toString('base64url')
  const hmac = createHmac('sha256', hmacKey()).update(`login:${raw}`).digest()
  return { raw, hmac }
}

export async function signSession(
  user: { id: string; email: string },
  expiresIn: string | number = '30d',
): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(jwtSecret())
}

export async function verifySession(header: string | undefined): Promise<{ id: string; email: string } | null> {
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ['HS256'] })
    if (!payload.sub || typeof payload.email !== 'string') return null
    return { id: payload.sub, email: payload.email }
  } catch {
    return null
  }
}

function linkLimited(email: string): boolean {
  const now = Date.now()
  const previous = recentLinks.get(email) ?? 0
  if (now - previous < LINK_WINDOW_MS) return true
  recentLinks.set(email, now)
  return false
}

function signInBase(client: unknown): string {
  if (client == null || client === '' || client === 'web') return `${appOrigin()}/auth/verify`
  if (client === 'mac') return 'observer://auth/verify'
  throw new ApiError(400, 'invalid client')
}

export function signInUrl(client: unknown, token: string): string {
  return `${signInBase(client)}?token=${encodeURIComponent(token)}`
}

export async function requestLogin(store: Store, email: string, client?: unknown): Promise<void> {
  const base = signInBase(client)
  if (linkLimited(email)) return
  try {
    await issueLogin(store, email, base)
  } catch (error) {
    recentLinks.delete(email)
    throw error
  }
}

async function issueLogin(store: Store, email: string, base: string): Promise<void> {
  const user = await store.upsertUser(email)
  const token = loginToken()
  await store.saveLoginToken(user.id, token.hmac, new Date(Date.now() + LINK_TTL_MS))
  const url = `${base}?token=${encodeURIComponent(token.raw)}`
  await sendEmail({
    to: email,
    subject: 'Sign in to Observer.to',
    text: [
      'Sign in to Observer.to.',
      '',
      'This link expires in 15 minutes and works once:',
      url,
      '',
      'If you did not ask for this, you can ignore this email.',
    ].join('\n'),
  })
}

export async function verifyLogin(store: Store, raw: unknown): Promise<{ token: string; email: string }> {
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 200) throw new ApiError(401, 'unauthorized')
  const hmac = createHmac('sha256', hmacKey()).update(`login:${raw}`).digest()
  const user = await store.consumeLoginToken(hmac)
  if (!user) throw new ApiError(401, 'unauthorized')
  return { token: await signSession(user), email: user.email }
}
