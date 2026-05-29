/**
 * Pure force simulation for the Constellation view. No DOM, no React, no
 * time source of its own — the render loop stamps `heat`/`attention` onto
 * each node every frame and calls `stepSimulation`. Kept dependency-free
 * and unit-tested (physics.test.ts) rather than pulling in d3-force, since
 * the heat-driven radial spring isn't a stock d3 force anyway.
 */

export const WORLD_W = 1440
export const WORLD_H = 900

const CHARGE = 950 // pairwise repulsion strength
const CHARGE_R = 170 // repulsion cutoff distance
const DAMP = 0.84 // velocity damping per step
const MAX_V = 6 // velocity clamp
const INNER_R = 26 // radius a fully-hot node settles at within its well
const K_GRAVITY = 0.02 // radial spring stiffness
const K_ATTN = 0.045 // stronger pull for attention nodes
const K_CENTER = 0.003 // attention nodes also drift toward world center

export interface SimNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  projectKey: string
  baseR: number
  /** 0 (cold) .. 1 (hot), set by the render loop each frame. */
  heat: number
  /** Needs-attention flag, set by the render loop each frame. */
  attention: boolean
}

export interface Well {
  key: string
  cx: number
  cy: number
  r: number
}

/** Star radius from a session's event count. */
export function radius(eventCount: number | undefined): number {
  return 9 + Math.sqrt(Math.max(0, eventCount ?? 0)) * 0.42
}

/** Collision radius — leaves room for the subagent orbit when present. */
export function collisionRadius(node: SimNode, hasOrbit: boolean): number {
  return node.baseR + (hasOrbit ? node.baseR + 24 : 8)
}

/**
 * Continuous recency heat: 1 just after activity, decaying to 0 over τ.
 * `tauSec` is the e-folding time (≈ how long until a quiet session reads "cold").
 */
export function heat(lastActivityMs: number, nowMs: number, tauSec: number): number {
  const age = (nowMs - lastActivityMs) / 1000
  if (age <= 0) return 1
  return Math.exp(-age / Math.max(1, tauSec))
}

/**
 * Lay out project gravity wells across the world. Wells are arranged on an
 * ellipse (a single well sits at center); radius shrinks as projects grow.
 */
export function layoutWells(projectKeys: string[]): Well[] {
  const n = projectKeys.length
  const cx = WORLD_W / 2
  const cy = WORLD_H / 2
  if (n === 0) return []
  if (n === 1) return [{ key: projectKeys[0], cx, cy, r: 300 }]
  const wellR = Math.max(110, Math.min(230, 760 / Math.sqrt(n)))
  const spreadX = WORLD_W * 0.32
  const spreadY = WORLD_H * 0.3
  return projectKeys.map((key, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    return { key, cx: cx + Math.cos(a) * spreadX, cy: cy + Math.sin(a) * spreadY, r: wellR }
  })
}

/**
 * Advance the simulation one step, mutating node positions/velocities.
 * Forces: a heat-driven radial spring toward each node's well (hot → center,
 * cold → rim), pairwise charge repulsion, and soft collision resolution.
 */
export function stepSimulation(
  nodes: SimNode[],
  wellByKey: Map<string, Well>,
  hasOrbit: (node: SimNode) => boolean,
): void {
  const cx = WORLD_W / 2
  const cy = WORLD_H / 2

  for (const s of nodes) {
    const well = wellByKey.get(s.projectKey)
    if (!well) continue
    const dx = s.x - well.cx
    const dy = s.y - well.cy
    const dist = Math.hypot(dx, dy) || 0.01
    const desired = s.attention ? INNER_R * 0.5 : INNER_R + (well.r - INNER_R) * (1 - s.heat)
    const tx = well.cx + (dx / dist) * desired
    const ty = well.cy + (dy / dist) * desired
    const k = s.attention ? K_ATTN : K_GRAVITY
    s.vx += (tx - s.x) * k
    s.vy += (ty - s.y) * k
    if (s.attention) {
      s.vx += (cx - s.x) * K_CENTER
      s.vy += (cy - s.y) * K_CENTER
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      const dx = a.x - b.x
      const dy = a.y - b.y
      const d2 = dx * dx + dy * dy || 0.01
      if (d2 < CHARGE_R * CHARGE_R) {
        const d = Math.sqrt(d2)
        const f = CHARGE / d2
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
      const minD = collisionRadius(a, hasOrbit(a)) + collisionRadius(b, hasOrbit(b))
      if (d2 < minD * minD) {
        const d = Math.sqrt(d2) || 0.01
        const push = ((minD - d) / d) * 0.5
        a.vx += dx * push * 0.12
        a.vy += dy * push * 0.12
        b.vx -= dx * push * 0.12
        b.vy -= dy * push * 0.12
      }
    }
  }

  for (const s of nodes) {
    s.vx *= DAMP
    s.vy *= DAMP
    s.vx = Math.max(-MAX_V, Math.min(MAX_V, s.vx))
    s.vy = Math.max(-MAX_V, Math.min(MAX_V, s.vy))
    s.x += s.vx
    s.y += s.vy
    s.x = Math.max(60, Math.min(WORLD_W - 60, s.x))
    s.y = Math.max(70, Math.min(WORLD_H - 50, s.y))
  }
}
