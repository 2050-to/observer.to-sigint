export const OBSERVATION_WINDOWS = [7, 30, 90] as const
export const DEFAULT_OBSERVATION_DAYS = 90
export const DEFAULT_REVIEW_DAYS = 365

export type ObservationWindow = (typeof OBSERVATION_WINDOWS)[number]

export function observationWindow(value: unknown): ObservationWindow | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return OBSERVATION_WINDOWS.find((days) => days === parsed) ?? null
}
