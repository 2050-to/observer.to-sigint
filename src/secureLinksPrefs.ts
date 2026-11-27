import { onMacApp, Wardrive } from './native/drive'

const STORAGE_KEY = 'wifi-mapping.secure-links'

export function readSecureAllowed(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const value = JSON.parse(raw) as { allowed?: unknown }
    return value.allowed === true
  } catch {
    return false
  }
}

function writeSecureAllowed(allowed: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ allowed: allowed === true }))
  } catch {
    // The choice still applies until this window closes.
  }
}

export async function loadSecureChoice(): Promise<boolean> {
  if (!onMacApp()) return readSecureAllowed()
  try {
    const saved = await Wardrive.getSecureLinks()
    writeSecureAllowed(saved.allowed === true)
    return saved.allowed === true
  } catch {
    return readSecureAllowed()
  }
}

export async function rememberSecureChoice(allowed: boolean): Promise<void> {
  const next = allowed === true
  writeSecureAllowed(next)
  if (onMacApp()) await Wardrive.setSecureLinks({ allowed: next })
}
