// app/server/src/storage/sqlite-adapter.ts

import Database from 'better-sqlite3'
import { dirname } from 'node:path'
import type {
  AgentPatch,
  EventStore,
  InsertEventParams,
  InsertEventResult,
  EventFilters,
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
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // Migration: rebuild projects table to drop unused columns (metadata,
    // cwd, transcript_path). Idempotent — guarded by PRAGMA check.
    const projectCols = this.db.prepare("PRAGMA table_info('projects')").all() as { name: string }[]
    const projectsHasMetadata = projectCols.some((c) => c.name === 'metadata')
    const projectsHasCwd = projectCols.some((c) => c.name === 'cwd')
    const projectsHasTranscriptPath = projectCols.some((c) => c.name === 'transcript_path')
    if (projectsHasMetadata || projectsHasCwd || projectsHasTranscriptPath) {
      this.db.exec(`
        PRAGMA foreign_keys=OFF;
        BEGIN IMMEDIATE;
        DROP TABLE IF EXISTS projects_new;
        CREATE TABLE projects_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO projects_new (id, slug, name, created_at, updated_at)
        SELECT id, slug, name, created_at, updated_at FROM projects;
        DROP TABLE projects;
        ALTER TABLE projects_new RENAME TO projects;
        COMMIT;
        PRAGMA foreign_keys=ON;
      `)
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id),
        slug TEXT,
        started_at INTEGER NOT NULL,
        stopped_at INTEGER,
        transcript_path TEXT,
        start_cwd TEXT,
        metadata TEXT,
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
    if (!sessionCols.some((c) => c.name === 'last_activity')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN last_activity INTEGER')
      this.db.exec(`
        UPDATE sessions SET
          last_activity = (SELECT MAX(timestamp) FROM events WHERE session_id = sessions.id)
      `)
    }
    // Notification tracking — `pending_notification_ts` holds the ts of
    // the event that put the session into "awaiting user" state. NULL
    // means no pending notification. Envelope flags
    // (flags.startsNotification / flags.clearsNotification) decide
    // transitions, applied by the route layer via
    // startSessionNotification / clearSessionNotification; the server
    // never inspects the raw payload for notification purposes.
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
      // events table as a one-time bootstrap. After migration, state is
      // driven entirely by envelope flags at event-insert time. We use
      // hook_name first (post-Phase-2 schema) and fall back to the legacy
      // `subtype` column for events tables that haven't been rebuilt yet.
      const evtCols = this.db.prepare("PRAGMA table_info('events')").all() as { name: string }[]
      const hookNameCol = evtCols.some((c) => c.name === 'hook_name')
      const subtypeCol = evtCols.some((c) => c.name === 'subtype')
      const matchExpr = hookNameCol
        ? subtypeCol
          ? "COALESCE(hook_name, subtype) = 'Notification'"
          : "hook_name = 'Notification'"
        : subtypeCol
          ? "subtype = 'Notification'"
          : '0'
      this.db.exec(`
        UPDATE sessions SET
          pending_notification_ts = (
            SELECT MAX(timestamp) FROM events
            WHERE session_id = sessions.id AND ${matchExpr}
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

    // Migration: rebuild sessions table to drop dead columns
    // (status, event_count, agent_count) and add start_cwd. Idempotent —
    // guarded by PRAGMA check.
    const sessionsHasStatus = sessionCols.some((c) => c.name === 'status')
    const sessionsHasEventCount = sessionCols.some((c) => c.name === 'event_count')
    const sessionsHasAgentCount = sessionCols.some((c) => c.name === 'agent_count')
    const sessionsHasStartCwd = sessionCols.some((c) => c.name === 'start_cwd')
    if (
      sessionsHasStatus ||
      sessionsHasEventCount ||
      sessionsHasAgentCount ||
      !sessionsHasStartCwd
    ) {
      this.db.exec(`
        PRAGMA foreign_keys=OFF;
        BEGIN IMMEDIATE;
        DROP TABLE IF EXISTS sessions_new;
        CREATE TABLE sessions_new (
          id TEXT PRIMARY KEY,
          project_id INTEGER REFERENCES projects(id),
          slug TEXT,
          started_at INTEGER NOT NULL,
          stopped_at INTEGER,
          transcript_path TEXT,
          start_cwd TEXT,
          metadata TEXT,
          last_activity INTEGER,
          pending_notification_ts INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO sessions_new (id, project_id, slug, started_at, stopped_at, transcript_path, start_cwd, metadata, last_activity, pending_notification_ts, created_at, updated_at)
        SELECT id, project_id, slug, started_at, stopped_at, transcript_path, NULL, metadata, last_activity, pending_notification_ts, created_at, updated_at FROM sessions;
        DROP TABLE sessions;
        ALTER TABLE sessions_new RENAME TO sessions;
        COMMIT;
        PRAGMA foreign_keys=ON;
      `)
    }

    // Migration (Phase 3): add pending_notification_count + last_notification_ts
    // for the spec'd notification semantics. Existing rows default to 0/NULL.
    const sessionColsAfter = this.db.prepare("PRAGMA table_info('sessions')").all() as {
      name: string
    }[]
    if (!sessionColsAfter.some((c) => c.name === 'pending_notification_count')) {
      this.db.exec(
        'ALTER TABLE sessions ADD COLUMN pending_notification_count INTEGER NOT NULL DEFAULT 0',
      )
    }
    if (!sessionColsAfter.some((c) => c.name === 'last_notification_ts')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN last_notification_ts INTEGER')
      // Bootstrap: pre-Phase-3 rows had only pending_notification_ts; mirror it
      // into last_notification_ts so sort-by-recent-attention works.
      this.db.exec(
        'UPDATE sessions SET last_notification_ts = pending_notification_ts WHERE pending_notification_ts IS NOT NULL',
      )
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        agent_class TEXT NOT NULL DEFAULT 'unknown',
        name TEXT,
        description TEXT,
        agent_type TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // Migrations for agents
    const agentCols = this.db.prepare("PRAGMA table_info('agents')").all() as { name: string }[]
    if (!agentCols.some((c) => c.name === 'agent_class')) {
      this.db.exec('ALTER TABLE agents ADD COLUMN agent_class TEXT')
    }

    // Migration: rebuild to drop unused columns (metadata, transcript_path)
    // and the now-removed session linkage columns (session_id, parent_agent_id).
    // Idempotent — guarded by PRAGMA check.
    const agentsHasMetadata = agentCols.some((c) => c.name === 'metadata')
    const agentsHasTranscriptPath = agentCols.some((c) => c.name === 'transcript_path')
    const agentsHasSessionId = agentCols.some((c) => c.name === 'session_id')
    const agentsHasParentAgentId = agentCols.some((c) => c.name === 'parent_agent_id')
    if (
      agentsHasMetadata ||
      agentsHasTranscriptPath ||
      agentsHasSessionId ||
      agentsHasParentAgentId
    ) {
      this.db.exec(`
        PRAGMA foreign_keys=OFF;
        BEGIN IMMEDIATE;
        DROP TABLE IF EXISTS agents_new;
        CREATE TABLE agents_new (
          id TEXT PRIMARY KEY,
          agent_class TEXT NOT NULL DEFAULT 'unknown',
          name TEXT,
          description TEXT,
          agent_type TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO agents_new (id, agent_class, name, description, agent_type, created_at, updated_at)
        SELECT id, COALESCE(agent_class, 'unknown'), name, description, agent_type, created_at, updated_at FROM agents;
        DROP TABLE agents;
        ALTER TABLE agents_new RENAME TO agents;
        COMMIT;
        PRAGMA foreign_keys=ON;
      `)
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        hook_name TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        cwd TEXT,
        _meta TEXT,
        payload TEXT NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
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

    // Migration: drop tool_use_id column when present (legacy schema).
    if (eventCols.some((c) => c.name === 'tool_use_id')) {
      this.db.exec('DROP INDEX IF EXISTS idx_events_tool_use_id')
      try {
        this.db.exec('ALTER TABLE events DROP COLUMN tool_use_id')
      } catch {
        // Older SQLite fallback path — handled by the table-rebuild migration below.
      }
    }

    // Migration: rebuild events table to drop type/subtype/tool_name and
    // add cwd + _meta. Idempotent — guarded by PRAGMA check. Existing
    // rows get NULL cwd/_meta; hook_name is backfilled with COALESCE so
    // legacy rows that pre-date the column still have a usable identity.
    const eventsHasType = eventCols.some((c) => c.name === 'type')
    const eventsHasSubtype = eventCols.some((c) => c.name === 'subtype')
    const eventsHasToolName = eventCols.some((c) => c.name === 'tool_name')
    const eventsHasCwd = eventCols.some((c) => c.name === 'cwd')
    const eventsHasMeta = eventCols.some((c) => c.name === '_meta')
    if (eventsHasType || eventsHasSubtype || eventsHasToolName || !eventsHasCwd || !eventsHasMeta) {
      // Compose the source-row hook_name expression depending on which
      // legacy columns exist on the current table.
      const subSelect =
        eventsHasSubtype && eventsHasType
          ? "COALESCE(hook_name, subtype, type, 'unknown')"
          : eventsHasSubtype
            ? "COALESCE(hook_name, subtype, 'unknown')"
            : eventsHasType
              ? "COALESCE(hook_name, type, 'unknown')"
              : "COALESCE(hook_name, 'unknown')"
      this.db.exec(`
        PRAGMA foreign_keys=OFF;
        BEGIN IMMEDIATE;
        DROP TABLE IF EXISTS events_new;
        CREATE TABLE events_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          hook_name TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          cwd TEXT,
          _meta TEXT,
          payload TEXT NOT NULL,
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        INSERT INTO events_new (id, agent_id, session_id, hook_name, timestamp, created_at, cwd, _meta, payload)
        SELECT id, agent_id, session_id, ${subSelect}, timestamp, created_at, NULL, NULL, payload FROM events;
        DROP TABLE events;
        ALTER TABLE events_new RENAME TO events;
        COMMIT;
        PRAGMA foreign_keys=ON;
      `)
    }

    // Create indexes
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug)')
    this.db.exec('DROP INDEX IF EXISTS idx_projects_transcript_path')
    this.db.exec('DROP INDEX IF EXISTS idx_projects_cwd')
    this.db.exec('DROP INDEX IF EXISTS idx_events_type')
    this.db.exec('DROP INDEX IF EXISTS idx_events_session')
    this.db.exec('DROP INDEX IF EXISTS idx_events_agent')
    this.db.exec('DROP INDEX IF EXISTS idx_events_session_agent')
    this.db.exec('DROP INDEX IF EXISTS idx_events_hook_name')
    this.db.exec('DROP INDEX IF EXISTS idx_agents_session')
    this.db.exec('DROP INDEX IF EXISTS idx_agents_parent')
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(session_id, timestamp)',
    )
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_agent_ts ON events(agent_id, timestamp)')
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_events_session_hook ON events(session_id, hook_name)',
    )
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_start_cwd ON sessions(start_cwd)')
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_sessions_transcript_path ON sessions(transcript_path)',
    )
  }

  async createProject(slug: string, name: string): Promise<number> {
    const now = Date.now()
    const result = this.db
      .prepare('INSERT INTO projects (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(slug, name, now, now)
    return result.lastInsertRowid as number
  }

  async getProjectById(id: number): Promise<any | null> {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) || null
  }

  async getProjectBySlug(slug: string): Promise<any | null> {
    return this.db.prepare(`SELECT * FROM projects WHERE slug = ?`).get(slug) || null
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

  async findOrCreateProjectBySlug(
    slug: string,
    name?: string,
  ): Promise<{ id: number; slug: string; created: boolean }> {
    const now = Date.now()
    const insertResult = this.db
      .prepare(
        `INSERT INTO projects (slug, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(slug) DO NOTHING`,
      )
      .run(slug, name ?? slug, now, now)
    const created = insertResult.changes === 1
    let row = this.db.prepare('SELECT id, slug FROM projects WHERE slug = ?').get(slug) as
      | { id: number; slug: string }
      | undefined
    if (!row) {
      // Defensive retry — SQLite serializes writes so this is unreachable
      // in practice. Retry once before giving up.
      row = this.db.prepare('SELECT id, slug FROM projects WHERE slug = ?').get(slug) as
        | { id: number; slug: string }
        | undefined
      if (!row) throw new Error(`findOrCreateProjectBySlug: slug ${slug} disappeared`)
    }
    return { id: row.id, slug: row.slug, created }
  }

  async findSiblingSessionWithProject(input: {
    startCwd: string | null
    transcriptBasedir: string | null
    excludeSessionId: string
  }): Promise<{ projectId: number } | null> {
    const { startCwd, transcriptBasedir, excludeSessionId } = input
    if (!startCwd && !transcriptBasedir) return null
    // Use Node's dirname applied at write time would be ideal, but we
    // store the full transcript_path. Compare basedir via SQL by
    // matching the prefix exactly: `dirname(transcript_path)` is the
    // path up to (but not including) the trailing '/<file>'.
    //
    // SQLite has no built-in dirname, so we fold it in at the candidate
    // side: a session row matches if `start_cwd = ?` (when supplied) OR
    // its transcript_path starts with `<basedir>/`. We pass the basedir
    // with a trailing slash to avoid matching prefixes of unrelated dirs
    // like `/foo/bar` against `/foo/barbaz/...`.
    const basedirPrefix = transcriptBasedir ? `${transcriptBasedir}/` : null
    const row = this.db
      .prepare(
        `SELECT project_id FROM sessions
         WHERE id != ?
           AND project_id IS NOT NULL
           AND (
             (? IS NOT NULL AND start_cwd = ?)
             OR (? IS NOT NULL AND transcript_path LIKE ? || '%')
           )
         ORDER BY COALESCE(last_activity, started_at) DESC
         LIMIT 1`,
      )
      .get(excludeSessionId, startCwd, startCwd, basedirPrefix, basedirPrefix) as
      | { project_id: number }
      | undefined
    return row ? { projectId: row.project_id } : null
  }

  // dirname helper exposed for callers that want a consistent answer.
  // (Not part of EventStore — inline helper.)
  static dirname(p: string): string {
    return dirname(p)
  }

  async upsertSession(
    id: string,
    projectId: number | null,
    slug: string | null,
    metadata: Record<string, unknown> | null,
    timestamp: number,
    transcriptPath?: string | null,
    startCwd?: string | null,
  ): Promise<void> {
    const now = Date.now()
    this.db
      .prepare(
        `
      INSERT INTO sessions (id, project_id, slug, started_at, transcript_path, start_cwd, metadata, last_activity, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        slug = COALESCE(excluded.slug, sessions.slug),
        transcript_path = COALESCE(excluded.transcript_path, sessions.transcript_path),
        start_cwd = COALESCE(sessions.start_cwd, excluded.start_cwd),
        metadata = CASE
          WHEN excluded.metadata IS NULL THEN sessions.metadata
          WHEN sessions.metadata IS NULL THEN excluded.metadata
          ELSE json_patch(sessions.metadata, excluded.metadata)
        END,
        last_activity = MAX(COALESCE(sessions.last_activity, 0), excluded.last_activity),
        updated_at = ?
    `,
      )
      .run(
        id,
        projectId,
        slug,
        timestamp,
        transcriptPath || null,
        startCwd || null,
        metadata ? JSON.stringify(metadata) : null,
        timestamp,
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
    agentClass?: string | null,
  ): Promise<void> {
    // sessionId and parentAgentId are accepted for backward-compat with
    // pre-Phase-3 callers but are no longer persisted on the agents row.
    // The agents table is now class+identity only; session/parent linkage
    // is derived from events at query time.
    void sessionId
    void parentAgentId
    const now = Date.now()
    this.db
      .prepare(
        `
      INSERT INTO agents (id, name, description, agent_type, agent_class, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = COALESCE(excluded.name, agents.name),
        description = COALESCE(excluded.description, agents.description),
        agent_type = COALESCE(excluded.agent_type, agents.agent_type),
        agent_class = CASE
          WHEN excluded.agent_class = 'unknown' AND agents.agent_class != 'unknown' THEN agents.agent_class
          ELSE excluded.agent_class
        END,
        updated_at = ?
    `,
      )
      .run(id, name, description, agentType ?? null, agentClass ?? 'unknown', now, now, now)
  }

  async updateAgentType(id: string, agentType: string): Promise<void> {
    this.db
      .prepare('UPDATE agents SET agent_type = ?, updated_at = ? WHERE id = ?')
      .run(agentType, Date.now(), id)
  }

  async patchAgent(id: string, patch: AgentPatch): Promise<any | null> {
    const fields: string[] = []
    const values: unknown[] = []
    if ('name' in patch) {
      fields.push('name = ?')
      values.push(patch.name ?? null)
    }
    if ('description' in patch) {
      fields.push('description = ?')
      values.push(patch.description ?? null)
    }
    if ('agent_type' in patch) {
      fields.push('agent_type = ?')
      values.push(patch.agent_type ?? null)
    }
    if (fields.length === 0) {
      // No-op patch — just verify the row exists and return it.
      return this.getAgentById(id)
    }
    fields.push('updated_at = ?')
    values.push(Date.now())
    const result = this.db
      .prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values, id)
    if (result.changes === 0) return null
    return this.getAgentById(id)
  }

  async startSessionNotification(sessionId: string, timestamp: number): Promise<void> {
    this.db
      .prepare(
        `UPDATE sessions SET
           pending_notification_ts = ?,
           last_notification_ts = ?,
           pending_notification_count = pending_notification_count + 1,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(timestamp, timestamp, Date.now(), sessionId)
  }

  async clearSessionNotification(sessionId: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE sessions SET
           pending_notification_ts = NULL,
           pending_notification_count = 0,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(Date.now(), sessionId)
  }

  async stopSession(sessionId: string, timestamp: number): Promise<void> {
    this.db
      .prepare('UPDATE sessions SET stopped_at = ?, updated_at = ? WHERE id = ?')
      .run(timestamp, Date.now(), sessionId)
  }

  async touchSessionActivity(sessionId: string, timestamp: number): Promise<void> {
    this.db
      .prepare(
        `UPDATE sessions SET
           last_activity = MAX(COALESCE(last_activity, 0), ?),
           updated_at = ?
         WHERE id = ?`,
      )
      .run(timestamp, Date.now(), sessionId)
  }

  async updateSessionStatus(id: string, status: string): Promise<void> {
    // The sessions table no longer stores `status` — it's derived from
    // `stopped_at`. This method now only updates `stopped_at` based on
    // the requested status, preserving the pre-refactor behavior for
    // route-layer callers that still pass 'stopped' / 'active'.
    this.db
      .prepare('UPDATE sessions SET stopped_at = ? WHERE id = ?')
      .run(status === 'stopped' ? Date.now() : null, id)
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
      INSERT INTO events (agent_id, session_id, hook_name, timestamp, created_at, cwd, _meta, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        params.agentId,
        params.sessionId,
        params.hookName ?? 'unknown',
        params.timestamp,
        now,
        params.cwd ?? null,
        params._meta != null ? JSON.stringify(params._meta) : null,
        JSON.stringify(params.payload),
      )

    // Bump session activity so the dashboard knows the session is live.
    // Notification state transitions are owned by the route layer
    // (startSessionNotification / clearSessionNotification, applied per
    // envelope flag in spec order); insertEvent does not touch
    // pending_notification_ts.
    this.db
      .prepare(
        `UPDATE sessions SET
          last_activity = MAX(COALESCE(last_activity, 0), ?)
        WHERE id = ?`,
      )
      .run(params.timestamp, params.sessionId)

    return { eventId: Number(result.lastInsertRowid) }
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
      SELECT p.id, p.slug, p.name, p.created_at,
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
        (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS event_count,
        (SELECT COUNT(DISTINCT e.agent_id) FROM events e WHERE e.session_id = s.id) AS agent_count,
        (
          SELECT GROUP_CONCAT(DISTINCT a.agent_class)
          FROM agents a
          JOIN events e ON e.agent_id = a.id
          WHERE e.session_id = s.id AND a.agent_class IS NOT NULL
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
        (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS event_count,
        (SELECT COUNT(DISTINCT e.agent_id) FROM events e WHERE e.session_id = s.id) AS agent_count,
        (
          SELECT GROUP_CONCAT(DISTINCT a.agent_class)
          FROM agents a
          JOIN events e ON e.agent_id = a.id
          WHERE e.session_id = s.id AND a.agent_class IS NOT NULL
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
    // Agents are no longer linked directly to sessions — derive the set
    // from events for this session.
    return this.db
      .prepare(
        `SELECT DISTINCT a.*
         FROM agents a
         JOIN events e ON e.agent_id = a.id
         WHERE e.session_id = ?
         ORDER BY a.created_at ASC`,
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

  async getEventsSince(sessionId: string, sinceTimestamp: number): Promise<StoredEvent[]> {
    return this.db
      .prepare(
        `
      SELECT * FROM events WHERE session_id = ? AND timestamp > ? ORDER BY timestamp ASC
    `,
      )
      .all(sessionId, sinceTimestamp) as StoredEvent[]
  }

  /**
   * Delete agents that have no events left. Agents are no longer linked
   * to sessions in the schema, so per-session deletion routes through
   * the events table.
   */
  private deleteAgentsForRemovedEvents(agentIds: string[]): number {
    if (agentIds.length === 0) return 0
    const checkOther = this.db.prepare('SELECT 1 FROM events WHERE agent_id = ? LIMIT 1')
    const deleteAgent = this.db.prepare('DELETE FROM agents WHERE id = ?')
    let removed = 0
    for (const aid of agentIds) {
      if (!checkOther.get(aid)) {
        removed += deleteAgent.run(aid).changes
      }
    }
    return removed
  }

  async deleteSession(sessionId: string): Promise<{ events: number; agents: number }> {
    const agentIds = (
      this.db
        .prepare('SELECT DISTINCT agent_id FROM events WHERE session_id = ?')
        .all(sessionId) as { agent_id: string }[]
    ).map((r) => r.agent_id)
    const events = this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId).changes
    const agents = this.deleteAgentsForRemovedEvents(agentIds)
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
      const agentIds = (
        this.db
          .prepare('SELECT DISTINCT agent_id FROM events WHERE session_id = ?')
          .all(sessionId) as { agent_id: string }[]
      ).map((r) => r.agent_id)
      events += this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId).changes
      agents += this.deleteAgentsForRemovedEvents(agentIds)
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
      const selectAgents = this.db.prepare(
        'SELECT DISTINCT agent_id FROM events WHERE session_id = ?',
      )
      const delEvents = this.db.prepare('DELETE FROM events WHERE session_id = ?')
      const delSession = this.db.prepare('DELETE FROM sessions WHERE id = ?')
      for (const id of ids) {
        const agentIds = (selectAgents.all(id) as { agent_id: string }[]).map((r) => r.agent_id)
        events += delEvents.run(id).changes
        agents += this.deleteAgentsForRemovedEvents(agentIds)
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
    // Delete events for this session and any agents that have no remaining
    // events. Agents are no longer linked to sessions directly (Phase 2),
    // so we identify them via the events join.
    const agentIdsRows = this.db
      .prepare('SELECT DISTINCT agent_id FROM events WHERE session_id = ?')
      .all(sessionId) as { agent_id: string }[]
    const events = this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId).changes
    let agents = 0
    if (agentIdsRows.length > 0) {
      const checkOther = this.db.prepare('SELECT 1 FROM events WHERE agent_id = ? LIMIT 1')
      const deleteAgent = this.db.prepare('DELETE FROM agents WHERE id = ?')
      for (const row of agentIdsRows) {
        const stillUsed = checkOther.get(row.agent_id)
        if (!stillUsed) {
          agents += deleteAgent.run(row.agent_id).changes
        }
      }
    }
    this.db.prepare('UPDATE sessions SET last_activity = NULL WHERE id = ?').run(sessionId)
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
        (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS event_count,
        (SELECT COUNT(DISTINCT e.agent_id) FROM events e WHERE e.session_id = s.id) AS agent_count,
        (
          SELECT GROUP_CONCAT(DISTINCT a.agent_class)
          FROM agents a
          JOIN events e ON e.agent_id = a.id
          WHERE e.session_id = s.id AND a.agent_class IS NOT NULL
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

    // 1. Sessions whose project FK points to a missing project: clear the
    //    project_id (NULL = "Unassigned" client-side). Sessions with NULL
    //    project_id are valid post-refactor and need no repair.
    const orphanedSessions = this.db
      .prepare(
        `SELECT s.id FROM sessions s
         WHERE s.project_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = s.project_id)`,
      )
      .all() as { id: string }[]

    if (orphanedSessions.length > 0) {
      const update = this.db.prepare(
        'UPDATE sessions SET project_id = NULL, updated_at = ? WHERE id = ?',
      )
      const now = Date.now()
      for (const s of orphanedSessions) {
        update.run(now, s.id)
        result.sessionsReassigned++
      }
    }

    // 2. Events with invalid session_id → delete. Done before agent
    //    cleanup so that any agents whose only events referenced the
    //    deleted session become orphaned and are caught in step 3.
    const orphanedSessionEvents = this.db
      .prepare(
        `DELETE FROM events
         WHERE session_id NOT IN (SELECT id FROM sessions)`,
      )
      .run()
    result.eventsDeleted += orphanedSessionEvents.changes

    // 3. Agents are no longer linked to sessions in the schema (Phase 2).
    //    Orphaned agents are detected as: rows in `agents` with no
    //    referencing event rows. Delete them.
    const orphanedAgents = this.db
      .prepare(
        `SELECT a.id FROM agents a
         WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.agent_id = a.id)`,
      )
      .all() as { id: string }[]
    if (orphanedAgents.length > 0) {
      const deleteAgent = this.db.prepare('DELETE FROM agents WHERE id = ?')
      for (const a of orphanedAgents) {
        deleteAgent.run(a.id)
        result.agentsDeleted++
      }
    }

    // 4. parent_agent_id is gone from the schema; nothing to reparent.
    result.agentsReparented = 0

    // 5. Events with invalid agent_id → delete.
    const orphanedAgentEvents = this.db
      .prepare(
        `DELETE FROM events
         WHERE agent_id NOT IN (SELECT id FROM agents)`,
      )
      .run()
    result.eventsDeleted += orphanedAgentEvents.changes

    // 6. Recompute last_activity on sessions if anything was repaired.
    //    Counts (event_count / agent_count) are derived at query time now,
    //    so there is no cached state to fix up.
    if (result.sessionsReassigned > 0 || result.agentsDeleted > 0 || result.eventsDeleted > 0) {
      this.db.exec(`
        UPDATE sessions SET
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
