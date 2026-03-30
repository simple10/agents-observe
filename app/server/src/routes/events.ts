// app/server/src/routes/events.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { Agent, ParsedEvent } from '../types'
import { parseRawEvent } from '../parser'
import { resolveProject } from '../services/project-resolver'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

const router = new Hono<Env>()

const LOG_LEVEL = process.env.CLAUDE_OBSERVE_LOG_LEVEL || 'debug'

// Track root agent IDs per session (sessionId -> agentId)
const sessionRootAgents = new Map<string, string>()

// Track pending Agent tool descriptions so we can name subagents early.
// When PreToolUse:Agent fires, we store the description keyed by tool_use_id
// and also push it onto a per-session FIFO queue. The queue is necessary because
// subagent events carry only agent_id (not the parent tool_use_id), so we can't
// directly look up by tool_use_id when a new subagent first appears.
//
// When multiple Agent tools are invoked concurrently (e.g. two subagents spawned
// in the same turn), each gets its own queue entry so names are assigned 1:1.
const pendingAgentNames = new Map<string, string>() // toolUseId -> description
const pendingAgentTypes = new Map<string, string>() // toolUseId -> subagent_type
const pendingAgentNameQueue = new Map<string, string[]>() // sessionId -> FIFO queue of descriptions
const namedAgents = new Map<string, Set<string>>() // sessionId -> set of agent IDs already named via queue

async function getAgentForBroadcast(store: EventStore, agentId: string): Promise<Agent | null> {
  const row = await store.getAgentById(agentId)
  if (!row) return null
  return {
    id: row.id,
    sessionId: row.session_id,
    parentAgentId: row.parent_agent_id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    eventCount: row.event_count,
    agentType: row.agent_type || null,
  }
}

async function ensureRootAgent(
  store: EventStore,
  sessionId: string,
  slug: string | null,
  timestamp: number,
): Promise<{ id: string; created: boolean }> {
  let rootId = sessionRootAgents.get(sessionId)
  if (!rootId) {
    rootId = sessionId
    await store.upsertAgent(rootId, sessionId, null, slug, null, timestamp)
    sessionRootAgents.set(sessionId, rootId)
    return { id: rootId, created: true }
  }
  return { id: rootId, created: false }
}

