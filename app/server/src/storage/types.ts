// app/server/src/storage/types.ts

export interface InsertEventParams {
  agentId: string
  sessionId: string
  type: string
  subtype: string | null
  toolName: string | null
  summary: string | null
  timestamp: number
  payload: Record<string, unknown>
  toolUseId?: string | null
  status?: string
}

export interface EventFilters {
  agentIds?: string[]
  type?: string
  subtype?: string
  search?: string
  limit?: number
  offset?: number
}

export interface StoredEvent {
  id: number
  agent_id: string
  session_id: string
  type: string
  subtype: string | null
  tool_name: string | null
  tool_use_id: string | null
  status: string
  summary: string | null
  timestamp: number
  payload: string // JSON string in DB
}

export interface EventStore {
  upsertProject(id: string, name: string): Promise<void>
  upsertSession(
    id: string,
    projectId: string,
    slug: string | null,
    metadata: Record<string, unknown> | null,
    timestamp: number,
  ): Promise<void>
  upsertAgent(
    id: string,
    sessionId: string,
    parentAgentId: string | null,
    slug: string | null,
    name: string | null,
    timestamp: number,
  ): Promise<void>
  updateAgentStatus(id: string, status: string): Promise<void>
  updateSessionStatus(id: string, status: string): Promise<void>
  updateSessionSlug(sessionId: string, slug: string): Promise<void>
  updateAgentSlug(agentId: string, slug: string): Promise<void>
  insertEvent(params: InsertEventParams): Promise<number>
  getProjects(): Promise<any[]>
  getSessionsForProject(projectId: string): Promise<any[]>
  getSessionById(sessionId: string): Promise<any | null>
  getAgentsForSession(sessionId: string): Promise<any[]>
  getEventsForSession(sessionId: string, filters?: EventFilters): Promise<StoredEvent[]>
  getEventsForAgent(agentId: string): Promise<StoredEvent[]>
  getThreadForEvent(eventId: number): Promise<StoredEvent[]>
  getEventsSince(sessionId: string, sinceTimestamp: number): Promise<StoredEvent[]>
  clearAllData(): Promise<void>
}
