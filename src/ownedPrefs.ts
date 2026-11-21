import {
  asDeviceDetails,
  asSubnetCatalog,
  type DeviceDetails,
  type OwnedConsent,
  type SubnetCatalog,
} from '../shared/ownedNetwork'

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

export function clearOwnedPrefs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // The in-memory toggles are cleared with it.
  }
}
