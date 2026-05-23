import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type {
  TranscriptCall,
  TranscriptUsage,
  TranscriptParseError,
  AgentParseResult,
} from '../types'

// ── Codex jsonl shapes ────────────────────────────────────────────
//
// Codex sessions live in `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`,
// one file per session. Lines are `{timestamp, type, payload}`:
//
//   - `session_meta` (first line): id, cwd, originator (model is null
//      here — the per-turn model lives in `turn_context`).
//   - `turn_context`: emitted per turn with `{turn_id, model, effort, ...}`.
//   - `event_msg` with payload.type ∈ {task_started, task_complete,
//     user_message, agent_message, token_count}.
//   - `response_item` with payload.type ∈ {message, reasoning,
//     function_call, function_call_output, local_shell_call,
//     custom_tool_call}.
//
// Mapping to the parser's common shape:
//
//   prompt   ← event_msg.user_message (one per turn; turn_id is the
//              "promptId")
//   call     ← event_msg.token_count with a *new* total_token_usage
//              snapshot (the cumulative total changes when a new API
//              call lands). Reasoning output tokens roll into the
//              `output_tokens` field — they're billed at the same rate.
//   tool use ← response_item.function_call / local_shell_call /
//              custom_tool_call
//   subagent ← never — codex doesn't spawn sub-sessions.

function parseTimestamp(value: unknown): number {
  if (typeof value !== 'string') return 0
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : 0
}

function isToolCall(payloadType: unknown): boolean {
  return (
    payloadType === 'function_call' ||
    payloadType === 'local_shell_call' ||
    payloadType === 'custom_tool_call'
  )
}

function usageFromCodex(last: any): TranscriptUsage {
  return {
    // OpenAI's `input_tokens` already includes the cached subset, which
    // matches the parser convention of "bundled input".
    inputTokens: Number(last?.input_tokens ?? 0),
    // Reasoning output rolls into the output bucket: it's billed at the
    // output rate and surfacing it separately would change the schema.
    outputTokens: Number(last?.output_tokens ?? 0) + Number(last?.reasoning_output_tokens ?? 0),
    cacheReadTokens: Number(last?.cached_input_tokens ?? 0),
    // Codex / OpenAI don't bill cache_write — set both buckets to 0 so
    // the cost calculation passes through cleanly.
    cacheCreate5mTokens: 0,
    cacheCreate1hTokens: 0,
  }
}

/**
 * Parse a codex rollout jsonl into the common AgentParseResult shape.
 * Codex sessions never have subagents, so the `subagents` array is
 * always empty. Subagent ids in the input are ignored.
 */
export async function parseCodexSession(
  mainJsonlPath: string,
  _subagentAgentIds: string[],
): Promise<AgentParseResult> {
  const calls: TranscriptCall[] = []
  const prompts: Record<string, { text: string; timestamp: number }> = {}
  const lastTimestampByPromptId: Record<string, number> = {}
  const errors: TranscriptParseError[] = []

  // Active-turn tracking. `turn_context` and `task_started` both
  // declare a turn_id; whichever lands first opens the window.
  let activeTurnId: string | null = null
  let activeModel: string = ''
  // De-dup token_count snapshots by cumulative total — a new total
  // means a new API call landed since we last checked.
  let lastSeenTotalTokens: number | null = null

  const stream = createReadStream(mainJsonlPath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  for await (const raw of rl) {
    if (!raw) continue
    let line: any
    try {
      line = JSON.parse(raw)
    } catch {
      continue
    }
    const ts = parseTimestamp(line.timestamp)
    const payload = line.payload ?? {}
    const lineType = line.type

    // Update active turn from turn_context (carries model + effort).
    if (lineType === 'turn_context' && typeof payload.turn_id === 'string') {
      activeTurnId = payload.turn_id
      if (typeof payload.model === 'string' && payload.model) {
        activeModel = payload.model
      }
    }

    // task_started is a fallback turn-opener: some lines may arrive
    // without a preceding turn_context (the file always opens with a
    // session_meta, not a turn_context). After task_started, the next
    // turn_context will refine the model.
    if (
      lineType === 'event_msg' &&
      payload.type === 'task_started' &&
      typeof payload.turn_id === 'string'
    ) {
      activeTurnId = payload.turn_id
    }

    // Record this line under the current turn for duration tracking.
    if (activeTurnId && ts > 0) {
      const cur = lastTimestampByPromptId[activeTurnId] ?? 0
      if (ts > cur) lastTimestampByPromptId[activeTurnId] = ts
    }

    if (lineType === 'event_msg' && payload.type === 'user_message') {
      const text = typeof payload.message === 'string' ? payload.message : ''
      if (activeTurnId && text && !(activeTurnId in prompts)) {
        prompts[activeTurnId] = { text, timestamp: ts }
      }
    }

    if (lineType === 'event_msg' && payload.type === 'token_count') {
      const info = payload.info
      if (!info) continue // initial rate-limit-only events have info: null
      const total = info?.total_token_usage?.total_tokens
      if (typeof total !== 'number') continue
      if (total === lastSeenTotalTokens) continue // duplicate / idle ping
      lastSeenTotalTokens = total

      const last = info.last_token_usage ?? {}
      calls.push({
        // No native message id in codex — synthesize one from turn +
        // ascending call index so dedup keys downstream still work.
        messageId: `${activeTurnId ?? 'no-turn'}-${calls.length + 1}`,
        requestId: null,
        timestamp: ts,
        model: activeModel,
        isSidechain: false,
        serviceTier: null,
        stopReason: null,
        usage: usageFromCodex(last),
        toolUseIds: [],
        promptId: activeTurnId,
      })
    }

    // Attribute tool calls to the most recent call so toolCount comes
    // out right per-prompt aggregation. The actual call_id is opaque;
    // we don't need to dedupe across sibling jsonls (codex has none).
    if (lineType === 'response_item' && isToolCall(payload.type)) {
      const callId = typeof payload.call_id === 'string' ? payload.call_id : `${ts}`
      const last = calls[calls.length - 1]
      if (last) last.toolUseIds.push(callId)
    }
  }

  if (calls.length === 0 && Object.keys(prompts).length === 0) {
    errors.push({
      scope: 'main',
      code: 'parse_error',
      message: 'No codex turns or token counts found in transcript.',
    })
  }

  return {
    calls,
    prompts,
    lastTimestampByPromptId,
    subagents: [],
    errors,
  }
}
