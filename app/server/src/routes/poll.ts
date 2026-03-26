import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

// GET /poll?session_id=<id>&since=<timestamp>
// Returns events newer than `since` for the given session.
// Client polls this every 2-3 seconds when WebSocket is unavailable.
router.get('/poll', async (c) => {
  const store = c.get('store')
  const sessionId = c.req.query('session_id')
  const since = c.req.query('since')

  if (!sessionId) {
    return c.json({ error: 'session_id is required' }, 400)
  }

  const sinceTs = since ? parseInt(since, 10) : 0
  const events = await store.getEventsSince(sessionId, sinceTs)

  // Transform StoredEvent rows to API format (parse payload JSON)
  const parsed = events.map((r: any) => ({
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

  return c.json(parsed)
})

export default router
