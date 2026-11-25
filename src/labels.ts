import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { sessionToken } from './session'

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

function writeLabels(next: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // The names stay in memory for this page.
  }
}

function rowsOf(labels: Record<string, string>): { id: string; name: string }[] {
  return Object.entries(labels).flatMap(([id, name]) => (name.trim() ? [{ id, name }] : []))
}

export function useLabels() {
  const [labels, setLabels] = useState<Record<string, string>>(readLabels)

  useEffect(() => {
    if (!sessionToken()) return
    let stop = false
    void (async () => {
      const remote = await api.labels()
      if (stop) return
      if (remote.length === 0) {
        const local = rowsOf(readLabels())
        if (local.length === 0) return
        const saved = await api.saveLabels(local)
        if (stop) return
        const next = Object.fromEntries(saved.map((row) => [row.id, row.name]))
        writeLabels(next)
        setLabels(next)
        return
      }
      const next = Object.fromEntries(remote.map((row) => [row.id, row.name]))
      writeLabels(next)
      setLabels(next)
    })().catch(() => undefined)
    return () => {
      stop = true
    }
  }, [])

  const rename = useCallback((id: string, value: string) => {
    setLabels((current) => {
      const next = { ...current, [id]: value }
      writeLabels(next)
      if (sessionToken()) {
        void api.saveLabels([{ id, name: value }]).catch(() => undefined)
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
