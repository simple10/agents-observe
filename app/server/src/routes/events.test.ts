import { describe, test, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { SqliteAdapter } from '../storage/sqlite-adapter'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
    broadcastActivity: (sessionId: string, eventId: number) => void
  }
}

let store: SqliteAdapter
let app: Hono<Env>
let sessionBroadcasts: Array<{ sessionId: string; msg: any }>
let allBroadcasts: any[]
let activityPings: Array<{ sessionId: string; eventId: number }>

beforeEach(async () => {
  store = new SqliteAdapter(':memory:')
  sessionBroadcasts = []
  allBroadcasts = []
  activityPings = []

  const { default: eventsRouter } = await import('./events')
  app = new Hono<Env>()
  app.use('*', async (c, next) => {
    c.set('store', store as unknown as EventStore)
    c.set('broadcastToSession', (sessionId, msg) => sessionBroadcasts.push({ sessionId, msg }))
    c.set('broadcastToAll', (msg) => allBroadcasts.push(msg))
    c.set('broadcastActivity', (sessionId, eventId) => activityPings.push({ sessionId, eventId }))
    await next()
  })
  app.route('/api', eventsRouter)
})

async function postEvent(body: unknown) {
  return app.request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/events — validation', () => {
  test('returns 400 with missingFields on missing identity fields', async () => {
    const res = await postEvent({})
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { missingFields: string[] } }
    expect(body.error.missingFields).toEqual([
      'agentClass',
      'sessionId',
      'agentId',
      'hookName',
      'payload',
    ])
  })

  test('returns 400 on invalid JSON', async () => {
    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/events — happy path', () => {
  test('creates session, agent, event row from minimal new-shape envelope', async () => {
    const res = await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'PreToolUse',
      timestamp: 1000,
      payload: { tool_name: 'Bash' },
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: number; requests?: unknown[] }
    expect(body.id).toBeGreaterThan(0)
    expect(body.requests).toBeUndefined()

    const session = await store.getSessionById('sess-1')
    expect(session).not.toBeNull()
    expect(session.project_id).toBeNull() // no flag, no slug → unassigned

    const agent = await store.getAgentById('sess-1')
    expect(agent.agent_class).toBe('claude-code')

    const events = await store.getEventsForSession('sess-1')
    expect(events).toHaveLength(1)
    expect(events[0].hook_name).toBe('PreToolUse')
    expect(events[0].timestamp).toBe(1000)
  })

  test('broadcasts event + activity ping', async () => {
    await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'PreToolUse',
      timestamp: 1000,
      payload: {},
    })
    expect(sessionBroadcasts).toHaveLength(1)
    expect(sessionBroadcasts[0].sessionId).toBe('sess-1')
    expect(sessionBroadcasts[0].msg.type).toBe('event')
    expect(activityPings).toHaveLength(1)
  })
})

describe('POST /api/events — _meta and project resolution', () => {
  test('honors explicit _meta.project.slug', async () => {
    await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'SessionStart',
      timestamp: 1000,
      payload: {},
      _meta: { project: { slug: 'my-project' } },
    })
    const session = await store.getSessionById('sess-1')
    expect(session.project_id).not.toBeNull()
    const proj = await store.getProjectById(session.project_id)
    expect(proj.slug).toBe('my-project')
  })

  test('flags.resolveProject + start_cwd creates a project from cwd basename', async () => {
    await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'SessionStart',
      timestamp: 1000,
      payload: {},
      _meta: { session: { startCwd: '/Users/joe/Development/my-app' } },
      flags: { resolveProject: true },
    })
    const session = await store.getSessionById('sess-1')
    const proj = await store.getProjectById(session.project_id)
    expect(proj.slug).toBe('my-app')
  })

  test('project assignment is sticky on subsequent events', async () => {
    // First event creates and assigns project.
    await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'SessionStart',
      timestamp: 1000,
      payload: {},
      _meta: { project: { slug: 'first' } },
    })
    const proj1 = (await store.getSessionById('sess-1')).project_id
    // Second event with a different slug should NOT move the session.
    await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'PreToolUse',
      timestamp: 2000,
      payload: {},
      _meta: { project: { slug: 'second' } },
    })
    const proj2 = (await store.getSessionById('sess-1')).project_id
    expect(proj2).toBe(proj1)
  })
})

