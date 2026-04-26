// Convenience wrapper around the claude-code summary builder.
// Kept for backwards compatibility with timeline-rewind and tests —
// derives subtype/toolName from the wire event so callers can pass a
// bare `ParsedEvent` without knowing the new signature.

import type { ParsedEvent } from '@/types'
import { getEventSummary as buildSummary } from '@/agents/claude-code/helpers'
import { deriveSubtype, deriveToolName } from '@/agents/claude-code/derivers'

export function getEventSummary(event: ParsedEvent): string {
  return buildSummary(event, deriveSubtype(event), deriveToolName(event))
}
