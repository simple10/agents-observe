// app/server/src/storage/sqlite-adapter.ts

import Database from 'better-sqlite3'
import type {
  EventStore,
  InsertEventParams,
  InsertEventResult,
  EventFilters,
  NotificationTransition,
  StoredEvent,
  OrphanRepairResult,
} from './types'

export class SqliteAdapter implements EventStore {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)

    // PRAGMAs
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('cache_size = -64000') // 64MB cache (default 2MB)
    this.db.pragma('temp_store = MEMORY')
    this.db.pragma('mmap_size = 30000000') // 30MB memory-mapped I/O

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        transcript_path TEXT,
        cwd TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // Migration: add metadata to projects if missing
    const projectCols = this.db.prepare("PRAGMA table_info('projects')").all() as { name: string }[]
    if (!projectCols.some((c) => c.name === 'metadata')) {
      this.db.exec('ALTER TABLE projects ADD COLUMN metadata TEXT')
    }
    if (!projectCols.some((c) => c.name === 'cwd')) {
      this.db.exec('ALTER TABLE projects ADD COLUMN cwd TEXT')
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        slug TEXT,
        status TEXT DEFAULT 'active',
        started_at INTEGER NOT NULL,
        stopped_at INTEGER,
        transcript_path TEXT,
        metadata TEXT,
        event_count INTEGER NOT NULL DEFAULT 0,
        agent_count INTEGER NOT NULL DEFAULT 0,
        last_activity INTEGER,
        pending_notification_ts INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // Migrations for sessions
    const sessionCols = this.db.prepare("PRAGMA table_info('sessions')").all() as { name: string }[]
    if (!sessionCols.some((c) => c.name === 'transcript_path')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN transcript_path TEXT')
    }
    if (!sessionCols.some((c) => c.name === 'event_count')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN event_count INTEGER NOT NULL DEFAULT 0')
      this.db.exec('ALTER TABLE sessions ADD COLUMN agent_count INTEGER NOT NULL DEFAULT 0')
      this.db.exec('ALTER TABLE sessions ADD COLUMN last_activity INTEGER')
      // Backfill from existing data
      this.db.exec(`
        UPDATE sessions SET
          event_count = (SELECT COUNT(*) FROM events WHERE session_id = sessions.id),
          agent_count = (SELECT COUNT(*) FROM agents WHERE session_id = sessions.id),
          last_activity = (SELECT MAX(timestamp) FROM events WHERE session_id = sessions.id)
      `)
    }
    // Notification tracking — `pending_notification_ts` holds the ts of
    // the event that put the session into "awaiting user" state. NULL
    // means no pending notification. Flags on the incoming event envelope
    // (meta.isNotification / meta.clearsNotification) decide transitions;
    // the server never inspects the raw subtype for notification purposes.
    const hasPending = sessionCols.some((c) => c.name === 'pending_notification_ts')
    const hasLegacy = sessionCols.some((c) => c.name === 'last_notification_ts')
    if (!hasPending && hasLegacy) {
      // Rename the legacy column. Available in SQLite ≥3.25 (bundled with
      // modern better-sqlite3). Defensive fallback: add/copy/drop.
      try {
        this.db.exec(
          'ALTER TABLE sessions RENAME COLUMN last_notification_ts TO pending_notification_ts',
        )
      } catch {
        this.db.exec('ALTER TABLE sessions ADD COLUMN pending_notification_ts INTEGER')
        this.db.exec('UPDATE sessions SET pending_notification_ts = last_notification_ts')
        this.db.exec('ALTER TABLE sessions DROP COLUMN last_notification_ts')
      }
    } else if (!hasPending) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN pending_notification_ts INTEGER')
      // Fresh column on a pre-envelope-flags install → backfill from the
      // events table as a one-time bootstrap. This is the ONLY place the
      // server reads `subtype` to infer notification state; the sweep
      // below corrects for the old pending-rule. After migration, state
      // is driven entirely by envelope flags at event-insert time.
      this.db.exec(`
        UPDATE sessions SET
          pending_notification_ts = (
            SELECT MAX(timestamp) FROM events
            WHERE session_id = sessions.id AND subtype = 'Notification'
          )
      `)
    }
    // One-time sweep of rows that looked "pending" under the pre-rename
    // semantics (`last_activity == last_notification_ts` required). Under
    // the new model, any non-NULL `pending_notification_ts` means pending,
    // so rows where activity has moved past the notification get NULLed
    // out here to preserve the "already cleared" state those rows had.
    this.db.exec(`
      UPDATE sessions
      SET pending_notification_ts = NULL
      WHERE pending_notification_ts IS NOT NULL
        AND last_activity IS NOT NULL
        AND pending_notification_ts < last_activity
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_agent_id TEXT,
        name TEXT,
        description TEXT,
        agent_type TEXT,
        agent_class TEXT,
        transcript_path TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (parent_agent_id) REFERENCES agents(id)
      )
    `)

    // Migrations for agents
    const agentCols = this.db.prepare("PRAGMA table_info('agents')").all() as { name: string }[]
    if (!agentCols.some((c) => c.name === 'metadata')) {
      this.db.exec('ALTER TABLE agents ADD COLUMN metadata TEXT')
    }
    if (!agentCols.some((c) => c.name === 'transcript_path')) {
      this.db.exec('ALTER TABLE agents ADD COLUMN transcript_path TEXT')
    }
    if (!agentCols.some((c) => c.name === 'agent_class')) {
      this.db.exec('ALTER TABLE agents ADD COLUMN agent_class TEXT')
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        hook_name TEXT,
        type TEXT NOT NULL,
        subtype TEXT,
        tool_name TEXT,
        timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)

    // Migration: add created_at, drop summary and status from events
    const eventCols = this.db.prepare("PRAGMA table_info('events')").all() as { name: string }[]
    if (!eventCols.some((c) => c.name === 'created_at')) {
      this.db.exec('ALTER TABLE events ADD COLUMN created_at INTEGER')
      this.db.exec('UPDATE events SET created_at = timestamp WHERE created_at IS NULL')
    }
    if (eventCols.some((c) => c.name === 'summary')) {
      this.db.exec('ALTER TABLE events DROP COLUMN summary')
    }
    if (eventCols.some((c) => c.name === 'status')) {
      this.db.exec('ALTER TABLE events DROP COLUMN status')
    }

    // Migration: add hook_name column, backfill from payload's
    // `hook_event_name` for existing rows. After migration, value is
    // stamped at insert time from the CLI-supplied envelope meta.
    if (!eventCols.some((c) => c.name === 'hook_name')) {
      this.db.exec('ALTER TABLE events ADD COLUMN hook_name TEXT')
      // One-time bootstrap for existing rows: extract from JSON payload.
      this.db.exec(`
        UPDATE events
        SET hook_name = json_extract(payload, '$.hook_event_name')
        WHERE hook_name IS NULL
      `)
    }

    // Migration: drop tool_use_id column. The server never queries on
    // it (verified: zero WHERE clauses). The client reads the raw
    // `tool_use_id` from `payload` directly for Pre/Post tool pairing
    // (groupId in the agent-class processEvent). Server's subagent
    // pairing in events.ts also reads from payload at ingest.
    if (eventCols.some((c) => c.name === 'tool_use_id')) {
      this.db.exec('DROP INDEX IF EXISTS idx_events_tool_use_id')
      try {
        this.db.exec('ALTER TABLE events DROP COLUMN tool_use_id')
      } catch {
        // Older SQLite without DROP COLUMN — recreate the table sans
        // the column. Uses the new schema (no tool_use_id) declared
        // above at CREATE TABLE IF NOT EXISTS. This only triggers on
        // pre-3.35 SQLite which modern better-sqlite3 doesn't bundle,
        // but we keep the fallback defensive.
        this.db.exec('BEGIN')
        try {
          this.db.exec(`
            CREATE TABLE events_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              agent_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              hook_name TEXT,
              type TEXT NOT NULL,
              subtype TEXT,
              tool_name TEXT,
              timestamp INTEGER NOT NULL,
              created_at INTEGER NOT NULL,
              payload TEXT NOT NULL,
              FOREIGN KEY (agent_id) REFERENCES agents(id),
              FOREIGN KEY (session_id) REFERENCES sessions(id)
            )
          `)
          this.db.exec(`
            INSERT INTO events_new (id, agent_id, session_id, hook_name, type, subtype, tool_name, timestamp, created_at, payload)
            SELECT id, agent_id, session_id, hook_name, type, subtype, tool_name, timestamp, created_at, payload FROM events
          `)
          this.db.exec('DROP TABLE events')
          this.db.exec('ALTER TABLE events_new RENAME TO events')
          this.db.exec('COMMIT')
        } catch (err) {
          this.db.exec('ROLLBACK')
          throw err
        }
      }
    }

    // Create indexes
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug)')
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_projects_transcript_path ON projects(transcript_path)',
    )
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_projects_cwd ON projects(cwd)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, timestamp)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, timestamp)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, subtype)')
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_events_session_agent ON events(session_id, agent_id, timestamp)',
    )
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_hook_name ON events(hook_name)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)')
  }

  async createProject(
    slug: string,
    name: string,
    transcriptPath: string | null,
    cwd: string | null = null,
  ): Promise<number> {
    const now = Date.now()
    const result = this.db
      .prepare(
        'INSERT INTO projects (slug, name, transcript_path, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(slug, name, transcriptPath, cwd, now, now)
    return result.lastInsertRowid as number
  }

  async getProjectById(id: number): Promise<any | null> {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) || null
  }

  async getProjectBySlug(slug: string): Promise<any | null> {
    return this.db.prepare(`SELECT * FROM projects WHERE slug = ?`).get(slug) || null
  }

  async getProjectByCwd(cwd: string): Promise<any | null> {
    return this.db.prepare(`SELECT * FROM projects WHERE cwd = ?`).get(cwd) || null
  }

  async updateProjectCwd(projectId: number, cwd: string): Promise<void> {
    const now = Date.now()
    this.db
      .prepare('UPDATE projects SET cwd = ?, updated_at = ? WHERE id = ?')
      .run(cwd, now, projectId)
  }

  async getProjectByTranscriptPath(transcriptPath: string): Promise<any | null> {
    return (
      this.db.prepare(`SELECT * FROM projects WHERE transcript_path = ?`).get(transcriptPath) ||
      null
    )
  }

  async updateProjectName(projectId: number, name: string): Promise<void> {
    this.db
      .prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, Date.now(), projectId)
  }

  async isSlugAvailable(slug: string): Promise<boolean> {
    const row = this.db.prepare(`SELECT id FROM projects WHERE slug = ?`).get(slug) as
      | { id: number }
      | undefined
    return row === undefined
  }

  async upsertSession(
    id: string,
    projectId: number,
    slug: string | null,
    metadata: Record<string, unknown> | null,
    timestamp: number,
    transcriptPath?: string | null,
  ): Promise<void> {
    const now = Date.now()
    this.db
      .prepare(
        `
      INSERT INTO sessions (id, project_id, slug, status, started_at, transcript_path, metadata, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        slug = COALESCE(excluded.slug, sessions.slug),
        transcript_path = COALESCE(excluded.transcript_path, sessions.transcript_path),
        metadata = CASE
          WHEN excluded.metadata IS NULL THEN sessions.metadata
          WHEN sessions.metadata IS NULL THEN excluded.metadata
          ELSE json_patch(sessions.metadata, excluded.metadata)
        END,
        updated_at = ?
    `,
      )
      .run(
        id,
        projectId,
        slug,
        timestamp,
        transcriptPath || null,
        metadata ? JSON.stringify(metadata) : null,
        now,
        now,
        now,
      )
  }

  async upsertAgent(
    id: string,
    sessionId: string,
    parentAgentId: string | null,
    name: string | null,
    description: string | null,
    agentType?: string | null,
    transcriptPath?: string | null,
    agentClass?: string | null,
  ): Promise<void> {
    const now = Date.now()
    const existing = this.db.prepare('SELECT id FROM agents WHERE id = ?').get(id)
    this.db
      .prepare(
        `
      INSERT INTO agents (id, session_id, parent_agent_id, name, description, agent_type, transcript_path, agent_class, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = COALESCE(excluded.name, agents.name),
        description = COALESCE(excluded.description, agents.description),
        agent_type = COALESCE(excluded.agent_type, agents.agent_type),
        transcript_path = COALESCE(excluded.transcript_path, agents.transcript_path),
        agent_class = COALESCE(excluded.agent_class, agents.agent_class),
        updated_at = ?
    `,
      )
      .run(
        id,
        sessionId,
        parentAgentId,
        name,
        description,
        agentType ?? null,
        transcriptPath ?? null,
        agentClass ?? null,
        now,
        now,
        now,
      )

    if (!existing) {
      this.db
        .prepare('UPDATE sessions SET agent_count = agent_count + 1 WHERE id = ?')
        .run(sessionId)
    }
  }

  async updateAgentType(id: string, agentType: string): Promise<void> {
    this.db
      .prepare('UPDATE agents SET agent_type = ?, updated_at = ? WHERE id = ?')
      .run(agentType, Date.now(), id)
  }

  async updateSessionStatus(id: string, status: string): Promise<void> {
    this.db
      .prepare(
        `
      UPDATE sessions SET status = ?, stopped_at = ? WHERE id = ?
    `,
      )
      .run(status, status === 'stopped' ? Date.now() : null, id)
  }

  async updateSessionProject(sessionId: string, projectId: number): Promise<void> {
    this.db
      .prepare('UPDATE sessions SET project_id = ?, updated_at = ? WHERE id = ?')
      .run(projectId, Date.now(), sessionId)
  }

  async patchSessionMetadata(sessionId: string, patch: Record<string, unknown>): Promise<void> {
    this.db
      .prepare(
        `UPDATE sessions SET metadata = json_patch(COALESCE(metadata, '{}'), ?), updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(patch), Date.now(), sessionId)
  }

  async updateSessionSlug(sessionId: string, slug: string): Promise<void> {
    this.db
      .prepare(
        `
      UPDATE sessions SET slug = ? WHERE id = ?
    `,
      )
      .run(slug, sessionId)
  }

  async updateAgentName(agentId: string, name: string): Promise<void> {
    this.db
      .prepare('UPDATE agents SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, Date.now(), agentId)
  }

  async insertEvent(params: InsertEventParams): Promise<InsertEventResult> {
    const now = Date.now()
    const result = this.db
      .prepare(
        `
      INSERT INTO events (agent_id, session_id, hook_name, type, subtype, tool_name, timestamp, created_at, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        params.agentId,
        params.sessionId,
        params.hookName ?? null,
        params.type,
        params.subtype,
        params.toolName,
        params.timestamp,
        now,
        JSON.stringify(params.payload),
      )

    // Read pending state BEFORE the session update so we can report the
    // transition the caller needs to broadcast.
    const before = this.db
      .prepare('SELECT pending_notification_ts FROM sessions WHERE id = ?')
      .get(params.sessionId) as { pending_notification_ts: number | null } | undefined

    // Flag-driven state update. The server never inspects subtype for
    // notification purposes — agent-class-specific semantics live in the
    // CLI, which stamps meta.isNotification / meta.clearsNotification on
    // the envelope.
    let nextPendingTs: number | null | undefined
    if (params.isNotification === true) {
      nextPendingTs = params.timestamp
    } else if (params.clearsNotification !== false) {
      nextPendingTs = null
    } else {
      nextPendingTs = undefined // leave column alone
    }

    if (nextPendingTs === undefined) {
      this.db
        .prepare(
          `UPDATE sessions SET
            event_count = event_count + 1,
            last_activity = MAX(COALESCE(last_activity, 0), ?)
          WHERE id = ?`,
        )
        .run(params.timestamp, params.sessionId)
    } else {
      this.db
        .prepare(
          `UPDATE sessions SET
            event_count = event_count + 1,
            last_activity = MAX(COALESCE(last_activity, 0), ?),
            pending_notification_ts = ?
          WHERE id = ?`,
        )
        .run(params.timestamp, nextPendingTs, params.sessionId)
    }

    const beforeTs = before?.pending_notification_ts ?? null
    const afterTs = nextPendingTs === undefined ? beforeTs : nextPendingTs
    let notificationTransition: NotificationTransition
    if (beforeTs === null && afterTs !== null) notificationTransition = 'set'
    else if (beforeTs !== null && afterTs === null) notificationTransition = 'cleared'
    else notificationTransition = 'none'

    return { eventId: Number(result.lastInsertRowid), notificationTransition }
  }

  async getSessionsWithPendingNotifications(sinceTs: number): Promise<any[]> {
    // A session is "pending" when `pending_notification_ts` is set. The
    // column is driven entirely by envelope flags at event-insert time —
    // this query never inspects `subtype`. `sinceTs` is the client's
    // last-seen cursor for resume on page load. Pending is binary: the
    // session either has a notification pending or it doesn't.
    return this.db
      .prepare(
        `
      SELECT
        s.id as session_id,
        s.project_id,
        s.pending_notification_ts
      FROM sessions s
      WHERE s.pending_notification_ts IS NOT NULL
        AND s.pending_notification_ts > ?
      ORDER BY s.pending_notification_ts DESC
    `,
      )
      .all(sinceTs)
  }

  async getProjects(): Promise<any[]> {
    return this.db
      .prepare(
        `
      SELECT p.id, p.slug, p.name, p.transcript_path, p.created_at,
        COUNT(DISTINCT s.id) as session_count
      FROM projects p
      LEFT JOIN sessions s ON s.project_id = p.id
      GROUP BY p.id
      ORDER BY p.name ASC
    `,
      )
      .all()
  }

  async getSessionsForProject(projectId: number): Promise<any[]> {
    return this.db
      .prepare(
        `
      SELECT s.*,
        (
          SELECT GROUP_CONCAT(DISTINCT a.agent_class)
          FROM agents a
          WHERE a.session_id = s.id AND a.agent_class IS NOT NULL
        ) AS agent_classes
      FROM sessions s
      WHERE s.project_id = ?
      ORDER BY COALESCE(s.last_activity, s.started_at) DESC
    `,
      )
      .all(projectId)
  }

  async getSessionById(sessionId: string): Promise<any | null> {
    return (
      this.db
        .prepare(
          `
      SELECT s.*,
        p.slug as project_slug,
        p.name as project_name,
        (
          SELECT GROUP_CONCAT(DISTINCT a.agent_class)
          FROM agents a
          WHERE a.session_id = s.id AND a.agent_class IS NOT NULL
        ) AS agent_classes
      FROM sessions s
      LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?
    `,
        )
        .get(sessionId) || null
    )
  }

  async getAgentById(agentId: string): Promise<any | null> {
    return this.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) || null
  }

  async getAgentsForSession(sessionId: string): Promise<any[]> {
    return this.db
      .prepare('SELECT * FROM agents WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId)
  }

  async getEventsForSession(sessionId: string, filters?: EventFilters): Promise<StoredEvent[]> {
    let sql = 'SELECT * FROM events WHERE session_id = ?'
    const params: any[] = [sessionId]

    if (filters?.agentIds && filters.agentIds.length > 0) {
      const placeholders = filters.agentIds.map(() => '?').join(',')
      sql += ` AND agent_id IN (${placeholders})`
      params.push(...filters.agentIds)
    }

    if (filters?.type) {
      sql += ' AND type = ?'
      params.push(filters.type)
    }

    if (filters?.subtype) {
      sql += ' AND subtype = ?'
      params.push(filters.subtype)
    }

    if (filters?.hookName) {
      sql += ' AND hook_name = ?'
      params.push(filters.hookName)
    }

    if (filters?.search) {
      sql += ' AND payload LIKE ?'
      const term = `%${filters.search}%`
      params.push(term)
    }

    sql += ' ORDER BY timestamp ASC'

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
      if (filters?.offset) {
        sql += ' OFFSET ?'
        params.push(filters.offset)
      }
    }

    return this.db.prepare(sql).all(...params) as StoredEvent[]
  }

  async getEventsForAgent(agentId: string): Promise<StoredEvent[]> {
    return this.db
      .prepare(
        `
      SELECT * FROM events WHERE agent_id = ? ORDER BY timestamp ASC
    `,
      )
      .all(agentId) as StoredEvent[]
  }

  async getThreadForEvent(eventId: number): Promise<StoredEvent[]> {
    const event = this.db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
      | StoredEvent
      | undefined
    if (!event) return []

    const sessionId = event.session_id
    const agentId = event.agent_id

    // For SubagentStop or events from a non-root agent:
    // return all events belonging to that specific agent
    const isSubagent = agentId !== sessionId
    if (event.subtype === 'SubagentStop' || isSubagent) {
      return this.db
        .prepare('SELECT * FROM events WHERE agent_id = ? ORDER BY timestamp ASC')
        .all(agentId) as StoredEvent[]
    }

    // For root agent events: find the turn boundary (Prompt -> Stop)
    const prevPrompt = this.db
      .prepare(
        `SELECT timestamp FROM events
         WHERE session_id = ? AND subtype = 'UserPromptSubmit' AND timestamp <= ?
         ORDER BY timestamp DESC LIMIT 1`,
      )
      .get(sessionId, event.timestamp) as { timestamp: number } | undefined

    const startTs = prevPrompt ? prevPrompt.timestamp : 0

    // End at the first Stop or next UserPromptSubmit
    const nextBoundary = this.db
      .prepare(
        `SELECT timestamp FROM events
         WHERE session_id = ? AND timestamp > ?
           AND (subtype = 'UserPromptSubmit' OR subtype = 'Stop' OR subtype = 'SubagentStop')
         ORDER BY timestamp ASC LIMIT 1`,
      )
      .get(sessionId, startTs) as { timestamp: number } | undefined

    const endTs = nextBoundary ? nextBoundary.timestamp : Infinity

    if (endTs === Infinity) {
      return this.db
        .prepare(
          'SELECT * FROM events WHERE session_id = ? AND timestamp >= ? ORDER BY timestamp ASC',
        )
        .all(sessionId, startTs) as StoredEvent[]
    }

    return this.db
      .prepare(
        'SELECT * FROM events WHERE session_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC',
      )
      .all(sessionId, startTs, endTs) as StoredEvent[]
  }

  async getEventsSince(sessionId: string, sinceTimestamp: number): Promise<StoredEvent[]> {
    return this.db
      .prepare(
        `
      SELECT * FROM events WHERE session_id = ? AND timestamp > ? ORDER BY timestamp ASC
    `,
      )
      .all(sessionId, sinceTimestamp) as StoredEvent[]
  }

  async deleteSession(sessionId: string): Promise<{ events: number; agents: number }> {
    const events = this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId).changes
    const agents = this.db.prepare('DELETE FROM agents WHERE session_id = ?').run(sessionId).changes
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
    return { events, agents }
  }

  async deleteProject(
    projectId: number,
  ): Promise<{ sessionIds: string[]; sessions: number; agents: number; events: number }> {
    const rows = this.db.prepare('SELECT id FROM sessions WHERE project_id = ?').all(projectId) as {
      id: string
    }[]
    const sessionIds = rows.map((s) => s.id)
    let events = 0
    let agents = 0
    for (const sessionId of sessionIds) {
      events += this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId).changes
      agents += this.db.prepare('DELETE FROM agents WHERE session_id = ?').run(sessionId).changes
    }
    const sessions = this.db
      .prepare('DELETE FROM sessions WHERE project_id = ?')
      .run(projectId).changes
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
    return { sessionIds, sessions, agents, events }
  }

  async clearAllData(): Promise<{
    projects: number
    sessions: number
    agents: number
    events: number
  }> {
    const events = this.db.prepare('DELETE FROM events WHERE 1=1').run().changes
    const agents = this.db.prepare('DELETE FROM agents WHERE 1=1').run().changes
    const sessions = this.db.prepare('DELETE FROM sessions WHERE 1=1').run().changes
    const projects = this.db.prepare('DELETE FROM projects WHERE 1=1').run().changes
    return { projects, sessions, agents, events }
  }

  async deleteSessions(
    sessionIds: string[],
  ): Promise<{ events: number; agents: number; sessions: number }> {
    if (sessionIds.length === 0) return { events: 0, agents: 0, sessions: 0 }
    // Wrap in a transaction so a mid-loop failure doesn't leave orphaned
    // events/agents pointing at a deleted session row.
    const tx = this.db.transaction((ids: string[]) => {
      let events = 0
      let agents = 0
      let sessions = 0
      const delEvents = this.db.prepare('DELETE FROM events WHERE session_id = ?')
      const delAgents = this.db.prepare('DELETE FROM agents WHERE session_id = ?')
      const delSession = this.db.prepare('DELETE FROM sessions WHERE id = ?')
      for (const id of ids) {
        events += delEvents.run(id).changes
        agents += delAgents.run(id).changes
        sessions += delSession.run(id).changes
      }
      return { events, agents, sessions }
    })
    return tx(sessionIds)
  }

  async getDbStats(): Promise<{ sessionCount: number; eventCount: number }> {
    const sessionRow = this.db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }
    const eventRow = this.db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number }
    return { sessionCount: sessionRow.c, eventCount: eventRow.c }
  }

  async vacuum(): Promise<void> {
    // VACUUM cannot run inside a transaction. better-sqlite3 exposes it
    // directly via exec(). The DB briefly locks for writes, but for a
    // local single-user tool the tradeoff is fine.
    this.db.exec('VACUUM')
  }

  async clearSessionEvents(sessionId: string): Promise<{ events: number; agents: number }> {
    const events = this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId).changes
    const agents = this.db.prepare('DELETE FROM agents WHERE session_id = ?').run(sessionId).changes
    this.db
      .prepare(
        'UPDATE sessions SET event_count = 0, agent_count = 0, last_activity = NULL WHERE id = ?',
      )
      .run(sessionId)
    return { events, agents }
  }

  async getRecentSessions(limit: number = 20): Promise<any[]> {
    // LEFT JOIN so orphaned sessions (project deleted out from under them)
    // still appear in the recent list. The repairOrphans pass should make
    // this rare, but the LEFT JOIN is defensive — without it, an orphaned
    // active session would silently disappear from the UI.
    return this.db
      .prepare(
        `
      SELECT s.*,
        p.slug as project_slug,
        p.name as project_name,
        (
          SELECT GROUP_CONCAT(DISTINCT a.agent_class)
          FROM agents a
          WHERE a.session_id = s.id AND a.agent_class IS NOT NULL
        ) AS agent_classes
      FROM sessions s
      LEFT JOIN projects p ON p.id = s.project_id
      ORDER BY COALESCE(s.last_activity, s.started_at) DESC
      LIMIT ?
    `,
      )
      .all(limit)
  }

  async repairOrphans(): Promise<OrphanRepairResult> {
    const result: OrphanRepairResult = {
      sessionsReassigned: 0,
      agentsDeleted: 0,
      agentsReparented: 0,
      eventsDeleted: 0,
    }

    // 1. Sessions with invalid project_id (project doesn't exist or is null).
    //    Reassign to the 'unknown' project, creating it if needed.
    const orphanedSessions = this.db
      .prepare(
        `SELECT s.id FROM sessions s
         LEFT JOIN projects p ON p.id = s.project_id
         WHERE p.id IS NULL`,
      )
      .all() as { id: string }[]

    if (orphanedSessions.length > 0) {
      // Get-or-create the 'unknown' project
      let unknownProject = this.db
        .prepare('SELECT id FROM projects WHERE slug = ?')
        .get('unknown') as { id: number } | undefined
      if (!unknownProject) {
        const now = Date.now()
        const ins = this.db
          .prepare(
            'INSERT INTO projects (slug, name, transcript_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run('unknown', 'unknown', null, now, now)
        unknownProject = { id: Number(ins.lastInsertRowid) }
      }
      const update = this.db.prepare(
        'UPDATE sessions SET project_id = ?, updated_at = ? WHERE id = ?',
      )
      const now = Date.now()
      for (const s of orphanedSessions) {
        update.run(unknownProject.id, now, s.id)
        result.sessionsReassigned++
      }
    }

    // 2. Agents with invalid session_id → delete (no recovery possible since
    //    the session and all its events are gone).
    //    Note: we have to delete events for these agents first or the events
    //    table FK from agents would also fail when something tries to read them.
    const orphanedAgents = this.db
      .prepare(
        `SELECT a.id FROM agents a
         LEFT JOIN sessions s ON s.id = a.session_id
         WHERE s.id IS NULL`,
      )
      .all() as { id: string }[]
    if (orphanedAgents.length > 0) {
      const deleteEvents = this.db.prepare('DELETE FROM events WHERE agent_id = ?')
      const deleteAgent = this.db.prepare('DELETE FROM agents WHERE id = ?')
      for (const a of orphanedAgents) {
        const eventDel = deleteEvents.run(a.id)
        result.eventsDeleted += eventDel.changes
        deleteAgent.run(a.id)
        result.agentsDeleted++
      }
    }

    // 3. Agents with invalid parent_agent_id (parent has been deleted but
    //    the child remains). Null out the parent rather than deleting — the
    //    agent itself is still meaningful, just no longer part of a hierarchy.
    const reparented = this.db
      .prepare(
        `UPDATE agents
         SET parent_agent_id = NULL, updated_at = ?
         WHERE parent_agent_id IS NOT NULL
         AND parent_agent_id NOT IN (SELECT id FROM agents)`,
      )
      .run(Date.now())
    result.agentsReparented = reparented.changes

    // 4. Events with invalid session_id → delete. Also covers events that
    //    survived an interrupted delete cascade.
    //    Note: this is a NOT IN subquery against the full events table, so
    //    it scans all events. For very large databases (100k+ events) it
    //    may take a few hundred ms — acceptable since this only runs once
    //    on server startup.
    const orphanedSessionEvents = this.db
      .prepare(
        `DELETE FROM events
         WHERE session_id NOT IN (SELECT id FROM sessions)`,
      )
      .run()
    result.eventsDeleted += orphanedSessionEvents.changes

    // 5. Events with invalid agent_id → delete (similar to above).
    const orphanedAgentEvents = this.db
      .prepare(
        `DELETE FROM events
         WHERE agent_id NOT IN (SELECT id FROM agents)`,
      )
      .run()
    result.eventsDeleted += orphanedAgentEvents.changes

    // 6. Recompute cached counts on sessions if anything was repaired,
    //    since insertEvent/upsertAgent maintain these incrementally.
    if (result.sessionsReassigned > 0 || result.agentsDeleted > 0 || result.eventsDeleted > 0) {
      this.db.exec(`
        UPDATE sessions SET
          event_count = (SELECT COUNT(*) FROM events WHERE session_id = sessions.id),
          agent_count = (SELECT COUNT(*) FROM agents WHERE session_id = sessions.id),
          last_activity = (SELECT MAX(timestamp) FROM events WHERE session_id = sessions.id)
      `)
    }

    return result
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const row = this.db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined
      if (row?.ok !== 1) return { ok: false, error: 'SQLite query returned unexpected result' }

      // Verify tables exist
      const tables = this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects','sessions','events','agents')",
        )
        .all() as { name: string }[]
      if (tables.length < 4) {
        const missing = ['projects', 'sessions', 'events', 'agents'].filter(
          (t) => !tables.some((r) => r.name === t),
        )
        return { ok: false, error: `Missing tables: ${missing.join(', ')}` }
      }

      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err.message || 'Unknown database error' }
    }
  }
}
