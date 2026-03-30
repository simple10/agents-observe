// app/server/src/types.ts

// === Database Row Types ===

export interface ProjectRow {
  id: string
  name: string
  created_at: number
}

export interface SessionRow {
  id: string
  project_id: string
  slug: string | null
  status: string
  started_at: number
  stopped_at: number | null
  metadata: string | null
}

export interface AgentRow {
  id: string
  session_id: string
  parent_agent_id: string | null
  slug: string | null
  name: string | null
  status: string
  started_at: number
  stopped_at: number | null
}

export interface EventRow {
  id: number
  agent_id: string
  session_id: string
  type: string
  subtype: string | null
  tool_name: string | null
  summary: string | null
  timestamp: number
  payload: string
}

// === API Response Types ===

export interface Project {
  id: number
  slug: string
  name: string
  transcriptPath?: string | null
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

// === WebSocket Message Types ===

export type WSMessage =
  | { type: 'event'; data: ParsedEvent }
  | { type: 'session_update'; data: Session }
  | { type: 'project_update'; data: { id: number; name: string } }

// Messages FROM clients
export type WSClientMessage =
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe' }
