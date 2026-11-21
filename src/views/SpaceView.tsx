import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { SIGNAL_COLORS, roomSignals } from '../../shared/sources'
import { estimateBuildings, STORY_HEIGHT_M, type PlanBuilding } from '../../shared/structure'
import { eastNorthMeters, floorLabel, gpsGround, plottedHeight, STORY_M, type PlottedHeight } from '../height'
import { SignalLegend, SignalStack } from '../SignalStack'
import { SECURITY_COLORS, type DeviceRecord, type MotionTrack, type NetworkRecord, type RangeSnapshot, type Room } from '../types'

interface PlotPoint {
  id: string
  label: string
  east: number
  north: number
  height: PlottedHeight
  color: string
  record: NetworkRecord | null
}

interface SceneLevel {
  id: string
  label: string
  index: number
  east: number
  north: number
  width: number
  depth: number
  rooms: {
    id: string
    label: string
    east: number
    north: number
    width: number
    depth: number
    color: string
  }[]
  walls: {
    id: string
    kind: 'exterior' | 'interior'
    east1: number
    north1: number
    east2: number
    north2: number
  }[]
}

interface SceneBuilding {
  id: string
  label: string
  east: number
  north: number
  width: number
  depth: number
  base: number
  top: number
  levels: SceneLevel[]
}

function boundsOf(points: { east: number; north: number }[]) {
  const easts = points.map((point) => point.east)
  const norths = points.map((point) => point.north)
  const minEast = Math.min(...easts)
  const maxEast = Math.max(...easts)
  const minNorth = Math.min(...norths)
  const maxNorth = Math.max(...norths)
  return {
    east: (minEast + maxEast) / 2,
    north: (minNorth + maxNorth) / 2,
    width: Math.max(maxEast - minEast, 2),
    depth: Math.max(maxNorth - minNorth, 2),
  }
}

