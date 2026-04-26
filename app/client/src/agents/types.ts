import type { ComponentType } from 'react'
import type { ParsedEvent, Agent } from '@/types'

// ---------------------------------------------------------------------------
// Raw event — what the server returns (unchanged)
// Re-exported as RawEvent so agent code can reference the server shape.
// ---------------------------------------------------------------------------
export type RawEvent = ParsedEvent

// ---------------------------------------------------------------------------
// Enriched event — what the framework stores after processEvent
// ---------------------------------------------------------------------------
/** Display status derived per agent class from hook name + grouped events. */
export type EventStatus = 'running' | 'completed' | 'failed' | 'pending'

export interface EnrichedEvent {
  // Core fields (from raw server event)
  id: number
  agentId: string
  sessionId: string
  hookName: string
  timestamp: number
  createdAt: number

  // ---- Derived fields (populated by the runtime via per-class -----------
  // `deriveSubtype` / `deriveToolName` / `deriveStatus` hooks). These are
  // NOT wire fields; the server returns only `hookName + payload` and the
  // client decides what these mean per agent class. ---------------------
  type: string
  subtype: string | null
  toolName: string | null
  status: EventStatus

  // Agent-class enrichment
  groupId: string | null
  turnId: string | null
  displayEventStream: boolean
  displayTimeline: boolean
  label: string
  toolUseId: string | null
  icon: ComponentType | null
  iconColor: string | null
  dotColor: string | null
  iconColorHex: string | null
  filterTags: {
    static: string | null // category: 'Prompts', 'Tools', 'Agents', etc. (null if hidden)
    dynamic: string[] // specific filters: ['Bash'], ['Read'], etc.
  }
  searchText: string

  // Whether this event was processed with dedup enabled
  dedupMode: boolean

  // Original payload (same reference, no copy)
  payload: Record<string, unknown>

  // Agent-class can stash extra fields (tool_input, cwd, etc.)
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Processing context — mutable API available during processEvent
// ---------------------------------------------------------------------------
export interface ProcessingContext {
  // Settings
  dedupEnabled: boolean

  // Read
  getGroupedEvents(groupId: string): EnrichedEvent[]
  getAgentEvents(agentId: string): EnrichedEvent[]
  getCurrentTurn(agentId: string): string | null
  /**
   * Look up a pending groupId stashed under an arbitrary key. Used for
   * pairing two events that don't share a linking id on their payload
   * (e.g. PreCompact / PostCompact). The caller chooses the key
   * convention — typically `"<feature>:<agentId>"`.
   */
  getPendingGroup(key: string): string | null

  // Write
  updateEvent(eventId: number, changes: Partial<EnrichedEvent>): void
  setCurrentTurn(agentId: string, turnId: string): void
  clearCurrentTurn(agentId: string): void
  /** Stash a groupId under an arbitrary key for later lookup via getPendingGroup. */
  setPendingGroup(key: string, groupId: string): void
  /** Forget a pending groupId. Called after the matching second event arrives. */
  clearPendingGroup(key: string): void

  /** Stash subagent metadata (name/description) keyed by tool_use_id when
   *  a PreToolUse:Agent event arrives. Consumed by the matching
   *  PostToolUse:Agent so the spawned agent can be PATCHed with the
   *  Agent-tool input fields. Lives for the duration of the processing
   *  pass (per-EventStore instance). */
  stashPendingAgentMeta(
    toolUseId: string,
    meta: { name: string | null; description: string | null },
  ): void
  /** Read and clear stashed subagent metadata for a tool_use_id. */
  consumePendingAgentMeta(
    toolUseId: string,
  ): { name: string | null; description: string | null } | null
}

// ---------------------------------------------------------------------------
// Process event result
// ---------------------------------------------------------------------------
export interface ProcessEventResult {
  event: EnrichedEvent
}

// ---------------------------------------------------------------------------
// Data API — read-only API for render components
// ---------------------------------------------------------------------------
export interface FrameworkDataApi {
  getAgent(agentId: string): Agent | undefined
  getGroupedEvents(groupId: string): EnrichedEvent[]
  getTurnEvents(turnId: string): EnrichedEvent[]
  getAgentEvents(agentId: string): EnrichedEvent[]
}

// ---------------------------------------------------------------------------
// Props passed to agent-class render components
// ---------------------------------------------------------------------------
export interface EventProps {
  event: EnrichedEvent
  dataApi: FrameworkDataApi
}

// ---------------------------------------------------------------------------
// Agent class registration
// ---------------------------------------------------------------------------
export interface EventColor {
  iconColor: string
  dotColor: string
  customHex?: string
}

export interface AgentClassRegistration {
  agentClass: string
  displayName: string
  Icon: ComponentType<{ className?: string }>

  processEvent(raw: RawEvent, ctx: ProcessingContext): ProcessEventResult

  // ---- Per-class derivation hooks --------------------------------------
  // These map a wire event (hookName + payload) to display fields. The
  // runtime calls them when reshaping a `ParsedEvent` into the
  // `EnrichedEvent` consumed by render code. They are also the bridge
  // back to the server for endpoints that still accept legacy
  // `type` / `subtype` filters (see `api.getEvents`).

  /** Map a hookName + payload to a display "subtype" used by row
   *  summaries and filter pills. Returns null if the event has no
   *  canonical subtype. */
  deriveSubtype(event: RawEvent): string | null

  /** Map a hookName + payload to a tool name (for tool-related events).
   *  Returns null when the event doesn't reference a tool. */
  deriveToolName(event: RawEvent): string | null

  /** Compute display status from the event and any already-grouped
   *  sibling events (e.g. PreToolUse + matching PostToolUse). Returns
   *  null when status doesn't apply for this hook. */
  deriveStatus(event: RawEvent, groupedEvents: RawEvent[]): EventStatus | null

  // Render-time icon/color resolvers — called per-row so live icon
  // customization propagates without a full reprocess.
  getEventIcon(event: EnrichedEvent): ComponentType<{ className?: string }>
  getEventColor(event: EnrichedEvent): EventColor

  // Rendering components
  RowSummary: ComponentType<EventProps>
  EventDetail: ComponentType<EventProps>
  DotTooltip: ComponentType<{ event: EnrichedEvent }>
}
