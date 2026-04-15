import type { Agent } from '@/types'
import type { EnrichedEvent, RawEvent, ProcessingContext, FrameworkDataApi } from './types'
import { AgentRegistry } from './registry'

/**
 * Stores enriched events and provides indexed lookups.
 * Processes raw events through the registered agent class's processEvent.
 */
export class EventStore {
  private events: EnrichedEvent[] = []
  private eventById = new Map<number, EnrichedEvent>()
  private groupIndex = new Map<string, EnrichedEvent[]>()
  private turnIndex = new Map<string, EnrichedEvent[]>()
  private agentIndex = new Map<string, EnrichedEvent[]>()
  private currentTurns = new Map<string, string>()
  private pendingUpdates: Array<{ eventId: number; changes: Partial<EnrichedEvent> }> = []
  private dedupEnabled = true

  // Agent class lookup — set by the framework from the agents query
  private agentClassMap = new Map<string, string>()
  private agentMap = new Map<string, Agent>()

  /**
   * Update the agent class mapping (called when agents data changes).
   */
  setAgents(agents: Agent[]) {
    this.agentMap.clear()
    this.agentClassMap.clear()
    for (const agent of agents) {
      this.agentMap.set(agent.id, agent)
      // Default to 'claude-code' for agents without an explicit agentClass
      this.agentClassMap.set(agent.id, agent.agentClass || 'claude-code')
    }
  }

  /**
   * Process a batch of raw events (initial load).
   * Clears existing state and processes all events in order.
   */
  processBatch(rawEvents: RawEvent[], dedupEnabled: boolean): EnrichedEvent[] {
    this.clear()
    this.dedupEnabled = dedupEnabled
    for (const raw of rawEvents) {
      this.processOne(raw)
    }
    return this.events
  }

  /**
   * Process a single new raw event (incremental from WebSocket).
   * Returns the full events array (with any mutations applied).
   */
  processIncremental(raw: RawEvent): EnrichedEvent[] {
    this.processOne(raw)
    return this.events
  }

  /**
   * Get all enriched events.
   */
  getEvents(): EnrichedEvent[] {
    return this.events
  }

  /**
   * Create a FrameworkDataApi for render components.
   */
  createDataApi(): FrameworkDataApi {
    return {
      getAgent: (agentId) => this.agentMap.get(agentId),
      getGroupedEvents: (groupId) => this.groupIndex.get(groupId) ?? [],
      getTurnEvents: (turnId) => this.turnIndex.get(turnId) ?? [],
      getAgentEvents: (agentId) => this.agentIndex.get(agentId) ?? [],
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private processOne(raw: RawEvent) {
    const agentClass = this.agentClassMap.get(raw.agentId) ?? 'claude-code'
    const registration = AgentRegistry.get(agentClass)

    const ctx = this.createProcessingContext()
    const result = registration.processEvent(raw, ctx)
    const enriched = result.event

    // Store the event
    this.events.push(enriched)
    this.eventById.set(enriched.id, enriched)

    // Index by group
    if (enriched.groupId) {
      const group = this.groupIndex.get(enriched.groupId)
      if (group) group.push(enriched)
      else this.groupIndex.set(enriched.groupId, [enriched])
    }

    // Index by turn
    if (enriched.turnId) {
      const turn = this.turnIndex.get(enriched.turnId)
      if (turn) turn.push(enriched)
      else this.turnIndex.set(enriched.turnId, [enriched])
    }

    // Index by agent
    const agentEvents = this.agentIndex.get(enriched.agentId)
    if (agentEvents) agentEvents.push(enriched)
    else this.agentIndex.set(enriched.agentId, [enriched])

    // Apply any pending updates from ctx.updateEvent calls
    this.applyPendingUpdates()
  }

  private createProcessingContext(): ProcessingContext {
    return {
      dedupEnabled: this.dedupEnabled,
      getGroupedEvents: (groupId) => this.groupIndex.get(groupId) ?? [],
      getAgentEvents: (agentId) => this.agentIndex.get(agentId) ?? [],
      getCurrentTurn: (agentId) => this.currentTurns.get(agentId) ?? null,
      setCurrentTurn: (agentId, turnId) => this.currentTurns.set(agentId, turnId),
      clearCurrentTurn: (agentId) => this.currentTurns.delete(agentId),
      updateEvent: (eventId, changes) => {
        this.pendingUpdates.push({ eventId, changes })
      },
    }
  }

  private applyPendingUpdates() {
    for (const { eventId, changes } of this.pendingUpdates) {
      const existing = this.eventById.get(eventId)
      if (!existing) continue

      // Find the event in the array and replace with a new object
      // (new reference triggers React re-render for that row)
      const idx = this.events.indexOf(existing)
      if (idx >= 0) {
        const updated = { ...existing, ...changes } as EnrichedEvent
        this.events[idx] = updated
        this.eventById.set(eventId, updated)

        // Update index references
        this.updateIndexReference(this.groupIndex, existing.groupId, existing, updated)
        this.updateIndexReference(this.turnIndex, existing.turnId, existing, updated)
        this.updateIndexReference(this.agentIndex, existing.agentId, existing, updated)
      }
    }
    this.pendingUpdates = []
  }

  private updateIndexReference(
    index: Map<string, EnrichedEvent[]>,
    key: string | null,
    old: EnrichedEvent,
    updated: EnrichedEvent,
  ) {
    if (!key) return
    const arr = index.get(key)
    if (!arr) return
    const i = arr.indexOf(old)
    if (i >= 0) arr[i] = updated
  }

  private clear() {
    this.events = []
    this.eventById.clear()
    this.groupIndex.clear()
    this.turnIndex.clear()
    this.agentIndex.clear()
    this.currentTurns.clear()
    this.pendingUpdates = []
  }
}
