import assert from 'node:assert/strict'
import { labelEdgeTowardAnchor, leaderIsClear, spreadLabels, type LabelAnchor, type LabelOffset } from '../../shared/labelLayout.js'

function label(partial: Partial<LabelAnchor> & Pick<LabelAnchor, 'id' | 'text'>): LabelAnchor {
  return {
    x: 0,
    y: 100,
    width: 80,
    height: 20,
    ...partial,
  }
}

function rect(anchor: LabelAnchor, spot: LabelOffset) {
  return {
    left: anchor.x + spot.dx - anchor.width / 2,
    right: anchor.x + spot.dx + anchor.width / 2,
    top: anchor.y + spot.dy - anchor.height / 2,
    bottom: anchor.y + spot.dy + anchor.height / 2,
  }
}

function separated(anchors: LabelAnchor[], spots: LabelOffset[], gap: number) {
  for (let i = 0; i < anchors.length; i += 1) {
    for (let j = i + 1; j < anchors.length; j += 1) {
      const a = rect(anchors[i], spots[i])
      const b = rect(anchors[j], spots[j])
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      assert.ok(
        overlapX <= -gap || overlapY <= -gap,
        `${anchors[i].text} overlaps ${anchors[j].text}`,
      )
    }
  }
}

const alone = [label({ id: 'phone', text: 'This device', x: 400, y: 200, width: 90, height: 24 })]
const aloneSpot = spreadLabels(alone)
assert.equal(aloneSpot[0].dx, 0)
assert.equal(aloneSpot[0].dy, -(24 / 2 + 10))
assert.equal(aloneSpot[0].spread, false)

const piled = [
  label({ id: 'c', text: 'Trujillo house', x: 8, y: 2 }),
  label({ id: 'a', text: '6fdad5d4-ab13', x: 0, y: 0 }),
  label({ id: 'b', text: '8e47af58-d63d', x: 5, y: 1 }),
]
const piledSpots = spreadLabels(piled)
separated(piled, piledSpots, 6)
const readingOrder = piled
  .map((anchor, index) => ({ text: anchor.text, top: rect(anchor, piledSpots[index]).top }))
  .sort((a, b) => a.top - b.top)
  .map((item) => item.text)
assert.deepEqual(readingOrder, ['6fdad5d4-ab13', '8e47af58-d63d', 'Trujillo house'])
for (let index = 0; index < piled.length; index += 1) {
  assert.equal(piledSpots[index].spread, true)
  assert.ok(rect(piled[index], piledSpots[index]).left >= 8 + 10)
}

const distant = [
  label({ id: 'near', text: 'Cafe', x: 0, y: 0, width: 40, height: 18 }),
  label({ id: 'far', text: 'Library', x: 320, y: 40, width: 70, height: 18 }),
]
const distantSpots = spreadLabels(distant)
assert.equal(distantSpots[1].dx, 0)
assert.equal(distantSpots[1].spread, false)
separated(distant, distantSpots, 6)

const crowded = [
  label({ id: 'left', text: 'Home', x: 0, y: 100, width: 180, height: 24 }),
  label({ id: 'right', text: 'Office', x: 80, y: 100, width: 180, height: 24 }),
]
const crowdedSpots = spreadLabels(crowded)
separated(crowded, crowdedSpots, 6)
assert.ok(Math.hypot(crowdedSpots[0].dx, crowdedSpots[0].dy - -(24 / 2 + 10)) < 80)
assert.ok(Math.hypot(crowdedSpots[1].dx, crowdedSpots[1].dy - -(24 / 2 + 10)) < 160)

const edgeNames = ['N', 'S']
const edged = edgeNames.map((text, index) => label({
  id: text,
  text,
  x: 180,
  y: 100 + index * 4,
  width: 100,
  height: 24,
}))
const edgedSpots = spreadLabels(edged, { width: 220, height: 300, margin: 8 })
separated(edged, edgedSpots, 6)
for (let index = 0; index < edged.length; index += 1) {
  assert.ok(rect(edged[index], edgedSpots[index]).right <= 180)
  assert.ok(edgedSpots[index].dx !== 0)
}

const tall = Array.from({ length: 12 }, (_, index) => label({
  id: `n${index}`,
  text: `Network ${index}`,
  x: 10,
  y: 10,
  width: 90,
  height: 28,
}))
const tallSpots = spreadLabels(tall)
separated(tall, tallSpots, 6)
const tallTops = new Set(tallSpots.map((spot, index) => rect(tall[index], spot).top))
assert.ok(tallTops.size < tall.length)

const streetNames = ['6fdad5d4-ab13-b3a0-4a3e-24f81181612a', 'Trujillo house', '8e47af58-d63d-ba4b-844b-9cf4be02ddf1']
const street = streetNames.map((text, index) => label({
  id: text,
  text,
  x: 500 + index * 6,
  y: 260 + index * 4,
  width: text.length > 20 ? 250 : 120,
  height: 26,
}))
const streetSpots = spreadLabels(street, { width: 1000, height: 520, margin: 8, topMargin: 70, bottomMargin: 24 })
separated(street, streetSpots, 6)
const streetOrder = street
  .map((anchor, index) => ({ text: anchor.text, top: rect(anchor, streetSpots[index]).top }))
  .sort((a, b) => a.top - b.top)
  .map((item) => item.text)
assert.deepEqual(streetOrder, [
  '6fdad5d4-ab13-b3a0-4a3e-24f81181612a',
  '8e47af58-d63d-ba4b-844b-9cf4be02ddf1',
  'Trujillo house',
])
for (let index = 0; index < street.length; index += 1) {
  const box = rect(street[index], streetSpots[index])
  assert.ok(box.left >= 506 + 10, `${street[index].text} should sit to the right of the dots`)
  assert.ok(Math.abs((box.top + box.bottom) / 2 - 262) < 120, `${street[index].text} should stay near the dots`)
}

const west = [
  label({ id: 'w1', text: 'West A', x: 40, y: 180, width: 80, height: 24 }),
  label({ id: 'w2', text: 'West B', x: 46, y: 186, width: 80, height: 24 }),
]
const east = [
  label({ id: 'e1', text: 'East A', x: 360, y: 180, width: 90, height: 24 }),
  label({ id: 'e2', text: 'East B', x: 366, y: 176, width: 90, height: 24 }),
]
const coasts = [...west, ...east]
const coastSpots = spreadLabels(coasts, { width: 430, height: 360, margin: 8 })
separated(coasts, coastSpots, 6)
for (let index = 0; index < west.length; index += 1) {
  assert.ok(west[index].x + coastSpots[index].dx < 200)
}
for (let index = 0; index < east.length; index += 1) {
  assert.ok(east[index].x + coastSpots[west.length + index].dx > 200)
}

assert.equal(spreadLabels([]).length, 0)

const edge = labelEdgeTowardAnchor(80, 0, 100, 20)
assert.ok(edge)
assert.ok(Math.abs((edge?.x ?? 0) - 30) < 0.01)
assert.equal(edge?.y, 0)
assert.equal(labelEdgeTowardAnchor(0, 0, 40, 20), null)
assert.equal(labelEdgeTowardAnchor(4, 0, 40, 20), null)
assert.equal(leaderIsClear(0, 0, 40, 0, [{ left: 10, top: -8, right: 30, bottom: 8 }]), false)
assert.equal(leaderIsClear(0, 50, 40, 50, [{ left: 10, top: -8, right: 30, bottom: 8 }]), true)

console.log('label layout ok')
