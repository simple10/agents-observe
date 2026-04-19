export interface Project {
  id: number
  slug: string
  name: string
  createdAt: number
  sessionCount?: number
}

export interface Label {
  id: string
  name: string
  createdAt: number
}

export interface Session {
  id: string
  projectId: number
  projectSlug?: string
  projectName?: string
  transcriptPath?: string | null
  slug: string | null
  status: string
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
  agentCount: number
  eventCount: number
  lastActivity: number | null
  // Distinct agent_class values across every agent in the session (root +
  // subagents). Empty array for legacy sessions predating the column.
  agentClasses: string[]
}

/** Agent metadata from the server — no derived state */
export interface ServerAgent {
  id: string
  sessionId: string
  parentAgentId: string | null
  name: string | null
  description: string | null
  agentType?: string | null
  agentClass?: string | null
}

/** Agent with UI-derived state (computed from events) */
export interface Agent extends ServerAgent {
  status: 'active' | 'stopped'
  eventCount: number
  firstEventAt: number | null
  lastEventAt: number | null
  cwd?: string | null
}

export interface ParsedEvent {
  id: number
  agentId: string
  sessionId: string
  type: string
  subtype: string | null
  toolName: string | null
  toolUseId: string | null
  status: string
  timestamp: number
  createdAt: number
  payload: Record<string, unknown>
}

export interface RecentSession {
  id: string
  projectId: number
  projectSlug: string
  projectName: string
  slug: string | null
  transcriptPath?: string | null
  status: string
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
  agentCount: number
  eventCount: number
  lastActivity: number
  agentClasses: string[]
}

export interface NotificationPayload {
  sessionId: string
  projectId: number
  latestNotificationTs: number
  count: number
}

export type WSMessage =
  | { type: 'event'; data: ParsedEvent }
  | { type: 'session_update'; data: Session }
  | { type: 'project_update'; data: { id: number; name: string } }
  | { type: 'notification'; data: { sessionId: string; projectId: number; ts: number } }
  | { type: 'notification_clear'; data: { sessionId: string; ts: number } }

export type WSClientMessage = { type: 'subscribe'; sessionId: string } | { type: 'unsubscribe' }
