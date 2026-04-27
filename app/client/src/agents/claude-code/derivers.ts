// Derivers for the Claude Code agent class. The runtime calls these
// while reshaping a `ParsedEvent` into the `EnrichedEvent` consumed by
// renderers. They are also used internally by `processEvent`.

import type { RawEvent, EventStatus } from '../types'

/** Claude Code: tool name lives under `payload.tool_name`. */
export function deriveToolName(event: RawEvent): string | null {
  const p = event.payload as Record<string, unknown> | undefined
  const tn = p?.tool_name
  return typeof tn === 'string' ? tn : null
}

/**
 * Claude Code status derivation. Pairs PreToolUse with the matching
 * PostToolUse / PostToolUseFailure to decide running/completed/failed.
 * Other hooks return null (callers default to 'completed').
 */
export function deriveStatus(event: RawEvent, grouped: RawEvent[]): EventStatus | null {
  if (event.hookName === 'PreToolUse') {
    const post = grouped.find(
      (e) => e.hookName === 'PostToolUse' || e.hookName === 'PostToolUseFailure',
    )
    if (!post) return 'running'
    return post.hookName === 'PostToolUseFailure' ? 'failed' : 'completed'
  }
  if (event.hookName === 'PreCompact') return 'running'
  if (event.hookName === 'PostCompact') return 'completed'
  if (event.hookName === 'PostToolUseFailure') return 'failed'
  if (event.hookName === 'PostToolUse') return 'completed'
  return null
}
