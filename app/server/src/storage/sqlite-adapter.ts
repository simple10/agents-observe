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

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        slug TEXT,
        status TEXT DEFAULT 'active',
        started_at INTEGER NOT NULL,
        stopped_at INTEGER,
        metadata TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_agent_id TEXT,
        slug TEXT,
        name TEXT,
        status TEXT DEFAULT 'active',
        started_at INTEGER NOT NULL,
        stopped_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (parent_agent_id) REFERENCES agents(id)
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        subtype TEXT,
        tool_name TEXT,
        summary TEXT,
        timestamp INTEGER NOT NULL,
        payload TEXT NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)

    // Migration: add columns if missing (for existing DBs)
    const cols = this.db.pragma('table_info(events)') as any[]
    if (!cols.some((c: any) => c.name === 'tool_use_id')) {
      this.db.exec('ALTER TABLE events ADD COLUMN tool_use_id TEXT')
    }
    if (!cols.some((c: any) => c.name === 'status')) {
      this.db.exec("ALTER TABLE events ADD COLUMN status TEXT DEFAULT 'pending'")
    }

    // Create indexes
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, timestamp)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, timestamp)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, subtype)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_tool_use_id ON events(tool_use_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)')
  }

  async upsertProject(id: string, name: string): Promise<void> {
    this.db
      .prepare(
        `
      INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `,
      )
      .run(id, name, Date.now())
  }

  async upsertSession(
    id: string,
    projectId: string,
    slug: string | null,
    metadata: Record<string, unknown> | null,
    timestamp: number,
  ): Promise<void> {
    this.db
      .prepare(
        `
      INSERT INTO sessions (id, project_id, slug, status, started_at, metadata)
      VALUES (?, ?, ?, 'active', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        slug = COALESCE(excluded.slug, sessions.slug),
        metadata = COALESCE(excluded.metadata, sessions.metadata)
    `,
      )
      .run(id, projectId, slug, timestamp, metadata ? JSON.stringify(metadata) : null)
  }

  async upsertAgent(
    id: string,
    sessionId: string,
    parentAgentId: string | null,
    slug: string | null,
    name: string | null,
    timestamp: number,
  ): Promise<void> {
    this.db
      .prepare(
        `
      INSERT INTO agents (id, session_id, parent_agent_id, slug, name, status, started_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?)
      ON CONFLICT(id) DO UPDATE SET
        slug = COALESCE(excluded.slug, agents.slug),
        name = COALESCE(excluded.name, agents.name)
    `,
      )
      .run(id, sessionId, parentAgentId, slug, name, timestamp)
  }

  async updateAgentStatus(id: string, status: string): Promise<void> {
    this.db
      .prepare(
        `
      UPDATE agents SET status = ?, stopped_at = ? WHERE id = ?
    `,
      )
      .run(status, status === 'stopped' ? Date.now() : null, id)
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

  async updateSessionSlug(sessionId: string, slug: string): Promise<void> {
    this.db
      .prepare(
        `
      UPDATE sessions SET slug = ? WHERE id = ?
    `,
      )
      .run(slug, sessionId)
  }

  async updateAgentSlug(agentId: string, slug: string): Promise<void> {
    this.db
      .prepare(
        `
      UPDATE agents SET slug = ? WHERE id = ?
    `,
      )
      .run(slug, agentId)
  }

  async insertEvent(params: InsertEventParams): Promise<number> {
    const result = this.db
      .prepare(
        `
      INSERT INTO events (agent_id, session_id, type, subtype, tool_name, summary, timestamp, payload, tool_use_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        params.agentId,
        params.sessionId,
        params.type,
        params.subtype,
        params.toolName,
        params.summary,
        params.timestamp,
        JSON.stringify(params.payload),
        params.toolUseId || null,
        params.status || 'pending',
      )

    return Number(result.lastInsertRowid)
  }

  async getProjects(): Promise<any[]> {
    return this.db
      .prepare(
        `
      SELECT p.*, COUNT(DISTINCT s.id) as session_count
      FROM projects p
      LEFT JOIN sessions s ON s.project_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `,
      )
      .all()
  }

  async getSessionsForProject(projectId: string): Promise<any[]> {
    return this.db
      .prepare(
        `
      SELECT s.*,
        COUNT(DISTINCT a.id) as agent_count,
        COUNT(DISTINCT e.id) as event_count
      FROM sessions s
      LEFT JOIN agents a ON a.session_id = s.id
      LEFT JOIN events e ON e.session_id = s.id
      WHERE s.project_id = ?
      GROUP BY s.id
      ORDER BY s.started_at DESC
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
        COUNT(DISTINCT a.id) as agent_count,
        COUNT(DISTINCT e.id) as event_count
      FROM sessions s
      LEFT JOIN agents a ON a.session_id = s.id
      LEFT JOIN events e ON e.session_id = s.id
      WHERE s.id = ?
      GROUP BY s.id
    `,
        )
        .get(sessionId) || null
    )
  }

  async getAgentsForSession(sessionId: string): Promise<any[]> {
    return this.db
      .prepare(
        `
      SELECT a.*,
        COUNT(DISTINCT e.id) as event_count
      FROM agents a
      LEFT JOIN events e ON e.agent_id = a.id
      WHERE a.session_id = ?
      GROUP BY a.id
      ORDER BY a.started_at ASC
    `,
      )
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
      sql += ' AND (summary LIKE ? OR payload LIKE ?)'
      const term = `%${filters.search}%`
      params.push(term, term)
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

    // Find the preceding UserPromptSubmit (or start of session)
    const prevPrompt = this.db
      .prepare(
        `
      SELECT timestamp FROM events
      WHERE session_id = ? AND subtype = 'UserPromptSubmit' AND timestamp <= ?
      ORDER BY timestamp DESC LIMIT 1
    `,
      )
      .get(sessionId, event.timestamp) as { timestamp: number } | undefined

    const startTs = prevPrompt ? prevPrompt.timestamp : 0

    // Find the next UserPromptSubmit after this event's prompt (to bound the thread)
    const nextPrompt = this.db
      .prepare(
        `
      SELECT timestamp FROM events
      WHERE session_id = ? AND subtype = 'UserPromptSubmit' AND timestamp > ?
      ORDER BY timestamp ASC LIMIT 1
    `,
      )
      .get(sessionId, startTs) as { timestamp: number } | undefined

    const endTs = nextPrompt ? nextPrompt.timestamp : Infinity

    // Get all events in the thread window
    if (endTs === Infinity) {
      return this.db
        .prepare(
          `
        SELECT * FROM events
        WHERE session_id = ? AND timestamp >= ?
        ORDER BY timestamp ASC
      `,
        )
        .all(sessionId, startTs) as StoredEvent[]
    }

    return this.db
      .prepare(
        `
      SELECT * FROM events
      WHERE session_id = ? AND timestamp >= ? AND timestamp < ?
      ORDER BY timestamp ASC
    `,
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

  async clearAllData(): Promise<void> {
    this.db.exec('DELETE FROM events')
    this.db.exec('DELETE FROM agents')
    this.db.exec('DELETE FROM sessions')
    this.db.exec('DELETE FROM projects')
  }
}
