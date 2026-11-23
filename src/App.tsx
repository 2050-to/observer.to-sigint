import { useCallback, useEffect, useRef, useState } from 'react'
import { useLabels } from './labels'
import { api } from './api'
import { AccountBar, UpgradeBanner, alertLabel, useAccount } from './AccountBar'
import { sessionToken } from './session'
import { loadView, type RefreshMode } from './localCatalog'
import { AskBox, type AskDataset } from './AskBox'
import { onDevice, onMacApp, promptLocation, Wardrive } from './native/drive'
import { clearOwnedPrefs } from './ownedPrefs'
import type { EnrichmentQueueStatus, MapState, OpenRow, RangeSnapshot } from './types'
import { DriveMap } from './views/DriveMap'
import { LogView } from './views/LogView'
import { OwnedNetwork } from './views/OwnedNetwork'
import { OpenList } from './views/OpenList'
import { RangeGraph } from './views/RangeGraph'
import { RecordView } from './views/RecordView'

type Tab = 'range' | 'map' | 'open' | 'log' | 'search' | 'browsing'

const TABS: { id: Tab; label: string }[] = [
  { id: 'range', label: 'In range' },
  { id: 'map', label: 'Map' },
  { id: 'open', label: 'Open' },
  { id: 'log', label: 'Log' },
  { id: 'search', label: 'Search history' },
  { id: 'browsing', label: 'Browsing history' },
]

const NO_HEARD: RangeSnapshot['heard'] = []
const NO_DEVICES: RangeSnapshot['heardDevices'] = []
const NO_ACCESS_POINTS: MapState['accessPoints'] = []
const NO_ADVERTISERS: MapState['advertisers'] = []

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

function driveError(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : 'The drive could not start'
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
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
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [enrichmentStatus, setEnrichmentStatus] = useState<EnrichmentQueueStatus | null>(null)
  const [focus, setFocus] = useState<{ lat: number; lon: number; label: string } | null>(null)
  const [eraseStep, setEraseStep] = useState<0 | 1 | 2>(0)
  const [erasing, setErasing] = useState(false)
  const [ownedReset, setOwnedReset] = useState(0)
  const macApp = onMacApp()
  const [askDataset, setAskDataset] = useState<AskDataset>('wifi')
  const { nameFor, nameForGroup, draftFor, rename, clear } = useLabels()
  const account = useAccount()
  const queue = useRef(Promise.resolve())
  const billing = new URLSearchParams(window.location.search).get('billing')

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
      if (!sessionToken()) {
        setEnrichmentStatus(null)
        return
      }
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
    if (tab === 'map') setAskDataset('wifi')
    else if (tab === 'search') setAskDataset('search')
    else if (tab === 'browsing') setAskDataset('browsing')
  }, [tab])

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

  async function toggleDrive() {
    setError('')
    if (running) {
      await Wardrive.stopDrive()
      setRunning(false)
      setNote('Drive stopped.')
      await refresh('sync')
      return
    }
    const token = sessionToken()
    const configured = import.meta.env.VITE_DEVICE_API_URL
    const deviceApi = configured?.startsWith('https://')
      ? configured
      : (import.meta.env.DEV ? 'https://127.0.0.1:9453' : 'https://observer.to')
    const macApi = onMacApp() ? await Wardrive.apiOrigin() : ''
    const apiUrl = onDevice()
      ? (macApi.startsWith('https://') ? macApi : deviceApi)
      : window.location.origin
    try {
      await Wardrive.startDrive({ apiUrl, token })
    } catch (reason: unknown) {
      setError(driveError(reason))
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
        if (!sessionToken()) return true
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
      ? sessionToken()
        ? 'Saved data on this device was deleted. The server was not running, so any copy there is still stored.'
        : 'Saved data on this device was deleted.'
      : 'All saved data was deleted.')
    await refresh(serverMissed ? 'local' : 'pull').catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'The catalog is unavailable')
    })
  }

  return (
    <main className={macApp ? 'observer mac-app' : 'observer'}>
      <UpgradeBanner account={account} />
      <header>
        <div>
          <p className="eyebrow">Omnidirectional range</p>
          <h1>Observer.to</h1>
        </div>
        {account && <AccountBar account={account} />}
        <div className="actions">
          {onDevice() ? (
            <button type="button" onClick={() => void toggleDrive()}>{running ? 'Stop drive' : 'Start drive'}</button>
          ) : (
            <p className="note">Wi-Fi, Bluetooth, GPS, search history, and browsing history are captured by the Mac app. This site shows what that app has already uploaded.</p>
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
                ? 'This removes every saved network, scan, device, cell, import, and custom name on this device and on the server.'
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
        <span>{map?.accessPoints.length ?? 0} access points</span>
        {waiting > 0 && <span>{waitingText(waiting)}</span>}
        {waiting === 0 && syncedCount > 0 && <span>{syncedText(syncedCount)}</span>}
      </section>
      {billing === 'success' && account && account.alerts.status !== 'active' && (
        <p className="note">Stripe has not confirmed the subscription yet. Alerts turn on after that confirmation, not from this page.</p>
      )}
      {billing === 'cancel' && <p className="note">Checkout was canceled. {account ? alertLabel(account.alerts.status) : 'Weekly alerts stay off.'}</p>}
      {note.includes('Allow Location') ? (
        <div className="prompt location-prompt" role="alertdialog" aria-labelledby="location-prompt-title">
          <div>
            <h3 id="location-prompt-title">Allow Location</h3>
            <p>{note}</p>
          </div>
          <div className="actions">
            <button type="button" onClick={() => promptLocation()}>Allow Location</button>
          </div>
        </div>
      ) : note && <p className="note">{note}</p>}
      {error && <p className="warn">{error}</p>}
      <nav>
        {TABS.map((item) => (
          <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="workspace">
      <div className="stage">
      {tab === 'range' && (
        <RangeGraph
          heard={range?.heard ?? NO_HEARD}
          devices={range?.heardDevices ?? NO_DEVICES}
          accessPoints={map?.accessPoints ?? NO_ACCESS_POINTS}
          advertisers={map?.advertisers ?? NO_ADVERTISERS}
          nameFor={nameFor}
          nameForGroup={nameForGroup}
          draftFor={draftFor}
          rename={rename}
        />
      )}
      {tab === 'map' && (
        <DriveMap
          map={map}
          focus={focus}
          onPlaceSaved={() => void refresh(running ? 'pull' : 'sync')}
          subscribed={account?.alerts.status === 'active'}
          nameFor={nameFor}
          nameForGroup={nameForGroup}
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
          accessPoints={map?.accessPoints ?? []}
          devices={map?.devices ?? []}
          advertisers={map?.advertisers ?? []}
          cells={map?.cells ?? []}
          rooms={map?.rooms ?? []}
          movers={map?.movers ?? []}
          phone={map?.phone ?? null}
          history={range?.history ?? []}
          enrichmentStatus={enrichmentStatus}
          nameForGroup={nameForGroup}
          draftFor={draftFor}
          rename={rename}
        />
      )}
      {tab === 'search' && <RecordView kind="search" subscribed={account?.alerts.status === 'active'} />}
      {tab === 'browsing' && <RecordView kind="browsing" subscribed={account?.alerts.status === 'active'} />}
      <OwnedNetwork active={onDevice()} resetToken={ownedReset} />
      </div>
      {macApp && (
        <AskBox layout="rail" dataset={askDataset} subscribed={account?.alerts.status === 'active'} />
      )}
      </div>
    </main>
  )
}
