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
  prompts: Record<string, { text: string; timestamp: number }>
  /** For each promptId, the timestamp of the latest jsonl line whose
   *  parentUuid chain resolves back to that prompt. Used to compute
   *  per-prompt duration. */
  lastTimestampByPromptId: Record<string, number>
  subagents: TranscriptSubagent[]
  errors: TranscriptParseError[]
}

export interface TranscriptPrompt {
  promptId: string
  text: string
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