function sceneBuildings(buildings: PlanBuilding[], origin: { lat: number; lon: number }, nameFor: (id: string, fallback: string) => string): SceneBuilding[] {
  return buildings.flatMap((building) => {
    if (building.lat == null || building.lon == null) return []
    const shift = eastNorthMeters(origin.lat, origin.lon, building.lat, building.lon)
    const levels = building.floors.map((floor) => {
      const rooms = floor.rooms.map((room) => ({
        id: room.id,
        label: nameFor(room.id, room.label),
        east: shift.east + room.east,
        north: shift.north + room.north,
        width: room.widthM,
        depth: room.depthM,
        color: SIGNAL_COLORS[room.originKind],
      }))
      const corners = rooms.flatMap((room) => ([
        { east: room.east - room.width / 2, north: room.north - room.depth / 2 },
        { east: room.east + room.width / 2, north: room.north + room.depth / 2 },
      ]))
      const box = boundsOf(corners)
      return {
        id: `${building.id}:floor:${floor.index}`,
        label: nameFor(`${building.id}:floor:${floor.index}`, floor.label),
        index: floor.index,
        ...box,
        rooms,
        walls: floor.walls.map((wall) => ({
          id: wall.id,
          kind: wall.kind,
          east1: shift.east + wall.east1,
          north1: shift.north + wall.north1,
          east2: shift.east + wall.east2,
          north2: shift.north + wall.north2,
        })),
      }
    })
    if (levels.length === 0) return []
    const shell = boundsOf(levels.flatMap((level) => ([
      { east: level.east - level.width / 2, north: level.north - level.depth / 2 },
      { east: level.east + level.width / 2, north: level.north + level.depth / 2 },
    ])))
    const indexes = levels.map((level) => level.index)
    return [{
      id: building.id,
      label: nameFor(building.id, building.label),
      ...shell,
      base: Math.min(...indexes) * STORY_HEIGHT_M,
      top: (Math.max(...indexes) + 1) * STORY_HEIGHT_M,
      levels,
    }]
  })
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
  devices = [],
  rooms = [],
  movers = [],
  nameFor,
  draftFor,
  rename,
}: {
  phone: RangeSnapshot['phone'] | null
  networks: NetworkRecord[]
  devices?: DeviceRecord[]
  rooms?: Room[]
  movers?: MotionTrack[]
  nameFor: (id: string, fallback: string) => string
  draftFor: (id: string, fallback: string) => string
  rename: (id: string, value: string) => void
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
    const structures = origin ? sceneBuildings(estimateBuildings(rooms, { networks, devices, phone }), origin, nameFor) : []
    if (!origin) return { points, unknown, phoneHeight, structures }
    for (const room of rooms) {
      if (room.lat == null || room.lon == null) continue
      const { east, north } = eastNorthMeters(origin.lat, origin.lon, room.lat, room.lon)
      if (Math.hypot(east, north) > 80) continue
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
      const label = nameFor(network.bssid, network.hidden || !network.ssid ? network.bssid : network.ssid)
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
    return { points, unknown, phoneHeight, structures }
  }, [devices, movers, nameFor, networks, phone, rooms])

  const floors = useMemo(
    () => [...new Set([
      ...model.points.flatMap((point) => (point.height.floor == null ? [] : [point.height.floor])),
      ...model.structures.flatMap((building) => building.levels.map((level) => level.index)),
    ])].sort((a, b) => a - b),
    [model.points, model.structures],
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
    const shownBuildings = model.structures.flatMap((building) => {
      const levels = building.levels.filter((level) => floor === 'all' || level.index === Number(floor))
      return levels.length > 0 ? [{ ...building, levels }] : []
    })
    const tag = (text: string, east: number, up: number, north: number) => {
      const node = document.createElement('div')
      node.className = 'floor-label'
      node.textContent = text
      const object = new CSS2DObject(node)
      object.position.set(east, up, north)
      scene.add(object)
    }
    for (const building of shownBuildings) {
      const shell = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(building.width, Math.max(building.top - building.base, STORY_M), building.depth)),
        new THREE.LineBasicMaterial({ color: 0xe7f0ea }),
      )
      shell.position.set(building.east, (building.base + building.top) / 2, building.north)
      scene.add(shell)
      tag(building.label, building.east, building.top + 1.2, building.north)
      for (const level of building.levels) {
        const slab = new THREE.Mesh(
          new THREE.BoxGeometry(level.width, 0.16, level.depth),
          new THREE.MeshStandardMaterial({ color: 0x315744, transparent: true, opacity: 0.45 }),
        )
        slab.position.set(level.east, level.index * STORY_M, level.north)
        slab.userData = { id: level.id }
        scene.add(slab)
        meshes.push(slab)
        tag(level.label, level.east - level.width / 2, level.index * STORY_M + 0.4, level.north - level.depth / 2)
        for (const room of level.rooms) {
          const box = new THREE.Mesh(
            new THREE.BoxGeometry(room.width, STORY_M * 0.82, room.depth),
            new THREE.MeshStandardMaterial({ color: room.color, transparent: true, opacity: 0.32, side: THREE.DoubleSide }),
          )
          box.position.set(room.east, level.index * STORY_M + STORY_M * 0.5, room.north)
          box.userData = { id: room.id }
          scene.add(box)
          meshes.push(box)
          tag(room.label, room.east, level.index * STORY_M + STORY_M * 0.95, room.north)
        }
        const wallGeometry = new THREE.BufferGeometry().setFromPoints(level.walls.flatMap((wall) => ([
          new THREE.Vector3(wall.east1, level.index * STORY_M + 0.2, wall.north1),
          new THREE.Vector3(wall.east2, level.index * STORY_M + 0.2, wall.north2),
        ])))
        scene.add(new THREE.LineSegments(wallGeometry, new THREE.LineBasicMaterial({ color: 0xe7f0ea })))
      }
    }

    const heights = visible.map((point) => point.height.meters)
    if (showPhone) heights.push(model.phoneHeight?.meters ?? 0)
    for (const building of shownBuildings) heights.push(building.top)
    const minY = Math.min(0, ...heights)
    const maxY = Math.max(STORY_M, ...heights)
    const span = Math.max(
      24,
      ...visible.map((point) => Math.hypot(point.east, point.north) * 2),
      ...shownBuildings.map((building) => (Math.hypot(building.east, building.north) + Math.max(building.width, building.depth)) * 2),
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
  }, [floor, model.phoneHeight, model.structures, visible])

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
        <p className="empty">Boxes are rooms, slabs are floors, and the wireframe is the building. East, north, and up are in meters.</p>
      </div>
      <SignalLegend />
      <div ref={host} className="space" />
      {visible.length === 0 && model.structures.length === 0 && <p className="empty">No networks with a height on this floor.</p>}
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
