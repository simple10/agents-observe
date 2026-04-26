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

describe('POST /api/events — legacy compatibility', () => {
  test('accepts the pre-Phase-4 `{ hook_payload, meta }` envelope', async () => {
    const res = await postEvent({
      hook_payload: {
        hook_event_name: 'PreToolUse',
        session_id: 'legacy-sess',
        tool_name: 'Bash',
        cwd: '/Users/joe/repo',
      },
      meta: {
        agentClass: 'claude-code',
        hookName: 'PreToolUse',
        sessionId: 'legacy-sess',
      },
    })
    expect(res.status).toBe(201)
    const events = await store.getEventsForSession('legacy-sess')
    expect(events).toHaveLength(1)
    expect(events[0].hook_name).toBe('PreToolUse')
    const session = await store.getSessionById('legacy-sess')
    expect(session.start_cwd).toBe('/Users/joe/repo')
  })
})
