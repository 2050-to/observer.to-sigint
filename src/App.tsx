import { useCallback, useEffect, useRef, useState } from 'react'
import { useLabels } from './labels'
import { api } from './api'
import { sampleScans } from './fixture'
import { loadView, type RefreshMode } from './localCatalog'
import { onDevice, Wardrive } from './native/drive'
import { clearOwnedPrefs } from './ownedPrefs'
import type { EnrichmentQueueStatus, MapState, OpenRow, RangeSnapshot } from './types'
import { DriveMap } from './views/DriveMap'
import { LogView } from './views/LogView'
import { OwnedNetwork } from './views/OwnedNetwork'
import { OpenList } from './views/OpenList'
import { RangeGraph } from './views/RangeGraph'

type Tab = 'range' | 'map' | 'open' | 'log'

const SPEEDS = [
  { id: 'walk', label: 'Slow walk', mps: 0.82 },
  { id: 'car', label: 'Car 85 mph', mps: 38 },
  { id: 'drone', label: 'Drone 100 mph', mps: 44.704 },
]

const NO_HEARD: RangeSnapshot['heard'] = []

function deviceLabel(): string {
  if (typeof window !== 'undefined' && window.wifiMapping) return 'Mac'
  return 'device'
}

function waitingText(count: number): string {
  const noun = count === 1 ? 'scan' : 'scans'
  const pronoun = count === 1 ? 'It' : 'They'
  return `${count} ${noun} on this ${deviceLabel()}. ${pronoun} will sync when a saved network is in range.`
}

function syncedText(count: number): string {
  return `Synced ${count} scan${count === 1 ? '' : 's'}.`
}

function serverUnreachable(message: string): boolean {
  return /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|ECONNRESET|Failed to fetch|NetworkError|socket hang up|fetch failed|Internal Server Error/i.test(message)
}

