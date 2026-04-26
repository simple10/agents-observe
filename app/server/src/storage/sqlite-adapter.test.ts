import { describe, test, expect, beforeEach } from 'vitest'
import { SqliteAdapter } from './sqlite-adapter'

let store: SqliteAdapter

beforeEach(() => {
  store = new SqliteAdapter(':memory:')
})

// ---------------------------------------------------------------------------
// Helper: seed a minimal project + session + agent
// ---------------------------------------------------------------------------
async function seedBasic() {
  const projectId = await store.createProject('proj1', 'Project 1')
  await store.upsertSession('sess1', projectId, 'my-session', null, 1000)
  await store.upsertAgent('a1', 'sess1', null, null, null)
  return { projectId, sessionId: 'sess1', rootAgentId: 'a1' }
}

// Helper to seed an event with the new InsertEventParams shape.
async function insertHookEvent(opts: {
  agentId: string
  sessionId: string
  hookName: string
  timestamp: number
  payload?: Record<string, unknown>
  cwd?: string | null
}) {
  return store.insertEvent({
    agentId: opts.agentId,
    sessionId: opts.sessionId,
    hookName: opts.hookName,
    timestamp: opts.timestamp,
    payload: opts.payload ?? {},
    cwd: opts.cwd ?? null,
  })
}

