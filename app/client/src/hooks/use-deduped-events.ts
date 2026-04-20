import { useMemo } from 'react'
import type { ParsedEvent } from '@/types'

/**
 * Dedupe tool events by merging PostToolUse into the corresponding PreToolUse row.
 *
 * Consumed only by the rewind timeline (`timeline-rewind.tsx`); the main event
 * stream does its own dedup via the claude-code agent lib's `processEvent`
 * (see `agents/claude-code/process-event.ts`).
 */
export function useDedupedEvents(events: ParsedEvent[] | undefined): ParsedEvent[] {
  return useMemo(() => {
    if (!events) return []
    const result: ParsedEvent[] = []
    const toolUseMap = new Map<string, number>() // toolUseId -> index in result

    for (const e of events) {
      if (e.subtype === 'PreToolUse' && e.toolUseId) {
        toolUseMap.set(e.toolUseId, result.length)
        result.push({ ...e }) // copy so we can mutate status
      } else if (
        (e.subtype === 'PostToolUse' || e.subtype === 'PostToolUseFailure') &&
        e.toolUseId &&
        toolUseMap.has(e.toolUseId)
      ) {
        const idx = toolUseMap.get(e.toolUseId)!
        const preEvent = result[idx]
        result[idx] = {
          ...preEvent,
          status: e.subtype === 'PostToolUseFailure' ? 'failed' : 'completed',
          payload: e.payload,
        }
      } else {
        result.push(e)
      }
    }
    return result
  }, [events])
}
