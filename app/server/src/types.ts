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
  // Required
  id: number
  agentId: string
  hookName: string
  timestamp: number
  payload: Record<string, unknown>

  // Optional — only present on WS broadcasts that carry them or `fields=`
  // GET /events responses that opt in.
  sessionId?: string
  cwd?: string | null
  _meta?: Record<string, unknown> | null
}

// === Event Envelope (Layer 1 → Layer 2 contract) ===
//
// See docs/specs/2026-04-25-three-layer-contract-design.md for the
// authoritative definition. The server only ever inspects:
//   - Top-level identity fields (required for routing).
//   - Creation hints under `_meta` (consumed only when creating a row).
//   - Behavior flags under `flags` (drive state transitions; not persisted).
// It never branches on `payload` shape or `hookName` value.

export interface EventEnvelopeFlags {
  /** Mark the session as having a pending notification. */
  startsNotification?: boolean
  /** Clear any pending notification on the session. */
  clearsNotification?: boolean
  /** Stamp `sessions.stopped_at` with this event's timestamp. */
  stopsSession?: boolean
  /** Run project resolution if the session has no project_id yet. */
  resolveProject?: boolean
}

export interface EventEnvelopeCreationHints {
  session?: {
    slug?: string | null
    transcriptPath?: string | null
    /** The cwd at session start; immutable after first write. */
    startCwd?: string | null
    metadata?: Record<string, unknown> | null
  }
  project?: {
    /** Exact project id; obeyed if present. */
    id?: number
    /** Find-or-create by slug; obeyed if present. */
    slug?: string
  }
  agent?: {
    name?: string | null
    description?: string | null
    type?: string | null
  }
}

export interface EventEnvelope {
  agentClass: string
  sessionId: string
  agentId: string
  hookName: string
  cwd?: string | null
  timestamp?: number
  payload: Record<string, unknown>
  _meta?: EventEnvelopeCreationHints
  flags?: EventEnvelopeFlags
}

// === WebSocket Message Types ===

export type WSMessage =
  | { type: 'event'; data: ParsedEvent }
  | { type: 'session_update'; data: Session }
  | { type: 'project_update'; data: { id: number; name: string } }

// Messages FROM clients
export type WSClientMessage = { type: 'subscribe'; sessionId: string } | { type: 'unsubscribe' }
