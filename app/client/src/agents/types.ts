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
export interface EnrichedEvent {
  // Core fields (from raw server event)
  id: number
  agentId: string
  sessionId: string
  hookName: string | null
  timestamp: number
  createdAt: number
  type: string
  subtype: string | null

  // Agent-class enrichment
  groupId: string | null
  turnId: string | null
  displayEventStream: boolean
  displayTimeline: boolean
  label: string
  toolName: string | null
  toolUseId: string | null
  icon: ComponentType | null
  iconColor: string | null
  dotColor: string | null
  iconColorHex: string | null
  status: 'running' | 'completed' | 'failed' | 'pending'
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

  // Render-time icon/color resolvers — called per-row so live icon
  // customization propagates without a full reprocess.
  getEventIcon(event: EnrichedEvent): ComponentType<{ className?: string }>
  getEventColor(event: EnrichedEvent): EventColor

  // Rendering components
  RowSummary: ComponentType<EventProps>
  EventDetail: ComponentType<EventProps>
  DotTooltip: ComponentType<{ event: EnrichedEvent }>
}
