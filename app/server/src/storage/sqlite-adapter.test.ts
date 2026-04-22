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
  const projectId = await store.createProject('proj1', 'Project 1', '/path/proj1')
  await store.upsertSession('sess1', projectId, 'my-session', null, 1000)
  await store.upsertAgent('a1', 'sess1', null, null, null)
  return { projectId, sessionId: 'sess1', rootAgentId: 'a1' }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
describe('SqliteAdapter — projects', () => {
  test('createProject returns an integer id', async () => {
    const id = await store.createProject('my-project', 'My Project', null)
    expect(typeof id).toBe('number')
    expect(id).toBeGreaterThan(0)
  })

  test('createProject stores slug, name, and transcript_path', async () => {
    const id = await store.createProject('my-project', 'My Project', '/path/to/transcript')
    const project = await store.getProjectBySlug('my-project')
    expect(project).not.toBeNull()
    expect(project.id).toBe(id)
    expect(project.slug).toBe('my-project')
    expect(project.name).toBe('My Project')
    expect(project.transcript_path).toBe('/path/to/transcript')
  })

  test('createProject with null transcript_path', async () => {
    await store.createProject('no-transcript', 'No Transcript', null)
    const project = await store.getProjectBySlug('no-transcript')
    expect(project.transcript_path).toBeNull()
  })

  test('getProjectBySlug returns null for unknown slug', async () => {
    const project = await store.getProjectBySlug('does-not-exist')
    expect(project).toBeNull()
  })

  test('getProjectByTranscriptPath finds project by path', async () => {
    const id = await store.createProject('proj-a', 'Project A', '/transcripts/proj-a')
    const project = await store.getProjectByTranscriptPath('/transcripts/proj-a')
    expect(project).not.toBeNull()
    expect(project.id).toBe(id)
    expect(project.slug).toBe('proj-a')
  })

  test('getProjectByTranscriptPath returns null when no match', async () => {
    const project = await store.getProjectByTranscriptPath('/no/such/path')
    expect(project).toBeNull()
  })

  test('createProject stores cwd when provided', async () => {
    const id = await store.createProject('proj1', 'P', null, '/Users/joe/proj1')
    const project = await store.getProjectById(id)
    expect(project.cwd).toBe('/Users/joe/proj1')
  })

  test('createProject leaves cwd null when omitted (back-compat)', async () => {
    const id = await store.createProject('proj1', 'P', null)
    const project = await store.getProjectById(id)
    expect(project.cwd).toBeNull()
  })

  test('getProjectByCwd finds project by exact cwd', async () => {
    const id = await store.createProject('proj-a', 'A', null, '/Users/joe/proj-a')
    const project = await store.getProjectByCwd('/Users/joe/proj-a')
    expect(project).not.toBeNull()
    expect(project.id).toBe(id)
  })

  test('getProjectByCwd returns null for unknown cwd', async () => {
    const project = await store.getProjectByCwd('/nowhere')
    expect(project).toBeNull()
  })

  test('updateProjectCwd sets cwd on a project', async () => {
    const id = await store.createProject('proj1', 'P', null, null)
    await store.updateProjectCwd(id, '/Users/joe/proj1')
    const project = await store.getProjectById(id)
    expect(project.cwd).toBe('/Users/joe/proj1')
  })

  test('updateProjectName changes the name', async () => {
    const id = await store.createProject('proj1', 'Original Name', null)
    await store.updateProjectName(id, 'Updated Name')
    const project = await store.getProjectBySlug('proj1')
    expect(project.name).toBe('Updated Name')
  })

  test('updateProjectName can be updated multiple times', async () => {
    const id = await store.createProject('proj1', 'First', null)
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
    await store.createProject('taken-slug', 'Some Project', null)
    const available = await store.isSlugAvailable('taken-slug')
    expect(available).toBe(false)
  })

  test('getProjects returns session_count', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess2', projId, null, null, 2000)
    const projects = await store.getProjects()
    expect(projects[0].session_count).toBe(2)
  })

  test('getProjects returns slug and name fields', async () => {
    await store.createProject('test-proj', 'Test Project', null)
    const projects = await store.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].slug).toBe('test-proj')
    expect(projects[0].name).toBe('Test Project')
  })

  test('getRecentSessions includes project_slug and project_name', async () => {
    const projId = await store.createProject('proj1', 'Project One', null)
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
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, 'twinkly-dragon', { version: '2.1' }, 1000)
    const session = await store.getSessionById('sess1')
    expect(session).not.toBeNull()
    expect(session.slug).toBe('twinkly-dragon')
    expect(JSON.parse(session.metadata)).toEqual({ version: '2.1' })
    expect(session.status).toBe('active')
  })

  test('upsert session updates slug via COALESCE', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess1', projId, 'new-slug', null, 1000)
    const session = await store.getSessionById('sess1')
    expect(session.slug).toBe('new-slug')
  })

  test('getSessionsForProject returns aggregated counts', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub')
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: null,
      toolName: null,

      timestamp: 1000,
      payload: {},
    })

    const sessions = await store.getSessionsForProject(projId)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].agent_count).toBe(2)
    expect(sessions[0].event_count).toBe(1)
  })

  test('getSessionById returns null for non-existent session', async () => {
    const session = await store.getSessionById('no-such-session')
    expect(session).toBeNull()
  })

  test('updateSessionStatus sets status and stopped_at for "stopped"', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)

    await store.updateSessionStatus('sess1', 'stopped')
    const session = await store.getSessionById('sess1')
    expect(session.status).toBe('stopped')
    expect(session.stopped_at).toBeGreaterThan(0)
  })

  test('updateSessionStatus with non-stopped status sets stopped_at to null', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)

    await store.updateSessionStatus('sess1', 'active')
    const session = await store.getSessionById('sess1')
    expect(session.status).toBe('active')
    expect(session.stopped_at).toBeNull()
  })

  test('updateSessionSlug', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, 'old-slug', null, 1000)

    await store.updateSessionSlug('sess1', 'new-slug')
    const session = await store.getSessionById('sess1')
    expect(session.slug).toBe('new-slug')
  })

  // -------------------------------------------------------------------------
  // Pending-notification tracking: insertEvent applies envelope flags
  // (isNotification / clearsNotification) to `pending_notification_ts`.
  // getSessionsWithPendingNotifications surfaces sessions whose column is
  // non-NULL. Server is agent-class-neutral; the subtype on the event is
  // preserved for event display but NOT consulted for state transitions.
  // -------------------------------------------------------------------------
  async function insertNotification(sessionId: string, ts: number) {
    return store.insertEvent({
      agentId: sessionId,
      sessionId,
      type: 'hook',
      subtype: 'Notification',
      toolName: null,
      timestamp: ts,
      payload: {},
      isNotification: true,
    })
  }
  async function insertTool(sessionId: string, ts: number) {
    return store.insertEvent({
      agentId: sessionId,
      sessionId,
      type: 'hook',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      timestamp: ts,
      payload: {},
    })
  }
  async function insertNeutral(sessionId: string, ts: number) {
    // Flagged as non-clearing — e.g., SubagentStop from a subagent while
    // the main agent's notification is pending.
    return store.insertEvent({
      agentId: sessionId,
      sessionId,
      type: 'hook',
      subtype: 'SubagentStop',
      toolName: null,
      timestamp: ts,
      payload: {},
      clearsNotification: false,
    })
  }

  test('getSessionsWithPendingNotifications — returns sessions with unresolved notifications', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 100)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    await insertTool('sess1', 1000)
    await insertNotification('sess1', 2000)

    const rows = await store.getSessionsWithPendingNotifications(0)
    expect(rows).toHaveLength(1)
    expect(rows[0].session_id).toBe('sess1')
    expect(rows[0].project_id).toBe(projId)
    expect(rows[0].pending_notification_ts).toBe(2000)
  })

  test('auto-clears once a non-notification event arrives after the notification', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 100)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    await insertNotification('sess1', 2000)
    await insertTool('sess1', 3000)

    const rows = await store.getSessionsWithPendingNotifications(0)
    expect(rows).toHaveLength(0)
  })

  test('respects the since cursor', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess-a', projId, null, null, 100)
    await store.upsertSession('sess-b', projId, null, null, 100)
    await store.upsertAgent('sess-a', 'sess-a', null, null, null)
    await store.upsertAgent('sess-b', 'sess-b', null, null, null)

    await insertNotification('sess-a', 1500)
    await insertNotification('sess-b', 2500)

    const rows = await store.getSessionsWithPendingNotifications(2000)
    expect(rows.map((r: any) => r.session_id)).toEqual(['sess-b'])
  })

  test('repeated notifications advance the pending timestamp', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 100)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    await insertTool('sess1', 500)
    await insertNotification('sess1', 1000)
    await insertNotification('sess1', 2000)
    await insertNotification('sess1', 3000)

    const rows = await store.getSessionsWithPendingNotifications(0)
    expect(rows).toHaveLength(1)
    expect(rows[0].pending_notification_ts).toBe(3000)
  })

  test('new notification after a clearing event re-enters pending state', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 100)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    await insertNotification('sess1', 1000)
    await insertTool('sess1', 2000) // clears the session
    await insertNotification('sess1', 3000) // new pending notification

    const rows = await store.getSessionsWithPendingNotifications(0)
    expect(rows).toHaveLength(1)
    expect(rows[0].pending_notification_ts).toBe(3000)
  })

  test('neutral events (clearsNotification:false) do not clear pending state', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 100)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    await insertNotification('sess1', 2000)
    await insertNeutral('sess1', 3000) // subagent stop — should NOT clear
    await insertNeutral('sess1', 4000) // another neutral event — still pending

    const rows = await store.getSessionsWithPendingNotifications(0)
    expect(rows).toHaveLength(1)
    expect(rows[0].pending_notification_ts).toBe(2000)
  })

  test('insertEvent returns notificationTransition signal', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 100)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    const r1 = await insertTool('sess1', 500)
    expect(r1.notificationTransition).toBe('none') // nothing pending, nothing to clear

    const r2 = await insertNotification('sess1', 1000)
    expect(r2.notificationTransition).toBe('set')

    const r3 = await insertNeutral('sess1', 1500)
    expect(r3.notificationTransition).toBe('none') // neutral leaves state alone

    const r4 = await insertTool('sess1', 2000)
    expect(r4.notificationTransition).toBe('cleared')

    const r5 = await insertTool('sess1', 2500)
    expect(r5.notificationTransition).toBe('none') // already cleared
  })

  test('upsertSession stores and preserves transcript_path', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000, '/path/to/session.jsonl')

    const session = await store.getSessionById('sess1')
    expect(session.transcript_path).toBe('/path/to/session.jsonl')

    // Re-upsert without transcript_path should preserve it
    await store.upsertSession('sess1', projId, null, null, 2000)
    const session2 = await store.getSessionById('sess1')
    expect(session2.transcript_path).toBe('/path/to/session.jsonl')
  })

  test('upsertSession backfills transcript_path on later event', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)

    const session = await store.getSessionById('sess1')
    expect(session.transcript_path).toBeNull()

    // Later event provides transcript_path
    await store.upsertSession('sess1', projId, null, null, 2000, '/path/to/session.jsonl')
    const session2 = await store.getSessionById('sess1')
    expect(session2.transcript_path).toBe('/path/to/session.jsonl')
  })

  test('updateSessionProject moves session to a different project', async () => {
    const proj1 = await store.createProject('proj1', 'Project 1', null)
    const proj2 = await store.createProject('proj2', 'Project 2', null)
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
  test('upsert agent with parent, name, and description', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, 'root', null)
    await store.upsertAgent('a2', 'sess1', 'a1', 'ls-agent', 'List files in directory')

    const agents = await store.getAgentsForSession('sess1')
    expect(agents).toHaveLength(2)
    const sub = agents.find((a: any) => a.id === 'a2')
    expect(sub.parent_agent_id).toBe('a1')
    expect(sub.name).toBe('ls-agent')
    expect(sub.description).toBe('List files in directory')
  })

  test('upsertAgent with agentType', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null, 'code-writer')

    const agent = await store.getAgentById('a1')
    expect(agent).not.toBeNull()
    expect(agent.agent_type).toBe('code-writer')
  })

  test('upsertAgent updates agent_type via COALESCE on conflict', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
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
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, 'my-agent', 'my-description')

    const agent = await store.getAgentById('a1')
    expect(agent.id).toBe('a1')
    expect(agent.session_id).toBe('sess1')
    expect(agent.name).toBe('my-agent')
    expect(agent.description).toBe('my-description')
  })

  test('updateAgentName', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, 'old-name', null)

    await store.updateAgentName('a1', 'new-name')
    const agent = await store.getAgentById('a1')
    expect(agent.name).toBe('new-name')
  })

  test('updateAgentType', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)

    await store.updateAgentType('a1', 'debugger')
    const agent = await store.getAgentById('a1')
    expect(agent.agent_type).toBe('debugger')
  })

  test('getAgentsForSession returns agents', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: null,
      toolName: null,

      timestamp: 1000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',

      timestamp: 2000,
      payload: {},
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
    const { eventId: id1 } = await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,

      timestamp: 1000,
      payload: { text: 'hello' },
    })
    const { eventId: id2 } = await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',

      timestamp: 2000,
      payload: {},
    })
    expect(id1).toBeGreaterThan(0)
    expect(id2).toBe(id1 + 1)
  })

  test('insertEvent preserves tool_use_id in the stored payload', async () => {
    // tool_use_id is no longer its own column — it lives in payload.
    const { sessionId, rootAgentId } = await seedBasic()
    await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Read',
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
    await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      hookName: 'PreToolUse',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      timestamp: 1000,
      payload: {},
    })
    const events = await store.getEventsForSession(sessionId)
    expect(events[0].hook_name).toBe('PreToolUse')
  })

  test('insertEvent defaults hook_name to null when hookName omitted', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,
      timestamp: 1000,
      payload: {},
    })
    const events = await store.getEventsForSession(sessionId)
    expect(events[0].hook_name).toBeNull()
  })

  test('getEventsForSession filters by hookName', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      hookName: 'PreToolUse',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      timestamp: 1000,
      payload: {},
    })
    await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      hookName: 'Stop',
      type: 'system',
      subtype: 'Stop',
      toolName: null,
      timestamp: 2000,
      payload: {},
    })

    const onlyStop = await store.getEventsForSession(sessionId, { hookName: 'Stop' })
    expect(onlyStop).toHaveLength(1)
    expect(onlyStop[0].hook_name).toBe('Stop')
  })

  test('insertEvent sets created_at', async () => {
    const before = Date.now()
    const { sessionId, rootAgentId } = await seedBasic()
    await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      type: 'user',
      subtype: null,
      toolName: null,
      timestamp: 1000,
      payload: {},
    })

    const events = await store.getEventsForSession(sessionId)
    expect(events[0].created_at).toBeGreaterThanOrEqual(before)
    expect(events[0].created_at).toBeLessThanOrEqual(Date.now())
  })

  test('getEventsForAgent returns only that agent events', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub')

    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: null,
      toolName: null,

      timestamp: 1000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'a2',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',

      timestamp: 2000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'system',
      subtype: 'Stop',
      toolName: null,

      timestamp: 3000,
      payload: {},
    })

    const a1Events = await store.getEventsForAgent('a1')
    expect(a1Events).toHaveLength(2)
    expect(a1Events.every((e) => e.agent_id === 'a1')).toBe(true)
    // Ordered by timestamp ASC
    expect(a1Events[0].timestamp).toBeLessThanOrEqual(a1Events[1].timestamp)

    const a2Events = await store.getEventsForAgent('a2')
    expect(a2Events).toHaveLength(1)
    expect(a2Events[0].agent_id).toBe('a2')
  })

  test('getEventsSince returns events after timestamp', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      type: 'user',
      subtype: null,
      toolName: null,

      timestamp: 1000,
      payload: {},
    })
    await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',

      timestamp: 2000,
      payload: {},
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
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub')

    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,

      timestamp: 1000,
      payload: { text: 'hello world' },
    })
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',

      timestamp: 2000,
      payload: { command: 'ls -la' },
    })
    await store.insertEvent({
      agentId: 'a2',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PostToolUse',
      toolName: 'Read',

      timestamp: 3000,
      payload: { file: '/tmp/test.txt' },
    })
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'system',
      subtype: 'Stop',
      toolName: null,

      timestamp: 4000,
      payload: {},
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

  test('filter by type', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { type: 'tool' })
    expect(filtered).toHaveLength(2)
    expect(filtered.every((e) => e.type === 'tool')).toBe(true)
  })

  test('filter by subtype', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { subtype: 'PreToolUse' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].subtype).toBe('PreToolUse')
  })

  test('filter by search (matches payload)', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { search: 'hello world' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].type).toBe('user')
  })

  test('filter with limit', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { limit: 2 })
    expect(filtered).toHaveLength(2)
    // Should be first 2 by timestamp ASC
    expect(filtered[0].timestamp).toBe(1000)
    expect(filtered[1].timestamp).toBe(2000)
  })

  test('filter with limit and offset', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { limit: 2, offset: 1 })
    expect(filtered).toHaveLength(2)
    // Skips first, takes next 2
    expect(filtered[0].timestamp).toBe(2000)
    expect(filtered[1].timestamp).toBe(3000)
  })

  test('combined filters: type + agentIds', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', {
      type: 'tool',
      agentIds: ['a1'],
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].tool_name).toBe('Bash')
  })

  test('offset without limit is ignored (no OFFSET without LIMIT)', async () => {
    await seedWithMixedEvents()
    // offset alone should not crash; code only adds OFFSET if limit is set
    const filtered = await store.getEventsForSession('sess1', { offset: 2 })
    expect(filtered).toHaveLength(4) // all events returned
  })
})

