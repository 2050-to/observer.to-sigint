export type LabelAnchor = {
  id: string
  /** Marker position in pixels. */
  x: number
  y: number
  width: number
  height: number
  text: string
}

export type LabelFrame = {
  width: number
  height: number
  margin?: number
  topMargin?: number
  bottomMargin?: number
}

export type LabelOffset = {
  id: string
  /** Label center relative to its marker, in pixels. */
  dx: number
  dy: number
  /** The label was moved off the default spot above its marker. */
  spread: boolean
}

const ROW_GAP = 8
const MARKER_CLEARANCE = 10
const PILE_DISTANCE = 42
const CALLOUT_HEIGHT = 200
const NUDGE_LIMIT = 220

type Rect = { left: number; top: number; right: number; bottom: number }
type Spot = { dx: number; dy: number; baseDx: number; baseDy: number; group: number; grouped: boolean }

export function estimateLabelSize(text: string): { width: number; height: number } {
  const sample = text.trim() || ' '
  return {
    width: Math.ceil(sample.length * 7.2 + 20),
    height: 26,
  }
}

export function leaderIsClear(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  obstacles: Rect[],
): boolean {
  return obstacles.every((rect) => !segmentHitsRect(x1, y1, x2, y2, rect))
}

/** Point on the label edge closest to the marker, in the same offset space as dx/dy. */
export function labelEdgeTowardAnchor(dx: number, dy: number, width: number, height: number): { x: number; y: number } | null {
  if (width <= 0 || height <= 0) return null
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ax < 0.5 && ay < 0.5) return null
  const scaleX = ax === 0 ? Number.POSITIVE_INFINITY : (width / 2) / ax
  const scaleY = ay === 0 ? Number.POSITIVE_INFINITY : (height / 2) / ay
  const scale = Math.min(scaleX, scaleY)
  if (scale >= 1) return null
  return { x: dx * (1 - scale), y: dy * (1 - scale) }
}

export function spreadLabels(anchors: LabelAnchor[], frame?: LabelFrame): LabelOffset[] {
  const spots: Spot[] = anchors.map((anchor, index) => {
    const dy = defaultDy(anchor)
    return { dx: 0, dy, baseDx: 0, baseDy: dy, group: index, grouped: false }
  })
  const groups = new Map<number, number[]>()
  for (const group of clusterIndexes(anchors)) {
    const root = group[0]
    groups.set(root, group)
    if (group.length < 2) continue
    const placed = placeCluster(group.map((index) => anchors[index]), frame)
    group.forEach((index, order) => {
      const spot = placed[order]
      spots[index] = {
        dx: spot.dx,
        dy: spot.dy,
        baseDx: spot.dx,
        baseDy: spot.dy,
        group: root,
        grouped: true,
      }
    })
  }
  relax(anchors, spots, groups)
  return anchors.map((anchor, index) => {
    const spot = spots[index]
    const moved = Math.hypot(spot.dx - spot.baseDx, spot.dy - spot.baseDy) > 4
    return {
      id: anchor.id,
      dx: Math.round(spot.dx),
      dy: Math.round(spot.dy),
      spread: spot.grouped || moved,
    }
  })
}

function defaultDy(anchor: LabelAnchor): number {
  return -(anchor.height / 2 + MARKER_CLEARANCE)
}

function clusterIndexes(anchors: LabelAnchor[]): number[][] {
  const parent = anchors.map((_, index) => index)
  const find = (index: number): number => {
    let root = index
    while (parent[root] !== root) root = parent[root]
    let cursor = index
    while (parent[cursor] !== root) {
      const next = parent[cursor]
      parent[cursor] = root
      cursor = next
    }
    return root
  }
  for (let i = 0; i < anchors.length; i += 1) {
    for (let j = i + 1; j < anchors.length; j += 1) {
      const distance = Math.hypot(anchors[i].x - anchors[j].x, anchors[i].y - anchors[j].y)
      if (distance > PILE_DISTANCE) continue
      const left = find(i)
      const right = find(j)
      if (left !== right) parent[right] = left
    }
  }
  const groups = new Map<number, number[]>()
  for (let index = 0; index < anchors.length; index += 1) {
    const root = find(index)
    const list = groups.get(root)
    if (list) list.push(index)
    else groups.set(root, [index])
  }
  return [...groups.values()]
}

