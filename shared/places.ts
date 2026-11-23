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
