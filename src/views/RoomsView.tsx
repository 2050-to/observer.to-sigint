import { SIGNAL_COLORS, moverSignals, roomSignals, stackFor, stackSignals } from '../../shared/sources'
import { estimateBuildings, type PlanFloor, type PlanWall } from '../../shared/structure'
import { LabelField, SignalLegend, SignalStack } from '../SignalStack'
import type { CellRecord, DeviceRecord, Fix, MotionTrack, NetworkRecord, Room } from '../types'

function angleFor(id: string): number {
  let hash = 0
  for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0
  return ((hash % 360) * Math.PI) / 180
}

function latestDistance(device: DeviceRecord): number | null {
  const last = device.observations?.[device.observations.length - 1]
  return last?.distanceM ?? null
}

function FloorPlan({
  floor,
  nameFor,
}: {
  floor: PlanFloor
  nameFor: (id: string, fallback: string) => string
}) {
  let minEast = Infinity
  let maxEast = -Infinity
  let minNorth = Infinity
  let maxNorth = -Infinity
  for (const wall of floor.walls) {
    minEast = Math.min(minEast, wall.east1, wall.east2)
    maxEast = Math.max(maxEast, wall.east1, wall.east2)
    minNorth = Math.min(minNorth, wall.north1, wall.north2)
    maxNorth = Math.max(maxNorth, wall.north1, wall.north2)
  }
  const pad = Math.max(1, Math.max(maxEast - minEast, maxNorth - minNorth) * 0.12)
  minEast -= pad
  maxEast += pad
  minNorth -= pad
  maxNorth += pad
  const spanEast = Math.max(maxEast - minEast, 1)
  const spanNorth = Math.max(maxNorth - minNorth, 1)
  const width = 720
  const height = Math.max(240, Math.min(560, (width * spanNorth) / spanEast))
  const xFor = (east: number) => ((east - minEast) / spanEast) * (width - 28) + 14
  const yFor = (north: number) => height - (((north - minNorth) / spanNorth) * (height - 28) + 14)
  return (
    <svg className="plan" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${floor.label} plan`}>
      {floor.rooms.map((room) => {
        const left = xFor(room.east - room.widthM / 2)
        const top = yFor(room.north + room.depthM / 2)
        const right = xFor(room.east + room.widthM / 2)
        const bottom = yFor(room.north - room.depthM / 2)
        return (
          <rect
            key={room.id}
            x={left}
            y={top}
            width={Math.max(right - left, 1)}
            height={Math.max(bottom - top, 1)}
            fill={SIGNAL_COLORS[room.originKind]}
            opacity={0.2}
          />
        )
      })}
      {floor.walls.map((wall) => (
        <WallLine key={wall.id} wall={wall} xFor={xFor} yFor={yFor} />
      ))}
      {floor.rooms.map((room) => (
        <text key={`${room.id}-label`} x={xFor(room.east)} y={yFor(room.north + room.depthM / 2) + 16} fill="#e7f0ea" fontSize="13" textAnchor="middle">
          {nameFor(room.id, room.label)}
        </text>
      ))}
    </svg>
  )
}

function WallLine({
  wall,
  xFor,
  yFor,
}: {
  wall: PlanWall
  xFor: (east: number) => number
  yFor: (north: number) => number
}) {
  const name = wall.kind === 'exterior' ? 'Exterior wall' : 'Interior wall'
  return (
    <line
      x1={xFor(wall.east1)}
      y1={yFor(wall.north1)}
      x2={xFor(wall.east2)}
      y2={yFor(wall.north2)}
      stroke={wall.kind === 'exterior' ? '#e7f0ea' : '#8aa398'}
      strokeWidth={wall.kind === 'exterior' ? 3 : 1.5}
      strokeDasharray={wall.kind === 'interior' ? '7 5' : undefined}
    >
      <title>{name}</title>
    </line>
  )
}

export function RoomsView({
  rooms,
  movers,
  devices,
  networks,
  cells,
  phone,
  onShow,
  nameFor,
  draftFor,
  rename,
}: {
  rooms: Room[]
  movers: MotionTrack[]
  devices: DeviceRecord[]
  networks: NetworkRecord[]
  cells: CellRecord[]
  phone: Fix | null
  onShow?: (point: { lat: number; lon: number; label: string }) => void
  nameFor: (id: string, fallback: string) => string
  draftFor: (id: string, fallback: string) => string
  rename: (id: string, value: string) => void
}) {
  const width = 420
  const center = width / 2
  const scale = (width / 2 - 28) / 30
  const stacks = stackSignals({ networks, devices, cells, movers, phone })
  const buildings = estimateBuildings(rooms, { networks, devices, phone })
  const blips = devices.flatMap((device) => {
    const distance = latestDistance(device)
    if (distance == null) return []
    const angle = angleFor(device.address)
    const radius = Math.min(distance, 30) * scale
    const trail = (device.observations ?? []).slice(-4).map((observation) => {
      const reach = Math.min(observation.distanceM ?? distance, 30) * scale
      return { x: center + Math.cos(angle) * reach, y: center + Math.sin(angle) * reach }
    })
    const stack = stackFor(stacks, device.address)
    return [{
      id: device.address,
      label: nameFor(stack?.id ?? device.address, device.name || device.address),
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
      trail,
      color: stack && stack.signals.some((signal) => signal.kind === 'gps') ? SIGNAL_COLORS.gps : SIGNAL_COLORS.bluetooth,
    }]
  })

  return (
    <div className="panel">
      <p className="empty">Labels describe anonymous motion in this survey. They are not a person's identity. Solid lines are estimated exterior walls. Dashed lines are shared interior walls.</p>
      <SignalLegend />
      {buildings.length === 0 && <p className="empty">No Bluetooth, Wi-Fi, GPS, or cell signal yet.</p>}
      {buildings.map((building) => (
        <section key={building.id} className="building">
          <h2>
            <LabelField id={building.id} fallback={building.label} draftFor={draftFor} rename={rename} />
          </h2>
          {building.floors.map((floor) => (
            <div key={floor.index}>
              <h3>
                <LabelField id={`${building.id}:floor:${floor.index}`} fallback={floor.label} draftFor={draftFor} rename={rename} />
              </h3>
              <p className="floor-note">{floor.rooms.length} {floor.rooms.length === 1 ? 'room' : 'rooms'} · {floor.walls.filter((wall) => wall.kind === 'exterior').length} exterior walls · {floor.walls.filter((wall) => wall.kind === 'interior').length} interior walls</p>
              <FloorPlan floor={floor} nameFor={nameFor} />
            </div>
          ))}
        </section>
      ))}
      <svg className="sonar" viewBox={`0 0 ${width} ${width}`} role="img" aria-label="Sonar of the latest signals">
        {[10, 20, 30].map((ring) => (
          <circle key={ring} cx={center} cy={center} r={ring * scale} fill="none" stroke="#3d4f46" />
        ))}
        <circle cx={center} cy={center} r="5" fill={SIGNAL_COLORS.gps} />
        <text x={center + 10} y={center - 8} fill="#c5d5cc" fontSize="12">{nameFor('phone', 'This phone')}</text>
        {blips.map((blip) => (
          <g key={blip.id}>
            {blip.trail.length > 1 && (
              <polyline points={blip.trail.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#8aa398" strokeWidth="1" />
            )}
            <circle cx={blip.x} cy={blip.y} r="5" fill={blip.color} />
            <text x={blip.x + 8} y={blip.y - 6} fill="#e7f0ea" fontSize="11">{blip.label}</text>
          </g>
        ))}
      </svg>
      <ul className="open-list">
        {rooms.map((room) => {
          const moving = movers.filter((mover) => mover.roomId === room.id)
          return (
            <li key={room.id}>
              <SignalStack id={room.id} fallback={room.originLabel} signals={roomSignals(room)} draftFor={draftFor} rename={rename} />
              <p>{room.widthM.toFixed(0)} m by {room.depthM.toFixed(0)} m · confidence {Math.round(room.confidence * 100)}%</p>
              {moving.map((mover) => <Mover key={mover.id} mover={mover} stacks={stacks} draftFor={draftFor} rename={rename} />)}
              {room.lat != null && room.lon != null && onShow && (
                <button type="button" onClick={() => onShow({ lat: room.lat!, lon: room.lon!, label: nameFor(room.id, room.originLabel) })}>Show on map</button>
              )}
            </li>
          )
        })}
      </ul>
      {movers.filter((mover) => mover.roomId == null).map((mover) => (
        <Mover key={mover.id} mover={mover} stacks={stacks} draftFor={draftFor} rename={rename} />
      ))}
    </div>
  )
}

function Mover({
  mover,
  stacks,
  draftFor,
  rename,
}: {
  mover: MotionTrack
  stacks: ReturnType<typeof stackSignals>
  draftFor: (id: string, fallback: string) => string
  rename: (id: string, value: string) => void
}) {
  const linked = stackFor(stacks, mover.id)
  const signals = linked?.signals.length ? linked.signals : moverSignals(mover)
  if (signals.length === 0) {
    return (
      <p>
        <LabelField id={mover.id} fallback={mover.label} draftFor={draftFor} rename={rename} />
        {' '}{mover.kind}
      </p>
    )
  }
  return <SignalStack id={linked?.id ?? mover.id} fallback={mover.label} signals={signals} draftFor={draftFor} rename={rename} />
}
