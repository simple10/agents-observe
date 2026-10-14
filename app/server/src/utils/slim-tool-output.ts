// app/server/src/utils/slim-tool-output.ts
//
// Opt-in (AGENTS_OBSERVE_SLIM_TOOL_OUTPUT=1): replace bulky tool output with
// a size placeholder before the event is stored. Tool output (stdout, file
// contents, patches, MCP results) is most of the DB by bytes; the dashboard
// needs only its shape and a few small fields from it.
//
// Kept: numbers, booleans, null, and strings up to MAX_STRING chars (ids,
// models, statuses, file paths), two object levels deep. Everything else
// becomes a placeholder *string*, so client code that reads e.g.
// `tool_response.stdout` as text keeps working. `usage` objects are kept
// whole: they are token counts the session stats read.

const MAX_STRING = 200
const MAX_DEPTH = 2
const KEEP_WHOLE = new Set(['usage'])

export const SLIM_HOOKS = new Set(['PostToolUse', 'PostToolUseFailure', 'PostToolBatch'])

export function slimEnabled(): boolean {
  return process.env.AGENTS_OBSERVE_SLIM_TOOL_OUTPUT === '1'
}

function byteLength(value: unknown): number {
  const s = typeof value === 'string' ? value : JSON.stringify(value)
  return s === undefined ? 0 : Buffer.byteLength(s, 'utf8')
}

function placeholder(value: unknown): string {
  const bytes = byteLength(value)
  if (typeof value === 'string') {
    const lines = value.split('\n').length
    return `[omitted: ${bytes} bytes, ${lines} lines]`
  }
  if (Array.isArray(value)) return `[omitted: ${bytes} bytes, ${value.length} items]`
  return `[omitted: ${bytes} bytes]`
}

export function slimValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > MAX_STRING) return placeholder(value)
    return value
  }
  if (Array.isArray(value) || depth >= MAX_DEPTH) return placeholder(value)
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = KEEP_WHOLE.has(key) ? v : slimValue(v, depth + 1)
  }
  return out
}

/** Returns the payload with every tool_response slimmed; other fields untouched. */
export function slimToolOutput(hookName: string, payload: unknown): unknown {
  if (!SLIM_HOOKS.has(hookName) || !payload || typeof payload !== 'object') return payload
  const p = payload as Record<string, unknown>
  if ('tool_response' in p) {
    return { ...p, tool_response: slimValue(p.tool_response) }
  }
  if (Array.isArray(p.tool_calls)) {
    return {
      ...p,
      tool_calls: p.tool_calls.map((call) =>
        call && typeof call === 'object' && 'tool_response' in call
          ? { ...call, tool_response: slimValue((call as Record<string, unknown>).tool_response) }
          : call,
      ),
    }
  }
  return payload
}
