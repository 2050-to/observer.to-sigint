import { asDeviceDetails, asSubnetCatalog } from '../../shared/ownedNetwork.js'
import { cityName, stateCode, zipCode } from '../../shared/places.js'
import { ApiError } from './http.js'

export function asPlaceFilter(url: URL): { zip: string | null; state: string | null; city: string | null } {
  const zip = zipCode(url.searchParams.get('zip'))
  const state = stateCode(url.searchParams.get('state'))
  const city = cityName(url.searchParams.get('city'))
  if (url.searchParams.get('zip') && !zip) throw new ApiError(400, 'zip must be a US ZIP code')
  if (url.searchParams.get('state') && !state) throw new ApiError(400, 'state must be a US state')
  if (url.searchParams.get('city') && !city) throw new ApiError(400, 'city is invalid')
  if (!zip && !state && !city) throw new ApiError(400, 'zip, state, or city is required')
  return { zip, state, city }
}

export function asOwnedDevice(value: unknown) {
  const details = asDeviceDetails(value)
  if (!details) throw new ApiError(400, 'device details are invalid')
  return details
}

export function asOwnedLan(value: unknown) {
  const catalog = asSubnetCatalog(value)
  if (!catalog) throw new ApiError(400, 'network inventory is invalid')
  return catalog
}

