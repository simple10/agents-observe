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
  // Nullable to accommodate Unassigned sessions (project_id IS NULL on
  // the server). The /sessions/recent payload now carries explicit
  // null for these; the per-project /projects/:id/sessions response
  // still always populates them.
  projectSlug?: string | null
  projectName?: string | null
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

/** Agent metadata from the server — no derived state.
 *  Parent / hierarchy fields are NOT here; per spec the server is
 *  agent-class-agnostic and Layer 3 derives parent/child from events. */
export interface ServerAgent {
  id: string
  name: string | null
  description: string | null
  agentType?: string | null
  agentClass?: string | null
}

/** Agent with UI-derived state (computed from events).
 *  parentAgentId is derived client-side from spawn events (e.g.
 *  Claude Code's PostToolUse:Agent → tool_response.agentId), NOT
 *  read from the server. sessionId is the session-context this Agent
 *  was constructed for. */
export interface Agent extends ServerAgent {
  sessionId: string
  parentAgentId: string | null
  status: 'active' | 'stopped'
  eventCount: number
  firstEventAt: number | null
  lastEventAt: number | null
  cwd?: string | null
}

/**
 * Wire-shape event from the server. Identity + raw payload only — Layer
 * 3 derives display fields (toolName, status, etc.) per agent class.
 *
 * The default `/sessions/:id/events` response includes only the
 * REQUIRED fields below. Clients can opt into the optional fields via
 * `?fields=sessionId,cwd,createdAt,_meta`.
 */
export interface ParsedEvent {
  // Required — always returned
  id: number
  agentId: string
  hookName: string
  timestamp: number
  payload: Record<string, unknown>

  // Optional — opt-in via `fields=` or carried by WS broadcast
  sessionId?: string
  createdAt?: number
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
  // Aggregate counts derived server-side via subqueries on the events
  // and agents tables. Both routes (`/sessions/recent` and
  // `/projects/:id/sessions`) populate them so the projects-tab can
  // sum them per-project without an extra round trip.
  eventCount?: number
  agentCount?: number
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
  | {
      type: 'activity'
      data: { sessionId: string; projectId: number | null; eventId: number; ts: number }
    }

export type WSClientMessage = { type: 'subscribe'; sessionId: string } | { type: 'unsubscribe' }