function placeCluster(members: LabelAnchor[], frame?: LabelFrame): { dx: number; dy: number }[] {
  const ordered = [...members].sort((a, b) => {
    const byText = a.text.localeCompare(b.text, undefined, { sensitivity: 'base', numeric: true })
    if (byText !== 0) return byText
    return a.id.localeCompare(b.id)
  })
  const minX = Math.min(...ordered.map((item) => item.x))
  const maxX = Math.max(...ordered.map((item) => item.x))
  const minY = Math.min(...ordered.map((item) => item.y))
  const maxY = Math.max(...ordered.map((item) => item.y))
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  const pad = MARKER_CLEARANCE + 8
  const usable = frame && frame.width >= 40 && frame.height >= 40 ? frame : undefined
  let best: {
    score: number
    columns: number
    box: { left: number; top: number }
    grid: ReturnType<typeof measureGrid>
    short: boolean
  } | null = null

  const maxColumns = Math.min(ordered.length, 8)
  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const grid = measureGrid(ordered, columns)
    if (usable && grid.width > usable.width - 16 && columns > 1) break
    const candidates = [
      { left: maxX + pad, top: midY - grid.height / 2, beside: true },
      { left: minX - pad - grid.width, top: midY - grid.height / 2, beside: true },
      { left: midX - grid.width / 2, top: minY - pad - grid.height, beside: false },
      { left: midX - grid.width / 2, top: maxY + pad, beside: false },
    ]
    for (const candidate of candidates) {
      const nudged = usable ? clampBox(candidate, grid.width, grid.height, usable) : candidate
      const nudge = Math.hypot(nudged.left - candidate.left, nudged.top - candidate.top)
      const options = nudge > 0 && nudge <= 48
        ? [candidate, { ...candidate, left: nudged.left, top: nudged.top }]
        : [candidate]
      for (const box of options) {
        if (coversMarkers(box, grid.width, grid.height, ordered)) continue
        const inside = fits(box, grid.width, grid.height, usable)
        const distance = Math.hypot(box.left + grid.width / 2 - midX, box.top + grid.height / 2 - midY)
        const overflow = Math.max(0, grid.height - CALLOUT_HEIGHT)
        const score = distance + (inside ? 0 : 40) + (box.beside ? 0 : 90) + (columns - 1) * 18 + overflow * 3
        const short = grid.height <= CALLOUT_HEIGHT
        if (!short && best?.short) continue
        if (!best || score < best.score) best = { score, columns, box, grid, short }
      }
    }
    if (best && best.short && best.score < 130) break
  }

  const grid = best?.grid ?? measureGrid(ordered, 1)
  const columns = best?.columns ?? 1
  const chosen = best?.box ?? { left: maxX + pad, top: midY - grid.height / 2 }
  const byAnchor = new Map<LabelAnchor, { dx: number; dy: number }>()
  let rowTop = chosen.top
  const rows = Math.ceil(ordered.length / columns)
  for (let row = 0; row < rows; row += 1) {
    let columnLeft = chosen.left
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column
      const member = ordered[index]
      if (!member) break
      const centerX = columnLeft + member.width / 2
      const centerY = rowTop + member.height / 2
      byAnchor.set(member, { dx: centerX - member.x, dy: centerY - member.y })
      columnLeft += grid.colWidths[column] + ROW_GAP
    }
    rowTop += grid.rowHeights[row] + ROW_GAP
  }
  return members.map((member) => byAnchor.get(member) ?? { dx: 0, dy: defaultDy(member) })
}

function measureGrid(members: LabelAnchor[], columns: number): { width: number; height: number; colWidths: number[]; rowHeights: number[] } {
  const rows = Math.ceil(members.length / columns)
  const colWidths = Array.from({ length: columns }, () => 0)
  const rowHeights = Array.from({ length: rows }, () => 0)
  members.forEach((member, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    colWidths[column] = Math.max(colWidths[column], member.width)
    rowHeights[row] = Math.max(rowHeights[row], member.height)
  })
  const width = colWidths.reduce((sum, value) => sum + value, 0) + ROW_GAP * Math.max(0, columns - 1)
  const height = rowHeights.reduce((sum, value) => sum + value, 0) + ROW_GAP * Math.max(0, rows - 1)
  return { width, height, colWidths, rowHeights }
}

function coversMarkers(box: { left: number; top: number }, width: number, height: number, members: LabelAnchor[]): boolean {
  const right = box.left + width
  const bottom = box.top + height
  return members.some((member) => (
    member.x >= box.left - 2 &&
    member.x <= right + 2 &&
    member.y >= box.top - 2 &&
    member.y <= bottom + 2
  ))
}

