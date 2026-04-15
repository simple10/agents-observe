// React hook that wraps the EventStore for use in components.
// Replaces useDedupedEvents — processes raw events through the agent registry
// and provides enriched events + data API.

import { useMemo, useRef } from 'react'
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

  return useMemo(() => {
    const store = storeRef.current

    // Update agent class mapping before processing
    store.setAgents(agents)

    if (!rawEvents || rawEvents.length === 0) {
      return {
        events: [],
        dataApi: store.createDataApi(),
      }
    }

    // Process all events (batch mode)
    // TODO: optimize with incremental processing for WebSocket events
    const enriched = store.processBatch(rawEvents)

    return {
      events: enriched,
      dataApi: store.createDataApi(),
    }
  }, [rawEvents, agents])
}