export function App() {
  const [tab, setTab] = useState<Tab>('range')
  const [range, setRange] = useState<RangeSnapshot | null>(null)
  const [map, setMap] = useState<MapState | null>(null)
  const [openRows, setOpenRows] = useState<OpenRow[]>([])
  const [count, setCount] = useState(0)
  const [waiting, setWaiting] = useState(0)
  const [syncedCount, setSyncedCount] = useState(0)
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(SPEEDS[2].mps)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [enrichmentStatus, setEnrichmentStatus] = useState<EnrichmentQueueStatus | null>(null)
  const [focus, setFocus] = useState<{ lat: number; lon: number; label: string } | null>(null)
  const [eraseStep, setEraseStep] = useState<0 | 1 | 2>(0)
  const [erasing, setErasing] = useState(false)
  const [ownedReset, setOwnedReset] = useState(0)
  const { nameFor, draftFor, rename, clear } = useLabels()
  const queue = useRef(Promise.resolve())

  const refresh = useCallback((mode: RefreshMode) => {
    const run = queue.current.then(() => loadView(mode))
    queue.current = run.then(() => undefined, () => undefined)
    return run.then((view) => {
      setRange(view.range)
      setMap(view.map)
      setOpenRows(view.openRows)
      setCount(view.count)
      setWaiting(view.waiting)
      if (view.syncedNow > 0) setSyncedCount(view.syncedNow)
      setError('')
      void api.enrichmentStatus()
        .then(setEnrichmentStatus)
        .catch(() => setEnrichmentStatus(null))
    })
  }, [])

  useEffect(() => {
    if (!enrichmentStatus?.enabled || enrichmentStatus.pending + enrichmentStatus.processing === 0) return
    let stopped = false
    const previousComplete = enrichmentStatus.complete
    const previousActive = enrichmentStatus.pending + enrichmentStatus.processing
    const timer = window.setTimeout(() => {
      void api.enrichmentStatus().then(async (next) => {
        if (stopped) return
        setEnrichmentStatus(next)
        const nextActive = next.pending + next.processing
        if (next.complete > previousComplete || (previousActive > 0 && nextActive === 0)) await refresh('pull')
      }).catch(() => undefined)
    }, 3000)
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [enrichmentStatus, refresh])

  useEffect(() => {
    let stop = false
    void (async () => {
      const status = await Wardrive.getStatus()
      if (stop) return
      setRunning(status.running)
      await refresh(status.running ? 'local' : 'sync')
    })().catch((reason: unknown) => {
      if (!stop) setError(reason instanceof Error ? reason.message : 'The catalog is unavailable')
    })
    return () => {
      stop = true
    }
  }, [refresh])

  useEffect(() => {
    let stop = false
    const handles: { remove: () => Promise<void> }[] = []
    void Wardrive.addListener('scanQueued', () => {
      if (!stop) {
        void Wardrive.getStatus().then((status) => {
          if (status.running) setNote(status.message)
        })
        void refresh('local').catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : 'The catalog is unavailable')
        })
      }
    }).then((handle) => {
      if (stop) void handle.remove()
      else handles.push(handle)
    })
    void Wardrive.addListener('scansSynced', (event) => {
      setSyncedCount(event.count)
      if (!stop) void refresh('pull').catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'The catalog is unavailable')
      })
    }).then((handle) => {
      if (stop) void handle.remove()
      else handles.push(handle)
    })
    return () => {
      stop = true
      handles.forEach((handle) => void handle.remove())
    }
  }, [refresh])

  async function loadSample() {
    setError('')
    const scans = sampleScans(speed)
    try {
      let last: Awaited<ReturnType<typeof api.scan>> | null = null
      for (const scan of scans) last = await api.scan(scan)
      await refresh('sync')
      const kept = last?.heard.find((network) => network.bssid === 'aa:bb:cc:dd:ee:01')
      setNote(kept
        ? `Sample applied. Duplicate Cafe WiFi radio kept at ${kept.bestRssi} dBm, seen ${kept.seenCount} time${kept.seenCount === 1 ? '' : 's'}.`
        : 'Sample applied.')
    } catch {
      await Wardrive.enqueue({ scans: JSON.stringify(scans) })
      await refresh('local')
      setNote('Sample saved on this device. It will sync when a saved network is in range.')
    }
  }

  async function toggleDrive() {
    setError('')
    if (running) {
      await Wardrive.stopDrive()
      setRunning(false)
      setNote('Drive stopped.')
      await refresh('sync')
      return
    }
    const token = import.meta.env.VITE_API_TOKEN ?? ''
    const apiUrl = onDevice()
      ? (import.meta.env.VITE_DEVICE_API_URL || 'https://127.0.0.1:9453')
      : window.location.origin
    try {
      await Wardrive.startDrive({ apiUrl, token })
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The drive could not start')
      return
    }
    const status = await Wardrive.getStatus()
    setRunning(true)
    setNote(status.message)
  }

  async function eraseAll() {
    setErasing(true)
    setError('')
    let serverMissed = false
    try {
      const run = queue.current.then(async () => {
        const saved = await Wardrive.getLocalCatalog()
        const status = await Wardrive.getStatus()
        if (status.running) await Wardrive.stopDrive()
        await Wardrive.clearLocal()
        try {
          await api.reset()
          return false
        } catch (error) {
          const message = error instanceof Error ? error.message : ''
          if (serverUnreachable(message)) return true
          await Wardrive.replaceLocal({
            catalog: saved.catalog ?? '',
            journal: saved.journal ?? '[]',
          }).catch(() => undefined)
          throw error
        }
      })
      queue.current = run.then(() => undefined, () => undefined)
      serverMissed = await run
    } catch (reason: unknown) {
      setRunning(false)
      const raw = reason instanceof Error ? reason.message : ''
      await refresh('pull').catch(() => undefined)
      setError(raw && !serverUnreachable(raw) ? raw : 'Saved data could not be deleted. Nothing was removed.')
      return
    } finally {
      setErasing(false)
    }
    clear()
    clearOwnedPrefs()
    setOwnedReset((value) => value + 1)
    setRunning(false)
    setFocus(null)
    setSyncedCount(0)
    setEraseStep(0)
    setNote(serverMissed
      ? 'Saved data on this device was deleted. The server was not running, so any copy there is still stored.'
      : 'All saved data was deleted.')
    await refresh(serverMissed ? 'local' : 'pull').catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'The catalog is unavailable')
    })
  }

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Omnidirectional range</p>
          <h1>Wi-Fi Mapping</h1>
        </div>
        <div className="actions">
          <button type="button" onClick={() => void toggleDrive()}>{running ? 'Stop drive' : 'Start drive'}</button>
          {!onDevice() && (
            <>
              <label>
                Speed
                <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                  {SPEEDS.map((item) => <option key={item.id} value={item.mps}>{item.label}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => void loadSample().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Sample failed'))}>
                Load sample drive
              </button>
            </>
          )}
          {eraseStep === 0 && (
            <button type="button" className="danger" onClick={() => setEraseStep(1)}>Delete all data</button>
          )}
        </div>
      </header>
      {eraseStep > 0 && (
        <section className="confirm" role="alertdialog" aria-labelledby="erase-title">
          <div>
            <h2 id="erase-title">{eraseStep === 1 ? 'Delete all saved data?' : 'Delete everything permanently?'}</h2>
            <p>
              {eraseStep === 1
                ? 'This removes every saved network, scan, device, cell, and custom name on this device and on the server.'
                : 'There is no undo. The catalog will be empty, and a running drive will stop.'}
            </p>
          </div>
          <div className="actions">
            <button type="button" onClick={() => setEraseStep(0)} disabled={erasing}>Cancel</button>
            {eraseStep === 1 ? (
              <button type="button" className="danger" onClick={() => setEraseStep(2)}>Continue</button>
            ) : (
              <button type="button" className="danger" onClick={() => void eraseAll()} disabled={erasing}>
                {erasing ? 'Deleting…' : 'Delete everything'}
              </button>
            )}
          </div>
        </section>
      )}
      <section className="status">
        <span>Speed {range?.speedMps ?? 'unknown'} m/s</span>
        <span>Dwell {range ? range.dwellSeconds.toFixed(1) : '…'} s</span>
        <span>Scan every {range ? range.scanPeriodSeconds.toFixed(0) : '…'} s</span>
        <span>Radius {range ? range.radiusM.toFixed(0) : '…'} m</span>
        <span>{count} saved</span>
        {waiting > 0 && <span>{waitingText(waiting)}</span>}
        {waiting === 0 && syncedCount > 0 && <span>{syncedText(syncedCount)}</span>}
      </section>
      {note && <p className="note">{note}</p>}
      {error && <p className="warn">{error}</p>}
      <nav>
        {(['range', 'map', 'open', 'log'] as Tab[]).map((item) => (
          <button key={item} type="button" className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
            {item === 'range' ? 'In range' : item === 'map' ? 'Map' : item === 'open' ? 'Open' : 'Log'}
          </button>
        ))}
      </nav>
      {tab === 'range' && (
        <RangeGraph heard={range?.heard ?? NO_HEARD} nameFor={nameFor} draftFor={draftFor} rename={rename} />
      )}
      {tab === 'map' && (
        <DriveMap
          map={map}
          focus={focus}
          onPlaceSaved={() => void refresh(running ? 'pull' : 'sync')}
          nameFor={nameFor}
          draftFor={draftFor}
          rename={rename}
        />
      )}
      {tab === 'open' && (
        <OpenList
          rows={openRows}
          nameFor={nameFor}
          draftFor={draftFor}
          rename={rename}
          onShow={(row) => {
            if (row.lat == null || row.lon == null) return
            setFocus({ lat: row.lat, lon: row.lon, label: row.label })
            setTab('map')
          }}
        />
      )}
      {tab === 'log' && (
        <LogView
          count={count}
          openCount={openRows.length}
          networks={map?.networks ?? []}
          devices={map?.devices ?? []}
          cells={map?.cells ?? []}
          rooms={map?.rooms ?? []}
          movers={map?.movers ?? []}
          phone={map?.phone ?? null}
          history={range?.history ?? []}
          enrichmentStatus={enrichmentStatus}
          draftFor={draftFor}
          rename={rename}
        />
      )}
      <OwnedNetwork active={onDevice()} resetToken={ownedReset} />
    </main>
  )
}