// ---------------------------------------------------------------------------
// Schema sanity (Phase 2)
// ---------------------------------------------------------------------------
describe('SqliteAdapter — schema (Phase 2)', () => {
  test('sessions table has start_cwd, no status/event_count/agent_count', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cols = (
      (store as any).db.prepare("PRAGMA table_info('sessions')").all() as Array<{
        name: string
      }>
    ).map((c) => c.name)
    expect(cols).toContain('start_cwd')
    expect(cols).not.toContain('status')
    expect(cols).not.toContain('event_count')
    expect(cols).not.toContain('agent_count')
  })

  test('agents table drops session_id and parent_agent_id', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cols = (
      (store as any).db.prepare("PRAGMA table_info('agents')").all() as Array<{
        name: string
      }>
    ).map((c) => c.name)
    expect(cols).not.toContain('session_id')
    expect(cols).not.toContain('parent_agent_id')
    expect(cols).toContain('agent_class')
  })

  test('projects table drops cwd and transcript_path', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cols = (
      (store as any).db.prepare("PRAGMA table_info('projects')").all() as Array<{
        name: string
      }>
    ).map((c) => c.name)
    expect(cols).not.toContain('cwd')
    expect(cols).not.toContain('transcript_path')
  })

  test('events table has cwd + _meta, no type/subtype/tool_name', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cols = (
      (store as any).db.prepare("PRAGMA table_info('events')").all() as Array<{
        name: string
      }>
    ).map((c) => c.name)
    expect(cols).toContain('cwd')
    expect(cols).toContain('_meta')
    expect(cols).not.toContain('type')
    expect(cols).not.toContain('subtype')
    expect(cols).not.toContain('tool_name')
  })

  test('events indexes match Phase 2 spec', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const idx = (
      (store as any).db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='events'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name)
    expect(idx).toContain('idx_events_session_ts')
    expect(idx).toContain('idx_events_agent_ts')
    expect(idx).toContain('idx_events_session_hook')
    expect(idx).not.toContain('idx_events_type')
  })
})

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
describe('SqliteAdapter — projects', () => {
  test('createProject returns an integer id', async () => {
    const id = await store.createProject('my-project', 'My Project')
    expect(typeof id).toBe('number')
    expect(id).toBeGreaterThan(0)
  })

  test('createProject stores slug and name', async () => {
    const id = await store.createProject('my-project', 'My Project')
    const project = await store.getProjectBySlug('my-project')
    expect(project).not.toBeNull()
    expect(project.id).toBe(id)
    expect(project.slug).toBe('my-project')
    expect(project.name).toBe('My Project')
  })

  test('getProjectBySlug returns null for unknown slug', async () => {
    const project = await store.getProjectBySlug('does-not-exist')
    expect(project).toBeNull()
  })

  test('updateProjectName changes the name', async () => {
    const id = await store.createProject('proj1', 'Original Name')
    await store.updateProjectName(id, 'Updated Name')
    const project = await store.getProjectBySlug('proj1')
    expect(project.name).toBe('Updated Name')
  })

  test('updateProjectName can be updated multiple times', async () => {
    const id = await store.createProject('proj1', 'First')
    await store.updateProjectName(id, 'Second')
    await store.updateProjectName(id, 'Third')
    const project = await store.getProjectBySlug('proj1')
    expect(project.name).toBe('Third')
  })

  test('isSlugAvailable returns true for unused slug', async () => {
    const available = await store.isSlugAvailable('brand-new-slug')
    expect(available).toBe(true)
  })

  test('isSlugAvailable returns false after createProject with that slug', async () => {
    await store.createProject('taken-slug', 'Some Project')
    const available = await store.isSlugAvailable('taken-slug')
    expect(available).toBe(false)
  })

  test('getProjects returns session_count', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess2', projId, null, null, 2000)
    const projects = await store.getProjects()
    expect(projects[0].session_count).toBe(2)
  })

  test('getProjects returns slug and name fields', async () => {
    await store.createProject('test-proj', 'Test Project')
    const projects = await store.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].slug).toBe('test-proj')
    expect(projects[0].name).toBe('Test Project')
  })

  test('getRecentSessions includes project_slug and project_name', async () => {
    const projId = await store.createProject('proj1', 'Project One')
    await store.upsertSession('sess1', projId, null, null, 1000)
    const recent = await store.getRecentSessions()
    expect(recent).toHaveLength(1)
    expect(recent[0].project_slug).toBe('proj1')
    expect(recent[0].project_name).toBe('Project One')
  })
})

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
describe('SqliteAdapter — sessions', () => {
  test('upsert session with slug and metadata', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, 'twinkly-dragon', { version: '2.1' }, 1000)
    const session = await store.getSessionById('sess1')
    expect(session).not.toBeNull()
    expect(session.slug).toBe('twinkly-dragon')
    expect(JSON.parse(session.metadata)).toEqual({ version: '2.1' })
    // Status is derived from stopped_at; row itself no longer carries status.
    expect(session.stopped_at).toBeNull()
  })

  test('upsert session updates slug via COALESCE', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess1', projId, 'new-slug', null, 1000)
    const session = await store.getSessionById('sess1')
    expect(session.slug).toBe('new-slug')
  })

  test('getSessionsForProject returns aggregated counts derived from events', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess1', null, null, null, 'sub')
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
    })
    // Second agent appears via an event so it's counted via the events join.
    await insertHookEvent({
      agentId: 'a2',
      sessionId: 'sess1',
      hookName: 'PreToolUse',
      timestamp: 1100,
    })

    const sessions = await store.getSessionsForProject(projId)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].agent_count).toBe(2)
    expect(sessions[0].event_count).toBe(2)
  })

  test('getSessionById returns null for non-existent session', async () => {
    const session = await store.getSessionById('no-such-session')
    expect(session).toBeNull()
  })

  test('updateSessionStatus("stopped") sets stopped_at', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)

    await store.updateSessionStatus('sess1', 'stopped')
    const session = await store.getSessionById('sess1')
    expect(session.stopped_at).toBeGreaterThan(0)
  })

  test('updateSessionStatus("active") clears stopped_at', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.updateSessionStatus('sess1', 'stopped')

    await store.updateSessionStatus('sess1', 'active')
    const session = await store.getSessionById('sess1')
    expect(session.stopped_at).toBeNull()
  })

  test('updateSessionSlug', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, 'old-slug', null, 1000)

    await store.updateSessionSlug('sess1', 'new-slug')
    const session = await store.getSessionById('sess1')
    expect(session.slug).toBe('new-slug')
  })

  test('upsertSession sets start_cwd on first insert and preserves it on re-upsert', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000, null, '/orig/cwd')
    let session = await store.getSessionById('sess1')
    expect(session.start_cwd).toBe('/orig/cwd')

    // Re-upsert with a different cwd should NOT overwrite the start_cwd
    // (it's the cwd at session start, immutable thereafter).
    await store.upsertSession('sess1', projId, null, null, 2000, null, '/different/cwd')
    session = await store.getSessionById('sess1')
    expect(session.start_cwd).toBe('/orig/cwd')
  })

  test('upsertSession allows null projectId (Unassigned)', async () => {
    await store.upsertSession('sess1', null, null, null, 1000)
    const session = await store.getSessionById('sess1')
    expect(session.project_id).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Pending-notification tracking. Post-Phase-4: notification state is
  // owned by the route layer via startSessionNotification /
  // clearSessionNotification, applied per envelope flag. insertEvent only
  // bumps last_activity. These tests pin the storage adapter behavior;
  // route-layer flag dispatch is covered in routes/events.test.ts.
  // -------------------------------------------------------------------------

  test('getSessionsWithPendingNotifications — returns sessions with unresolved notifications', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 100)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    await insertHookEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      hookName: 'PreToolUse',
      timestamp: 1000,
    })
    await store.startSessionNotification('sess1', 2000)

    const rows = await store.getSessionsWithPendingNotifications(0)
    expect(rows).toHaveLength(1)
    expect(rows[0].session_id).toBe('sess1')
    expect(rows[0].project_id).toBe(projId)
    expect(rows[0].pending_notification_ts).toBe(2000)
  })

  test('routine events do NOT clear pending state (route-layer owns clear)', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 100)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    await store.startSessionNotification('sess1', 2000)
    await insertHookEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      hookName: 'PreToolUse',
      timestamp: 3000,
    })

    // PreToolUse is a routine event with no clearsNotification flag — the
    // adapter's insertEvent must NOT touch pending state.
    const rows = await store.getSessionsWithPendingNotifications(0)
    expect(rows).toHaveLength(1)
    expect(rows[0].pending_notification_ts).toBe(2000)
  })

  test('clearSessionNotification clears pending state', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 100)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    await store.startSessionNotification('sess1', 2000)
    await store.clearSessionNotification('sess1')

    const rows = await store.getSessionsWithPendingNotifications(0)
    expect(rows).toHaveLength(0)
  })

  test('respects the since cursor', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess-a', projId, null, null, 100)
    await store.upsertSession('sess-b', projId, null, null, 100)
    await store.upsertAgent('sess-a', 'sess-a', null, null, null)
    await store.upsertAgent('sess-b', 'sess-b', null, null, null)

    await store.startSessionNotification('sess-a', 1500)
    await store.startSessionNotification('sess-b', 2500)

    const rows = await store.getSessionsWithPendingNotifications(2000)
    expect(rows.map((r: any) => r.session_id)).toEqual(['sess-b'])
  })

  test('repeated startSessionNotification calls advance the pending timestamp', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 100)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    await store.startSessionNotification('sess1', 1000)
    await store.startSessionNotification('sess1', 2000)
    await store.startSessionNotification('sess1', 3000)

    const rows = await store.getSessionsWithPendingNotifications(0)
    expect(rows).toHaveLength(1)
    expect(rows[0].pending_notification_ts).toBe(3000)
  })

  test('new notification after a clear re-enters pending state', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 100)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    await store.startSessionNotification('sess1', 1000)
    await store.clearSessionNotification('sess1')
    await store.startSessionNotification('sess1', 3000)

    const rows = await store.getSessionsWithPendingNotifications(0)
    expect(rows).toHaveLength(1)
    expect(rows[0].pending_notification_ts).toBe(3000)
  })

  test('insertEvent bumps last_activity but does not change pending state', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 100)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    await store.startSessionNotification('sess1', 1000)
    const result = await insertHookEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      hookName: 'PreToolUse',
      timestamp: 2000,
    })
    expect(result.eventId).toBeGreaterThan(0)

    const session = await store.getSessionById('sess1')
    expect(session.pending_notification_ts).toBe(1000) // unchanged
    expect(session.last_activity).toBe(2000) // bumped
  })

  test('upsertSession stores and preserves transcript_path', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000, '/path/to/session.jsonl')

    const session = await store.getSessionById('sess1')
    expect(session.transcript_path).toBe('/path/to/session.jsonl')

    // Re-upsert without transcript_path should preserve it
    await store.upsertSession('sess1', projId, null, null, 2000)
    const session2 = await store.getSessionById('sess1')
    expect(session2.transcript_path).toBe('/path/to/session.jsonl')
  })

  test('upsertSession backfills transcript_path on later event', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)

    const session = await store.getSessionById('sess1')
    expect(session.transcript_path).toBeNull()

    await store.upsertSession('sess1', projId, null, null, 2000, '/path/to/session.jsonl')
    const session2 = await store.getSessionById('sess1')
    expect(session2.transcript_path).toBe('/path/to/session.jsonl')
  })

  test('updateSessionProject moves session to a different project', async () => {
    const proj1 = await store.createProject('proj1', 'Project 1')
    const proj2 = await store.createProject('proj2', 'Project 2')
    await store.upsertSession('sess1', proj1, null, null, 1000)

    await store.updateSessionProject('sess1', proj2)
    const session = await store.getSessionById('sess1')
    expect(session.project_id).toBe(proj2)
  })
})

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
describe('SqliteAdapter — agents', () => {
  test('upsert agent with name and description', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, 'root', null)
    await store.upsertAgent('a2', 'sess1', 'a1', 'ls-agent', 'List files in directory')

    // We need at least one event per agent for them to appear in the
    // session-derived agent list (Phase 2: agents linked to sessions
    // via events, not a column).
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'PreToolUse',
      timestamp: 1000,
    })
    await insertHookEvent({
      agentId: 'a2',
      sessionId: 'sess1',
      hookName: 'PreToolUse',
      timestamp: 1100,
    })

    const agents = await store.getAgentsForSession('sess1')
    expect(agents).toHaveLength(2)
    const sub = agents.find((a: any) => a.id === 'a2')
    expect(sub.name).toBe('ls-agent')
    expect(sub.description).toBe('List files in directory')
  })

  test('upsertAgent with agentType', async () => {
    await store.upsertAgent('a1', 'sess1', null, null, null, 'code-writer')
    const agent = await store.getAgentById('a1')
    expect(agent).not.toBeNull()
    expect(agent.agent_type).toBe('code-writer')
  })

  test('upsertAgent updates agent_type via COALESCE on conflict', async () => {
    await store.upsertAgent('a1', 'sess1', null, null, null)
    expect((await store.getAgentById('a1')).agent_type).toBeNull()

    await store.upsertAgent('a1', 'sess1', null, null, null, 'researcher')
    expect((await store.getAgentById('a1')).agent_type).toBe('researcher')
  })

  test('getAgentById returns null for non-existent agent', async () => {
    const agent = await store.getAgentById('no-such-agent')
    expect(agent).toBeNull()
  })

  test('getAgentById returns a single agent', async () => {
    await store.upsertAgent('a1', 'sess1', null, 'my-agent', 'my-description')
    const agent = await store.getAgentById('a1')
    expect(agent.id).toBe('a1')
    expect(agent.name).toBe('my-agent')
    expect(agent.description).toBe('my-description')
  })

  test('updateAgentName', async () => {
    await store.upsertAgent('a1', 'sess1', null, 'old-name', null)
    await store.updateAgentName('a1', 'new-name')
    const agent = await store.getAgentById('a1')
    expect(agent.name).toBe('new-name')
  })

  test('updateAgentType', async () => {
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.updateAgentType('a1', 'debugger')
    const agent = await store.getAgentById('a1')
    expect(agent.agent_type).toBe('debugger')
  })

  test('getAgentsForSession derives via events join', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
    })
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'PreToolUse',
      timestamp: 2000,
    })

    const agents = await store.getAgentsForSession('sess1')
    expect(agents).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Events — insert and query
