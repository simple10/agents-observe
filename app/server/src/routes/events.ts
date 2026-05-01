// app/server/src/routes/events.ts
//
// Per the three-layer contract spec
// (docs/specs/2026-04-25-three-layer-contract-design.md
// §"Layer 2 Contract — Server Behavior"). Steps:
//
//   1. Validate envelope.
//   2. Upsert session (consume _meta.session.* on first write only).
//   3. Resolve project (sticky after first assignment).
//   4. Upsert agent (consume _meta.agent.* on first write; agent_class
//      locked at first write).
//   5. Insert event row.
//   6. Apply flags in spec order: clear → start → stop.
//   7. Compose response — including a `requests` array of named
//      callbacks when state is missing (see Task 3.6).
//   8. Broadcast.

import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { EventEnvelope, ParsedEvent } from '../types'
import { validateEnvelope, EnvelopeValidationError } from '../parser'
import { resolveProject } from '../services/project-resolver'
import { config } from '../config'
import { apiError } from '../errors'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
    broadcastActivity: (sessionId: string, eventId: number, projectId: number | null) => void
  }
}

const router = new Hono<Env>()
const LOG_LEVEL = config.logLevel

router.post('/events', async (c) => {
  const store = c.get('store')
  const broadcastToSession = c.get('broadcastToSession')
  const broadcastToAll = c.get('broadcastToAll')
  const broadcastActivity = c.get('broadcastActivity')

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return apiError(c, 400, 'Invalid JSON body')
  }

  let envelope: EventEnvelope
  let timestamp: number
  try {
    const validated = validateEnvelope(raw)
    envelope = validated.envelope
    timestamp = validated.timestamp
  } catch (err) {
    if (err instanceof EnvelopeValidationError) {
      return c.json({ error: { message: err.message, missingFields: err.missingFields } }, 400)
    }
    throw err
  }

  if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace') {
    const payloadStr = JSON.stringify(envelope.payload)
    const trimmed = LOG_LEVEL === 'trace' ? payloadStr : payloadStr.slice(0, 500)
    console.log(
      `[HOOK:${envelope.hookName}] agentClass=${envelope.agentClass} session=${envelope.sessionId} ${trimmed}`,
    )
  }

  try {
    // ---- Step 2: upsert session ------------------------------------------
    // Read existing row first so we can tell whether this is a fresh
    // session — `requests` and project resolution both depend on that.
    const sessionBefore = await store.getSessionById(envelope.sessionId)
    const sessionHints = envelope._meta?.session
    await store.upsertSession(
      envelope.sessionId,
      sessionBefore?.project_id ?? null,
      sessionHints?.slug ?? null,
      sessionHints?.metadata ?? null,
      timestamp,
      sessionHints?.transcriptPath ?? null,
      sessionHints?.startCwd ?? null,
    )

    // Re-read so we work with the post-upsert canonical row (slug,
    // start_cwd, transcript_path now fully populated).
    const session = await store.getSessionById(envelope.sessionId)

    // ---- Step 3: project resolution --------------------------------------
    const resolvedProjectId = await resolveProject(store, {
      sessionId: envelope.sessionId,
      meta: envelope._meta?.project,
      flags: envelope.flags,
      startCwd: session?.start_cwd ?? null,
      transcriptPath: session?.transcript_path ?? null,
      currentProjectId: session?.project_id ?? null,
    })
    if (resolvedProjectId !== null && resolvedProjectId !== session?.project_id) {
      await store.updateSessionProject(envelope.sessionId, resolvedProjectId)
    }

    // ---- Step 4: upsert agent --------------------------------------------
    const agentHints = envelope._meta?.agent
    await store.upsertAgent(
      envelope.agentId,
      envelope.sessionId, // accepted for backwards-compat; not persisted
      null,
      agentHints?.name ?? null,
      agentHints?.description ?? null,
      agentHints?.type ?? null,
      envelope.agentClass,
    )

    // ---- Step 5: insert event row ----------------------------------------
    const eventStoreMeta: Record<string, unknown> | null = envelope._meta
      ? (envelope._meta as Record<string, unknown>)
      : null
    const { eventId } = await store.insertEvent({
      agentId: envelope.agentId,
      sessionId: envelope.sessionId,
      hookName: envelope.hookName,
      timestamp,
      payload: envelope.payload,
      cwd: envelope.cwd ?? null,
      _meta: eventStoreMeta,
    })

    // ---- Step 6: apply flags in spec order (clear → start → stop) --------
    const flags = envelope.flags ?? {}
    const wasPending = session?.pending_notification_ts ?? null
    let pendingTransition: 'set' | 'cleared' | 'none' = 'none'
    if (flags.clearsNotification) {
      await store.clearSessionNotification(envelope.sessionId)
      if (wasPending !== null) pendingTransition = 'cleared'
    }
    if (flags.startsNotification) {
      await store.startSessionNotification(envelope.sessionId, timestamp)
      // Set transition only if we weren't already pending (or just cleared).
      const wasJustCleared = pendingTransition === 'cleared'
      if (wasPending === null || wasJustCleared) pendingTransition = 'set'
    }
    if (flags.stopsSession) {
      await store.stopSession(envelope.sessionId, timestamp)
    }

    // ---- Step 7: compose response (callbacks) ----------------------------
    // Refresh session row so we see post-upsert slug + the freshly
    // created flag. A request fires only when the session lacks a slug
    // AND the envelope provided _meta.session.transcriptPath (the agent
    // class can satisfy `getSessionInfo`).
    const sessionAfter = await store.getSessionById(envelope.sessionId)
    const requests: Array<{
      name: string
      callback: string
      args: Record<string, unknown>
    }> = []
    if (sessionAfter && !sessionAfter.slug && envelope._meta?.session?.transcriptPath) {
      requests.push({
        name: 'getSessionInfo',
        callback: `/api/callbacks/session-info/${encodeURIComponent(envelope.sessionId)}`,
        args: {
          transcriptPath: envelope._meta.session.transcriptPath,
          agentClass: envelope.agentClass,
        },
      })
    }

    // Request token usage extraction when the session ends and we have
    // a transcript path. The hook reads the transcript JSONL, sums all
    // assistant message usage blocks, and POSTs the totals back.
    const transcriptPath =
      envelope._meta?.session?.transcriptPath ?? sessionAfter?.transcript_path ?? null
    if (flags.stopsSession && transcriptPath) {
      requests.push({
        name: 'getSessionUsage',
        callback: `/api/callbacks/session-usage/${encodeURIComponent(envelope.sessionId)}`,
        args: {
          transcriptPath,
          agentClass: envelope.agentClass,
        },
      })
    }

    // ---- Step 8: broadcast ------------------------------------------------
    const event: ParsedEvent = {
      id: eventId,
      agentId: envelope.agentId,
      sessionId: envelope.sessionId,
      hookName: envelope.hookName,
      timestamp,
      cwd: envelope.cwd ?? null,
      _meta: (envelope._meta as Record<string, unknown> | undefined) ?? null,
      payload: envelope.payload,
    }
    broadcastToSession(envelope.sessionId, { type: 'event', data: event })
    // Use the post-upsert canonical projectId — `resolvedProjectId` if
    // we just (re)assigned, otherwise whatever's already on the row.
    const broadcastProjectId =
      resolvedProjectId ?? (session?.project_id as number | null | undefined) ?? null
    broadcastActivity(envelope.sessionId, eventId, broadcastProjectId)

    if (flags.stopsSession) {
      broadcastToAll({
        type: 'session_update',
        data: { id: envelope.sessionId, status: 'stopped' },
      })
    }
    if (pendingTransition === 'set') {
      broadcastToAll({
        type: 'notification',
        data: {
          sessionId: envelope.sessionId,
          projectId: resolvedProjectId ?? sessionAfter?.project_id ?? null,
          ts: timestamp,
        },
      })
    } else if (pendingTransition === 'cleared') {
      broadcastToAll({
        type: 'notification_clear',
        data: { sessionId: envelope.sessionId, ts: timestamp },
      })
    }

    const responseBody: Record<string, unknown> = { id: eventId }
    if (requests.length > 0) responseBody.requests = requests
    return c.json(responseBody, 201)
  } catch (error) {
    console.error('Error processing event:', error)
    const message = error instanceof Error ? error.message : String(error)
    return apiError(c, 500, 'Failed to process event', { details: message })
  }
})

export default router
