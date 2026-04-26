// app/server/src/routes/sessions.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { ParsedEvent } from '../types'
import { config } from '../config'
import { apiError } from '../errors'

function deriveSessionStatus(stoppedAt: number | null | undefined): string {
  return stoppedAt ? 'ended' : 'active'
}

function parseAgentClasses(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  return raw.split(',').filter(Boolean)
}

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

const LOG_LEVEL = config.logLevel

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
    transcriptPath: r.transcript_path || null,
    startCwd: r.start_cwd || null,
    status: deriveSessionStatus(r.stopped_at),
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    agentCount: r.agent_count,
    eventCount: r.event_count,
    lastActivity: r.last_activity,
    agentClasses: parseAgentClasses(r.agent_classes),
  }))
  return c.json(sessions)
})

// GET /sessions/:id
router.get('/sessions/:id', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const row = await store.getSessionById(sessionId)
  if (!row) return apiError(c, 404, 'Session not found')
  return c.json({
    id: row.id,
    projectId: row.project_id,
    projectSlug: row.project_slug,
    projectName: row.project_name,
    slug: row.slug,
    status: deriveSessionStatus(row.stopped_at),
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    transcriptPath: row.transcript_path || null,
    startCwd: row.start_cwd || null,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    agentCount: row.agent_count,
    eventCount: row.event_count,
    lastActivity: row.last_activity,
    agentClasses: parseAgentClasses(row.agent_classes),
  })
})

// GET /sessions/:id/agents
router.get('/sessions/:id/agents', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const rows = await store.getAgentsForSession(sessionId)
  const agents = rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    agentType: r.agent_type || null,
    agentClass: r.agent_class || null,
  }))
  return c.json(agents)
})

// GET /sessions/:id/events
router.get('/sessions/:id/events', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const sinceParam = c.req.query('since')
  const agentIdParam = c.req.query('agentId')

  const rows = sinceParam
    ? await store.getEventsSince(sessionId, parseInt(sinceParam))
    : await store.getEventsForSession(sessionId, {
        agentIds: agentIdParam ? agentIdParam.split(',') : undefined,
        hookName: c.req.query('hookName') || undefined,
        search: c.req.query('search') || undefined,
        limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
        offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
      })

  const events: ParsedEvent[] = rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    sessionId: r.session_id,
    hookName: r.hook_name,
    timestamp: r.timestamp,
    createdAt: r.created_at || r.timestamp,
    cwd: r.cwd ?? null,
    _meta: r._meta ? JSON.parse(r._meta) : null,
    payload: JSON.parse(r.payload),
  }))

  // Lazy session status correction based on event history.
  // Phase 2: still uses the route's existing legacy compatibility wrapper
  // (`updateSessionStatus`) which now writes only to `stopped_at`.
  if (events.length > 0) {
    let lastSessionEndIdx = -1
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].hookName === 'SessionEnd') {
        lastSessionEndIdx = i
        break
      }
    }
    const session = await store.getSessionById(sessionId)
    if (session) {
      const isStopped = !!session.stopped_at
      if (lastSessionEndIdx >= 0 && lastSessionEndIdx === events.length - 1 && !isStopped) {
        await store.updateSessionStatus(sessionId, 'stopped')
      } else if (lastSessionEndIdx >= 0 && lastSessionEndIdx < events.length - 1 && isStopped) {
        await store.updateSessionStatus(sessionId, 'active')
      } else if (lastSessionEndIdx < 0 && isStopped) {
        await store.updateSessionStatus(sessionId, 'active')
      }
    }
  }

  return c.json(events)
})

// PATCH /sessions/:id — update session table fields (slug, projectId)
router.patch('/sessions/:id', async (c) => {
  const store = c.get('store')
  const broadcastToAll = c.get('broadcastToAll')

  try {
    const sessionId = decodeURIComponent(c.req.param('id'))
    const data = (await c.req.json()) as Record<string, unknown>

    if (typeof data.slug === 'string') {
      const slug = data.slug.trim()
      if (!slug) return apiError(c, 400, 'slug must not be empty')
      await store.updateSessionSlug(sessionId, slug)

      if (LOG_LEVEL === 'debug') {
        console.log(`[METADATA] Session ${sessionId.slice(0, 8)} slug: ${slug}`)
      }

      broadcastToAll({ type: 'session_update', data: { id: sessionId, slug } as any })
    }

    if (data.projectId && typeof data.projectId === 'number') {
      await store.updateSessionProject(sessionId, data.projectId)
      broadcastToAll({
        type: 'session_update',
        data: { id: sessionId, projectId: data.projectId },
      })
    }

    return c.json({ ok: true })
  } catch {
    return apiError(c, 400, 'Invalid request')
  }
})

// PATCH /sessions/:id/metadata — merge keys into session metadata JSON
router.patch('/sessions/:id/metadata', async (c) => {
  const store = c.get('store')

  try {
    const sessionId = decodeURIComponent(c.req.param('id'))
    const patch = (await c.req.json()) as Record<string, unknown>

    if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
      return apiError(c, 400, 'Provide at least one key to patch')
    }

    await store.patchSessionMetadata(sessionId, patch)
    return c.json({ ok: true })
  } catch {
    return apiError(c, 400, 'Invalid request')
  }
})

export default router