// ---------------------------------------------------------------------------
// getThreadForEvent
// ---------------------------------------------------------------------------
describe('SqliteAdapter — getThreadForEvent', () => {
  test('returns empty array for non-existent event', async () => {
    const thread = await store.getThreadForEvent(999)
    expect(thread).toEqual([])
  })

  test('subagent event: returns all events for that agent', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    // Root agent has same id as session
    await store.upsertAgent('sess1', 'sess1', null, null, null)
    await store.upsertAgent('sub1', 'sess1', 'sess1', null, 'sub')

    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,

      timestamp: 1000,
      payload: {},
    })
    const { eventId: subEvent1Id } = await store.insertEvent({
      agentId: 'sub1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',

      timestamp: 2000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'sub1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PostToolUse',
      toolName: 'Bash',

      timestamp: 3000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'system',
      subtype: 'Stop',
      toolName: null,

      timestamp: 4000,
      payload: {},
    })

    // Query thread for a subagent event — should get all sub1 events only
    const thread = await store.getThreadForEvent(subEvent1Id)
    expect(thread).toHaveLength(2)
    expect(thread.every((e) => e.agent_id === 'sub1')).toBe(true)
  })

  test('SubagentStop event: returns all events for that agent', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('sess1', 'sess1', null, null, null)
    await store.upsertAgent('sub1', 'sess1', 'sess1', null, 'sub')

    await store.insertEvent({
      agentId: 'sub1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',

      timestamp: 1000,
      payload: {},
    })
    // SubagentStop is on root agent but tagged with SubagentStop subtype
    const { eventId: stopId } = await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'system',
      subtype: 'SubagentStop',
      toolName: null,

      timestamp: 2000,
      payload: {},
    })

    // SubagentStop on root agent — code checks subtype === 'SubagentStop' first
    // agentId === sessionId so isSubagent is false, but SubagentStop branch triggers
    // returns all events for that agent (sess1)
    const thread = await store.getThreadForEvent(stopId)
    // agent_id is 'sess1' which equals session_id, so isSubagent = false
    // But subtype is 'SubagentStop', so it takes the subagent branch
    // Returns all events where agent_id = 'sess1'
    expect(thread).toHaveLength(1) // only the SubagentStop event itself belongs to agent sess1
    expect(thread[0].subtype).toBe('SubagentStop')
  })

  test('root agent event: returns turn between UserPromptSubmit and Stop', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    // Turn 1
    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,

      timestamp: 1000,
      payload: {},
    })
    const { eventId: toolEventId } = await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',

      timestamp: 2000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'system',
      subtype: 'Stop',
      toolName: null,

      timestamp: 3000,
      payload: {},
    })

    // Turn 2
    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,

      timestamp: 4000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'system',
      subtype: 'Stop',
      toolName: null,

      timestamp: 5000,
      payload: {},
    })

    // Query thread for the tool event in turn 1
    const thread = await store.getThreadForEvent(toolEventId)
    // Turn boundary: from UserPromptSubmit(1000) through Stop(3000)
    expect(thread.length).toBeGreaterThanOrEqual(2)
    expect(thread.length).toBeLessThanOrEqual(3) // Prompt, Tool, Stop
    // All events should be within turn 1 timestamps
    for (const e of thread) {
      expect(e.timestamp).toBeGreaterThanOrEqual(1000)
      expect(e.timestamp).toBeLessThanOrEqual(3000)
    }
  })

  test('root agent event with no subsequent boundary returns all remaining events', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,

      timestamp: 1000,
      payload: {},
    })
    const { eventId: toolId } = await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Read',

      timestamp: 2000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PostToolUse',
      toolName: 'Read',

      timestamp: 3000,
      payload: {},
    })
    // No Stop event — session still active

    const thread = await store.getThreadForEvent(toolId)
    // endTs is Infinity path: returns all events from startTs onward
    expect(thread).toHaveLength(3)
  })

  test('root agent event with no preceding UserPromptSubmit uses startTs=0', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 500)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    // No UserPromptSubmit, just a tool event
    const { eventId: toolId } = await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',

      timestamp: 1000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'system',
      subtype: 'Stop',
      toolName: null,

      timestamp: 2000,
      payload: {},
    })

    const thread = await store.getThreadForEvent(toolId)
    // startTs = 0 (no previous prompt), endTs = 2000 (Stop)
    expect(thread).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// getRecentSessions
