// Hermes agent class — hook → display mapping helpers.
//
// Hermes (Nous Research) emits its own lifecycle hooks (on_session_start,
// pre/post_llm_call, pre/post_api_request, transform_*, *_tool_call, …) rather
// than the Claude Code hook set. We map each onto the CLOSEST existing
// icon-registry id so events render with sensible icons/colors — no new icons
// are added to the catalog.

import type { EventStatus, RawEvent } from '../types'

type Payload = Record<string, unknown>

/** Collapse whitespace/newlines into a single line and trim. */
export function oneLine(s: unknown): string {
  if (typeof s !== 'string') return ''
  return s.replace(/\s*\n\s*/g, ' ').trim()
}

/** Truncate to n chars with an ellipsis. */
export function truncate(s: string, n = 140): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

/** Compact token/count formatting: 1234 → "1.2k", 21 → "21". */
export function fmtCount(n: unknown): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}

// Hermes hook → existing icon-registry id. Reuses Claude Code's icon keys:
//   on_session_start  → SessionStart      (session lifecycle)
//   pre_llm_call      → UserPromptSubmit  (carries the user message)
//   post_llm_call     → ToolAgent         (the model's turn / reply)
//   pre/post_api_request → ToolWebFetch    (the outbound provider HTTP call)
//   transform_llm_output → Notification    (the final user-visible output)
//   post_tool_call / transform_tool_result → ToolDefault (tool execution)
//   on_session_end    → SessionEnd
//   on_session_finalize → stop_hook_summary (final wrap-up)
export const HERMES_ICON_BY_HOOK: Record<string, string> = {
  on_session_start: 'SessionStart',
  pre_llm_call: 'UserPromptSubmit',
  post_llm_call: 'ToolAgent',
  pre_api_request: 'ToolWebFetch',
  post_api_request: 'ToolWebFetch',
  transform_llm_output: 'Notification',
  post_tool_call: 'ToolDefault',
  transform_tool_result: 'ToolDefault',
  on_session_end: 'SessionEnd',
  on_session_finalize: 'stop_hook_summary',
}

/** Short row label per hook. */
export const HERMES_LABEL_BY_HOOK: Record<string, string> = {
  on_session_start: 'Session',
  pre_llm_call: 'Prompt',
  post_llm_call: 'LLM',
  pre_api_request: 'API request',
  post_api_request: 'API response',
  transform_llm_output: 'Output',
  post_tool_call: 'Tool',
  transform_tool_result: 'Tool result',
  on_session_end: 'Session end',
  on_session_finalize: 'Finalize',
}

export function hermesIconId(hookName: string): string {
  return HERMES_ICON_BY_HOOK[hookName] ?? 'Default'
}

export function hermesLabel(hookName: string): string {
  return HERMES_LABEL_BY_HOOK[hookName] ?? hookName
}

/** Hermes carries the tool name at payload.tool_name for tool hooks. */
export function hermesToolName(payload: Payload): string | null {
  return typeof payload.tool_name === 'string' ? payload.tool_name : null
}

/** Hermes events are observations of work already done, so they're
 *  'completed' — except an interrupted session, surfaced as 'failed'. */
export function hermesStatus(hookName: string, payload: Payload): EventStatus {
  if (hookName === 'on_session_end' && payload.interrupted === true) return 'failed'
  return 'completed'
}

/** One-line summary text per hook, pulled from the relevant payload fields. */
export function hermesSummary(hookName: string, payload: Payload): string {
  const p = payload as Record<string, any>
  switch (hookName) {
    case 'on_session_start':
      return [p.model, p.platform].filter(Boolean).join(' · ') || 'Session started'
    case 'pre_llm_call':
      return truncate(oneLine(p.user_message)) || 'LLM call'
    case 'post_llm_call':
      return truncate(oneLine(p.assistant_response)) || 'Assistant responded'
    case 'pre_api_request': {
      const bits: string[] = []
      if (p.model) bits.push(String(p.model))
      if (typeof p.message_count === 'number') bits.push(`${p.message_count} msg`)
      if (typeof p.tool_count === 'number') bits.push(`${p.tool_count} tools`)
      const tok = fmtCount(p.approx_input_tokens)
      if (tok) bits.push(`~${tok} tok`)
      return bits.join(' · ') || 'API request'
    }
    case 'post_api_request': {
      const bits: string[] = []
      if (p.finish_reason) bits.push(String(p.finish_reason))
      const total = fmtCount(p.usage?.total_tokens)
      if (total) bits.push(`${total} tok`)
      if (typeof p.api_duration === 'number') bits.push(`${p.api_duration.toFixed(1)}s`)
      return bits.join(' · ') || 'API response'
    }
    case 'transform_llm_output':
      return truncate(oneLine(p.response_text)) || 'Output transformed'
    case 'post_tool_call':
    case 'transform_tool_result': {
      const tool = typeof p.tool_name === 'string' ? p.tool_name : 'tool'
      const args =
        p.args && typeof p.args === 'object'
          ? Object.entries(p.args as Record<string, unknown>)
              .map(([k, v]) => `${k}=${oneLine(String(v))}`)
              .join(' ')
          : ''
      const dur = typeof p.duration_ms === 'number' ? ` · ${p.duration_ms}ms` : ''
      return truncate(`${tool}${args ? ` ${args}` : ''}${dur}`)
    }
    case 'on_session_end':
      return p.interrupted ? 'Interrupted' : p.completed ? 'Completed' : 'Session ended'
    case 'on_session_finalize':
      return 'Session finalized'
    default:
      return ''
  }
}

/** Targeted search text — avoids stringifying Hermes' large payloads
 *  (system prompts, request_messages) on every event. */
export function hermesSearchText(
  event: RawEvent,
  summary: string,
  toolName: string | null,
): string {
  const p = event.payload as Record<string, any>
  return [event.hookName, toolName, summary, p?.model]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .slice(0, 500)
}
