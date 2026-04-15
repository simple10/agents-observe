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
  iconColorHex: string | null
  status: 'running' | 'completed' | 'failed' | 'pending'
  filterTags: string[]
  searchText: string

  // Original payload (same reference, no copy)
  payload: Record<string, unknown>

  // Agent-class can stash extra fields (tool_input, cwd, etc.)
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Processing context — mutable API available during processEvent
// ---------------------------------------------------------------------------
export interface ProcessingContext {
  // Read
  getGroupedEvents(groupId: string): EnrichedEvent[]
  getAgentEvents(agentId: string): EnrichedEvent[]
  getCurrentTurn(agentId: string): string | null

  // Write
  updateEvent(eventId: number, changes: Partial<EnrichedEvent>): void
  setCurrentTurn(agentId: string, turnId: string): void
  clearCurrentTurn(agentId: string): void
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
export interface AgentClassRegistration {
  agentClass: string
  displayName: string
  Icon: ComponentType

  processEvent(raw: RawEvent, ctx: ProcessingContext): ProcessEventResult

  // Rendering components
  RowSummary: ComponentType<EventProps>
  EventDetail: ComponentType<EventProps>
  DotTooltip: ComponentType<{ event: EnrichedEvent }>
}