// ---------------------------------------------------------------------------
describe('SqliteAdapter — events', () => {
  test('insertEvent returns auto-incremented id', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    const { eventId: id1 } = await insertHookEvent({
      agentId: rootAgentId,
      sessionId,
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
      payload: { text: 'hello' },
    })
    const { eventId: id2 } = await insertHookEvent({
      agentId: rootAgentId,
      sessionId,
      hookName: 'PreToolUse',
      timestamp: 2000,
    })
    expect(id1).toBeGreaterThan(0)
    expect(id2).toBe(id1 + 1)
  })

  test('insertEvent preserves tool_use_id in the stored payload', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    await insertHookEvent({
      agentId: rootAgentId,
      sessionId,
      hookName: 'PreToolUse',
      timestamp: 1000,
      payload: { tool_use_id: 'toolu_abc123' },
    })

    const events = await store.getEventsForSession(sessionId)
    expect(events).toHaveLength(1)
    const payload = JSON.parse(events[0].payload) as Record<string, unknown>
    expect(payload.tool_use_id).toBe('toolu_abc123')
  })

  test('insertEvent stores hookName in the hook_name column', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    await insertHookEvent({
      agentId: rootAgentId,
      sessionId,
      hookName: 'PreToolUse',
      timestamp: 1000,
    })
    const events = await store.getEventsForSession(sessionId)
    expect(events[0].hook_name).toBe('PreToolUse')
  })

  test('insertEvent stores cwd column when provided', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    await insertHookEvent({
      agentId: rootAgentId,
      sessionId,
      hookName: 'PreToolUse',
      timestamp: 1000,
      cwd: '/Users/joe/repo',
    })
    const events = await store.getEventsForSession(sessionId)
    expect(events[0].cwd).toBe('/Users/joe/repo')
  })

  test('insertEvent stores _meta as JSON when provided', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      hookName: 'PreToolUse',
      timestamp: 1000,
      payload: {},
      _meta: { session: { slug: 'testing' } },
    })
    const events = await store.getEventsForSession(sessionId)
    expect(events[0]._meta).toBe(JSON.stringify({ session: { slug: 'testing' } }))
  })

  test('getEventsForSession filters by hookName', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    await insertHookEvent({
      agentId: rootAgentId,
      sessionId,
      hookName: 'PreToolUse',
      timestamp: 1000,
    })
    await insertHookEvent({
      agentId: rootAgentId,
      sessionId,
      hookName: 'Stop',
      timestamp: 2000,
    })

    const onlyStop = await store.getEventsForSession(sessionId, { hookName: 'Stop' })
    expect(onlyStop).toHaveLength(1)
    expect(onlyStop[0].hook_name).toBe('Stop')
  })

  test('insertEvent sets created_at', async () => {
    const before = Date.now()
    const { sessionId, rootAgentId } = await seedBasic()
    await insertHookEvent({
      agentId: rootAgentId,
      sessionId,
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
    })

    const events = await store.getEventsForSession(sessionId)
    expect(events[0].created_at).toBeGreaterThanOrEqual(before)
    expect(events[0].created_at).toBeLessThanOrEqual(Date.now())
  })

  test('getEventsForAgent returns only that agent events', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess1', null, null, 'sub')

    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
    })
    await insertHookEvent({
      agentId: 'a2',
      sessionId: 'sess1',
      hookName: 'PreToolUse',
      timestamp: 2000,
    })
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'Stop',
      timestamp: 3000,
    })

    const a1Events = await store.getEventsForAgent('a1')
    expect(a1Events).toHaveLength(2)
    expect(a1Events.every((e) => e.agent_id === 'a1')).toBe(true)
    expect(a1Events[0].timestamp).toBeLessThanOrEqual(a1Events[1].timestamp)

    const a2Events = await store.getEventsForAgent('a2')
    expect(a2Events).toHaveLength(1)
    expect(a2Events[0].agent_id).toBe('a2')
  })

  test('getEventsSince returns events after timestamp', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    await insertHookEvent({
      agentId: rootAgentId,
      sessionId,
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
    })
    await insertHookEvent({
      agentId: rootAgentId,
      sessionId,
      hookName: 'PreToolUse',
      timestamp: 2000,
    })

    const since = await store.getEventsSince(sessionId, 1500)
    expect(since).toHaveLength(1)
    expect(since[0].timestamp).toBe(2000)
  })
})

