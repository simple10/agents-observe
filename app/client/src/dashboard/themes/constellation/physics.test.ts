import { describe, it, expect } from 'vitest'
import {
  radius,
  heat,
  layoutWells,
  stepSimulation,
  WORLD_W,
  WORLD_H,
  type SimNode,
  type Well,
} from './physics'

describe('radius', () => {
  it('grows with event count and handles missing/zero', () => {
    expect(radius(0)).toBeCloseTo(9)
    expect(radius(undefined)).toBeCloseTo(9)
    expect(radius(10000)).toBeGreaterThan(radius(100))
  })
})

describe('heat', () => {
  it('is 1 at/just-after the activity time', () => {
    expect(heat(1000, 1000, 60)).toBe(1)
    expect(heat(2000, 1000, 60)).toBe(1) // future timestamp clamps to 1
  })
  it('decays toward 0 as age grows', () => {
    const now = 100_000
    const fresh = heat(now - 1_000, now, 60)
    const old = heat(now - 180_000, now, 60) // 3τ → e^-3 ≈ 0.05
    expect(fresh).toBeGreaterThan(old)
    expect(old).toBeLessThan(0.1)
  })
  it('reaches ~1/e after one tau', () => {
    const now = 100_000
    expect(heat(now - 60_000, now, 60)).toBeCloseTo(Math.exp(-1), 3)
  })
})

describe('layoutWells', () => {
  it('centers a single project', () => {
    const [w] = layoutWells(['a'])
    expect(w.cx).toBe(WORLD_W / 2)
    expect(w.cy).toBe(WORLD_H / 2)
  })
  it('returns one well per project and shrinks radius as count grows', () => {
    const few = layoutWells(['a', 'b'])
    const many = layoutWells(Array.from({ length: 8 }, (_, i) => `p${i}`))
    expect(many).toHaveLength(8)
    expect(many[0].r).toBeLessThanOrEqual(few[0].r)
  })
})

function node(over: Partial<SimNode> = {}): SimNode {
  return {
    id: 'n',
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    projectKey: 'a',
    baseR: 12,
    heat: 0.5,
    attention: false,
    ...over,
  }
}

describe('stepSimulation', () => {
  const well: Well = { key: 'a', cx: 700, cy: 450, r: 200 }
  const wells = new Map([[well.key, well]])

  it('keeps nodes inside world bounds', () => {
    const n = node({ x: 5, y: 5, vx: -100, vy: -100 })
    stepSimulation([n], wells, () => false)
    expect(n.x).toBeGreaterThanOrEqual(60)
    expect(n.y).toBeGreaterThanOrEqual(70)
    expect(n.x).toBeLessThanOrEqual(WORLD_W - 60)
    expect(n.y).toBeLessThanOrEqual(WORLD_H - 50)
  })

  it('pulls a hot node closer to the well center than a cold one', () => {
    const hotNode = node({ id: 'h', x: 200, y: 200, heat: 1 })
    const coldNode = node({ id: 'c', x: 200, y: 200, heat: 0 })
    // step both many times in isolation toward the same well
    for (let i = 0; i < 400; i++) stepSimulation([hotNode], wells, () => false)
    for (let i = 0; i < 400; i++) stepSimulation([coldNode], wells, () => false)
    const distHot = Math.hypot(hotNode.x - well.cx, hotNode.y - well.cy)
    const distCold = Math.hypot(coldNode.x - well.cx, coldNode.y - well.cy)
    expect(distHot).toBeLessThan(distCold)
  })

  it('pushes two overlapping nodes apart', () => {
    const a = node({ id: 'a', x: 700, y: 450 })
    const b = node({ id: 'b', x: 701, y: 450 })
    const before = Math.hypot(a.x - b.x, a.y - b.y)
    for (let i = 0; i < 30; i++) stepSimulation([a, b], wells, () => false)
    const after = Math.hypot(a.x - b.x, a.y - b.y)
    expect(after).toBeGreaterThan(before)
  })

  it('does not move nodes whose well is missing', () => {
    const n = node({ projectKey: 'missing', x: 300, y: 300 })
    stepSimulation([n], wells, () => false)
    expect(n.x).toBe(300)
    expect(n.y).toBe(300)
  })
})