// POST /events
router.post('/events', async (c) => {
  const store = c.get('store')
  const broadcastToSession = c.get('broadcastToSession')
  const broadcastToAll = c.get('broadcastToAll')

  try {
    const body = await c.req.json()

    // Support both envelope format and legacy flat format
    let hookPayload: Record<string, unknown>
    let meta: { env?: Record<string, string> } = {}

    if (body.hook_payload) {
      hookPayload = body.hook_payload as Record<string, unknown>
      meta = (body.meta as typeof meta) || {}
    } else {
      hookPayload = body
    }

    if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace') {
      const logKeys = Object.keys(hookPayload).join(', ')
      const payload = JSON.stringify(hookPayload)
      const logPayload =
        LOG_LEVEL === 'trace'
          ? `Payload: ${payload}`
          : `Keys: ${logKeys} \nPayload: ${payload.slice(0, 500)}`

      if (hookPayload.hook_event_name) {
        const toolInfo = hookPayload.tool_name ? `tool:${hookPayload.tool_name} tool_use_id:${hookPayload.tool_use_id}` : ''
        console.log(`[HOOK:${hookPayload.hook_event_name}] ${toolInfo} \n${logPayload}\n---`)
      } else {
        console.log('[EVENT]', logPayload)
      }
    }

    const parsed = parseRawEvent(hookPayload)

    // Resolve project - only on first event for this session
    const existingSession = await store.getSessionById(parsed.sessionId)
    let effectiveProjectId: number

    if (existingSession) {
      effectiveProjectId = existingSession.project_id
    } else {
      const projectSlugOverride = meta.env?.CLAUDE_OBSERVE_PROJECT_SLUG || null
      const resolved = await resolveProject(store, {
        sessionId: parsed.sessionId,
        slug: projectSlugOverride,
        transcriptPath: parsed.transcriptPath,
      })
      effectiveProjectId = resolved.projectId
    }

    await store.upsertSession(
      parsed.sessionId,
      effectiveProjectId,
      parsed.slug,
      Object.keys(parsed.metadata).length > 0 ? parsed.metadata : null,
      parsed.timestamp,
    )

    const { id: rootAgentId, created: rootAgentCreated } = await ensureRootAgent(
      store,
      parsed.sessionId,
      parsed.slug,
      parsed.timestamp,
    )

    // Broadcast root agent only when first created
    if (rootAgentCreated) {
      const rootAgentData = await getAgentForBroadcast(store, rootAgentId)
      if (rootAgentData) {
        broadcastToSession(parsed.sessionId, { type: 'agent_update', data: rootAgentData })
      }
    }

    // When PreToolUse:Agent fires, stash the description for early naming.
    // We store it both by toolUseId (for definitive lookup at PostToolUse) and
    // in a per-session FIFO queue (for early naming when subagent events arrive
    // before PostToolUse, since those events don't carry the parent tool_use_id).
    if (parsed.subtype === 'PreToolUse' && parsed.toolName === 'Agent') {
      if (parsed.subAgentName) {
        if (parsed.toolUseId) {
          pendingAgentNames.set(parsed.toolUseId, parsed.subAgentName)
        }
        const queue = pendingAgentNameQueue.get(parsed.sessionId) || []
        queue.push(parsed.subAgentName)
        pendingAgentNameQueue.set(parsed.sessionId, queue)
      }
      // Stash agent type from tool_input.subagent_type
      const agentType = (hookPayload as any)?.tool_input?.subagent_type
      if (agentType && parsed.toolUseId) {
        pendingAgentTypes.set(parsed.toolUseId, agentType)
      }
    }

    // If the event has an ownerAgentId (from payload.agent_id), this event
    // belongs to that agent. Ensure the agent record exists.
    if (parsed.ownerAgentId && parsed.ownerAgentId !== rootAgentId) {
      // Only consume a queue entry for agents we haven't named yet.
      // This prevents subsequent events from the same agent re-consuming names
      // that belong to other agents.
      const sessionNamed = namedAgents.get(parsed.sessionId)
      const alreadyNamed = sessionNamed?.has(parsed.ownerAgentId) ?? false
      let pendingName: string | null = null

      if (!alreadyNamed) {
        // Consume the next name from the FIFO queue for this session
        const queue = pendingAgentNameQueue.get(parsed.sessionId)
        if (queue && queue.length > 0) {
          pendingName = queue.shift()!
          if (queue.length === 0) {
            pendingAgentNameQueue.delete(parsed.sessionId)
          }
        }
        // Track that we've named this agent via the queue
        if (pendingName) {
          if (!sessionNamed) {
            namedAgents.set(parsed.sessionId, new Set([parsed.ownerAgentId]))
          } else {
            sessionNamed.add(parsed.ownerAgentId)
          }
        }
      }

      await store.upsertAgent(
        parsed.ownerAgentId,
        parsed.sessionId,
        rootAgentId,
        null,
        pendingName,
        parsed.timestamp,
      )
      const ownerAgentData = await getAgentForBroadcast(store, parsed.ownerAgentId)
      if (ownerAgentData) {
        broadcastToSession(parsed.sessionId, { type: 'agent_update', data: ownerAgentData })
      }
    }
    let agentId = parsed.ownerAgentId || rootAgentId

    // Create/update subagent records (from Agent tool PostToolUse or SubagentStop)
    if (parsed.subAgentId) {
      // For PostToolUse:Agent, prefer the name from the toolUseId-keyed map
      // (set at PreToolUse time) since parsed.subAgentName comes from the same
      // tool_input. Also clean up the pending map entry.
      let subAgentName = parsed.subAgentName
      let subAgentType: string | null = null
      if (parsed.subtype === 'PostToolUse' && parsed.toolName === 'Agent' && parsed.toolUseId) {
        const nameFromPre = pendingAgentNames.get(parsed.toolUseId)
        if (nameFromPre) {
          subAgentName = subAgentName || nameFromPre
          pendingAgentNames.delete(parsed.toolUseId)
        }
        subAgentType = pendingAgentTypes.get(parsed.toolUseId) ?? null
        pendingAgentTypes.delete(parsed.toolUseId)
      }

      await store.upsertAgent(
        parsed.subAgentId,
        parsed.sessionId,
        rootAgentId,
        null,
        subAgentName,
        parsed.timestamp,
        subAgentType,
      )
      const subAgentData = await getAgentForBroadcast(store, parsed.subAgentId)
      if (subAgentData) {
        broadcastToSession(parsed.sessionId, { type: 'agent_update', data: subAgentData })
      }

      // agent_progress events belong to the subagent
      if (parsed.subtype === 'agent_progress') {
        agentId = parsed.subAgentId
      }
    }

    // Handle stop events — Stop hook marks root agent inactive;
    // any subsequent event reactivates it.
    // Session status is independent: only SessionEnd marks a session as stopped.
    if (parsed.subtype === 'Stop' || parsed.subtype === 'stop_hook_summary') {
      await store.updateAgentStatus(rootAgentId, 'stopped')
      const agentData = await getAgentForBroadcast(store, rootAgentId)
      if (agentData) {
        broadcastToSession(parsed.sessionId, { type: 'agent_update', data: agentData })
      }
    } else if (parsed.subtype === 'SessionEnd') {
      await store.updateAgentStatus(rootAgentId, 'stopped')
      await store.updateSessionStatus(parsed.sessionId, 'stopped')
      const agentData = await getAgentForBroadcast(store, rootAgentId)
      if (agentData) {
        broadcastToSession(parsed.sessionId, { type: 'agent_update', data: agentData })
      }
      broadcastToAll({
        type: 'session_update',
        data: { id: parsed.sessionId, status: 'stopped' },
      })
    } else {
      // Reactivate root agent and session if previously stopped
      const agent = await store.getAgentById(rootAgentId)
      if (agent && agent.status === 'stopped') {
        await store.updateAgentStatus(rootAgentId, 'active')
        const agentData = await getAgentForBroadcast(store, rootAgentId)
        if (agentData) {
          broadcastToSession(parsed.sessionId, { type: 'agent_update', data: agentData })
        }
      }
      const session = await store.getSessionById(parsed.sessionId)
      if (session && session.status === 'stopped') {
        await store.updateSessionStatus(parsed.sessionId, 'active')
        broadcastToAll({
          type: 'session_update',
          data: { id: parsed.sessionId, status: 'active' },
        })
      }
    }

    // SubagentStop: mark the subagent as stopped
    if (parsed.subtype === 'SubagentStop' && parsed.subAgentId) {
      await store.updateAgentStatus(parsed.subAgentId, 'stopped')
      const agentData = await getAgentForBroadcast(store, parsed.subAgentId)
      if (agentData) {
        broadcastToSession(parsed.sessionId, { type: 'agent_update', data: agentData })
      }
    }

    // PostToolUse:Agent completion also marks the subagent as stopped.
    // SubagentStop hook is unreliable and sometimes doesn't fire,
    // but PostToolUse:Agent always fires when the agent task completes.
    if (parsed.subtype === 'PostToolUse' && parsed.toolName === 'Agent' && parsed.subAgentId) {
      await store.updateAgentStatus(parsed.subAgentId, 'stopped')
      const agentData = await getAgentForBroadcast(store, parsed.subAgentId)
      if (agentData) {
        broadcastToSession(parsed.sessionId, { type: 'agent_update', data: agentData })
      }
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

    broadcastToSession(parsed.sessionId, { type: 'event', data: event })

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

    const responseBody: Record<string, unknown> = {
      status: 'OK',
      meta: {
        event_id: eventId,
        session_id: parsed.sessionId,
        project_id: effectiveProjectId,
      },
    }

    if (requests.length > 0) {
      responseBody.requests = requests
    }

    return c.json(responseBody, 201)
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

/** Remove a single session from the in-memory root agent cache */
export function removeSessionRootAgent(sessionId: string): void {
  sessionRootAgents.delete(sessionId)
  pendingAgentNameQueue.delete(sessionId)
  namedAgents.delete(sessionId)
  // pendingAgentNames is keyed by toolUseId, not sessionId, so we can't
  // selectively clean it here — entries are cleaned up at PostToolUse time.
}

/** Clear all in-memory session state */
export function clearSessionRootAgents(): void {
  sessionRootAgents.clear()
  pendingAgentNames.clear()
  pendingAgentNameQueue.clear()
  namedAgents.clear()
}

export default router
