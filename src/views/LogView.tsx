import { catalogBundleCsv } from '../../shared/csv'
import { api } from '../api'
import type { CellRecord, DeviceRecord, NetworkRecord, Room } from '../types'

export function LogView({
  count,
  openCount,
  networks,
  devices,
  cells,
  rooms,
}: {
  count: number
  openCount: number
  networks: NetworkRecord[]
  devices: DeviceRecord[]
  cells: CellRecord[]
  rooms: Room[]
}) {
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
    </section>
  )
}
