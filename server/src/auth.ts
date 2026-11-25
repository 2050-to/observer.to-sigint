import { createHmac, randomBytes, randomUUID } from 'node:crypto'
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
  const origin = (process.env.APP_ORIGIN || 'http://localhost:5173').replace(/\/$/, '')
  if (process.env.RENDER === 'true' && !origin.startsWith('https://')) {
    throw new Error('APP_ORIGIN must use https on Render')
  }
  return origin
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
  sid?: string,
): Promise<string> {
  return new SignJWT({ email: user.email, ...(sid ? { sid } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(jwtSecret())
}

export interface SessionClaims {
  id: string
  email: string
  sid: string | null
  iat: number | null
}

export async function readSession(header: string | undefined): Promise<SessionClaims | null> {
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ['HS256'] })
    if (!payload.sub || typeof payload.email !== 'string') return null
    return {
      id: payload.sub,
      email: payload.email,
      sid: typeof payload.sid === 'string' ? payload.sid : null,
      iat: typeof payload.iat === 'number' ? payload.iat : null,
    }
  } catch {
    return null
  }
}

export async function verifySession(header: string | undefined): Promise<{ id: string; email: string } | null> {
  const session = await readSession(header)
  if (!session) return null
  return { id: session.id, email: session.email }
}

export function sessionClient(value: unknown): 'web' | 'mac' | 'android' {
  if (value === 'mac' || value === 'android') return value
  return 'web'
}

export function sessionLabel(client: 'web' | 'mac' | 'android'): string {
  if (client === 'mac') return 'Mac'
  if (client === 'android') return 'Android'
  return 'Web'
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

export async function verifyLogin(store: Store, raw: unknown, client?: unknown): Promise<{ token: string; email: string }> {
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 200) throw new ApiError(401, 'unauthorized')
  const hmac = createHmac('sha256', hmacKey()).update(`login:${raw}`).digest()
  const user = await store.consumeLoginToken(hmac)
  if (!user) throw new ApiError(401, 'unauthorized')
  const kind = sessionClient(client)
  const sid = randomUUID()
  await store.createSession(user.id, sid, kind, sessionLabel(kind))
  return { token: await signSession(user, '30d', sid), email: user.email }
}
