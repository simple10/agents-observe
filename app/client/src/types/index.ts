export interface Project {
  id: string
  name: string
  createdAt: number
  sessionCount?: number
  activeAgentCount?: number
}

export interface Session {
  id: string
  projectId: string
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
  children?: Agent[]
  eventCount?: number
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

export type WSMessage =
  | { type: 'event'; data: ParsedEvent }
  | { type: 'agent_update'; data: { id: string; status: string; sessionId: string } }
  | { type: 'session_update'; data: Session }
