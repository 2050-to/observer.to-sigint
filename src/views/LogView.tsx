import { catalogCsv } from '../../shared/csv'
import { api } from '../api'
import type { NetworkRecord } from '../types'

export function LogView({ count, openCount, networks }: { count: number; openCount: number; networks: NetworkRecord[] }) {
  async function download() {
    let blob: Blob
    try {
      blob = await api.csv()
    } catch {
      blob = new Blob([catalogCsv(networks)], { type: 'text/csv; charset=utf-8' })
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
      <p>{count} unique access points. {openCount} open names.</p>
      <button type="button" onClick={() => void download()}>Download CSV</button>
    </section>
  )
}