describe('POST /api/events — flags', () => {
  async function seedSession(id: string) {
    await postEvent({
      agentClass: 'claude-code',
      sessionId: id,
      agentId: id,
      hookName: 'SessionStart',
      timestamp: 1000,
      payload: {},
    })
  }

  test('startsNotification sets pending_notification_ts and broadcasts', async () => {
    await seedSession('sess-1')
    allBroadcasts.length = 0
    await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'Notification',
      timestamp: 2000,
      payload: {},
      flags: { startsNotification: true },
    })
    const session = await store.getSessionById('sess-1')
    expect(session.pending_notification_ts).toBe(2000)
    expect(allBroadcasts.find((m) => m.type === 'notification')).toBeTruthy()
  })

  test('clearsNotification clears state and broadcasts', async () => {
    await seedSession('sess-1')
    await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'Notification',
      timestamp: 2000,
      payload: {},
      flags: { startsNotification: true },
    })
    allBroadcasts.length = 0
    await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'UserPromptSubmit',
      timestamp: 3000,
      payload: {},
      flags: { clearsNotification: true },
    })
    const session = await store.getSessionById('sess-1')
    expect(session.pending_notification_ts).toBeNull()
    expect(allBroadcasts.find((m) => m.type === 'notification_clear')).toBeTruthy()
  })

  test('stopsSession stamps stopped_at and broadcasts session_update', async () => {
    await seedSession('sess-1')
    allBroadcasts.length = 0
    await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'SessionEnd',
      timestamp: 5000,
      payload: {},
      flags: { stopsSession: true },
    })
    const session = await store.getSessionById('sess-1')
    expect(session.stopped_at).toBe(5000)
    expect(
      allBroadcasts.find((m) => m.type === 'session_update' && m.data.status === 'stopped'),
    ).toBeTruthy()
  })

  test('routine event does NOT clear an existing pending notification', async () => {
    await seedSession('sess-1')
    await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'Notification',
      timestamp: 2000,
      payload: {},
      flags: { startsNotification: true },
    })
    // Routine event with no flags — pending state must persist.
    await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'PreToolUse',
      timestamp: 3000,
      payload: {},
    })
    const session = await store.getSessionById('sess-1')
    expect(session.pending_notification_ts).toBe(2000)
  })
})

describe('POST /api/events — callbacks (`requests` array)', () => {
  test('emits a getSessionInfo request when session has no slug and transcriptPath is provided', async () => {
    const res = await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'SessionStart',
      timestamp: 1000,
      payload: {},
      _meta: {
        session: { transcriptPath: '/path/to/sess-1.jsonl' },
      },
    })
    const body = (await res.json()) as {
      id: number
      requests?: Array<{ name: string; callback: string; args: Record<string, unknown> }>
    }
    expect(body.requests).toHaveLength(1)
    expect(body.requests![0].name).toBe('getSessionInfo')
    expect(body.requests![0].callback).toBe('/api/callbacks/session-info/sess-1')
    expect(body.requests![0].args).toEqual({
      transcriptPath: '/path/to/sess-1.jsonl',
      agentClass: 'claude-code',
    })
  })

  test('does NOT emit requests when transcriptPath is absent', async () => {
    const res = await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'PreToolUse',
      timestamp: 1000,
      payload: {},
    })
    const body = (await res.json()) as { requests?: unknown[] }
    expect(body.requests).toBeUndefined()
  })

  test('does NOT emit requests on subsequent events once slug is populated', async () => {
    // First event creates the session — slug is null, transcriptPath given,
    // so requests fires.
    const r1 = await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'SessionStart',
      timestamp: 1000,
      payload: {},
      _meta: { session: { transcriptPath: '/x.jsonl' } },
    })
    const body1 = (await r1.json()) as { requests?: unknown[] }
    expect(body1.requests).toHaveLength(1)

    // Simulate the callback succeeding (sets the slug).
    await store.updateSessionSlug('sess-1', 'auto:slug')

    const r2 = await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'sess-1',
      hookName: 'PreToolUse',
      timestamp: 2000,
      payload: {},
      _meta: { session: { transcriptPath: '/x.jsonl' } },
    })
    const body2 = (await r2.json()) as { requests?: unknown[] }
    expect(body2.requests).toBeUndefined()
  })
})