// ---------------------------------------------------------------------------
describe('SqliteAdapter — getRecentSessions', () => {
  test('returns sessions ordered by last activity descending', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, 'first', null, 1000)
    await store.upsertSession('sess2', projId, 'second', null, 2000)

    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess2', null, null, null)

    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: null,
      toolName: null,

      timestamp: 5000, // more recent activity
      payload: {},
    })
    await store.insertEvent({
      agentId: 'a2',
      sessionId: 'sess2',
      type: 'user',
      subtype: null,
      toolName: null,

      timestamp: 3000,
      payload: {},
    })

    const recent = await store.getRecentSessions(10)
    expect(recent).toHaveLength(2)
    // sess1 has more recent last_activity (5000)
    expect(recent[0].id).toBe('sess1')
    expect(recent[1].id).toBe('sess2')
    expect(recent[0].project_name).toBe('Project 1')
    expect(recent[0].last_activity).toBe(5000)
  })

  test('respects limit parameter', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess2', projId, null, null, 2000)
    await store.upsertSession('sess3', projId, null, null, 3000)

    const recent = await store.getRecentSessions(2)
    expect(recent).toHaveLength(2)
  })

  test('returns aggregated counts', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub')

    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: null,
      toolName: null,

      timestamp: 1000,
      payload: {},
    })

    const recent = await store.getRecentSessions()
    expect(recent).toHaveLength(1)
    expect(recent[0].agent_count).toBe(2)
    expect(recent[0].event_count).toBe(1)
  })

  test('session without events uses started_at for ordering', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess-no-events', projId, null, null, 9000)
    await store.upsertSession('sess-with-events', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess-with-events', null, null, null)
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess-with-events',
      type: 'user',
      subtype: null,
      toolName: null,

      timestamp: 5000,
      payload: {},
    })

    const recent = await store.getRecentSessions()
    expect(recent).toHaveLength(2)
    // sess-no-events has COALESCE(NULL, 9000) = 9000
    // sess-with-events has COALESCE(5000, 1000) = 5000
    expect(recent[0].id).toBe('sess-no-events')
    expect(recent[1].id).toBe('sess-with-events')
  })
})

