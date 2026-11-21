import type { DeviceRecord, MotionTrack, Room } from '../types'

function angleFor(id: string): number {
  let hash = 0
  for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0
  return ((hash % 360) * Math.PI) / 180
}

function latestDistance(device: DeviceRecord): number | null {
  const last = device.observations?.[device.observations.length - 1]
  return last?.distanceM ?? null
}

export function RoomsView({
  rooms,
  movers,
  devices,
  onShow,
}: {
  rooms: Room[]
  movers: MotionTrack[]
  devices: DeviceRecord[]
  onShow?: (point: { lat: number; lon: number; label: string }) => void
}) {
  const width = 420
  const center = width / 2
  const scale = (width / 2 - 28) / 30
  const blips = devices.flatMap((device) => {
    const distance = latestDistance(device)
    if (distance == null) return []
    const angle = angleFor(device.address)
    const radius = Math.min(distance, 30) * scale
    const trail = (device.observations ?? []).slice(-4).map((observation) => {
      const reach = Math.min(observation.distanceM ?? distance, 30) * scale
      return { x: center + Math.cos(angle) * reach, y: center + Math.sin(angle) * reach }
    })
    return [{
      id: device.address,
      label: device.name || device.address,
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
      trail,
    }]
  })
  const wifiOrigin = rooms.find((room) => room.originKind === 'wifi')

  return (
    <div className="panel">
      <p className="empty">Labels describe anonymous motion in this survey. They are not a person's identity.</p>
      <svg className="sonar" viewBox={`0 0 ${width} ${width}`} role="img" aria-label="Sonar of the latest signals">
        {[10, 20, 30].map((ring) => (
          <circle key={ring} cx={center} cy={center} r={ring * scale} fill="none" stroke="#3d4f46" />
        ))}
        <circle cx={center} cy={center} r="5" fill="#7dcea0" />
        {wifiOrigin && <text x={center + 10} y={center - 8} fill="#c5d5cc" fontSize="12">{wifiOrigin.originLabel}</text>}
        {blips.map((blip) => (
          <g key={blip.id}>
            {blip.trail.length > 1 && (
              <polyline points={blip.trail.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#8aa398" strokeWidth="1" />
            )}
            <circle cx={blip.x} cy={blip.y} r="5" fill="#c9a0dc" />
            <text x={blip.x + 8} y={blip.y - 6} fill="#e7f0ea" fontSize="11">{blip.label}</text>
          </g>
        ))}
      </svg>
      {rooms.length === 0 && <p className="empty">No Bluetooth, Wi-Fi, GPS, or cell signal yet.</p>}
      <ul className="open-list">
        {rooms.map((room) => {
          const moving = movers.filter((mover) => mover.roomId === room.id)
          return (
            <li key={room.id}>
              <div>
                <strong>{room.originLabel}</strong>
                <span>{originText(room.originKind)}</span>
              </div>
              <p>{room.radiusM.toFixed(0)} m radius · {room.widthM.toFixed(0)} m by {room.depthM.toFixed(0)} m · confidence {Math.round(room.confidence * 100)}%</p>
              <p>{room.members.map((member) => `${member.label} (${member.kind})`).join(', ') || 'No contents yet'}</p>
              {moving.map((mover) => <Mover key={mover.id} mover={mover} />)}
              {room.lat != null && room.lon != null && onShow && (
                <button type="button" onClick={() => onShow({ lat: room.lat!, lon: room.lon!, label: room.originLabel })}>Show on map</button>
              )}
            </li>
          )
        })}
      </ul>
      {movers.filter((mover) => mover.roomId == null).map((mover) => <Mover key={mover.id} mover={mover} />)}
    </div>
  )
}

function originText(kind: Room['originKind']): string {
  if (kind === 'wifi') return 'Wi-Fi origin'
  if (kind === 'gps') return 'GPS origin'
  if (kind === 'cell') return 'Cell origin'
  return 'Bluetooth origin'
}

function Mover({ mover }: { mover: MotionTrack }) {
  const speed = mover.speedMps == null ? 'speed unknown' : `${mover.speedMps.toFixed(1)} m/s`
  const bound = mover.speedKind === 'radial_lower_bound' ? ' (lower bound)' : ''
  const caps = mover.capabilities.length ? mover.capabilities.join(', ') : 'no radio'
  return <p>{mover.label}: {mover.kind}, {caps}, {speed}{bound}</p>
}