function fits(box: { left: number; top: number }, width: number, height: number, frame?: LabelFrame): boolean {
  if (!frame) return true
  const margin = frame.margin ?? 8
  const top = frame.topMargin ?? margin
  const bottom = frame.bottomMargin ?? margin
  return box.left >= margin
    && box.top >= top
    && box.left + width <= frame.width - margin
    && box.top + height <= frame.height - bottom
}

function clampBox(box: { left: number; top: number }, width: number, height: number, frame: LabelFrame): { left: number; top: number } {
  const margin = frame.margin ?? 8
  const top = frame.topMargin ?? margin
  const bottom = frame.bottomMargin ?? margin
  return {
    left: clamp(box.left, margin, frame.width - margin - width),
    top: clamp(box.top, top, frame.height - bottom - height),
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

function relax(anchors: LabelAnchor[], spots: Spot[], groups: Map<number, number[]>) {
  for (let pass = 0; pass < 24; pass += 1) {
    const push = new Map<number, { x: number; y: number }>()
    for (let i = 0; i < anchors.length; i += 1) {
      for (let j = i + 1; j < anchors.length; j += 1) {
        if (spots[i].group === spots[j].group) continue
        const hit = overlap(expand(rectOf(anchors[i], spots[i]), ROW_GAP), expand(rectOf(anchors[j], spots[j]), ROW_GAP))
        if (!hit) continue
        const mover = moverGroup(spots[i], spots[j])
        const movingIndex = mover === spots[i].group ? i : j
        const otherIndex = movingIndex === i ? j : i
        const moving = rectOf(anchors[movingIndex], spots[movingIndex])
        const other = rectOf(anchors[otherIndex], spots[otherIndex])
        const current = push.get(mover) ?? { x: 0, y: 0 }
        if (hit.y <= hit.x) {
          const dir = center(moving).y > center(other).y ? 1 : -1
          const delta = dir * hit.y
          if (current.y === 0 || Math.abs(delta) > Math.abs(current.y)) current.y = delta
        } else {
          const dir = center(moving).x > center(other).x ? 1 : -1
          const delta = dir * hit.x
          if (current.x === 0 || Math.abs(delta) > Math.abs(current.x)) current.x = delta
        }
        push.set(mover, current)
      }
    }
    if (push.size === 0) return
    for (const [group, delta] of push) shiftGroup(groups, spots, group, delta.x, delta.y)
  }
}

function moverGroup(a: Spot, b: Spot): number {
  if (a.grouped && !b.grouped) return b.group
  if (!a.grouped && b.grouped) return a.group
  return b.group
}

function shiftGroup(groups: Map<number, number[]>, spots: Spot[], group: number, dx: number, dy: number) {
  for (const index of groups.get(group) ?? []) {
    const spot = spots[index]
    spot.dx += dx
    spot.dy += dy
    const travelX = spot.dx - spot.baseDx
    const travelY = spot.dy - spot.baseDy
    const distance = Math.hypot(travelX, travelY)
    if (distance > NUDGE_LIMIT) {
      const scale = NUDGE_LIMIT / distance
      spot.dx = spot.baseDx + travelX * scale
      spot.dy = spot.baseDy + travelY * scale
    }
  }
}

function rectOf(anchor: LabelAnchor, spot: Spot): Rect {
  const cx = anchor.x + spot.dx
  const cy = anchor.y + spot.dy
  return {
    left: cx - anchor.width / 2,
    top: cy - anchor.height / 2,
    right: cx + anchor.width / 2,
    bottom: cy + anchor.height / 2,
  }
}

function expand(rect: Rect, gap: number): Rect {
  const pad = gap / 2
  return {
    left: rect.left - pad,
    top: rect.top - pad,
    right: rect.right + pad,
    bottom: rect.bottom + pad,
  }
}

function overlap(a: Rect, b: Rect): { x: number; y: number } | null {
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  if (x <= 0.5 || y <= 0.5) return null
  return { x, y }
}

function center(rect: Rect): { x: number; y: number } {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 }
}

function segmentHitsRect(x1: number, y1: number, x2: number, y2: number, rect: Rect): boolean {
  let t0 = 0
  let t1 = 1
  const dx = x2 - x1
  const dy = y2 - y1
  const p = [-dx, dx, -dy, dy]
  const q = [x1 - rect.left, rect.right - x1, y1 - rect.top, rect.bottom - y1]
  for (let edge = 0; edge < 4; edge += 1) {
    if (Math.abs(p[edge]) < 1e-9) {
      if (q[edge] < 0) return false
      continue
    }
    const t = q[edge] / p[edge]
    if (p[edge] < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else if (t < t0) {
      return false
    } else if (t < t1) {
      t1 = t
    }
  }
  return t0 <= t1
}
