import { useMemo } from 'react'
import type { ParsedEvent } from '@/types'

export interface PayloadSnapshot {
  subtype: string
  timestamp: number
  payload: Record<string, unknown>
}

export interface PairedPayloads {
  pre: PayloadSnapshot
  post: PayloadSnapshot | null // null when still pending (no PostToolUse yet)
}

export interface DedupedEventsResult {
  /** Deduped list of events with PostToolUse merged into PreToolUse rows */
  deduped: ParsedEvent[]
  /** Map from subagent ID to the parent Agent tool's toolUseId */
  spawnToolUseIds: Map<string, string>
  /** Map from subagent ID to the parent Agent call's description/prompt */
  spawnInfo: Map<string, { description?: string; prompt?: string }>
  /** Map from merged (PostToolUse) event ID to the displayed (PreToolUse) row's event ID */
  mergedIdMap: Map<number, number>
  /** For tool rows: the Pre and Post payload snapshots, keyed by the row's event ID */
  pairedPayloads: Map<number, PairedPayloads>
}

/**
 * Dedupe tool events by merging PostToolUse into the corresponding PreToolUse row.
 * Also extracts subagent spawn info (parent tool use IDs + description/prompt).
 *
 * Used by both the event stream and the rewind timeline so they render the same
 * set of rows/dots.
 */
export function useDedupedEvents(events: ParsedEvent[] | undefined): DedupedEventsResult {
  return useMemo(() => {
    if (!events)
      return {
        deduped: [],
        spawnToolUseIds: new Map<string, string>(),
        spawnInfo: new Map<string, { description?: string; prompt?: string }>(),
        mergedIdMap: new Map<number, number>(),
        pairedPayloads: new Map<number, PairedPayloads>(),
      }
    const result: ParsedEvent[] = []
    const toolUseMap = new Map<string, number>() // toolUseId -> index in result
    const spawns = new Map<string, string>() // subagentId -> toolUseId
    const info = new Map<string, { description?: string; prompt?: string }>()
    const idMap = new Map<number, number>() // merged event ID -> displayed row event ID
    const pairedPayloads = new Map<number, PairedPayloads>()

    for (const e of events) {
      if (e.subtype === 'PreToolUse' && e.toolUseId) {
        toolUseMap.set(e.toolUseId, result.length)
        result.push({ ...e }) // copy so we can mutate status
        // Seed the paired payloads with just the Pre for now (Post may arrive later)
        pairedPayloads.set(e.id, {
          pre: {
            subtype: e.subtype,
            timestamp: e.timestamp,
            payload: e.payload,
          },
          post: null,
        })
      } else if (
        (e.subtype === 'PostToolUse' || e.subtype === 'PostToolUseFailure') &&
        e.toolUseId &&
        toolUseMap.has(e.toolUseId)
      ) {
        const idx = toolUseMap.get(e.toolUseId)!
        const preEvent = result[idx]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prePayload = preEvent.payload as any
        result[idx] = {
          ...preEvent,
          status: e.subtype === 'PostToolUseFailure' ? 'failed' : 'completed',
          payload: e.payload,
        }
        // Map the PostToolUse ID to the PreToolUse row ID so scroll-to works
        idMap.set(e.id, preEvent.id)
        // Complete the paired payloads entry with the Post event
        const existing = pairedPayloads.get(preEvent.id)
        if (existing) {
          existing.post = {
            subtype: e.subtype!,
            timestamp: e.timestamp,
            payload: e.payload,
          }
        }
        // Track Agent tool spawns + capture prompt from PreToolUse input
        if (e.toolName === 'Agent') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const agentId = (e.payload as any)?.tool_response?.agentId
          if (agentId) {
            spawns.set(agentId, e.toolUseId)
            const toolInput = prePayload?.tool_input
            if (toolInput) {
              info.set(agentId, {
                description: toolInput.description,
                prompt: toolInput.prompt,
              })
            }
          }
        }
      } else {
        result.push(e)
      }
    }
    return {
      deduped: result,
      spawnToolUseIds: spawns,
      spawnInfo: info,
      mergedIdMap: idMap,
      pairedPayloads,
    }
  }, [events])
}