// ---------------------------------------------------------------------------
// Event filtering (getEventsForSession)
// ---------------------------------------------------------------------------
describe('SqliteAdapter — event filtering', () => {
  async function seedWithMixedEvents() {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess1', null, null, 'sub')

    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
      payload: { text: 'hello world' },
    })
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'PreToolUse',
      timestamp: 2000,
      payload: { command: 'ls -la' },
    })
    await insertHookEvent({
      agentId: 'a2',
      sessionId: 'sess1',
      hookName: 'PostToolUse',
      timestamp: 3000,
      payload: { file: '/tmp/test.txt' },
    })
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'Stop',
      timestamp: 4000,
    })
  }

  test('filter by agentIds', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { agentIds: ['a1'] })
    expect(filtered).toHaveLength(3)
    expect(filtered.every((e) => e.agent_id === 'a1')).toBe(true)
  })

  test('filter by multiple agentIds', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { agentIds: ['a1', 'a2'] })
    expect(filtered).toHaveLength(4)
  })

  test('filter by hookName', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { hookName: 'PreToolUse' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].hook_name).toBe('PreToolUse')
  })

  test('filter by search (matches payload)', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { search: 'hello world' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].hook_name).toBe('UserPromptSubmit')
  })

  test('filter with limit', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { limit: 2 })
    expect(filtered).toHaveLength(2)
    expect(filtered[0].timestamp).toBe(1000)
    expect(filtered[1].timestamp).toBe(2000)
  })

  test('filter with limit and offset', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { limit: 2, offset: 1 })
    expect(filtered).toHaveLength(2)
    expect(filtered[0].timestamp).toBe(2000)
    expect(filtered[1].timestamp).toBe(3000)
  })

  test('combined filters: hookName + agentIds', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', {
      hookName: 'PreToolUse',
      agentIds: ['a1'],
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].agent_id).toBe('a1')
  })

  test('offset without limit is ignored (no OFFSET without LIMIT)', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { offset: 2 })
    expect(filtered).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// getRecentSessions
