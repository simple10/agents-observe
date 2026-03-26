// app/server/src/routes/agents.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { ParsedEvent } from '../types'

type Env = { Variables: { store: EventStore } }

const LOG_LEVEL = process.env.SERVER_LOG_LEVEL || 'debug'

const router = new Hono<Env>()

// GET /agents/:id/events
router.get('/agents/:id/events', async (c) => {
  const store = c.get('store')
  const agentId = decodeURIComponent(c.req.param('id'))
  const rows = await store.getEventsForAgent(agentId)
  const events: ParsedEvent[] = rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    sessionId: r.session_id,
    type: r.type,
    subtype: r.subtype,
    toolName: r.tool_name,
    toolUseId: r.tool_use_id || null,
    status: r.status || 'pending',
    timestamp: r.timestamp,
    payload: JSON.parse(r.payload),
  }))
  return c.json(events)
})

// POST /agents/:id/metadata
router.post('/agents/:id/metadata', async (c) => {
  const store = c.get('store')

  try {
    const agentIdParam = decodeURIComponent(c.req.param('id'))
    const data = (await c.req.json()) as Record<string, unknown>

    if (data.slug && typeof data.slug === 'string') {
      await store.updateAgentSlug(agentIdParam, data.slug)

      if (LOG_LEVEL === 'debug') {
        console.log(`[METADATA] Agent ${agentIdParam.slice(0, 8)} slug: ${data.slug}`)
      }
    }

    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Invalid request' }, 400)
  }
})

export default router
