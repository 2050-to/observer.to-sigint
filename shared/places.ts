const STATE_CODES: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
}

const CODES = new Set(Object.values(STATE_CODES))

export function isUnitedStates(countryCode: string | null | undefined): boolean {
  return countryCode?.trim().toUpperCase() === 'US'
}

export function stateCode(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ')
  if (!text || text.length > 40) return null
  if (/^[a-z]{2}$/.test(text)) {
    const code = text.toUpperCase()
    return CODES.has(code) ? code : null
  }
  return STATE_CODES[text] ?? null
}

export function zipCode(value: string | null | undefined): string | null {
  if (!value) return null
  const match = value.trim().match(/^(\d{5})(?:-\d{4})?$/)
  return match?.[1] ?? null
}

export function cityName(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.trim().replace(/\s+/g, ' ')
  if (!text || text.length > 80) return null
  return text
}

export function countryCode(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(text) ? text : null
}

export function regionText(value: string | null | undefined): string | null {
  const code = stateCode(value)
  if (code) return code
  return cityName(value)
}

export interface IndexedPlace {
  country: string
  region: string | null
  locality: string | null
  postal: string | null
  city: string | null
  state: string | null
  zip: string | null
}

export function indexedPlace(parts: {
  countryCode?: string | null
  state?: string | null
  city?: string | null
  postalCode?: string | null
  zip?: string | null
} | null | undefined, postalOf: (value: string | null | undefined) => string | null): IndexedPlace | null {
  const country = countryCode(parts?.countryCode)
  if (!country) return null
  const region = country === 'US' ? stateCode(parts?.state) : cityName(parts?.state)
  const locality = cityName(parts?.city)
  const rawPostal = parts?.postalCode ?? parts?.zip ?? null
  const postal = country === 'US' ? zipCode(rawPostal) ?? postalOf(rawPostal) : postalOf(rawPostal)
  return {
    country,
    region,
    locality,
    postal,
    city: locality,
    state: region,
    zip: postal,
  }
}

export interface PlaceQuery {
  country?: string | null
  region?: string | null
  locality?: string | null
  postal?: string | null
  zip?: string | null
  state?: string | null
  city?: string | null
}

export interface StoredPlaceFields {
  country?: string | null
  region?: string | null
  locality?: string | null
  postal?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}

export function storedPlace(fields: StoredPlaceFields): Omit<IndexedPlace, 'country'> & { country: string | null } {
  const region = fields.region || fields.state || null
  const locality = fields.locality || fields.city || null
  const postal = fields.postal || fields.zip || null
  const country = countryCode(fields.country) ?? (region || locality || postal ? 'US' : null)
  return { country, region, locality, postal, city: locality, state: region, zip: postal }
}

function sameText(left: string | null, right: string): boolean {
  return Boolean(left && left.trim().toLowerCase() === right.trim().toLowerCase())
}

export function regionMatches(stored: string | null, query: string): boolean {
  if (!stored) return false
  if (sameText(stored, query)) return true
  const left = stateCode(stored)
  const right = stateCode(query)
  if (left && right && left === right) return true
  if (left && sameText(left, query)) return true
  if (right && sameText(stored, right)) return true
  return false
}

export function postalMatches(stored: string | null, query: string): boolean {
  if (!stored) return false
  const left = zipCode(stored) ?? stored.trim()
  const right = zipCode(query) ?? query.trim()
  return left.toLowerCase() === right.toLowerCase()
}

export function placeMatches(fields: StoredPlaceFields, query: PlaceQuery): boolean {
  const place = storedPlace(fields)
  const country = countryCode(query.country)
  const region = query.region || query.state || null
  const locality = query.locality || query.city || null
  const postal = query.postal || query.zip || null
  if (country && place.country !== country) return false
  if (region && !regionMatches(place.region, region)) return false
  if (locality && !sameText(place.locality, locality)) return false
  if (postal && !postalMatches(place.postal, postal)) return false
  return true
}
