// app/server/src/routes/events.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { ParsedEvent } from '../types'
import { parseRawEvent } from '../parser'

type Env = {
  Variables: {
    store: EventStore
    broadcast: (msg: object) => void
  }
}

const router = new Hono<Env>()

const LOG_LEVEL = process.env.SERVER_LOG_LEVEL || 'debug'

// Track root agent IDs per session (sessionId -> agentId)
const sessionRootAgents = new Map<string, string>()

async function ensureRootAgent(
  store: EventStore,
  sessionId: string,
  slug: string | null,
  timestamp: number,
): Promise<string> {
  let rootId = sessionRootAgents.get(sessionId)
  if (!rootId) {
    rootId = sessionId
    await store.upsertAgent(rootId, sessionId, null, slug, null, timestamp)
    sessionRootAgents.set(sessionId, rootId)
  }
  return rootId
}

// POST /events
router.post('/events', async (c) => {
  const store = c.get('store')
  const broadcast = c.get('broadcast')

  try {
    const raw = await c.req.json()

    if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace') {
      const logKeys = Object.keys(raw).join(', ')
      const payload = JSON.stringify(raw)
      const logPayload =
        LOG_LEVEL === 'trace'
          ? `Payload: ${payload}`
          : `Keys: ${logKeys} \nPayload: ${payload.slice(0, 500)}`

      if (raw.hook_event_name) {
        const toolInfo = raw.tool_name
          ? `tool:${raw.tool_name} tool_use_id:${raw.tool_use_id}`
          : ''
        console.log(`[HOOK:${raw.hook_event_name}] ${toolInfo} \n${logPayload}\n---`)
      } else {
        console.log('[EVENT]', logPayload)
      }
    }

    const parsed = parseRawEvent(raw)

    await store.upsertProject(parsed.projectName, parsed.projectName)
    await store.upsertSession(
      parsed.sessionId,
      parsed.projectName,
      parsed.slug,
      Object.keys(parsed.metadata).length > 0 ? parsed.metadata : null,
      parsed.timestamp,
    )

    const rootAgentId = await ensureRootAgent(store, parsed.sessionId, parsed.slug, parsed.timestamp)

    // If the event has an ownerAgentId (from payload.agent_id), this event
    // belongs to that agent. Ensure the agent record exists.
    if (parsed.ownerAgentId && parsed.ownerAgentId !== rootAgentId) {
      await store.upsertAgent(
        parsed.ownerAgentId,
        parsed.sessionId,
        rootAgentId,
        null,
        null,
        parsed.timestamp,
      )
    }
    let agentId = parsed.ownerAgentId || rootAgentId

    // Create/update subagent records (from Agent tool PostToolUse or SubagentStop)
    if (parsed.subAgentId) {
      await store.upsertAgent(
        parsed.subAgentId,
        parsed.sessionId,
        rootAgentId,
        null,
        parsed.subAgentName,
        parsed.timestamp,
      )

      // agent_progress events belong to the subagent
      if (parsed.subtype === 'agent_progress') {
        agentId = parsed.subAgentId
      }
    }

    // Handle stop events
    if (parsed.type === 'system' && parsed.subtype === 'stop_hook_summary') {
      await store.updateAgentStatus(rootAgentId, 'stopped')
      await store.updateSessionStatus(parsed.sessionId, 'stopped')
    }

    // SubagentStop: mark the subagent as stopped
    if (parsed.subtype === 'SubagentStop' && parsed.subAgentId) {
      await store.updateAgentStatus(parsed.subAgentId, 'stopped')
    }

    // Set status for tool events
    let status = 'pending'
    if (parsed.subtype === 'PreToolUse') status = 'running'
    else if (parsed.subtype === 'PostToolUse') status = 'completed'

    const eventId = await store.insertEvent({
      agentId,
      sessionId: parsed.sessionId,
      type: parsed.type,
      subtype: parsed.subtype,
      toolName: parsed.toolName,
      summary: null, // computed client-side
      timestamp: parsed.timestamp,
      payload: parsed.raw,
      toolUseId: parsed.toolUseId,
      status,
    })

    const event: ParsedEvent = {
      id: eventId,
      agentId,
      sessionId: parsed.sessionId,
      type: parsed.type,
      subtype: parsed.subtype,
      toolName: parsed.toolName,
      toolUseId: parsed.toolUseId,
      status,
      timestamp: parsed.timestamp,
      payload: parsed.raw,
    }

    broadcast({ type: 'event', data: event })

    // Build response -- request local data if the server is missing info
    const requests: Array<{ cmd: string; args: Record<string, unknown>; callback: string }> = []

    // Request session slug if missing
    if (parsed.raw.transcript_path) {
      const session = await store.getSessionById(parsed.sessionId)
      if (session && !session.slug) {
        requests.push({
          cmd: 'getSessionSlug',
          args: { transcript_path: parsed.raw.transcript_path },
          callback: `/api/sessions/${encodeURIComponent(parsed.sessionId)}/metadata`,
        })
      }
    }

    // On SubagentStop, request subagent slug from its transcript
    if (
      parsed.subtype === 'SubagentStop' &&
      parsed.subAgentId &&
      parsed.raw.agent_transcript_path
    ) {
      requests.push({
        cmd: 'getSessionSlug',
        args: { transcript_path: parsed.raw.agent_transcript_path },
        callback: `/api/agents/${encodeURIComponent(parsed.subAgentId)}/metadata`,
      })
    }

    return c.json({ ok: true, id: eventId, ...(requests.length > 0 ? { requests } : {}) }, 201)
  } catch (error) {
    console.error('Error processing event:', error)
    return c.json({ error: 'Invalid request' }, 400)
  }
})

// GET /events/:id/thread
router.get('/events/:id/thread', async (c) => {
  const store = c.get('store')
  const eventId = parseInt(c.req.param('id'))
  const rows = await store.getThreadForEvent(eventId)
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

/** Expose for clearing on DELETE /api/data */
export function clearSessionRootAgents(): void {
  sessionRootAgents.clear()
}

export default router
