// Shared types for the transcript-parser.

export interface ModelPricing {
  inputPerM: number
  outputPerM: number
  cacheReadPerM: number
  cacheCreate5mPerM: number
  cacheCreate1hPerM: number
}

export interface TranscriptUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
}

export interface TranscriptCall {
  messageId: string
  requestId: string | null
  timestamp: number
  model: string
  isSidechain: boolean
  serviceTier: string | null
  stopReason: string | null
  usage: TranscriptUsage
  toolUseIds: string[]
  promptId: string | null
}

export interface TranscriptSubagent {
  agentId: string
  agentType: string | null
  description: string | null
  toolUseId: string | null
  /** Raw promptId carried in this subagent's JSONL lines — the
   *  originating main-session prompt. Resolved to the prompt's canonical
   *  uuid via AgentParseResult.promptIdToUuid for cost attribution. */
  originPromptId: string | null
  model: string
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
  durationMs: number
  toolCount: number
  costCents: number | null
}

export interface TranscriptParseError {
  scope: 'main' | 'subagent'
  agentId?: string
  code: 'missing' | 'unreadable' | 'parse_error'
  message: string
}

export interface AgentParseResult {
  calls: TranscriptCall[]
  prompts: Record<string, { text: string; timestamp: number; command: string | null }>
  /** For each promptId, the timestamp of the latest jsonl line whose
   *  parentUuid chain resolves back to that prompt. Used to compute
   *  per-prompt duration. */
  lastTimestampByPromptId: Record<string, number>
  /** Maps raw promptId → canonical prompt uuid (main transcript). Lets
   *  the aggregator link subagents (which carry the raw promptId) to the
   *  prompt row keyed by uuid. Empty for agent classes without subagents. */
  promptIdToUuid: Record<string, string>
  subagents: TranscriptSubagent[]
  errors: TranscriptParseError[]
  /** Session-wide aggregates derived from main + subagent JSONLs. */
  startedAt: number | null
  durationMs: number | null
  toolCalls: number
  filesRead: number
  filesEdited: number
  gitCommits: number
  toolStats: TranscriptToolStat[]
  /** Count of real user-typed prompts in the main JSONL, deduped by
   *  uuid so session-resume replays don't inflate the count, with
   *  internal injects (slash commands, command caveats, bash output
   *  captures) and `[Request interrupted by user]` auto-messages
   *  filtered out. */
  userPrompts: number
}

export interface TranscriptToolStat {
  name: string
  count: number
  /** Pairing-derived duration stats. null when no tool_result line was
   *  found for any invocation of this tool. */
  minMs: number | null
  medianMs: number | null
  maxMs: number | null
  /** tool_use_id of the slowest invocation. The UI cross-references
   *  against PreToolUse events to make the row clickable when an event
   *  exists; falls back to non-clickable when the event isn't captured
   *  (pre-plugin tool calls). */
  longestToolUseId: string | null
}

export interface TranscriptPrompt {
  promptId: string
  text: string
  /** Reconstructed `/name args` when this prompt is a slash-command
   *  expansion; null for ordinary typed prompts. The UI renders it as the
   *  primary (clickable) line with `text` (the expanded body) beneath, and
   *  matches it against UserPromptSubmit/UserPromptExpansion events. */
  command: string | null
  timestamp: number
  durationMs: number | null
  toolCount: number
  requests: number
  /** Bundled input (fresh + cache_read + cache_write). */
  inputTokens: number
  outputTokens: number
  /** Cache breakdown — same shape as byModel rows so the UI can render a per-line cost tooltip. */
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
  models: string[]
  costCents: number | null
}

export interface TranscriptByModelV2 {
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
  costCents: number | null
}

export interface TranscriptSummaryV2 {
  totalCalls: number
  inputTotal: number
  outputTotal: number
  cacheHitRate: number
  costTotalCents: number | null
  /** First/last timestamps + wall-clock duration of the main JSONL.
   *  null when the JSONL has no timestamped lines. */
  startedAt: number | null
  durationMs: number | null
  /** Tool-use counts aggregated across the main agent + every subagent. */
  toolCalls: number
  filesRead: number
  filesEdited: number
  gitCommits: number
  toolStats: TranscriptToolStat[]
  /** JSONL-derived count of user-typed prompts (main JSONL only,
   *  deduped by uuid, internal injects filtered). */
  userPrompts: number
}

export interface TranscriptStatsV2 {
  source: 'jsonl'
  summary: TranscriptSummaryV2
  byModel: TranscriptByModelV2[]
  prompts: TranscriptPrompt[]
  subagents: TranscriptSubagent[]
  models: Record<string, { pricing: ModelPricing | null }>
  errors: TranscriptParseError[]
}
