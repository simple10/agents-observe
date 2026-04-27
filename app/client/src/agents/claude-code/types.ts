import type { EnrichedEvent } from '../types'

/**
 * Claude Code's per-class enrichment. Extends the framework's
 * `EnrichedEvent` with fields that only make sense for Claude Code
 * events.
 *
 * Slot fields (`summaryTool`, `summaryCmd`) follow the recommended
 * row-summary pattern: `processEvent` decides what goes in each slot,
 * and `RowSummary` is a dumb renderer that just reads them. New agent
 * classes can adopt the same pattern by adding optional `summaryTool` /
 * `summaryCmd` to their own extension type.
 */
export interface ClaudeCodeEnrichedEvent extends EnrichedEvent {
  /** Claude Code's `tool_use_id` from `payload.tool_use_id`. Set on
   *  PreToolUse / PostToolUse / PostToolUseFailure events; absent on
   *  others. Used to pair Pre with the matching Post. */
  toolUseId?: string

  /** Working directory associated with this event, derived from
   *  `payload.cwd`. Set when the payload carries it; absent otherwise.
   *  Independent of the server `events.cwd` column, which is hooks-lib
   *  metadata reserved for future per-cwd auditing. */
  cwd?: string

  // ---- Summary row "slots" ---------------------------------------------
  // The row-summary component renders, in order: summaryTool (colored
  // with iconColor) → summaryCmd (gray) → summary (default text). All
  // three are optional. processEvent owns the decision of what to put
  // in each.

  /** Primary colored slot — typically the tool name (e.g. "Bash") or
   *  expansion type. Rendered with `iconColor`. */
  summaryTool?: string

  /** Secondary gray slot — typically the parsed command name (e.g. the
   *  binary from a Bash tool input) or command source. Rendered gray. */
  summaryCmd?: string
}
