import L from 'leaflet'

const CACHE_NAME = 'wifi-mapping-tiles'
const TILE_CAP = 2000

async function showTile(img: HTMLImageElement, url: string): Promise<void> {
  const cache = 'caches' in window ? await caches.open(CACHE_NAME) : null
  if (cache && !navigator.onLine) {
    const cached = await cache.match(url)
    if (!cached) throw new Error('tile unavailable')
    img.src = URL.createObjectURL(await cached.blob())
    return
  }
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error('tile unavailable')
    if (cache) {
      await cache.put(url, response.clone())
      const keys = await cache.keys()
      if (keys.length > TILE_CAP) {
        const extra = keys.length - TILE_CAP
        for (let index = 0; index < extra; index += 1) await cache.delete(keys[index])
      }
    }
    img.src = URL.createObjectURL(await response.blob())
  } catch (error) {
    if (cache) {
      const cached = await cache.match(url)
      if (cached) {
        img.src = URL.createObjectURL(await cached.blob())
        return
      }
    }
    throw error
  }
}

const CachingTiles = L.TileLayer.extend({
  createTile(this: L.TileLayer, coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const img = document.createElement('img')
    const url = this.getTileUrl(coords)
    void showTile(img, url).then(
      () => done(undefined as unknown as Error, img),
      () => done(new Error('tile unavailable'), img),
    )
    return img
  },
  _removeTile(this: L.TileLayer, key: string) {
    const tiles = (this as unknown as { _tiles?: Record<string, { el?: HTMLImageElement }> })._tiles
    const src = tiles?.[key]?.el?.src
    const parent = L.TileLayer.prototype as unknown as { _removeTile(key: string): void }
    parent._removeTile.call(this, key)
    if (src?.startsWith('blob:')) URL.revokeObjectURL(src)
  },
}) as { new (url: string, options?: L.TileLayerOptions): L.TileLayer }

export function streetTiles(): L.TileLayer {
  return new CachingTiles('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  })
}
