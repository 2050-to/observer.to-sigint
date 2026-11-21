import { useCallback, useState } from 'react'

const KEY = 'wifi-mapping-labels'

function readLabels(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch {
    return {}
  }
}

export function useLabels() {
  const [labels, setLabels] = useState<Record<string, string>>(readLabels)

  const rename = useCallback((id: string, value: string) => {
    setLabels((current) => {
      const next = { ...current, [id]: value }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        return next
      }
      return next
    })
  }, [])

  const nameFor = useCallback((id: string, fallback: string) => {
    const custom = labels[id]
    return custom && custom.trim() ? custom.trim() : fallback
  }, [labels])

  const nameForGroup = useCallback((ids: string[], fallback: string) => {
    const [id, ...older] = ids
    if (id !== undefined && Object.prototype.hasOwnProperty.call(labels, id)) return nameFor(id, fallback)
    return older.map((key) => labels[key]?.trim()).find(Boolean) ?? fallback
  }, [labels, nameFor])

  const draftFor = useCallback((id: string, fallback: string) => (
    Object.prototype.hasOwnProperty.call(labels, id) ? labels[id] : fallback
  ), [labels])

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(KEY)
    } catch {
      // The names are already dropped from the page.
    }
    setLabels({})
  }, [])

  return { nameFor, nameForGroup, draftFor, rename, clear }
}
