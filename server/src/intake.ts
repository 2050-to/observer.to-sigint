import { asDeviceDetails, asSubnetCatalog } from '../../shared/ownedNetwork.js'
import { cityName, countryCode, regionText, zipCode, type PlaceQuery } from '../../shared/places.js'
import { cleanPostalCode } from '../../shared/postal.js'
import { ApiError } from './http.js'

export function asPlaceFilter(url: URL): PlaceQuery {
  const countryRaw = url.searchParams.get('country')
  const country = countryCode(countryRaw)
  if (countryRaw && !country) throw new ApiError(400, 'country must be a two-letter code')
  const regionRaw = url.searchParams.get('region') ?? url.searchParams.get('state')
  const region = regionRaw ? regionText(regionRaw) : null
  if (regionRaw && !region) throw new ApiError(400, 'region is invalid')
  const localityRaw = url.searchParams.get('locality') ?? url.searchParams.get('city')
  const locality = localityRaw ? cityName(localityRaw) : null
  if (localityRaw && !locality) throw new ApiError(400, 'locality is invalid')
  const postalRaw = url.searchParams.get('postal') ?? url.searchParams.get('zip')
  const postal = postalRaw ? zipCode(postalRaw) ?? cleanPostalCode(postalRaw) : null
  if (postalRaw && !postal) throw new ApiError(400, 'postal code is invalid')
  if (!country && !region && !locality && !postal) throw new ApiError(400, 'a place field is required')
  return { country, region, locality, postal, zip: postal, state: region, city: locality }
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

