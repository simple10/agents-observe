// app/server/src/routes/agents.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import { apiError } from '../errors'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

// GET /agents/:id
router.get('/agents/:id', async (c) => {
  const store = c.get('store')
  const agentId = decodeURIComponent(c.req.param('id'))
  const row = await store.getAgentById(agentId)
  if (!row) return apiError(c, 404, 'Agent not found')
  return c.json({
    id: row.id,
    sessionId: row.session_id,
    parentAgentId: row.parent_agent_id,
    name: row.name,
    description: row.description,
    agentType: row.agent_type || null,
    agentClass: row.agent_class || null,
  })
})

export default router
