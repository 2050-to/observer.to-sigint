import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

function keyFromEnv(name: string): Buffer {
  const raw = process.env[name]
  if (!raw) throw new Error(`missing ${name}`)
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error(`${name} must decode to 32 bytes`)
  return buf
}

export function dataKey(): Buffer {
  return keyFromEnv('DATA_KEY')
}

export function hmacKey(): Buffer {
  return keyFromEnv('HMAC_KEY')
}

export function bssidHmac(bssid: string): Buffer {
  return createHmac('sha256', hmacKey()).update(bssid.toLowerCase()).digest()
}

export function emailHmac(email: string): Buffer {
  return createHmac('sha256', hmacKey()).update(`email:${email.trim().toLowerCase()}`).digest()
}

export function encryptJson(value: unknown): { payload: Buffer; nonce: Buffer } {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', dataKey(), nonce)
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return { payload: Buffer.concat([body, tag]), nonce }
}

export function decryptJson<T>(payload: Buffer, nonce: Buffer): T {
  const raw = Buffer.from(payload)
  const iv = Buffer.from(nonce)
  if (raw.length < 16) throw new Error('ciphertext is too short')
  const tag = raw.subarray(raw.length - 16)
  const body = raw.subarray(0, raw.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', dataKey(), iv)
  decipher.setAuthTag(tag)
  const json = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  return JSON.parse(json) as T
}
