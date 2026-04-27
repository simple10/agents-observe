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
  // Identity (from raw server event)
  id: number
  agentId: string
  hookName: string
  timestamp: number

  // Per-class enrichment (every agent class populates these)
  toolName: string | null
  status: EventStatus
  groupId: string | null
  turnId: string | null
  displayEventStream: boolean
  displayTimeline: boolean
  /** Short label shown on the row (e.g. "Tool", "Prompt"). */
  label: string
  /** Tooltip for the label / icon. Defaults to `hookName` when null. */
  labelTooltip: string | null
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

  /** One-line summary text shown in the row. Universal across agent classes. */
  summary: string

  // Original payload (same reference, no copy)
  payload: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Processing context — mutable API available during processEvent
// ---------------------------------------------------------------------------
export interface ProcessingContext {
  // Settings
  dedupEnabled: boolean

  // Read
  /** Look up the canonical Agent row by id. Returns undefined if the
   *  bulk /api/sessions/:id/agents fetch hasn't landed yet, or if the
   *  agent isn't known. Used by process-event implementations to skip
   *  no-op metadata PATCHes when the server already has the same
   *  values. */
  getAgent(agentId: string): Agent | undefined
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
// Agent class registration
// ---------------------------------------------------------------------------
export interface EventColor {
  iconColor: string
  dotColor: string
  customHex?: string
}

export interface AgentClassRegistration<TEvent extends EnrichedEvent = EnrichedEvent> {
  agentClass: string
  displayName: string
  Icon: ComponentType<{ className?: string }>

  processEvent(raw: RawEvent, ctx: ProcessingContext): { event: TEvent }

  // ---- Per-class derivation hooks --------------------------------------
  // These map a wire event (hookName + payload) to display fields.

  /** Map a hookName + payload to a tool name (for tool-related events).
   *  Returns null when the event doesn't reference a tool. */
  deriveToolName(event: RawEvent): string | null

  /** Compute display status from the event and any already-grouped
   *  sibling events (e.g. PreToolUse + matching PostToolUse). Returns
   *  null when status doesn't apply for this hook. */
  deriveStatus(event: RawEvent, groupedEvents: RawEvent[]): EventStatus | null

  // Render-time icon/color resolvers — called per-row so live icon
  // customization propagates without a full reprocess.
  getEventIcon(event: TEvent): ComponentType<{ className?: string }>
  getEventColor(event: TEvent): EventColor

  // Rendering components
  RowSummary: ComponentType<{ event: TEvent; dataApi: FrameworkDataApi }>
  EventDetail: ComponentType<{ event: TEvent; dataApi: FrameworkDataApi }>
  DotTooltip: ComponentType<{ event: TEvent }>
}
