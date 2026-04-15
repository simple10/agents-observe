// Shared event processing context.
// Ensures a single EventStore processes events once, shared by
// event-stream, activity-timeline, and any other consumers.

import { createContext, useContext, useMemo, useRef } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { EventStore } from './event-store'
import type { EnrichedEvent, FrameworkDataApi } from './types'
import type { ParsedEvent, Agent } from '@/types'

interface EventProcessingValue {
  events: EnrichedEvent[]
  dataApi: FrameworkDataApi
}

const EventProcessingContext = createContext<EventProcessingValue>({
  events: [],
  dataApi: {
    getAgent: () => undefined,
    getGroupedEvents: () => [],
    getTurnEvents: () => [],
    getAgentEvents: () => [],
  },
})

export function EventProcessingProvider({
  rawEvents,
  agents,
  children,
}: {
  rawEvents: ParsedEvent[] | undefined
  agents: Agent[]
  children: React.ReactNode
}) {
  const storeRef = useRef<EventStore>(new EventStore())
  const dedupEnabled = useUIStore((s) => s.dedupEnabled)

  const value = useMemo(() => {
    const store = storeRef.current
    store.setAgents(agents)

    if (!rawEvents || rawEvents.length === 0) {
      return {
        events: [] as EnrichedEvent[],
        dataApi: store.createDataApi(),
      }
    }

    const enriched = store.process(rawEvents, dedupEnabled)

    return {
      events: enriched,
      dataApi: store.createDataApi(),
    }
  }, [rawEvents, agents, dedupEnabled])

  return <EventProcessingContext.Provider value={value}>{children}</EventProcessingContext.Provider>
}

export function useProcessedEvents(): EventProcessingValue {
  return useContext(EventProcessingContext)
}
