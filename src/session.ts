const KEY = 'observer.session'

export function sessionToken(): string {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(KEY) ?? ''
}

export function setSession(token: string): void {
  localStorage.setItem(KEY, token)
}

export function clearSession(): void {
  localStorage.removeItem(KEY)
}
