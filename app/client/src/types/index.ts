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
  // Sessions whose project hasn't been resolved yet have `projectId:
  // null`. The sidebar groups those into a synthetic "Unassigned"
  // bucket; users can move them via the SessionEditModal.
  projectId: number | null
  projectSlug?: string
  projectName?: string
  transcriptPath?: string | null
  slug: string | null
  // Status is a derived field. Server returns either `'active'` or
  // `'ended'`/`'stopped'`, computed from `stoppedAt`. The column is gone
  // from the schema; this string lives on the API response only.
  status: string
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
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

/**
 * Wire-shape event from the server. Identity + raw payload only — Layer
 * 3 derives display fields (subtype, toolName, status, type, etc.) per
 * agent class. The previously-server-derived fields (`type`, `subtype`,
 * `toolName`, `status`) live on `EnrichedEvent` after runtime
 * processing — they are NOT wire fields.
 */
export interface ParsedEvent {
  id: number
  agentId: string
  sessionId: string
  hookName: string
  timestamp: number
  createdAt: number
  payload: Record<string, unknown>
  cwd?: string | null
  _meta?: Record<string, unknown> | null
}

export interface RecentSession {
  id: string
  // Sessions whose project hasn't been resolved yet carry `projectId:
  // null`. The /sessions/recent endpoint includes them so the sidebar
  // Unassigned bucket can pick them up alongside assigned sessions.
  projectId: number | null
  projectSlug: string | null
  projectName: string | null
  slug: string | null
  transcriptPath?: string | null
  // Derived server-side from stoppedAt (see Session.status comment).
  status: string
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
  lastActivity: number
  agentClasses: string[]
}

export interface NotificationPayload {
  sessionId: string
  projectId: number
  latestNotificationTs: number
}

/**
 * Trimmed wire shape for the per-session WS broadcast. Per spec
 * §"Wire Protocols", broadcasts carry only the minimum needed to
 * render a row — display fields are derived client-side.
 *
 * The server emits camelCase fields today (matching `ParsedEvent`).
 * We type defensively so the boundary parser tolerates either casing
 * in case the broadcast is ever trimmed to the spec-canonical
 * snake_case form (`{id, timestamp, agent_id, hook_name, payload}`).
 */
export interface WSEventBroadcast {
  id: number
  timestamp: number
  agentId?: string
  agent_id?: string
  hookName?: string
  hook_name?: string
  sessionId?: string
  session_id?: string
  createdAt?: number
  created_at?: number
  cwd?: string | null
  _meta?: Record<string, unknown> | null
  payload: Record<string, unknown>
}

export type WSMessage =
  | { type: 'event'; data: WSEventBroadcast }
  | { type: 'session_update'; data: Session }
  | { type: 'project_update'; data: { id: number; name: string } }
  | { type: 'notification'; data: { sessionId: string; projectId: number; ts: number } }
  | { type: 'notification_clear'; data: { sessionId: string; ts: number } }
  | { type: 'activity'; data: { sessionId: string; eventId: number; ts: number } }

export type WSClientMessage = { type: 'subscribe'; sessionId: string } | { type: 'unsubscribe' }
