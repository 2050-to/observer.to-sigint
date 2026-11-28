export const TOS_VERSION = '2026-11-27.2'
export const PRIVACY_VERSION = '2026-11-27.4'

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function ageYears(bornOn: string, now = new Date()): number | null {
  const match = DATE.exec(bornOn)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const born = new Date(Date.UTC(year, month - 1, day))
  if (born.getUTCFullYear() !== year || born.getUTCMonth() !== month - 1 || born.getUTCDate() !== day) return null
  if (year < 1900) return null
  let age = now.getUTCFullYear() - year
  const nowMonth = now.getUTCMonth() + 1
  const nowDay = now.getUTCDate()
  if (nowMonth < month || (nowMonth === month && nowDay < day)) age -= 1
  return age
}

export function isAdult(bornOn: string, now = new Date()): boolean {
  const age = ageYears(bornOn, now)
  return age != null && age >= 18 && age <= 120
}

export function consentMatches(
  row: { tosVersion: string | null; privacyVersion: string | null; bornOn: string | null },
  now = new Date(),
): boolean {
  if (!row.bornOn || !isAdult(row.bornOn, now)) return false
  return row.tosVersion === TOS_VERSION && row.privacyVersion === PRIVACY_VERSION
}

export function routeNeedsConsent(method: string, pathname: string): boolean {
  if (pathname === '/health') return false
  if (pathname === '/api/legal') return false
  if (pathname.startsWith('/api/auth/')) return false
  if (pathname === '/api/billing/webhook') return false
  if (method === 'GET' && (pathname === '/api/me' || pathname === '/api/billing')) return false
  if (method === 'POST' && pathname === '/api/legal/accept') return false
  return pathname.startsWith('/api/')
}
