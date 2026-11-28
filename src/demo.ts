import { sessionToken } from './session'

const KEY = 'observer.demo'

export function isDemoMode(): boolean {
  if (typeof localStorage === 'undefined') return false
  if (sessionToken()) return false
  return localStorage.getItem(KEY) === '1'
}

export function enterDemo(): void {
  localStorage.setItem(KEY, '1')
}

export function clearDemo(): void {
  localStorage.removeItem(KEY)
}

export function leaveDemo(): void {
  clearDemo()
  window.location.assign(window.location.pathname || '/')
}

export function captureDemoQuery(): void {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  if (params.get('demo') !== '1') return
  if (!sessionToken()) localStorage.setItem(KEY, '1')
  params.delete('demo')
  const search = params.toString()
  const next = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`
  window.history.replaceState(null, '', next)
}