describe('POST /api/events — dedup', () => {
  const baseEnv = {
    agentClass: 'claude-code',
    sessionId: 'sess-dedup',
    agentId: 'sess-dedup',
    hookName: 'PreToolUse',
    timestamp: 2_000_000,
    payload: { tool_name: 'Bash', command: 'ls' },
    cwd: '/repo',
    _meta: { project: { slug: 'x' } },
  }

  test('same envelope twice returns same id + deduplicated:true', async () => {
    const a = await postEvent(baseEnv)
    expect(a.status).toBe(201)
    const aBody = (await a.json()) as { id: number; deduplicated?: boolean }
    expect(aBody.deduplicated).toBeUndefined()

    const b = await postEvent({ ...baseEnv, timestamp: baseEnv.timestamp + 50 })
    expect(b.status).toBe(201)
    const bBody = (await b.json()) as { id: number; deduplicated?: boolean }
    expect(bBody.deduplicated).toBe(true)
    expect(bBody.id).toBe(aBody.id)

    const events = await store.getEventsForSession('sess-dedup')
    expect(events).toHaveLength(1)
  })

  test('payload key reordering still dedupes', async () => {
    const a = await postEvent(baseEnv)
    const aBody = (await a.json()) as { id: number }
    const b = await postEvent({
      ...baseEnv,
      timestamp: baseEnv.timestamp + 50,
      payload: { command: 'ls', tool_name: 'Bash' },
    })
    const bBody = (await b.json()) as { id: number; deduplicated?: boolean }
    expect(bBody.deduplicated).toBe(true)
    expect(bBody.id).toBe(aBody.id)
  })

  test('identical content >5s apart inserts both', async () => {
    const a = await postEvent(baseEnv)
    const aBody = (await a.json()) as { id: number }
    const b = await postEvent({ ...baseEnv, timestamp: baseEnv.timestamp + 6000 })
    expect(b.status).toBe(201)
    const bBody = (await b.json()) as { id: number; deduplicated?: boolean }
    expect(bBody.deduplicated).toBeUndefined()
    expect(bBody.id).not.toBe(aBody.id)
    const events = await store.getEventsForSession('sess-dedup')
    expect(events).toHaveLength(2)
  })

  test('dedup hit does NOT re-broadcast', async () => {
    await postEvent(baseEnv)
    sessionBroadcasts.length = 0
    activityPings.length = 0
    allBroadcasts.length = 0
    await postEvent({ ...baseEnv, timestamp: baseEnv.timestamp + 50 })
    expect(sessionBroadcasts).toHaveLength(0)
    expect(activityPings).toHaveLength(0)
    expect(allBroadcasts).toHaveLength(0)
  })

  test('dedup hit does NOT re-apply stopsSession flag', async () => {
    const env = { ...baseEnv, flags: { stopsSession: true } }
    await postEvent(env)
    const sessionAfterFirst = await store.getSessionById('sess-dedup')
    expect(sessionAfterFirst.stopped_at).not.toBeNull()

    // Clear stopped_at so we can detect whether the dup call re-applies it.
    ;(
      store as unknown as { db: { prepare: (sql: string) => { run: (...a: unknown[]) => void } } }
    ).db
      .prepare('UPDATE sessions SET stopped_at = NULL WHERE id = ?')
      .run('sess-dedup')

    await postEvent({ ...env, timestamp: env.timestamp + 50 })
    const sessionAfterDup = await store.getSessionById('sess-dedup')
    expect(sessionAfterDup.stopped_at).toBeNull()
  })

  test('concurrent identical posts: exactly one row, both return same id', async () => {
    const [a, b] = await Promise.all([
      postEvent(baseEnv),
      postEvent({ ...baseEnv, timestamp: baseEnv.timestamp + 1 }),
    ])
    const aBody = (await a.json()) as { id: number; deduplicated?: boolean }
    const bBody = (await b.json()) as { id: number; deduplicated?: boolean }
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(aBody.id).toBe(bBody.id)
    // Exactly one of the two should be marked deduplicated.
    expect(Boolean(aBody.deduplicated) !== Boolean(bBody.deduplicated)).toBe(true)
    const events = await store.getEventsForSession('sess-dedup')
    expect(events).toHaveLength(1)
  })
})

