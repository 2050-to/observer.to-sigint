export const STORY_M = 3
export const CERTAIN_VERTICAL_M = 8

export interface HeightFix {
  altitudeM: number | null
  verticalAccuracyM: number | null
  relativeM: number | null
}

export interface PlottedHeight {
  meters: number
  source: 'barometer' | 'gps'
  floor: number | null
  uncertain: boolean
}

export function eastNorthMeters(
  originLat: number,
  originLon: number,
  lat: number,
  lon: number,
): { east: number; north: number } {
  const north = (lat - originLat) * 110540
  const east = (lon - originLon) * 111320 * Math.cos((originLat * Math.PI) / 180)
  return { east, north }
}

export function latLonFromEastNorth(
  originLat: number,
  originLon: number,
  east: number,
  north: number,
): { lat: number; lon: number } {
  return {
    lat: originLat + north / 110540,
    lon: originLon + east / (111320 * Math.cos((originLat * Math.PI) / 180)),
  }
}

export function gpsGround(points: { altitudeM: number | null }[]): number | null {
  let lowest: number | null = null
  for (const point of points) {
    if (point.altitudeM == null) continue
    lowest = lowest == null ? point.altitudeM : Math.min(lowest, point.altitudeM)
  }
  return lowest
}

export function plottedHeight(point: HeightFix, ground: number | null): PlottedHeight | null {
  if (point.relativeM != null) {
    return {
      meters: point.relativeM,
      source: 'barometer',
      floor: Math.round(point.relativeM / STORY_M),
      uncertain: false,
    }
  }
  if (point.altitudeM != null && ground != null) {
    const meters = point.altitudeM - ground
    const certain = point.verticalAccuracyM != null && point.verticalAccuracyM <= CERTAIN_VERTICAL_M
    return {
      meters,
      source: 'gps',
      floor: certain ? Math.round(meters / STORY_M) : null,
      uncertain: !certain,
    }
  }
  return null
}

export function floorLabel(height: PlottedHeight | null): string | null {
  if (height?.floor == null) return null
  return `Floor ${height.floor}`
}
