// Codex transcript-format parser.
//
// Ported from the deleted server-side `parser.ts` (see git
// `7d54cfe^:app/server/src/parser.ts`, the TRANSCRIPT JSONL FORMAT
// branch). When a Codex hook payload doesn't carry a hook_event_name —
// e.g. a raw transcript line was forwarded as-is — we still need to
// surface a sensible subtype and toolName for display. Per the
// three-layer contract, all of this lives in Layer 3 now.

export interface TranscriptParseResult {
  /** Display subtype (`agent_progress`, the inner hookEvent for
   *  hook_progress, etc.). Null when no signal in the payload. */
  subtype: string | null
  /** Tool name surfaced from a nested tool_use, hookName, or message. */
  toolName: string | null
  /** Spawned subagent id when the line announces an agent_progress or
   *  carries a `toolUseResult.agentId`. */
  subAgentId: string | null
  /** Subagent display name from a tool_use input. */
  subAgentName: string | null
  /** Subagent description from a tool_use input. */
  subAgentDescription: string | null
}

/**
 * Inspect a transcript-format payload and pull out a subtype + tool
 * name. The function is permissive: missing keys / malformed shapes
 * just return null entries — never throw.
 */
export function parseTranscriptEvent(
  payload: Record<string, unknown> | undefined | null,
): TranscriptParseResult {
  const result: TranscriptParseResult = {
    subtype: null,
    toolName: null,
    subAgentId: null,
    subAgentName: null,
    subAgentDescription: null,
  }
  if (!payload || typeof payload !== 'object') return result

  const type = typeof payload.type === 'string' ? (payload.type as string) : null

  // Some transcripts carry `subtype` directly.
  if (typeof payload.subtype === 'string') {
    result.subtype = payload.subtype as string
  }

  const data = payload.data as Record<string, unknown> | undefined
  const message = payload.message as Record<string, unknown> | undefined
  const toolUseResult = payload.toolUseResult as Record<string, unknown> | undefined

  // ---- progress ---------------------------------------------------------
  if (type === 'progress' && data) {
    const dataType = data.type as string | undefined

    if (dataType === 'hook_progress') {
      result.subtype = (data.hookEvent as string) ?? result.subtype
      const hookName = data.hookName as string | undefined
      // Old convention: `hookName` looks like `PreToolUse:Bash` — split
      // on `:` to extract the tool name.
      if (hookName && hookName.includes(':')) {
        result.toolName = hookName.split(':').slice(1).join(':')
      }
    }

    if (dataType === 'agent_progress') {
      result.subtype = 'agent_progress'
      result.subAgentId = (data.agentId as string) ?? null
      const nestedMsg = data.message as Record<string, unknown> | undefined
      const innerMsg = nestedMsg?.message as Record<string, unknown> | undefined
      const content = innerMsg?.content
      if (Array.isArray(content)) {
        const toolUse = content.find(
          (c: unknown) =>
            !!c && typeof c === 'object' && (c as Record<string, unknown>).type === 'tool_use',
        ) as Record<string, unknown> | undefined
        if (toolUse) {
          result.toolName = (toolUse.name as string) ?? null
        }
      }
    }
  }

  // ---- assistant --------------------------------------------------------
  if (type === 'assistant' && message) {
    const content = message.content
    if (Array.isArray(content)) {
      const toolUse = content.find(
        (c: unknown) =>
          !!c && typeof c === 'object' && (c as Record<string, unknown>).type === 'tool_use',
      ) as Record<string, unknown> | undefined
      if (toolUse) {
        result.toolName = (toolUse.name as string) ?? null
        if (result.toolName === 'Agent') {
          const input = toolUse.input as Record<string, unknown> | undefined
          result.subAgentName = (input?.name as string) ?? null
          result.subAgentDescription = (input?.description as string) ?? null
        }
      }
    }
  }

  // ---- toolUseResult ----------------------------------------------------
  if (toolUseResult) {
    result.subAgentId = (toolUseResult.agentId as string) ?? result.subAgentId
  }

  return result
}
