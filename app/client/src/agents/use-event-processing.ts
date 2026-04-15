// React hook that wraps the EventStore for use in components.
// Replaces useDedupedEvents — processes raw events through the agent registry
// and provides enriched events + data API.

import { useMemo, useRef } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { EventStore } from './event-store'
import type { EnrichedEvent, FrameworkDataApi } from './types'
import type { ParsedEvent, Agent } from '@/types'

interface ProcessedEventsResult {
  events: EnrichedEvent[]
  dataApi: FrameworkDataApi
}

/**
 * Process raw server events through the agent class registry.
 * Returns enriched events with display flags, grouping, and a data API for components.
 */
export function useEventProcessing(
  rawEvents: ParsedEvent[] | undefined,
  agents: Agent[],
): ProcessedEventsResult {
  const storeRef = useRef<EventStore>(new EventStore())
  const dedupEnabled = useUIStore((s) => s.dedupEnabled)

  return useMemo(() => {
    const store = storeRef.current
    store.setAgents(agents)

    if (!rawEvents || rawEvents.length === 0) {
      return {
        events: [],
        dataApi: store.createDataApi(),
      }
    }

    // Process all events through agent registry
    const enriched = store.processBatch(rawEvents)

    // When dedup is off, show all events
    if (!dedupEnabled) {
      for (const e of enriched) {
        e.displayEventStream = true
        e.displayTimeline = true
      }
    }

    return {
      events: enriched,
      dataApi: store.createDataApi(),
    }
  }, [rawEvents, agents, dedupEnabled])
}
