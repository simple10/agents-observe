// app/server/src/storage/types.ts

export interface InsertEventParams {
  agentId: string
  sessionId: string
  /** Raw hook event name from the CLI-stamped envelope. Defaults to 'unknown'. */
  hookName: string
  timestamp: number
  payload: Record<string, unknown>
  /** Per-event cwd (lifted from envelope). Optional. */
  cwd?: string | null
  /** Envelope creation hints persisted for traceability. Optional. */
  _meta?: Record<string, unknown> | null
  /**
   * When true, set `pending_notification_ts = timestamp`. When explicitly
   * false (default for untagged events), clear it. When undefined AND the
   * caller sets `notificationClears === false`, leave state alone.
   */
  isNotification?: boolean
  /**
   * When explicitly `false`, this event is neutral — it leaves
   * `pending_notification_ts` untouched. Any other value applies the
   * default "clear" behavior unless `isNotification` is true.
   */
  clearsNotification?: boolean
}

export type NotificationTransition = 'set' | 'cleared' | 'none'

export interface InsertEventResult {
  eventId: number
  notificationTransition: NotificationTransition
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

export interface EventStore {
  createProject(slug: string, name: string): Promise<number>
  getProjectById(id: number): Promise<any | null>
  getProjectBySlug(slug: string): Promise<any | null>
  updateProjectName(projectId: number, name: string): Promise<void>
  isSlugAvailable(slug: string): Promise<boolean>
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
  updateAgentType(id: string, agentType: string): Promise<void>
  updateSessionStatus(id: string, status: string): Promise<void>
  patchSessionMetadata(sessionId: string, patch: Record<string, unknown>): Promise<void>
  updateSessionSlug(sessionId: string, slug: string): Promise<void>
  updateSessionProject(sessionId: string, projectId: number): Promise<void>
  updateAgentName(agentId: string, name: string): Promise<void>
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