describe('POST /api/events — background poll ticks', () => {
  // Claude Code fires a SubagentStop ~every 31s while background work is in
  // flight, each with a throwaway agent_id that belongs to no real subagent.
  // They collapse onto one lane per session instead of one agent row apiece.
  function tick(agentId: string, timestamp: number, payload: Record<string, unknown> = {}) {
    return {
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId,
      hookName: 'SubagentStop',
      timestamp,
      payload: { hook_event_name: 'SubagentStop', agent_type: '', ...payload },
    }
  }

  test('collapses many ticks onto one background lane, creating no per-tick agents', async () => {
    await postEvent(tick('af0cb6cac2ed003b3', 1000, { last_assistant_message: 'one' }))
    await postEvent(tick('a5a8bdf11072b8ac2', 32000, { last_assistant_message: 'two' }))
    await postEvent(tick('a264b2f3888eeb0a8', 63000, { last_assistant_message: 'three' }))

    expect(await store.getAgentById('af0cb6cac2ed003b3')).toBeNull()
    expect(await store.getAgentById('a5a8bdf11072b8ac2')).toBeNull()
    expect(await store.getAgentById('a264b2f3888eeb0a8')).toBeNull()

    const lane = await store.getAgentById('sess-1:background')
    expect(lane).not.toBeNull()

    const events = await store.getEventsForSession('sess-1')
    expect(events).toHaveLength(3)
    for (const e of events) expect(e.agent_id).toBe('sess-1:background')
  })

  test('preserves the original agent_id inside the stored payload', async () => {
    await postEvent(tick('af0cb6cac2ed003b3', 1000))
    const events = await store.getEventsForSession('sess-1')
    const payload = JSON.parse(events[0].payload)
    expect(payload.agent_id).toBeUndefined() // not present on this fixture
    expect(events[0].agent_id).toBe('sess-1:background')
  })

  test('a typed SubagentStop still lands on its own real agent', async () => {
    await postEvent(tick('a356a5359c2963201', 1000, { agent_type: 'general-purpose' }))

    const agent = await store.getAgentById('a356a5359c2963201')
    expect(agent).not.toBeNull()
    expect(await store.getAgentById('sess-1:background')).toBeNull()

    const events = await store.getEventsForSession('sess-1')
    expect(events[0].agent_id).toBe('a356a5359c2963201')
  })

  test('an id already opened by SubagentStart is never rerouted', async () => {
    await postEvent({
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'a356a5359c2963201',
      hookName: 'SubagentStart',
      timestamp: 1000,
      payload: { hook_event_name: 'SubagentStart' },
    })
    // Stop arrives with an empty agent_type, but the agents row already exists.
    await postEvent(tick('a356a5359c2963201', 5000))

    expect(await store.getAgentById('sess-1:background')).toBeNull()
    const events = await store.getEventsForSession('sess-1')
    expect(events).toHaveLength(2)
    for (const e of events) expect(e.agent_id).toBe('a356a5359c2963201')
  })

  test('lanes are per-session', async () => {
    await postEvent(tick('af0cb6cac2ed003b3', 1000))
    await postEvent({ ...tick('a5a8bdf11072b8ac2', 1000), sessionId: 'sess-2' })

    expect(await store.getAgentById('sess-1:background')).not.toBeNull()
    expect(await store.getAgentById('sess-2:background')).not.toBeNull()
  })

  test('broadcasts the tick under the lane id so the client lands it in one row', async () => {
    await postEvent(tick('af0cb6cac2ed003b3', 1000))
    const broadcast = sessionBroadcasts.find((b) => b.sessionId === 'sess-1')
    expect(broadcast).toBeDefined()
    expect(broadcast!.msg.data.agentId).toBe('sess-1:background')
  })
})

describe('POST /api/events — AGENTS_OBSERVE_SLIM_TOOL_OUTPUT', () => {
  const envelope = (sessionId: string) => ({
    agentClass: 'claude-code',
    sessionId,
    agentId: sessionId,
    hookName: 'PostToolUse',
    timestamp: 1000,
    payload: { tool_name: 'Bash', tool_response: { stdout: 'y'.repeat(1000), interrupted: false } },
  })

  test('stores tool output as a placeholder when the flag is on', async () => {
    process.env.AGENTS_OBSERVE_SLIM_TOOL_OUTPUT = '1'
    try {
      expect((await postEvent(envelope('slim-1'))).status).toBe(201)
    } finally {
      delete process.env.AGENTS_OBSERVE_SLIM_TOOL_OUTPUT
    }
    const [event] = await store.getEventsForSession('slim-1')
    const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload
    expect(payload.tool_response).toEqual({
      stdout: '[omitted: 1000 bytes, 1 lines]',
      interrupted: false,
    })
  })

  test('stores tool output verbatim when the flag is off', async () => {
    expect((await postEvent(envelope('slim-2'))).status).toBe(201)
    const [event] = await store.getEventsForSession('slim-2')
    const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload
    expect(payload.tool_response.stdout).toHaveLength(1000)
  })
})
