import { describe, it, expect } from 'vitest'
import { buildAgentTree, countTree, layoutTree } from './agent-tree'
import type { Agent } from '@/types'

function agent(id: string, parentAgentId: string | null, over: Partial<Agent> = {}): Agent {
  return {
    id,
    sessionId: 'sess',
    parentAgentId,
    description: null,
    name: id,
    agentType: null,
    agentClass: null,
    status: 'active',
    eventCount: 1,
    firstEventAt: 0,
    lastEventAt: 0,
    cwd: null,
    ...over,
  }
}

describe('buildAgentTree', () => {
  it('builds a nested tree from parentAgentId', () => {
    const agents = [agent('sess', null), agent('a', 'sess'), agent('b', 'sess'), agent('a1', 'a')]
    const root = buildAgentTree(agents, 'sess')
    expect(root.id).toBe('sess')
    expect(root.children.map((c) => c.id).sort()).toEqual(['a', 'b'])
    const a = root.children.find((c) => c.id === 'a')!
    expect(a.children.map((c) => c.id)).toEqual(['a1'])
    expect(countTree(root)).toBe(4)
  })

  it('reparents orphans (unknown parent) under the root', () => {
    const agents = [agent('sess', null), agent('x', 'ghost')]
    const root = buildAgentTree(agents, 'sess')
    expect(root.children.map((c) => c.id)).toEqual(['x'])
  })

  it('synthesizes a root when the session agent is absent', () => {
    const agents = [agent('a', 'sess')]
    const root = buildAgentTree(agents, 'sess')
    expect(root.id).toBe('sess')
    expect(root.children.map((c) => c.id)).toEqual(['a'])
  })

  it('prefers agentType, then agentClass, for the node type', () => {
    const agents = [
      agent('sess', null),
      agent('a', 'sess', { agentType: 'Explore', agentClass: 'ClaudeCode' }),
      agent('b', 'sess', { agentType: null, agentClass: 'ClaudeCode' }),
    ]
    const root = buildAgentTree(agents, 'sess')
    expect(root.children.find((c) => c.id === 'a')!.type).toBe('Explore')
    expect(root.children.find((c) => c.id === 'b')!.type).toBe('ClaudeCode')
  })
})

describe('layoutTree', () => {
  it('positions the root at the origin and emits an edge per non-root node', () => {
    const agents = [agent('sess', null), agent('a', 'sess'), agent('b', 'sess'), agent('a1', 'a')]
    const root = buildAgentTree(agents, 'sess')
    const { nodes, edges } = layoutTree(root, 500, 400)
    expect(nodes).toHaveLength(4)
    const rootNode = nodes.find((n) => n.isRoot)!
    expect([rootNode.x, rootNode.y]).toEqual([500, 400])
    // one edge per parent→child relationship = (total nodes - 1)
    expect(edges).toHaveLength(3)
    // depths: root 0, a/b 1, a1 2
    expect(nodes.find((n) => n.id === 'a1')!.depth).toBe(2)
  })
})