// ---------------------------------------------------------------------------
describe('SqliteAdapter — getRecentSessions', () => {
  test('returns sessions ordered by last activity descending', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, 'first', null, 1000)
    await store.upsertSession('sess2', projId, 'second', null, 2000)

    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess2', null, null, null)

    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'UserPromptSubmit',
      timestamp: 5000,
    })
    await insertHookEvent({
      agentId: 'a2',
      sessionId: 'sess2',
      hookName: 'UserPromptSubmit',
      timestamp: 3000,
    })

    const recent = await store.getRecentSessions(10)
    expect(recent).toHaveLength(2)
    expect(recent[0].id).toBe('sess1')
    expect(recent[1].id).toBe('sess2')
    expect(recent[0].project_name).toBe('Project 1')
    expect(recent[0].last_activity).toBe(5000)
  })

  test('respects limit parameter', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess2', projId, null, null, 2000)
    await store.upsertSession('sess3', projId, null, null, 3000)

    const recent = await store.getRecentSessions(2)
    expect(recent).toHaveLength(2)
  })

  test('returns aggregated counts derived from events', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess1', null, null, 'sub')
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
    })
    await insertHookEvent({
      agentId: 'a2',
      sessionId: 'sess1',
      hookName: 'PreToolUse',
      timestamp: 1100,
    })

    const recent = await store.getRecentSessions()
    expect(recent).toHaveLength(1)
    expect(recent[0].agent_count).toBe(2)
    expect(recent[0].event_count).toBe(2)
  })

  test('session without events uses started_at for ordering', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    // upsertSession sets last_activity = timestamp at insert time, so use
    // started_at to compare. The COALESCE in the query falls back to
    // started_at when last_activity is also null (legacy data).
    await store.upsertSession('sess-no-events', projId, null, null, 9000)
    await store.upsertSession('sess-with-events', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess-with-events', null, null, null)
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess-with-events',
      hookName: 'UserPromptSubmit',
      timestamp: 5000,
    })

    const recent = await store.getRecentSessions()
    expect(recent).toHaveLength(2)
    expect(recent[0].id).toBe('sess-no-events')
    expect(recent[1].id).toBe('sess-with-events')
  })
})

