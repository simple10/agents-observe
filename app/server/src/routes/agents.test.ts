import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
  }
}

describe('agent routes', () => {
  let app: Hono<Env>
  const mockStore = {
    getAgentById: vi.fn(),
    updateAgentName: vi.fn(),
    updateAgentType: vi.fn(),
  }

  beforeEach(async () => {
    vi.resetModules()
    Object.values(mockStore).forEach((fn) => fn.mockReset())

    vi.doMock('../config', () => ({
      config: { logLevel: 'error' },
    }))

    const { default: agentsRouter } = await import('./agents')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', mockStore as unknown as EventStore)
      await next()
    })
    app.route('/api', agentsRouter)
  })

  describe('GET /api/agents/:id', () => {
    test('returns agentClass in response', async () => {
      mockStore.getAgentById.mockResolvedValue({
        id: 'agent-1',
        session_id: 'sess-1',
        parent_agent_id: null,
        name: 'Main',
        description: null,
        agent_type: 'general-purpose',
        agent_class: 'claude-code',
      })

      const res = await app.request('/api/agents/agent-1', { method: 'GET' })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.agentClass).toBe('claude-code')
    })

    test('returns null agentClass when not set', async () => {
      mockStore.getAgentById.mockResolvedValue({
        id: 'agent-1',
        session_id: 'sess-1',
        parent_agent_id: null,
        name: null,
        description: null,
        agent_type: null,
        agent_class: null,
      })

      const res = await app.request('/api/agents/agent-1', { method: 'GET' })
      const body = await res.json()
      expect(body.agentClass).toBeNull()
    })
  })
})
