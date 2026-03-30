export interface Project {
  id: number
  slug: string
  name: string
  createdAt: number
  sessionCount?: number
  activeAgentCount?: number
}

export interface Session {
  id: string
  projectId: number
  slug: string | null
  status: string
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
  agentCount?: number
  activeAgentCount?: number
  eventCount?: number
}

export interface Agent {
  id: string
  sessionId: string
  parentAgentId: string | null
  slug: string | null
  name: string | null
  status: string
  startedAt: number
  stoppedAt: number | null
  eventCount?: number
  agentType?: string | null
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
  payload: Record<string, unknown>
}

export interface RecentSession {
  id: string
  projectId: number
  projectSlug: string
  projectName: string
  slug: string | null
  status: string
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
  agentCount?: number
  activeAgentCount?: number
  eventCount?: number
  lastActivity: number
}

export type WSMessage =
  | { type: 'event'; data: ParsedEvent }
  | { type: 'agent_update'; data: Agent }
  | { type: 'session_update'; data: Session }
  | { type: 'project_update'; data: { id: number; name: string } }

export type WSClientMessage =
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe' }
