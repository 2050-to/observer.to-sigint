import {
  asDeviceDetails,
  asSubnetCatalog,
  normalizeOwnedConsent,
  type DeviceDetails,
  type OwnedConsent,
  type SubnetCatalog,
} from '../shared/ownedNetwork'
import { api } from './api'
import { onMacApp, Wardrive } from './native/drive'
import { sessionToken } from './session'

const STORAGE_KEY = 'wifi-mapping.owned-network'

export interface OwnedPrefs extends OwnedConsent {
  catalog: SubnetCatalog | null
  device: DeviceDetails | null
}

export const EMPTY_OWNED: OwnedPrefs = {
  addresses: false,
  details: false,
  catalog: null,
  device: null,
}

export function readOwnedPrefs(): OwnedPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_OWNED
    const value = JSON.parse(raw) as Partial<OwnedPrefs>
    const addresses = value.addresses === true
    const details = addresses && value.details === true
    return {
      addresses,
      details,
      catalog: addresses ? asSubnetCatalog(value.catalog) : null,
      device: details ? asDeviceDetails(value.device) : null,
    }
  } catch {
    return EMPTY_OWNED
  }
}

export function writeOwnedPrefs(prefs: OwnedPrefs): void {
  const addresses = prefs.addresses === true
  const details = addresses && prefs.details === true
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      addresses,
      details,
      catalog: addresses ? prefs.catalog : null,
      device: details ? prefs.device : null,
    }))
  } catch {
    // The choice still applies until this window closes.
  }
}

export function clearOwnedPrefs(): Promise<void> {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // The in-memory toggles are cleared with it.
  }
  if (!onMacApp()) return Promise.resolve()
  return Wardrive.clearOwnedPrefs().catch(() => undefined)
}

export async function loadOwnedChoice(): Promise<OwnedConsent | null> {
  if (onMacApp()) return Wardrive.getOwnedPrefs()
  return readOwnedChoice()
}

export async function rememberOwnedChoice(choice: OwnedConsent): Promise<void> {
  const next = normalizeOwnedConsent(choice)
  const current = readOwnedPrefs()
  writeOwnedPrefs({
    addresses: next.addresses,
    details: next.details,
    catalog: next.addresses ? current.catalog : null,
    device: next.details ? current.device : null,
  })
  if (onMacApp()) await Wardrive.setOwnedPrefs(next)
}

export async function saveOwnedChoice(choice: OwnedConsent): Promise<void> {
  const next = normalizeOwnedConsent(choice)
  await rememberOwnedChoice(next)
  if (sessionToken()) await api.saveOwned(next)
}

export async function resolveOwnedPrefs(): Promise<OwnedPrefs> {
  const cached = readOwnedPrefs()
  const choice = await loadOwnedChoice()
  if (choice) {
    return {
      addresses: choice.addresses,
      details: choice.details,
      catalog: choice.addresses ? cached.catalog : null,
      device: choice.details ? cached.device : null,
    }
  }
  if (!sessionToken()) return EMPTY_OWNED
  try {
    const account = await api.me()
    const adopted = normalizeOwnedConsent(account.owned)
    if (!adopted.addresses && !adopted.details) return EMPTY_OWNED
    await rememberOwnedChoice(adopted)
    return { ...adopted, catalog: null, device: null }
  } catch {
    return EMPTY_OWNED
  }
}

function readOwnedChoice(): OwnedConsent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<OwnedPrefs>
    if (value.addresses !== true && value.addresses !== false) return null
    return normalizeOwnedConsent(value)
  } catch {
    return null
  }
}
