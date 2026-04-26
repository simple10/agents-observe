// app/server/src/types.ts

// === Database Row Types ===

export interface ProjectRow {
  id: number
  slug: string
  name: string
  created_at: number
  updated_at: number
}

export interface SessionRow {
  id: string
  project_id: number | null
  slug: string | null
  started_at: number
  stopped_at: number | null
  transcript_path: string | null
  start_cwd: string | null
  metadata: string | null
  last_activity: number | null
  pending_notification_ts: number | null
  created_at: number
  updated_at: number
}

export interface AgentRow {
  id: string
  agent_class: string
  name: string | null
  description: string | null
  agent_type: string | null
  created_at: number
  updated_at: number
}

export interface EventRow {
  id: number
  agent_id: string
  session_id: string
  hook_name: string
  timestamp: number
  created_at: number
  cwd: string | null
  _meta: string | null
  payload: string
}

// === API Response Types ===

export interface Project {
  id: number
  slug: string
  name: string
  createdAt: number
  sessionCount?: number
}

export interface Session {
  id: string
  projectId: number | null
  slug: string | null
  status: string // derived from stopped_at on the server
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
  agentCount?: number
  eventCount?: number
}

export interface Agent {
  id: string
  name: string | null
  description: string | null
  agentType?: string | null
  agentClass?: string | null
}

export interface ParsedEvent {
  id: number
  agentId: string
  sessionId: string
  hookName: string
  timestamp: number
  createdAt: number
  cwd: string | null
  _meta: Record<string, unknown> | null
  payload: Record<string, unknown>
}

// === Event Envelope (CLI → server) ===

export interface EventEnvelopeMeta {
  agentClass?: string
  env?: Record<string, string>
  /**
   * When true, this event marks the session as having a pending
   * notification. The server sets `pending_notification_ts` to the event
   * timestamp and broadcasts `notification` if the transition is new.
   */
  isNotification?: boolean
  /**
   * When explicitly `false`, this event does NOT clear a pending
   * notification. Any other value (including undefined) lets the server
   * apply the default clearing behavior.
   */
  clearsNotification?: boolean

  // ---- Event descriptors (stamped by the CLI) ----
  /** Raw hook event name as emitted by the agent (agent-class-native). */
  hookName?: string
  /** Session id extracted from the payload by the agent lib. */
  sessionId?: string
  /** Subagent id if the event came from a subagent; null for main agent. */
  agentId?: string | null

  // ---- Legacy fields (Phase 2 compat — removed in Phase 3) ----
  /** @deprecated removed in Phase 3 — server no longer derives type. */
  type?: string
  /** @deprecated removed in Phase 3 — server no longer derives subtype. */
  subtype?: string | null
  /** @deprecated removed in Phase 3 — server no longer derives toolName. */
  toolName?: string | null
}

export interface EventEnvelope {
  hook_payload: Record<string, unknown>
  meta?: EventEnvelopeMeta
}

// === WebSocket Message Types ===

export type WSMessage =
  | { type: 'event'; data: ParsedEvent }
  | { type: 'session_update'; data: Session }
  | { type: 'project_update'; data: { id: number; name: string } }

// Messages FROM clients
export type WSClientMessage = { type: 'subscribe'; sessionId: string } | { type: 'unsubscribe' }