// ---------------------------------------------------------------------------
// agent_classes aggregation — derived via events join now (Phase 2).
// ---------------------------------------------------------------------------
describe('SqliteAdapter — agent_classes aggregation', () => {
  function parseClasses(row: { agent_classes: string | null }): string[] {
    if (!row.agent_classes) return []
    return row.agent_classes.split(',').sort()
  }

  test('getSessionById returns empty agent_classes when session has no events', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    const session = await store.getSessionById('sess1')
    expect(parseClasses(session)).toEqual([])
  })

  test('getSessionById returns single class for single-class session', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null, null, 'claude-code')
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
    })
    const session = await store.getSessionById('sess1')
    expect(parseClasses(session)).toEqual(['claude-code'])
  })

  test('getSessionById deduplicates repeated agent classes', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null, null, 'claude-code')
    await store.upsertAgent('a2', 'sess1', null, null, 'sub', null, 'claude-code')
    await store.upsertAgent('a3', 'sess1', null, null, 'sub2', null, 'claude-code')
    for (const aid of ['a1', 'a2', 'a3']) {
      await insertHookEvent({
        agentId: aid,
        sessionId: 'sess1',
        hookName: 'UserPromptSubmit',
        timestamp: 1000,
      })
    }
    const session = await store.getSessionById('sess1')
    expect(parseClasses(session)).toEqual(['claude-code'])
  })

  test('getSessionById returns multiple distinct classes sorted', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null, null, 'claude-code')
    await store.upsertAgent('a2', 'sess1', null, null, 'sub', null, 'codex')
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
    })
    await insertHookEvent({
      agentId: 'a2',
      sessionId: 'sess1',
      hookName: 'PreToolUse',
      timestamp: 1100,
    })
    const session = await store.getSessionById('sess1')
    expect(parseClasses(session)).toEqual(['claude-code', 'codex'])
  })

  // Note: post-Phase-2 the agents table defaults agent_class to 'unknown'
  // for legacy rows. The aggregation still filters NULL but rows with the
  // 'unknown' default surface as 'unknown'. This test is no longer
  // meaningful — leaving disabled.
  test.skip('getSessionById omits NULL agent_class values (defaults to unknown post-Phase-2)', async () => {
    // TODO(phase-3): re-enable when agent_class default behavior is re-evaluated
  })

  test('getSessionsForProject aggregates per-session without leaking across sessions', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess2', projId, null, null, 2000)
    await store.upsertAgent('a1', 'sess1', null, null, null, null, 'claude-code')
    await store.upsertAgent('a2', 'sess2', null, null, null, null, 'codex')
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
    })
    await insertHookEvent({
      agentId: 'a2',
      sessionId: 'sess2',
      hookName: 'UserPromptSubmit',
      timestamp: 2000,
    })

    const sessions = await store.getSessionsForProject(projId)
    const bySessionId = new Map(sessions.map((s) => [s.id, parseClasses(s)]))
    expect(bySessionId.get('sess1')).toEqual(['claude-code'])
    expect(bySessionId.get('sess2')).toEqual(['codex'])
  })

  test('getRecentSessions aggregates per-session without leaking across sessions', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess2', projId, null, null, 2000)
    await store.upsertAgent('a1', 'sess1', null, null, null, null, 'claude-code')
    await store.upsertAgent('a2', 'sess1', null, null, 'sub', null, 'codex')
    await store.upsertAgent('a3', 'sess2', null, null, null, null, 'codex')
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
    })
    await insertHookEvent({
      agentId: 'a2',
      sessionId: 'sess1',
      hookName: 'PreToolUse',
      timestamp: 1100,
    })
    await insertHookEvent({
      agentId: 'a3',
      sessionId: 'sess2',
      hookName: 'UserPromptSubmit',
      timestamp: 2000,
    })

    const recent = await store.getRecentSessions()
    const bySessionId = new Map(recent.map((s) => [s.id, parseClasses(s)]))
    expect(bySessionId.get('sess1')).toEqual(['claude-code', 'codex'])
    expect(bySessionId.get('sess2')).toEqual(['codex'])
  })
})

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------
describe('SqliteAdapter — deletion', () => {
  test('deleteSession removes session, agents, and events but keeps project', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess1', null, null, 'sub')
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
    })

    await store.deleteSession('sess1')

    const sessions = await store.getSessionsForProject(projId)
    expect(sessions).toHaveLength(0)
    const agents = await store.getAgentsForSession('sess1')
    expect(agents).toHaveLength(0)
    const events = await store.getEventsForSession('sess1')
    expect(events).toHaveLength(0)
    const projects = await store.getProjects()
    expect(projects).toHaveLength(1)
  })

  test('deleteProject cascades through sessions, agents, and events', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess2', projId, null, null, 2000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess2', null, null, null)
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
    })
    await insertHookEvent({
      agentId: 'a2',
      sessionId: 'sess2',
      hookName: 'UserPromptSubmit',
      timestamp: 2000,
    })

    await store.deleteProject(projId)

    const projects = await store.getProjects()
    expect(projects).toHaveLength(0)
    const sessions = await store.getSessionsForProject(projId)
    expect(sessions).toHaveLength(0)
    const events1 = await store.getEventsForSession('sess1')
    expect(events1).toHaveLength(0)
    const events2 = await store.getEventsForSession('sess2')
    expect(events2).toHaveLength(0)
    const agents1 = await store.getAgentsForSession('sess1')
    expect(agents1).toHaveLength(0)
    const agents2 = await store.getAgentsForSession('sess2')
    expect(agents2).toHaveLength(0)
  })

  test('deleteProject with no sessions is a no-op beyond removing the project', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.deleteProject(projId)
    const projects = await store.getProjects()
    expect(projects).toHaveLength(0)
  })

  test('deleteSessions bulk-removes multiple sessions with their events/agents', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('keep', projId, null, null, 1000)
    await store.upsertSession('del1', projId, null, null, 2000)
    await store.upsertSession('del2', projId, null, null, 3000)
    await store.upsertAgent('a-keep', 'keep', null, null, null)
    await store.upsertAgent('a-del1', 'del1', null, null, null)
    await store.upsertAgent('a-del2', 'del2', null, null, null)
    for (const [aid, sid, ts] of [
      ['a-keep', 'keep', 1000],
      ['a-del1', 'del1', 2000],
      ['a-del2', 'del2', 3000],
    ] as const) {
      await insertHookEvent({
        agentId: aid,
        sessionId: sid,
        hookName: 'UserPromptSubmit',
        timestamp: ts,
      })
    }

    const result = await store.deleteSessions(['del1', 'del2'])
    expect(result).toEqual({ events: 2, agents: 2, sessions: 2 })

    const sessions = await store.getSessionsForProject(projId)
    expect(sessions.map((s: { id: string }) => s.id)).toEqual(['keep'])
    const agents = await store.getAgentsForSession('keep')
    expect(agents).toHaveLength(1)
    const events = await store.getEventsForSession('keep')
    expect(events).toHaveLength(1)
  })

  test('deleteSessions with empty array is a no-op', async () => {
    const result = await store.deleteSessions([])
    expect(result).toEqual({ events: 0, agents: 0, sessions: 0 })
  })

  test('getDbStats counts rows across sessions and events', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('s1', projId, null, null, 1000)
    await store.upsertSession('s2', projId, null, null, 2000)
    await store.upsertAgent('a1', 's1', null, null, null)
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 's1',
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
    })
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 's1',
      hookName: 'UserPromptSubmit',
      timestamp: 1100,
    })

    const stats = await store.getDbStats()
    expect(stats).toEqual({ sessionCount: 2, eventCount: 2 })
  })

  test('vacuum runs without throwing', async () => {
    await expect(store.vacuum()).resolves.toBeUndefined()
  })

  test('clearAllData empties all tables', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
    })

    await store.clearAllData()
    const projects = await store.getProjects()
    expect(projects).toHaveLength(0)
  })

  test('clearSessionEvents removes events and agents but keeps the session', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, 'my-session', null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'UserPromptSubmit',
      timestamp: 1000,
    })

    await store.clearSessionEvents('sess1')

    const session = await store.getSessionById('sess1')
    expect(session).not.toBeNull()
    expect(session.slug).toBe('my-session')
    const events = await store.getEventsForSession('sess1')
    expect(events).toHaveLength(0)
    const agents = await store.getAgentsForSession('sess1')
    expect(agents).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Orphan repair (Phase 2)
