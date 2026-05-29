/**
 * Pure helpers for the drill-in subagent tree: build a tree from the flat
 * Agent[] (using derived parentAgentId) and lay it out radially around the
 * focused session's star. No DOM/React — unit-tested in agent-tree.test.ts.
 */
import type { Agent } from '@/types'

export interface AgentTreeNode {
  id: string
  name: string | null
  type: string | null
  status: 'active' | 'stopped'
  eventCount: number
  children: AgentTreeNode[]
}

export interface PositionedNode {
  id: string
  name: string | null
  type: string | null
  status: 'active' | 'stopped'
  x: number
  y: number
  depth: number
  isRoot: boolean
}

export interface TreeEdge {
  x1: number
  y1: number
  x2: number
  y2: number
}

const RING0 = 92 // radius of direct children
const RING_DEEP = 54 // radius added per deeper level

/** Build a tree rooted at `rootId` (the session) from flat agents via parentAgentId. */
export function buildAgentTree(agents: Agent[], rootId: string): AgentTreeNode {
  const toNode = (a: Agent): AgentTreeNode => ({
    id: a.id,
    name: a.name,
    type: a.agentType ?? a.agentClass ?? null,
    status: a.status,
    eventCount: a.eventCount,
    children: [],
  })

  const byId = new Map<string, AgentTreeNode>()
  for (const a of agents) byId.set(a.id, toNode(a))

  let root = byId.get(rootId)
  if (!root) {
    root = {
      id: rootId,
      name: null,
      type: 'session',
      status: 'active',
      eventCount: 0,
      children: [],
    }
    byId.set(rootId, root)
  }

  for (const a of agents) {
    if (a.id === rootId) continue
    const node = byId.get(a.id)!
    const parent = (a.parentAgentId && byId.get(a.parentAgentId)) || root
    if (parent !== node) parent.children.push(node)
  }
  return root
}

/** Count every node in the tree (including the root). */
export function countTree(node: AgentTreeNode): number {
  return node.children.reduce((acc, c) => acc + countTree(c), 1)
}

/**
 * Radial layout around (originX, originY). Direct children spread evenly on a
 * full circle; deeper descendants fan out in an arc facing away from their
 * parent. Returns positioned nodes plus parent→child edges for drawing.
 */
export function layoutTree(
  root: AgentTreeNode,
  originX: number,
  originY: number,
): { nodes: PositionedNode[]; edges: TreeEdge[] } {
  const nodes: PositionedNode[] = []
  const edges: TreeEdge[] = []

  const place = (
    node: AgentTreeNode,
    x: number,
    y: number,
    baseAngle: number,
    spread: number,
    depth: number,
  ) => {
    nodes.push({
      id: node.id,
      name: node.name,
      type: node.type,
      status: node.status,
      x,
      y,
      depth,
      isRoot: depth === 0,
    })
    const kids = node.children
    if (kids.length === 0) return
    const r = depth === 0 ? RING0 : RING_DEEP
    kids.forEach((kid, i) => {
      let angle: number
      if (depth === 0) {
        angle = -Math.PI / 2 + ((i + 0.5) / kids.length) * Math.PI * 2
      } else if (kids.length === 1) {
        angle = baseAngle
      } else {
        angle = baseAngle - spread / 2 + (spread * i) / (kids.length - 1)
      }
      const kx = x + Math.cos(angle) * r
      const ky = y + Math.sin(angle) * r
      edges.push({ x1: x, y1: y, x2: kx, y2: ky })
      place(kid, kx, ky, angle, depth === 0 ? 1.1 : 0.8, depth + 1)
    })
  }

  place(root, originX, originY, 0, 0, 0)
  return { nodes, edges }
}
