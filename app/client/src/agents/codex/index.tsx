// Codex agent class registration. Reuses the default renderer (generic JSON
// payload) but surfaces a Codex-branded icon + display name for UI hints.

import { Terminal } from 'lucide-react'
import { AgentRegistry } from '../registry'
import {
  processEvent,
  DefaultRowSummary,
  DefaultEventDetail,
  DefaultDotTooltip,
} from '../default/index'
import type { RawEvent, EventStatus } from '../types'
import { parseTranscriptEvent } from './parse-transcript'

/** Codex subtype derivation: prefer the transcript-format parser, fall
 *  back to the raw hookName when the payload uses the standard hook
 *  shape (hook_event_name set in the wrapping payload). */
function deriveSubtype(event: RawEvent): string | null {
  const fromTranscript = parseTranscriptEvent(event.payload).subtype
  return fromTranscript ?? event.hookName ?? null
}

/** Codex tool-name derivation: prefer the transcript-format parser; if
 *  the payload carries a Claude-Code-style `tool_name`, surface that. */
function deriveToolName(event: RawEvent): string | null {
  const fromTranscript = parseTranscriptEvent(event.payload).toolName
  if (fromTranscript) return fromTranscript
  const p = event.payload as Record<string, unknown> | undefined
  const tn = p?.tool_name
  return typeof tn === 'string' ? tn : null
}

/** Codex status derivation. Mirrors Claude's Pre/Post pattern when the
 *  payload uses hook-shaped events; transcript-only events have no
 *  inherent pre/post pairing so we return null (callers default to
 *  'completed'). */
function deriveStatus(event: RawEvent, grouped: RawEvent[]): EventStatus | null {
  if (event.hookName === 'PreToolUse') {
    const post = grouped.find(
      (e) => e.hookName === 'PostToolUse' || e.hookName === 'PostToolUseFailure',
    )
    if (!post) return 'running'
    return post.hookName === 'PostToolUseFailure' ? 'failed' : 'completed'
  }
  return null
}

AgentRegistry.register({
  agentClass: 'codex',
  displayName: 'codex',
  Icon: Terminal,
  processEvent,
  deriveSubtype,
  deriveToolName,
  deriveStatus,
  getEventIcon: () => Terminal,
  getEventColor: () => ({
    iconColor: 'text-muted-foreground',
    dotColor: 'bg-muted-foreground',
  }),
  RowSummary: DefaultRowSummary,
  EventDetail: DefaultEventDetail,
  DotTooltip: DefaultDotTooltip,
})
