import { useEvents } from '@/hooks/use-events'
import { useUIStore } from '@/stores/ui-store'
import type { ParsedEvent } from '@/types'

/**
 * Returns the frozen event snapshot when in rewind mode, otherwise live events
 * from react-query. Both timeline and event-stream read events through this
 * hook so they stay in sync with the frozen state.
 */
export function useEffectiveEvents(sessionId: string | null): ParsedEvent[] | undefined {
  const { data: liveEvents } = useEvents(sessionId)
  const rewindMode = useUIStore((s) => s.rewindMode)
  const frozenEvents = useUIStore((s) => s.frozenEvents)
  return rewindMode && frozenEvents ? frozenEvents : liveEvents
}