// ---------------------------------------------------------------------------
// agent_classes aggregation — session queries return DISTINCT classes
// across every agent in the session (root + subagents).
// ---------------------------------------------------------------------------
describe('SqliteAdapter — agent_classes aggregation', () => {
  // The three session queries return agent_classes as a comma-joined string
  // of DISTINCT values. Routes split it into an array; at the storage layer
  // we just verify the set of classes is correct.
  function parseClasses(row: { agent_classes: string | null }): string[] {
    if (!row.agent_classes) return []
    return row.agent_classes.split(',').sort()
  }

  test('getSessionById returns empty agent_classes when session has no agents', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)

    const session = await store.getSessionById('sess1')
    expect(parseClasses(session)).toEqual([])
  })

  test('getSessionById returns single class for single-class session', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null, null, null, 'claude-code')

    const session = await store.getSessionById('sess1')
    expect(parseClasses(session)).toEqual(['claude-code'])
  })

  test('getSessionById deduplicates repeated agent classes', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null, null, null, 'claude-code')
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub', null, null, 'claude-code')
    await store.upsertAgent('a3', 'sess1', 'a1', null, 'sub2', null, null, 'claude-code')

    const session = await store.getSessionById('sess1')
    expect(parseClasses(session)).toEqual(['claude-code'])
  })

  test('getSessionById returns multiple distinct classes sorted', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null, null, null, 'claude-code')
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub', null, null, 'codex')

    const session = await store.getSessionById('sess1')
    expect(parseClasses(session)).toEqual(['claude-code', 'codex'])
  })

  test('getSessionById omits NULL agent_class values', async () => {
    // Legacy row with NULL agent_class + a new row with 'codex' → only codex
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null) // no agentClass
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub', null, null, 'codex')

    const session = await store.getSessionById('sess1')
    expect(parseClasses(session)).toEqual(['codex'])
  })

  test('getSessionsForProject aggregates per-session without leaking across sessions', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess2', projId, null, null, 2000)
    await store.upsertAgent('a1', 'sess1', null, null, null, null, null, 'claude-code')
    await store.upsertAgent('a2', 'sess2', null, null, null, null, null, 'codex')

    const sessions = await store.getSessionsForProject(projId)
    const bySessionId = new Map(sessions.map((s) => [s.id, parseClasses(s)]))
    expect(bySessionId.get('sess1')).toEqual(['claude-code'])
    expect(bySessionId.get('sess2')).toEqual(['codex'])
  })

  test('getRecentSessions aggregates per-session without leaking across sessions', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess2', projId, null, null, 2000)
    await store.upsertAgent('a1', 'sess1', null, null, null, null, null, 'claude-code')
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub', null, null, 'codex')
    await store.upsertAgent('a3', 'sess2', null, null, null, null, null, 'codex')

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
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub')
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,

      timestamp: 1000,
      payload: {},
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
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess2', projId, null, null, 2000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess2', null, null, null)
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: null,
      toolName: null,

      timestamp: 1000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'a2',
      sessionId: 'sess2',
      type: 'user',
      subtype: null,
      toolName: null,

      timestamp: 2000,
      payload: {},
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
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.deleteProject(projId)
    const projects = await store.getProjects()
    expect(projects).toHaveLength(0)
  })

  test('deleteSessions bulk-removes multiple sessions with their events/agents', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
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
      await store.insertEvent({
        agentId: aid,
        sessionId: sid,
        type: 'user',
        subtype: null,
        toolName: null,
        timestamp: ts,
        payload: {},
      })
    }

    const result = await store.deleteSessions(['del1', 'del2'])
    expect(result).toEqual({ events: 2, agents: 2, sessions: 2 })

    // Surviving session still has its row + agent + event
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
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('s1', projId, null, null, 1000)
    await store.upsertSession('s2', projId, null, null, 2000)
    await store.upsertAgent('a1', 's1', null, null, null)
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 's1',
      type: 'user',
      subtype: null,
      toolName: null,
      timestamp: 1000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 's1',
      type: 'user',
      subtype: null,
      toolName: null,
      timestamp: 1100,
      payload: {},
    })

    const stats = await store.getDbStats()
    expect(stats).toEqual({ sessionCount: 2, eventCount: 2 })
  })

  test('vacuum runs without throwing', async () => {
    // VACUUM is mostly a smoke test — it rewrites the DB file.
    await expect(store.vacuum()).resolves.toBeUndefined()
  })

  test('clearAllData empties all tables', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: null,
      toolName: null,

      timestamp: 1000,
      payload: {},
    })

    await store.clearAllData()
    const projects = await store.getProjects()
    expect(projects).toHaveLength(0)
  })

  test('clearSessionEvents removes events and agents but keeps the session', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, 'my-session', null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: null,
      toolName: null,

      timestamp: 1000,
      payload: {},
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
// Orphan repair
// ---------------------------------------------------------------------------
describe('SqliteAdapter — repairOrphans', () => {
  // Helper to bypass FK checks and write directly. better-sqlite3 enables FK
  // by default; we briefly disable it to inject orphaned rows for testing.
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
    await store.createProject('proj1', 'Project 1', null)
    const result = await store.repairOrphans()
    expect(result.sessionsReassigned).toBe(0)
    expect(result.agentsDeleted).toBe(0)
    expect(result.agentsReparented).toBe(0)
    expect(result.eventsDeleted).toBe(0)
  })

  test('reassigns sessions with invalid project_id to unknown project', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    // Manually orphan the session by deleting its project (bypass cascade)
    withFkOff(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).db.prepare('DELETE FROM projects WHERE id = ?').run(projId)
    })

    const result = await store.repairOrphans()
    expect(result.sessionsReassigned).toBe(1)

    // The session should now be reassigned to the 'unknown' project
    const unknown = await store.getProjectBySlug('unknown')
    expect(unknown).not.toBeNull()
    const session = await store.getSessionById('sess1')
    expect(session.project_id).toBe(unknown.id)
  })

  test('reuses existing unknown project if it already exists', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    const unknownId = await store.createProject('unknown', 'unknown', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess2', projId, null, null, 2000)
    withFkOff(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).db.prepare('DELETE FROM projects WHERE id = ?').run(projId)
    })

    const result = await store.repairOrphans()
    expect(result.sessionsReassigned).toBe(2)

    const sess1 = await store.getSessionById('sess1')
    const sess2 = await store.getSessionById('sess2')
    expect(sess1.project_id).toBe(unknownId)
    expect(sess2.project_id).toBe(unknownId)

    // Should not have created a duplicate unknown project
    const projects = await store.getProjects()
    const unknowns = projects.filter((p: { slug: string }) => p.slug === 'unknown')
    expect(unknowns).toHaveLength(1)
  })

  test('deletes agents with invalid session_id', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    // Orphan the agent by deleting the session row
    withFkOff(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).db.prepare('DELETE FROM sessions WHERE id = ?').run('sess1')
    })

    const result = await store.repairOrphans()
    expect(result.agentsDeleted).toBe(1)

    const agent = await store.getAgentById('a1')
    expect(agent).toBeNull()
  })

  test('nulls out parent_agent_id when parent has been deleted', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('parent1', 'sess1', null, null, null)
    await store.upsertAgent('child1', 'sess1', 'parent1', null, null)
    // Delete the parent only
    withFkOff(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).db.prepare('DELETE FROM agents WHERE id = ?').run('parent1')
    })

    const result = await store.repairOrphans()
    expect(result.agentsReparented).toBe(1)

    const child = await store.getAgentById('child1')
    expect(child).not.toBeNull()
    expect(child.parent_agent_id).toBeNull()
  })

  test('deletes events with invalid session_id', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      timestamp: 1000,
      payload: {},
    })
    // Orphan the event by deleting the session
    withFkOff(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
    })

    const result = await store.repairOrphans()
    // Both the event and the agent get deleted
    expect(result.agentsDeleted).toBe(1)
    expect(result.eventsDeleted).toBeGreaterThanOrEqual(1)
  })

  test('deletes events with invalid agent_id', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      timestamp: 1000,
      payload: {},
    })
    // Orphan the event by deleting only the agent
    withFkOff(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).db.prepare('DELETE FROM agents WHERE id = ?').run('a1')
    })

    const result = await store.repairOrphans()
    expect(result.eventsDeleted).toBe(1)
    const events = await store.getEventsForSession('sess1')
    expect(events).toHaveLength(0)
  })

  test('recomputes session counts after repair', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    // Insert two events normally (so counts are correct: event_count=2, agent_count=1)
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      timestamp: 1000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PostToolUse',
      toolName: 'Bash',
      timestamp: 2000,
      payload: {},
    })

    let session = await store.getSessionById('sess1')
    expect(session.event_count).toBe(2)
    expect(session.agent_count).toBe(1)

    // Orphan one event by deleting its agent
    withFkOff(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).db.prepare('DELETE FROM agents WHERE id = ?').run('a1')
    })

    await store.repairOrphans()

    // After repair: events deleted, counts recomputed
    session = await store.getSessionById('sess1')
    expect(session.event_count).toBe(0)
    expect(session.agent_count).toBe(0)
  })

  test('handles multiple orphan types in a single pass', async () => {
    // Project P1 with session S1, agent A1, event E1
    const p1 = await store.createProject('p1', 'P1', null)
    await store.upsertSession('s1', p1, null, null, 1000)
    await store.upsertAgent('a1', 's1', null, null, null)
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 's1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      timestamp: 1000,
      payload: {},
    })

    // Project P2 with session S2 and a parent/child agent pair
    const p2 = await store.createProject('p2', 'P2', null)
    await store.upsertSession('s2', p2, null, null, 2000)
    await store.upsertAgent('parent2', 's2', null, null, null)
    await store.upsertAgent('child2', 's2', 'parent2', null, null)

    // Orphan everything via raw deletes
    withFkOff(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).db.prepare('DELETE FROM projects WHERE id = ?').run(p1)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).db.prepare('DELETE FROM agents WHERE id = ?').run('parent2')
    })

    const result = await store.repairOrphans()
    // s1's project was deleted but the session row still exists → reassigned
    expect(result.sessionsReassigned).toBe(1)
    // child2's parent was deleted → reparented
    expect(result.agentsReparented).toBe(1)
    // Sanity: nothing else got deleted unexpectedly
    expect(result.agentsDeleted).toBe(0)
  })

  test('orphaned active session is recoverable via getRecentSessions', async () => {
    // This is the specific bug the user hit: an active session whose project
    // was deleted should still appear in recent sessions (not silently hidden
    // by the previous INNER JOIN).
    const projId = await store.createProject('p1', 'P1', null)
    await store.upsertSession('s1', projId, 'active-session', null, Date.now())
    withFkOff(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).db.prepare('DELETE FROM projects WHERE id = ?').run(projId)
    })

    // Even before repair, the LEFT JOIN should surface the orphan
    const recentBefore = await store.getRecentSessions()
    expect(recentBefore.find((r: { id: string }) => r.id === 's1')).toBeDefined()

    // After repair, the session is reassigned to 'unknown'
    await store.repairOrphans()
    const recentAfter = await store.getRecentSessions()
    const found = recentAfter.find((r: { id: string }) => r.id === 's1')
    expect(found).toBeDefined()
    expect(found.project_slug).toBe('unknown')
  })
})
