// app/server/src/routes/sessions.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { Agent, ParsedEvent } from '../types'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

const LOG_LEVEL = process.env.CLAUDE_OBSERVE_LOG_LEVEL || 'debug'

const router = new Hono<Env>()

// GET /sessions/recent
router.get('/sessions/recent', async (c) => {
  const store = c.get('store')
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20
  const rows = await store.getRecentSessions(limit)
  const sessions = rows.map((r: any) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    projectSlug: r.project_slug,
    slug: r.slug,
    status: r.status,
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    agentCount: r.agent_count,
    activeAgentCount: r.active_agent_count,
    eventCount: r.event_count,
    lastActivity: r.last_activity,
  }))
  return c.json(sessions)
})

// GET /sessions/:id
router.get('/sessions/:id', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const row = await store.getSessionById(sessionId)
  if (!row) return c.json({ error: 'Session not found' }, 404)
  return c.json({
    id: row.id,
    projectId: row.project_id,
    slug: row.slug,
    status: row.status,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    agentCount: row.agent_count,
    activeAgentCount: row.active_agent_count,
    eventCount: row.event_count,
  })
})

// GET /sessions/:id/agents
router.get('/sessions/:id/agents', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const rows = await store.getAgentsForSession(sessionId)
  const agents: Agent[] = rows.map((r: any) => ({
    id: r.id,
    sessionId: r.session_id,
    parentAgentId: r.parent_agent_id,
    slug: r.slug,
    name: r.name,
    agentType: r.agent_type || null,
  }))

  return c.json(agents)
})

// GET /sessions/:id/events
router.get('/sessions/:id/events', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const agentIdParam = c.req.query('agent_id')
  const rows = await store.getEventsForSession(sessionId, {
    agentIds: agentIdParam ? agentIdParam.split(',') : undefined,
    type: c.req.query('type') || undefined,
    subtype: c.req.query('subtype') || undefined,
    search: c.req.query('search') || undefined,
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
  })

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

  // Lazy session status correction based on event history.
  if (events.length > 0) {
    let lastSessionEndIdx = -1
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].subtype === 'SessionEnd') { lastSessionEndIdx = i; break }
    }
    const session = await store.getSessionById(sessionId)
    if (session) {
      if (lastSessionEndIdx >= 0 && lastSessionEndIdx === events.length - 1 && session.status === 'active') {
        await store.updateSessionStatus(sessionId, 'stopped')
      } else if (lastSessionEndIdx >= 0 && lastSessionEndIdx < events.length - 1 && session.status === 'stopped') {
        await store.updateSessionStatus(sessionId, 'active')
      } else if (lastSessionEndIdx < 0 && session.status === 'stopped') {
        await store.updateSessionStatus(sessionId, 'active')
      }
    }
  }

  return c.json(events)
})

// POST /sessions/:id/metadata
router.post('/sessions/:id/metadata', async (c) => {
  const store = c.get('store')
  const broadcastToAll = c.get('broadcastToAll')

  try {
    const sessionId = decodeURIComponent(c.req.param('id'))
    const data = (await c.req.json()) as Record<string, unknown>

    if (data.slug && typeof data.slug === 'string') {
      await store.updateSessionSlug(sessionId, data.slug)
      await store.updateAgentSlug(sessionId, data.slug)

      if (LOG_LEVEL === 'debug') {
        console.log(`[METADATA] Session ${sessionId.slice(0, 8)} slug: ${data.slug}`)
      }

      // Notify clients
      broadcastToAll({ type: 'session_update', data: { id: sessionId, slug: data.slug } as any })
    }

    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Invalid request' }, 400)
  }
})

export default router
