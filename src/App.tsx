import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { sampleScans } from './fixture'
import { onDevice, Wardrive } from './native/drive'
import type { MapState, NetworkRecord, OpenRow, RangeSnapshot } from './types'

const NO_HEARD: NetworkRecord[] = []
import { DriveMap } from './views/DriveMap'
import { LogView } from './views/LogView'
import { OpenList } from './views/OpenList'
import { RangeGraph } from './views/RangeGraph'
import { SpaceView } from './views/SpaceView'

type Tab = 'range' | 'map' | 'space' | 'open' | 'log'

const SPEEDS = [
  { id: 'walk', label: 'Slow walk', mps: 0.82 },
  { id: 'car', label: 'Car 85 mph', mps: 38 },
  { id: 'drone', label: 'Drone 100 mph', mps: 44.704 },
]

export function App() {
  const [tab, setTab] = useState<Tab>('range')
  const [range, setRange] = useState<RangeSnapshot | null>(null)
  const [map, setMap] = useState<MapState | null>(null)
  const [openRows, setOpenRows] = useState<OpenRow[]>([])
  const [count, setCount] = useState(0)
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(SPEEDS[2].mps)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [focus, setFocus] = useState<{ lat: number; lon: number; label: string } | null>(null)

  const refresh = useCallback(async () => {
    const [nextRange, nextMap, nextOpen, summary] = await Promise.all([
      api.range(),
      api.map(),
      api.open(),
      api.summary(),
    ])
    setRange(nextRange)
    setMap(nextMap)
    setOpenRows(nextOpen)
    setCount(summary.count)
  }, [])

  useEffect(() => {
    refresh().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'The catalog is unavailable')
    })
  }, [refresh])

  async function loadSample() {
    setError('')
    const scans = sampleScans(speed)
    let last: RangeSnapshot & { applied: boolean } | null = null
    for (const scan of scans) last = await api.scan(scan)
    await refresh()
    const kept = last?.heard.find((network) => network.bssid === 'aa:bb:cc:dd:ee:01')
    setNote(kept
      ? `Sample applied. Duplicate Cafe WiFi radio kept at ${kept.bestRssi} dBm, seen ${kept.seenCount} time${kept.seenCount === 1 ? '' : 's'}.`
      : 'Sample applied.')
  }

  async function toggleDrive() {
    setError('')
    if (running) {
      await Wardrive.stopDrive()
      setRunning(false)
      setNote('Drive stopped.')
      return
    }
    const token = import.meta.env.VITE_API_TOKEN ?? ''
    const apiUrl = onDevice()
      ? (import.meta.env.VITE_DEVICE_API_URL || 'https://127.0.0.1:9453')
      : window.location.origin
    await Wardrive.startDrive({ apiUrl, token })
    const status = await Wardrive.getStatus()
    setRunning(true)
    setNote(status.message)
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
        </div>
      </header>
      <section className="status">
        <span>Speed {range?.speedMps ?? 'unknown'} m/s</span>
        <span>Dwell {range ? range.dwellSeconds.toFixed(1) : '…'} s</span>
        <span>Scan every {range ? range.scanPeriodSeconds.toFixed(0) : '…'} s</span>
        <span>Radius {range ? range.radiusM.toFixed(0) : '…'} m</span>
        <span>{count} saved</span>
      </section>
      {note && <p className="note">{note}</p>}
      {error && <p className="warn">{error}</p>}
      <nav>
        {(['range', 'map', 'space', 'open', 'log'] as Tab[]).map((item) => (
          <button key={item} type="button" className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
            {item === 'range' ? 'In range' : item === 'map' ? 'Map' : item === 'space' ? 'Space' : item === 'open' ? 'Open' : 'Log'}
          </button>
        ))}
      </nav>
      {tab === 'range' && <RangeGraph heard={range?.heard ?? NO_HEARD} />}
      {tab === 'map' && <DriveMap map={map} focus={focus} onPlaceSaved={() => void refresh()} />}
      {tab === 'space' && <SpaceView phone={map?.phone ?? null} networks={map?.networks ?? []} />}
      {tab === 'open' && (
        <OpenList
          rows={openRows}
          onShow={(row) => {
            if (row.lat == null || row.lon == null) return
            setFocus({ lat: row.lat, lon: row.lon, label: row.label })
            setTab('map')
          }}
        />
      )}
      {tab === 'log' && <LogView count={count} openCount={openRows.length} />}
    </main>
  )
}