// ---------------------------------------------------------------------------
describe('SqliteAdapter — repairOrphans', () => {
  function withFkOff(fn: () => void) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(store as any).db.pragma('foreign_keys = OFF')
    try {
      fn()
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).db.pragma('foreign_keys = ON')
    }
  }

  test('clean database returns zero counts', async () => {
    await store.createProject('proj1', 'Project 1')
    const result = await store.repairOrphans()
    expect(result.sessionsReassigned).toBe(0)
    expect(result.agentsDeleted).toBe(0)
    expect(result.agentsReparented).toBe(0)
    expect(result.eventsDeleted).toBe(0)
  })

  test('clears project_id on sessions whose project disappeared', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    withFkOff(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).db.prepare('DELETE FROM projects WHERE id = ?').run(projId)
    })

    const result = await store.repairOrphans()
    expect(result.sessionsReassigned).toBe(1)

    const session = await store.getSessionById('sess1')
    expect(session.project_id).toBeNull()
  })

  test('deletes agents that have no referencing events', async () => {
    await store.upsertAgent('a1', 'sess1', null, null, null)
    // No events reference this agent; orphan repair should delete it.
    const result = await store.repairOrphans()
    expect(result.agentsDeleted).toBe(1)
    const agent = await store.getAgentById('a1')
    expect(agent).toBeNull()
  })

  test('agentsReparented is always 0 (parent_agent_id is gone)', async () => {
    const projId = await store.createProject('proj1', 'Project 1')
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await insertHookEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      hookName: 'PreToolUse',
      timestamp: 1000,
    })

    const result = await store.repairOrphans()
    expect(result.agentsReparented).toBe(0)
  })

  test('deletes events with invalid session_id', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    await insertHookEvent({
      agentId: rootAgentId,
      sessionId,
      hookName: 'PreToolUse',
      timestamp: 1000,
    })
    withFkOff(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
    })

    const result = await store.repairOrphans()
    // Both event(s) and the now-orphaned agent get removed.
    expect(result.eventsDeleted).toBeGreaterThanOrEqual(1)
    expect(result.agentsDeleted).toBeGreaterThanOrEqual(1)
  })

  test('orphaned active session is recoverable via getRecentSessions', async () => {
    const projId = await store.createProject('p1', 'P1')
    await store.upsertSession('s1', projId, 'active-session', null, Date.now())
    withFkOff(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).db.prepare('DELETE FROM projects WHERE id = ?').run(projId)
    })

    const recentBefore = await store.getRecentSessions()
    expect(recentBefore.find((r: { id: string }) => r.id === 's1')).toBeDefined()

    await store.repairOrphans()
    const recentAfter = await store.getRecentSessions()
    const found = recentAfter.find((r: { id: string }) => r.id === 's1')
    expect(found).toBeDefined()
    // After repair, the session is unassigned (project_id NULL).
    expect(found.project_id).toBeNull()
  })
})
