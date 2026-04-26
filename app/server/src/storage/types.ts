// app/server/src/storage/types.ts

export interface InsertEventParams {
  agentId: string
  sessionId: string
  /** Raw hook event name from the envelope. */
  hookName: string
  timestamp: number
  payload: Record<string, unknown>
  /** Per-event cwd (lifted from envelope). Optional. */
  cwd?: string | null
  /** Envelope creation hints persisted for traceability. Optional. */
  _meta?: Record<string, unknown> | null
}

export interface InsertEventResult {
  eventId: number
}

export interface EventFilters {
  agentIds?: string[]
  hookName?: string
  search?: string
  limit?: number
  offset?: number
}

export interface StoredEvent {
  id: number
  agent_id: string
  session_id: string
  hook_name: string
  timestamp: number
  created_at: number
  cwd: string | null
  _meta: string | null // JSON string in DB
  payload: string // JSON string in DB
}

export interface AgentPatch {
  name?: string | null
  description?: string | null
  agent_type?: string | null
}

export interface EventStore {
  createProject(slug: string, name: string): Promise<number>
  getProjectById(id: number): Promise<any | null>
  getProjectBySlug(slug: string): Promise<any | null>
  updateProjectName(projectId: number, name: string): Promise<void>
  isSlugAvailable(slug: string): Promise<boolean>
  /**
   * Find-or-create a project by slug. Uses INSERT ... ON CONFLICT(slug)
   * DO NOTHING followed by SELECT, so concurrent inserts converge on
   * the same row. Never auto-suffixes.
   */
  findOrCreateProjectBySlug(
    slug: string,
    name?: string,
  ): Promise<{ id: number; slug: string; created: boolean }>
  /**
   * Look up a session that already has a project, matching by either
   * `start_cwd` or `dirname(transcript_path)`. Used by project
   * resolution when `flags.resolveProject` fires.
   */
  findSiblingSessionWithProject(input: {
    startCwd: string | null
    transcriptBasedir: string | null
    excludeSessionId: string
  }): Promise<{ projectId: number } | null>
  deleteProject(
    projectId: number,
  ): Promise<{ sessionIds: string[]; sessions: number; agents: number; events: number }>
  upsertSession(
    id: string,
    projectId: number | null,
    slug: string | null,
    metadata: Record<string, unknown> | null,
    timestamp: number,
    transcriptPath?: string | null,
    startCwd?: string | null,
  ): Promise<void>
  upsertAgent(
    id: string,
    sessionId: string,
    parentAgentId: string | null,
    name: string | null,
    description: string | null,
    agentType?: string | null,
    agentClass?: string | null,
  ): Promise<void>
  /** Layer 3 patch path. Only `name`, `description`, `agent_type` honored. */
  patchAgent(id: string, patch: AgentPatch): Promise<any | null>
  updateAgentType(id: string, agentType: string): Promise<void>
  updateSessionStatus(id: string, status: string): Promise<void>
  patchSessionMetadata(sessionId: string, patch: Record<string, unknown>): Promise<void>
  updateSessionSlug(sessionId: string, slug: string): Promise<void>
  updateSessionProject(sessionId: string, projectId: number): Promise<void>
  updateAgentName(agentId: string, name: string): Promise<void>
  /** Set `pending_notification_ts = timestamp` and bump count + last. */
  startSessionNotification(sessionId: string, timestamp: number): Promise<void>
  /** Clear pending notification state (count -> 0, ts -> NULL). */
  clearSessionNotification(sessionId: string): Promise<void>
  /** Stamp `sessions.stopped_at = timestamp`. */
  stopSession(sessionId: string, timestamp: number): Promise<void>
  /** Update `sessions.last_activity` to MAX(current, timestamp). */
  touchSessionActivity(sessionId: string, timestamp: number): Promise<void>
  insertEvent(params: InsertEventParams): Promise<InsertEventResult>
  getProjects(): Promise<any[]>
  getSessionsForProject(projectId: number): Promise<any[]>
  getSessionById(sessionId: string): Promise<any | null>
  getAgentById(agentId: string): Promise<any | null>
  getSessionsWithPendingNotifications(sinceTs: number): Promise<any[]>
  getAgentsForSession(sessionId: string): Promise<any[]>
  getEventsForSession(sessionId: string, filters?: EventFilters): Promise<StoredEvent[]>
  getEventsForAgent(agentId: string): Promise<StoredEvent[]>
  getEventsSince(sessionId: string, sinceTimestamp: number): Promise<StoredEvent[]>
  deleteSession(sessionId: string): Promise<{ events: number; agents: number }>
  deleteSessions(
    sessionIds: string[],
  ): Promise<{ events: number; agents: number; sessions: number }>
  clearAllData(): Promise<{ projects: number; sessions: number; agents: number; events: number }>
  clearSessionEvents(sessionId: string): Promise<{ events: number; agents: number }>
  getDbStats(): Promise<{ sessionCount: number; eventCount: number }>
  vacuum(): Promise<void>
  getRecentSessions(limit?: number): Promise<any[]>
  healthCheck(): Promise<{ ok: boolean; error?: string }>
  /**
   * Scan all tables for rows with broken foreign keys and repair them.
   * - Sessions with invalid project_id → project_id set to NULL
   * - Agents with no referencing events → deleted
   * - Events with invalid session_id or agent_id → deleted
   *
   * Returns a summary of what was repaired.
   */
  repairOrphans(): Promise<OrphanRepairResult>
}

export interface OrphanRepairResult {
  sessionsReassigned: number
  agentsDeleted: number
  agentsReparented: number
  eventsDeleted: number
}
