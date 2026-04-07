// app/server/src/storage/sqlite-adapter.ts

import Database from 'better-sqlite3'
import type { EventStore, InsertEventParams, EventFilters, StoredEvent } from './types'

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

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_agent_id TEXT,
        name TEXT,
        description TEXT,
        agent_type TEXT,
        agent_class TEXT DEFAULT 'claude-code',
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

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        subtype TEXT,
        tool_name TEXT,
        timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        tool_use_id TEXT,
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

    // Create indexes
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug)')
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_projects_transcript_path ON projects(transcript_path)',
    )
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, timestamp)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, timestamp)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, subtype)')
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_events_session_agent ON events(session_id, agent_id, timestamp)',
    )
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_tool_use_id ON events(tool_use_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)')
  }

  async createProject(slug: string, name: string, transcriptPath: string | null): Promise<number> {
    const now = Date.now()
    const result = this.db
      .prepare(
        'INSERT INTO projects (slug, name, transcript_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(slug, name, transcriptPath, now, now)
    return result.lastInsertRowid as number
  }

  async getProjectBySlug(slug: string): Promise<any | null> {
    return this.db.prepare(`SELECT * FROM projects WHERE slug = ?`).get(slug) || null
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
        metadata = COALESCE(excluded.metadata, sessions.metadata),
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
  ): Promise<void> {
    const now = Date.now()
    const existing = this.db.prepare('SELECT id FROM agents WHERE id = ?').get(id)
    this.db
      .prepare(
        `
      INSERT INTO agents (id, session_id, parent_agent_id, name, description, agent_type, transcript_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = COALESCE(excluded.name, agents.name),
        description = COALESCE(excluded.description, agents.description),
        agent_type = COALESCE(excluded.agent_type, agents.agent_type),
        transcript_path = COALESCE(excluded.transcript_path, agents.transcript_path),
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

  async insertEvent(params: InsertEventParams): Promise<number> {
    const now = Date.now()
    const result = this.db
      .prepare(
        `
      INSERT INTO events (agent_id, session_id, type, subtype, tool_name, timestamp, created_at, payload, tool_use_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        params.agentId,
        params.sessionId,
        params.type,
        params.subtype,
        params.toolName,
        params.timestamp,
        now,
        JSON.stringify(params.payload),
        params.toolUseId || null,
      )

    // Update cached counters on session
    this.db
      .prepare(
        `UPDATE sessions SET
          event_count = event_count + 1,
          last_activity = MAX(COALESCE(last_activity, 0), ?)
        WHERE id = ?`,
      )
      .run(params.timestamp, params.sessionId)

    return Number(result.lastInsertRowid)
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
      SELECT s.*
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
        p.name as project_name
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

  async deleteSession(sessionId: string): Promise<void> {
    this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM agents WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  }

  async deleteProject(projectId: number): Promise<void> {
    // Get all session IDs for this project
    const sessions = this.db
      .prepare('SELECT id FROM sessions WHERE project_id = ?')
      .all(projectId) as { id: string }[]
    for (const session of sessions) {
      this.db.prepare('DELETE FROM events WHERE session_id = ?').run(session.id)
      this.db.prepare('DELETE FROM agents WHERE session_id = ?').run(session.id)
    }
    this.db.prepare('DELETE FROM sessions WHERE project_id = ?').run(projectId)
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
  }

  async clearAllData(): Promise<void> {
    this.db.prepare('DELETE FROM events WHERE 1=1').run()
    this.db.prepare('DELETE FROM agents WHERE 1=1').run()
    this.db.prepare('DELETE FROM sessions WHERE 1=1').run()
    this.db.prepare('DELETE FROM projects WHERE 1=1').run()
  }

  async clearSessionEvents(sessionId: string): Promise<void> {
    this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM agents WHERE session_id = ?').run(sessionId)
    this.db
      .prepare(
        'UPDATE sessions SET event_count = 0, agent_count = 0, last_activity = NULL WHERE id = ?',
      )
      .run(sessionId)
  }

  async getRecentSessions(limit: number = 20): Promise<any[]> {
    return this.db
      .prepare(
        `
      SELECT s.*,
        p.slug as project_slug,
        p.name as project_name
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      ORDER BY COALESCE(s.last_activity, s.started_at) DESC
      LIMIT ?
    `,
      )
      .all(limit)
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
