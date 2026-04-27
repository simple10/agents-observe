// Convenience wrapper around the claude-code summary builder. Used by
// the timeline dot tooltip and tests where the caller has only a bare
// `ParsedEvent`. Derives toolName itself; subtype is no longer a thing
// — claude-code reads hookName directly.

import type { ParsedEvent } from '@/types'
import { getEventSummary as buildSummary } from '@/agents/claude-code/helpers'
import { deriveToolName } from '@/agents/claude-code/derivers'

export function getEventSummary(event: ParsedEvent): string {
  return buildSummary(event, event.hookName, deriveToolName(event))
}
