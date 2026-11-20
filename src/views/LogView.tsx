import { api } from '../api'

export function LogView({ count, openCount }: { count: number; openCount: number }) {
  async function download() {
    const blob = await api.csv()
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
