// Hermes agent class — event enrichment.

import { applyFilters } from '@/lib/filters/matcher'
import { passesAllFilter } from '@/lib/filters/all-filter'
import type { RawEvent, EnrichedEvent, EventStatus, ProcessingContext } from '../types'
import {
  hermesIconId,
  hermesLabel,
  hermesSearchText,
  hermesStatus,
  hermesSummary,
  hermesToolName,
} from './helpers'

/** Tool name lives at payload.tool_name for Hermes' *_tool_* hooks. */
export function deriveToolName(event: RawEvent): string | null {
  return hermesToolName(event.payload as Record<string, unknown>)
}

/** Hermes events are post-hoc observations; status comes from the payload. */
export function deriveStatus(event: RawEvent): EventStatus | null {
  return hermesStatus(event.hookName, event.payload as Record<string, unknown>)
}

export function processEvent(raw: RawEvent, ctx: ProcessingContext): { event: EnrichedEvent } {
  const payload = (raw.payload ?? {}) as Record<string, unknown>
  const hookName = raw.hookName
  const toolName = hermesToolName(payload)
  const summary = hermesSummary(hookName, payload)
  const passesAll = passesAllFilter(raw, toolName, ctx.compiledFilters)

  const enriched: EnrichedEvent = {
    id: raw.id,
    agentId: raw.agentId,
    hookName,
    timestamp: raw.timestamp,
    toolName,
    groupId: null,
    turnId: ctx.getCurrentTurn(raw.agentId),
    displayEventStream: passesAll,
    displayTimeline: passesAll,
    label: hermesLabel(hookName),
    labelTooltip: hookName,
    iconId: hermesIconId(hookName),
    dedupMode: ctx.dedupEnabled,
    status: hermesStatus(hookName, payload),
    filters: applyFilters(raw, toolName, ctx.compiledFilters),
    searchText: hermesSearchText(raw, summary, toolName),
    payload,
    summary,
  }

  return { event: enriched }
}
