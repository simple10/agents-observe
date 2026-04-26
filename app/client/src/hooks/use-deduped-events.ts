import { useMemo } from 'react'
import type { ParsedEvent } from '@/types'

/**
 * Dedupe tool events by merging PostToolUse into the corresponding PreToolUse row.
 *
 * Consumed only by the rewind timeline (`timeline-rewind.tsx`); the main event
 * stream does its own dedup via the claude-code agent lib's `processEvent`
 * (see `agents/claude-code/process-event.ts`).
 *
 * Operates on the wire `ParsedEvent` shape — keys off `hookName` directly
 * since the wire event no longer carries a derived `subtype`. The
 * dedup result keeps the wire shape (no derived fields stamped on).
 */
/** Read `tool_use_id` from a raw event payload (Claude-Code-specific key). */
function payloadToolUseId(e: ParsedEvent): string | null {
  const v = (e.payload as Record<string, unknown>).tool_use_id
  return typeof v === 'string' && v ? v : null
}

export function useDedupedEvents(events: ParsedEvent[] | undefined): ParsedEvent[] {
  return useMemo(() => {
    if (!events) return []
    const result: ParsedEvent[] = []
    const toolUseMap = new Map<string, number>() // toolUseId -> index in result

    for (const e of events) {
      const toolUseId = payloadToolUseId(e)
      if (e.hookName === 'PreToolUse' && toolUseId) {
        toolUseMap.set(toolUseId, result.length)
        result.push({ ...e }) // copy so consumers don't mutate cached rows
      } else if (
        (e.hookName === 'PostToolUse' || e.hookName === 'PostToolUseFailure') &&
        toolUseId &&
        toolUseMap.has(toolUseId)
      ) {
        const idx = toolUseMap.get(toolUseId)!
        const preEvent = result[idx]
        // Merge the post payload into the pre row so consumers can read
        // tool_response from the pre slot. Status used to be merged here
        // too — that's now derived per-class via deriveStatus, so we
        // just preserve the pre row's hookName + payload.
        result[idx] = {
          ...preEvent,
          payload: e.payload,
        }
      } else {
        result.push(e)
      }
    }
    return result
  }, [events])
}
