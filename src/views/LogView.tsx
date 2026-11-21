import { catalogBundleCsv } from '../../shared/csv'
import { segmentSignals, SIGNAL_COLORS, SIGNAL_NAMES, stackSignals } from '../../shared/sources'
import { api } from '../api'
import { SignalStack } from '../SignalStack'
import type { CellRecord, DeviceRecord, Fix, MotionTrack, NetworkRecord, Room } from '../types'

export function LogView({
  count,
  openCount,
  networks,
  devices,
  cells,
  rooms,
  movers,
  phone,
  draftFor,
  rename,
}: {
  count: number
  openCount: number
  networks: NetworkRecord[]
  devices: DeviceRecord[]
  cells: CellRecord[]
  rooms: Room[]
  movers: MotionTrack[]
  phone: Fix | null
  draftFor: (id: string, fallback: string) => string
  rename: (id: string, value: string) => void
}) {
  const sections = segmentSignals(stackSignals({ networks, devices, cells, movers, phone }))

  async function download() {
    let blob: Blob
    try {
      blob = await api.csv()
    } catch {
      blob = new Blob([catalogBundleCsv(networks, { devices, cells, rooms })], { type: 'text/csv; charset=utf-8' })
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'wifi-networks.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="card">
      <h2>Catalog</h2>
      <p>{count} unique access points. {openCount} open names. {devices.length} Bluetooth advertisements. {cells.length} towers. {rooms.length} rooms.</p>
      <button type="button" onClick={() => void download()}>Download CSV</button>
      <div className="signal-groups">
        <h2>Datasources</h2>
        {sections.length === 0 && <p className="empty">No signals saved yet.</p>}
        {sections.map((section) => (
          <section key={section.kind}>
            <h3><i style={{ background: SIGNAL_COLORS[section.kind] }} />{SIGNAL_NAMES[section.kind]}</h3>
            <ul className="open-list">
              {section.devices.map((device) => (
                <li key={`${section.kind}:${device.id}`}>
                  <SignalStack id={device.id} fallback={device.label} signals={device.signals} draftFor={draftFor} rename={rename} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}
