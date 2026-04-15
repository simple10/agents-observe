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

  // Track what we've already processed to enable incremental updates
  private lastProcessedCount = 0
  private lastDedupEnabled = true
  private lastIconVersion = 0

  /**
   * Process raw events. Automatically detects whether to do a full
   * reprocess or incremental append based on what changed.
   */
  process(rawEvents: RawEvent[], dedupEnabled: boolean, iconVersion = 0): EnrichedEvent[] {
    // Full reprocess needed if settings changed or events were replaced (not appended)
    const needsFullReprocess =
      dedupEnabled !== this.lastDedupEnabled ||
      iconVersion !== this.lastIconVersion ||
      rawEvents.length < this.lastProcessedCount ||
      (this.lastProcessedCount > 0 &&
        rawEvents.length > 0 &&
        rawEvents[0]?.id !== this.events[0]?.id)

    if (needsFullReprocess) {
      this.clear()
      this.dedupEnabled = dedupEnabled
      this.lastDedupEnabled = dedupEnabled
      this.lastIconVersion = iconVersion
      for (const raw of rawEvents) {
        this.processOne(raw)
      }
      this.lastProcessedCount = rawEvents.length
      return this.events
    }

    // Incremental: only process newly appended events
    this.dedupEnabled = dedupEnabled
    const newEvents = rawEvents.slice(this.lastProcessedCount)
    if (newEvents.length === 0) return this.events
    for (const raw of newEvents) {
      this.processOne(raw)
    }
    this.lastProcessedCount = rawEvents.length
    // Return a new array reference so React detects the change
    this.events = [...this.events]
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
    this.lastProcessedCount = 0
  }
}
