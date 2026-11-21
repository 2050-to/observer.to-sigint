import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { eastNorthMeters, floorLabel, gpsGround, plottedHeight, STORY_M, type PlottedHeight } from '../height'
import { SECURITY_COLORS, type MotionTrack, type NetworkRecord, type RangeSnapshot, type Room } from '../types'

interface PlotPoint {
  id: string
  label: string
  east: number
  north: number
  height: PlottedHeight
  color: string
  record: NetworkRecord | null
}

function originColor(kind: Room['originKind']): string {
  if (kind === 'wifi') return '#3d8bfd'
  if (kind === 'gps') return '#7dcea0'
  if (kind === 'cell') return '#e6a23c'
  return '#c9a0dc'
}

function bestFix(record: NetworkRecord) {
  return {
    altitudeM: record.bestAltitudeM ?? null,
    verticalAccuracyM: record.bestVerticalAccuracyM ?? null,
    relativeM: record.bestRelativeM ?? null,
  }
}

function phoneFix(phone: RangeSnapshot['phone']) {
  return {
    altitudeM: phone.altitudeM ?? null,
    verticalAccuracyM: phone.verticalAccuracyM ?? null,
    relativeM: phone.relativeM ?? null,
  }
}

export function SpaceView({
  phone,
  networks,
  rooms = [],
  movers = [],
}: {
  phone: RangeSnapshot['phone'] | null
  networks: NetworkRecord[]
  rooms?: Room[]
  movers?: MotionTrack[]
}) {
  const host = useRef<HTMLDivElement>(null)
  const [floor, setFloor] = useState<string>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectRef = useRef(setSelectedId)
  selectRef.current = setSelectedId

  const model = useMemo(() => {
    const located = networks.find((network) => network.bestLat != null && network.bestLon != null)
    const origin = phone?.lat != null && phone.lon != null
      ? { lat: phone.lat, lon: phone.lon }
      : located?.bestLat != null && located.bestLon != null
        ? { lat: located.bestLat, lon: located.bestLon }
        : null
    const fixes = [
      ...(phone ? [phoneFix(phone)] : []),
      ...networks.map(bestFix),
    ]
    const ground = gpsGround(fixes)
    const phoneHeight = phone ? plottedHeight(phoneFix(phone), ground) : null
    const points: PlotPoint[] = []
    const unknown: NetworkRecord[] = []
    const volumes: { id: string; east: number; north: number; radius: number; color: string }[] = []
    if (!origin) return { points, unknown, phoneHeight, volumes }
    for (const room of rooms) {
      if (room.lat == null || room.lon == null) continue
      const { east, north } = eastNorthMeters(origin.lat, origin.lon, room.lat, room.lon)
      if (Math.hypot(east, north) > 80) continue
      volumes.push({
        id: room.id,
        east,
        north,
        radius: Math.max(room.radiusM, 1),
        color: originColor(room.originKind),
      })
      for (const mover of movers) {
        if (mover.roomId !== room.id || mover.distanceM == null) continue
        const reach = Math.min(mover.distanceM, room.radiusM)
        points.push({
          id: mover.id,
          label: `${mover.label} · ${mover.kind}`,
          east: east + reach,
          north,
          height: phoneHeight ?? { meters: 1, source: 'barometer', floor: 0, uncertain: false },
          color: mover.kind === 'vehicle' ? '#e85d4c' : '#e6a23c',
          record: null,
        })
      }
    }
    for (const network of networks) {
      const height = plottedHeight(bestFix(network), ground)
      if (network.bestLat == null || network.bestLon == null || !height) {
        unknown.push(network)
        continue
      }
      const { east, north } = eastNorthMeters(origin.lat, origin.lon, network.bestLat, network.bestLon)
      const label = network.hidden || !network.ssid ? network.bssid : network.ssid
      points.push({
        id: network.bssid,
        label,
        east,
        north,
        height,
        color: SECURITY_COLORS[network.security],
        record: network,
      })
    }
    return { points, unknown, phoneHeight, volumes }
  }, [movers, networks, phone, rooms])

  const floors = useMemo(
    () => [...new Set(model.points.flatMap((point) => (point.height.floor == null ? [] : [point.height.floor])))].sort((a, b) => a - b),
    [model.points],
  )
  const visible = useMemo(
    () => model.points.filter((point) => floor === 'all' || point.height.floor === Number(floor)),
    [floor, model.points],
  )
  const selected = selectedId === 'phone'
    ? null
    : model.points.find((point) => point.id === selectedId) ?? null

  useEffect(() => {
    if (!selectedId) return
    const onThisFloor = selectedId === 'phone'
      ? floor === 'all' || model.phoneHeight?.floor === Number(floor)
      : visible.some((point) => point.id === selectedId)
    if (!onThisFloor) setSelectedId(null)
  }, [floor, model.phoneHeight, selectedId, visible])

  useEffect(() => {
    const node = host.current
    if (!node) return
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(0x1c2420)
    node.appendChild(renderer.domElement)

    const labels = new CSS2DRenderer()
    labels.domElement.style.position = 'absolute'
    labels.domElement.style.inset = '0'
    labels.domElement.style.pointerEvents = 'none'
    node.appendChild(labels.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 0.75))
    const sun = new THREE.DirectionalLight(0xffffff, 0.9)
    sun.position.set(30, 80, 20)
    scene.add(sun)

    const meshes: THREE.Mesh[] = []
    const showPhone = floor === 'all' || model.phoneHeight?.floor === Number(floor)
    const place = (id: string, east: number, up: number, north: number, color: string, radius: number) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 22, 16),
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.45,
          wireframe: id === 'phone',
        }),
      )
      mesh.position.set(east, up, north)
      mesh.userData = { id }
      scene.add(mesh)
      meshes.push(mesh)
      const drop = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(east, 0, north),
          new THREE.Vector3(east, up, north),
        ]),
        new THREE.LineBasicMaterial({ color: 0x3d4f46 }),
      )
      scene.add(drop)
    }

    for (const point of visible) {
      place(point.id, point.east, point.height.meters, point.north, point.color, 1.6)
    }
    if (showPhone) place('phone', 0, model.phoneHeight?.meters ?? 0, 0, '#7dcea0', 2.4)
    for (const volume of model.volumes) {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(volume.radius, volume.radius, 2.4, 28, 1, true),
        new THREE.MeshStandardMaterial({
          color: volume.color,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
        }),
      )
      mesh.position.set(volume.east, 1.2, volume.north)
      scene.add(mesh)
    }

    const heights = visible.map((point) => point.height.meters)
    if (showPhone) heights.push(model.phoneHeight?.meters ?? 0)
    const minY = Math.min(0, ...heights)
    const maxY = Math.max(STORY_M, ...heights)
    const span = Math.max(
      24,
      ...visible.map((point) => Math.hypot(point.east, point.north) * 2),
      ...model.volumes.map((volume) => (Math.hypot(volume.east, volume.north) + volume.radius) * 2),
    )
    for (let level = Math.floor(minY / STORY_M); level <= Math.ceil(maxY / STORY_M); level += 1) {
      const grid = new THREE.GridHelper(span, 6, 0x3d4f46, 0x2c3a33)
      grid.position.y = level * STORY_M
      scene.add(grid)
      const tag = document.createElement('div')
      tag.className = 'floor-label'
      tag.textContent = `Floor ${level}`
      const object = new CSS2DObject(tag)
      object.position.set(-span / 2, level * STORY_M, 0)
      scene.add(object)
    }

    const axis = (dir: THREE.Vector3, color: number, text: string) => {
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir]),
        new THREE.LineBasicMaterial({ color }),
      ))
      const tag = document.createElement('div')
      tag.className = 'floor-label'
      tag.textContent = text
      const object = new CSS2DObject(tag)
      object.position.copy(dir)
      scene.add(object)
    }
    axis(new THREE.Vector3(span * 0.4, 0, 0), 0xe85d4c, 'East')
    axis(new THREE.Vector3(0, Math.max(maxY, STORY_M * 2), 0), 0x7dcea0, 'Up')
    axis(new THREE.Vector3(0, 0, span * 0.4), 0x3d8bfd, 'North')

    const center = new THREE.Vector3(0, maxY / 2, 0)
    camera.position.set(span * 0.9, Math.max(span * 0.55, 16), span * 0.9)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(center)
    controls.update()

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const onClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(meshes)[0]
      const id = hit?.object.userData.id as string | undefined
      if (id) selectRef.current(id)
    }
    renderer.domElement.addEventListener('click', onClick)

    const resize = () => {
      const width = node.clientWidth
      const heightPx = node.clientHeight
      if (!width || !heightPx) return
      camera.aspect = width / heightPx
      camera.updateProjectionMatrix()
      renderer.setSize(width, heightPx)
      labels.setSize(width, heightPx)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(node)

    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      controls.update()
      renderer.render(scene, camera)
      labels.render(scene, camera)
    }
    tick()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('click', onClick)
      controls.dispose()
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry.dispose()
          const material = object.material
          if (Array.isArray(material)) material.forEach((item) => item.dispose())
          else material.dispose()
        }
      })
      renderer.dispose()
      node.replaceChildren()
    }
  }, [floor, model.phoneHeight, model.volumes, visible])

  const phoneSelected = selectedId === 'phone'
  const activeHeight = phoneSelected ? model.phoneHeight : selected?.height ?? null
  const source = activeHeight?.source === 'barometer' ? 'Barometer' : 'GPS'

  return (
    <div className="panel">
      <div className="actions">
        <label>
          Floor
          <select value={floor} onChange={(event) => setFloor(event.target.value)}>
            <option value="all">All floors</option>
            {floors.map((level) => <option key={level} value={level}>Floor {level}</option>)}
          </select>
        </label>
        <p className="empty">East, north, and up are in meters. Floor lines are 3 m apart.</p>
      </div>
      <div ref={host} className="space" />
      {visible.length === 0 && <p className="empty">No networks with a height on this floor.</p>}
      <div className="actions">
        {model.phoneHeight && (
          <button type="button" onClick={() => setSelectedId('phone')}>
            This phone · {floorLabel(model.phoneHeight) ?? 'Height uncertain'}
          </button>
        )}
        {visible.map((point) => (
          <button key={point.id} type="button" onClick={() => setSelectedId(point.id)}>
            {point.label} · {floorLabel(point.height) ?? 'Height uncertain'}
          </button>
        ))}
      </div>
      {(selected || phoneSelected) && (
        <article className="card">
          <h2>{phoneSelected ? 'This phone' : selected?.label}</h2>
          {selected?.record && (
            <p>{selected.record.security} · best {selected.record.bestRssi} dBm · {selected.record.bssid}</p>
          )}
          {activeHeight && <p>{activeHeight.meters.toFixed(1)} m up</p>}
          <p>{floorLabel(activeHeight) ?? 'Height uncertain'}</p>
          {activeHeight && <p>{source}</p>}
        </article>
      )}
      {model.unknown.length > 0 && (
        <p className="empty">
          No height: {model.unknown.map((network) => network.ssid || network.bssid).join(', ')}
        </p>
      )}
    </div>
  )
}
