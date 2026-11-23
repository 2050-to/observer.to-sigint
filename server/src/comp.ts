export const COMP_EMAILS = [
  'ben@2050.to',
  'alicia@2050.to',
  'vicanwulika@gmail.com',
] as const

export function isCompEmail(email: string): boolean {
  return (COMP_EMAILS as readonly string[]).includes(email.trim().toLowerCase())
}

export function entitledStatus(email: string | null | undefined, status: string | null | undefined): string {
  if (email && isCompEmail(email)) return 'active'
  if (!status || !status.trim()) return 'none'
  return status
}
