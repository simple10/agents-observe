import { promises as fsp, createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type {
  TranscriptCall,
  TranscriptUsage,
  TranscriptSubagent,
  TranscriptParseError,
  TranscriptToolStat,
  AgentParseResult,
} from '../types'

interface ToolUseRecord {
  name: string
  timestamp: number
  /** Captured for Read/Edit/Write (file_path) — used for filesRead/filesEdited sets. */
  filePath: string | null
  /** Captured for Bash — used for gitCommits regex. */
  command: string | null
}

// ── Parsing primitives ────────────────────────────────────────────

interface IndexedLine {
  uuid: string | null
  parentUuid: string | null
  type: string
  promptId: string | null
  timestamp: number
}

function parseTimestamp(value: unknown): number {
  if (typeof value !== 'string') return 0
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : 0
}

function extractUsage(u: any): TranscriptUsage {
  const cache = u?.cache_creation ?? {}
  return {
    inputTokens: Number(u?.input_tokens ?? 0),
    outputTokens: Number(u?.output_tokens ?? 0),
    cacheReadTokens: Number(u?.cache_read_input_tokens ?? 0),
    cacheCreate5mTokens: Number(cache?.ephemeral_5m_input_tokens ?? 0),
    cacheCreate1hTokens: Number(cache?.ephemeral_1h_input_tokens ?? 0),
  }
}

interface JsonlParseResult {
  calls: TranscriptCall[]
  prompts: Record<string, { text: string; timestamp: number }>
  firstTimestamp: number
  lastTimestamp: number
  toolCount: number
  /** For each promptId, the timestamp of the latest line in this jsonl
   *  whose parentUuid chain resolves back to that prompt. Used to
   *  compute per-prompt duration as `lastTs - prompt.timestamp` — the
   *  proper "time spent on this prompt" without bleeding in idle time
   *  between prompts. */
  lastTimestampByPromptId: Record<string, number>
  /** All tool_use blocks keyed by tool_use_id. Used by parseClaudeSession
   *  to aggregate filesRead/filesEdited/gitCommits/toolStats across the
   *  main JSONL + every subagent JSONL. */
  toolUses: Map<string, ToolUseRecord>
  /** Timestamps of tool_result blocks keyed by tool_use_id, used for
   *  per-tool duration stats. */
  toolResults: Map<string, number>
  /** Set of uuids whose user line looks like a real user-typed prompt
   *  (has text content, isn't an internal inject like <command-name>,
   *  <local-command-stdout>, or `[Request interrupted by user]`).
   *  Dedup by uuid because session resume rewrites the JSONL, re-emitting
   *  the same prompt line multiple times with the same uuid but new
   *  promptIds — promptId-based counting would over-count those replays.
   */
  userPromptUuids: Set<string>
}

/** Matches the leading tag of Claude Code's internal user-line injects
 *  (slash commands, command caveats, captured bash output). These have
 *  a promptId but don't represent a user prompt. */
const INJECT_PREFIX_RE = /^<(?:command-|local-command-|bash-stdout|bash-stderr|bash-input)/
const INTERRUPT_PREFIX = '[Request interrupted'

/**
 * Stream-parse a single jsonl file. Returns deduped calls (by
 * message.id), the originating-prompt index, and aggregate
 * primitives needed by callers (timestamps + tool count).
 */
async function parseJsonlFile(filePath: string): Promise<JsonlParseResult> {
  const callMap = new Map<string, TranscriptCall>()
  const lineIndex = new Map<string, IndexedLine>()
  const prompts: Record<string, { text: string; timestamp: number }> = {}
  const firstUuidByMessageId = new Map<string, string>()
  const toolUses = new Map<string, ToolUseRecord>()
  const toolResults = new Map<string, number>()
  const userPromptUuids = new Set<string>()

  let firstTimestamp = Infinity
  let lastTimestamp = 0
  let toolCount = 0

  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  for await (const raw of rl) {
    if (!raw) continue
    let line: any
    try {
      line = JSON.parse(raw)
    } catch {
      continue
    }
    const uuid = typeof line.uuid === 'string' ? line.uuid : null
    const ts = parseTimestamp(line.timestamp)
    if (ts > 0) {
      if (ts < firstTimestamp) firstTimestamp = ts
      if (ts > lastTimestamp) lastTimestamp = ts
    }
    const indexed: IndexedLine = {
      uuid,
      parentUuid: typeof line.parentUuid === 'string' ? line.parentUuid : null,
      type: typeof line.type === 'string' ? line.type : '',
      promptId: typeof line.promptId === 'string' ? line.promptId : null,
      timestamp: ts,
    }
    if (uuid) lineIndex.set(uuid, indexed)

    if (line.type === 'assistant' && line.message && typeof line.message.id === 'string') {
      const msg = line.message
      // Skip locally-synthesized API-error placeholders. They carry
      // model "<synthetic>" with zero-token usage — not real API calls,
      // no pricing match, would null-out cost aggregations downstream.
      if (msg.model === '<synthetic>') continue
      const existing = callMap.get(msg.id)
      const toolUseIds: string[] = []
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && block.type === 'tool_use' && typeof block.id === 'string') {
            toolUseIds.push(block.id)
            toolCount += 1
            // First write wins — a given tool_use_id can appear in more
            // than one assistant line for the same message (thinking +
            // tool_use blocks emit separately). The first carries the
            // canonical timestamp/name/input.
            if (!toolUses.has(block.id)) {
              const name = typeof block.name === 'string' ? block.name : ''
              const input = block.input ?? null
              const filePath = input && typeof input.file_path === 'string' ? input.file_path : null
              const command = input && typeof input.command === 'string' ? input.command : null
              toolUses.set(block.id, { name, timestamp: ts, filePath, command })
            }
          }
        }
      }
      if (existing) {
        for (const id of toolUseIds) {
          if (!existing.toolUseIds.includes(id)) existing.toolUseIds.push(id)
        }
      } else {
        if (uuid) firstUuidByMessageId.set(msg.id, uuid)
        callMap.set(msg.id, {
          messageId: msg.id,
          requestId: typeof line.requestId === 'string' ? line.requestId : null,
          timestamp: ts,
          model: typeof msg.model === 'string' ? msg.model : '',
          isSidechain: line.isSidechain === true,
          serviceTier: typeof msg.usage?.service_tier === 'string' ? msg.usage.service_tier : null,
          stopReason: typeof msg.stop_reason === 'string' ? msg.stop_reason : null,
          usage: extractUsage(msg.usage),
          toolUseIds,
          promptId: null,
        })
      }
    } else if (line.type === 'user' && line.message) {
      const content = line.message.content
      // Prompt text: only on user lines that originate a prompt
      // (carry a promptId). Tool results don't have one.
      if (typeof line.promptId === 'string' && line.promptId) {
        let text: string | null = null
        if (typeof content === 'string') {
          text = content
        } else if (
          Array.isArray(content) &&
          content[0]?.type === 'text' &&
          typeof content[0].text === 'string'
        ) {
          text = content[0].text
        }
        if (text !== null && !(line.promptId in prompts)) {
          prompts[line.promptId] = { text, timestamp: ts }
        }
        // Track real user-typed prompts (deduped by uuid so resume
        // replays of the same line don't inflate the count). Filter out
        // internal injects and [Request interrupted by user] auto-msgs.
        if (
          text !== null &&
          uuid &&
          !INJECT_PREFIX_RE.test(text) &&
          !text.startsWith(INTERRUPT_PREFIX)
        ) {
          userPromptUuids.add(uuid)
        }
      }
      // Tool results: capture the timestamp keyed by tool_use_id so
      // parseClaudeSession can pair each tool_use with its result and
      // compute per-tool durations.
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block &&
            block.type === 'tool_result' &&
            typeof block.tool_use_id === 'string' &&
            !toolResults.has(block.tool_use_id)
          ) {
            toolResults.set(block.tool_use_id, ts)
          }
        }
      }
    }
  }

  // Resolve promptId for each call by walking parentUuid back through
  // the line index until we hit any line carrying a non-null promptId.
  const maxWalkSteps = lineIndex.size + 1
  for (const [messageId, call] of callMap) {
    const startUuid = firstUuidByMessageId.get(messageId)
    if (!startUuid) continue
    let cursor: string | null = startUuid
    let steps = 0
    while (cursor && steps < maxWalkSteps) {
      const node = lineIndex.get(cursor)
      if (!node) break
      if (node.promptId) {
        call.promptId = node.promptId
        break
      }
      cursor = node.parentUuid
      steps += 1
    }
  }

  // Per-prompt last-activity timestamp. Walk every indexed line back
  // through its parent chain to find the originating prompt, then
  // record max(timestamp) per prompt. This captures *all* events for
  // each prompt — assistant messages, attachments, and the tool_result
  // user lines that mark when subagents and tools return — independent
  // of any other prompt. Lets the duration column read "time spent on
  // this prompt" rather than "time between prompts."
  const lastTimestampByPromptId: Record<string, number> = {}
  for (const [uuid, line] of lineIndex) {
    if (line.timestamp === 0) continue
    let cursor: string | null = uuid
    let steps = 0
    while (cursor && steps < maxWalkSteps) {
      const node = lineIndex.get(cursor)
      if (!node) break
      if (node.promptId) {
        const cur = lastTimestampByPromptId[node.promptId] ?? 0
        if (line.timestamp > cur) lastTimestampByPromptId[node.promptId] = line.timestamp
        break
      }
      cursor = node.parentUuid
      steps += 1
    }
  }

  return {
    calls: [...callMap.values()],
    prompts,
    firstTimestamp: firstTimestamp === Infinity ? 0 : firstTimestamp,
    lastTimestamp,
    toolCount,
    lastTimestampByPromptId,
    toolUses,
    toolResults,
    userPromptUuids,
  }
}

// ── Public entrypoint ─────────────────────────────────────────────

/**
 * Parse the main Claude Code session jsonl plus every subagent jsonl
 * discovered in `<dirname(mainJsonl)>/<basename(mainJsonl) without .jsonl>/subagents/`.
 * Each subagent has `agent-<agentId>.jsonl` + a sibling `agent-<agentId>.meta.json`
 * with `{agentType, description, toolUseId}`.
 *
 * Discovery is filesystem-driven (not DB-driven) so resumed sessions
 * that ran subagents before the plugin was capturing still get counted.
 *
 * Subagent-level failures (EACCES, parse errors) populate `errors[]` and
 * are skipped — they don't fail the whole parse. ENOENT on the subagents
 * dir is silent (a session with no subagents simply has no directory).
 */
export async function parseClaudeSession(mainJsonlPath: string): Promise<AgentParseResult> {
  const main = await parseJsonlFile(mainJsonlPath)

  const subagentsDir = mainJsonlPath.replace(/\.jsonl$/, '') + '/subagents'
  const errors: TranscriptParseError[] = []
  const subagents: TranscriptSubagent[] = []
  const subagentParses: JsonlParseResult[] = []

  let dirEntries: string[] = []
  try {
    dirEntries = await fsp.readdir(subagentsDir)
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      errors.push({
        scope: 'main',
        code: 'unreadable',
        message: `Subagents directory unreadable: ${err?.message ?? String(err)}`,
      })
    }
  }

  const agentIds = dirEntries
    .filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'))
    .map((f) => f.slice('agent-'.length, -'.jsonl'.length))

  for (const agentId of agentIds) {
    const jsonlPath = `${subagentsDir}/agent-${agentId}.jsonl`
    const metaPath = `${subagentsDir}/agent-${agentId}.meta.json`

    // Read meta first — independent of jsonl existence. Some subagents
    // have a .meta.json without a .jsonl (older agents whose transcripts
    // were pruned, etc.).
    let meta: { agentType: string | null; description: string | null; toolUseId: string | null } = {
      agentType: null,
      description: null,
      toolUseId: null,
    }
    try {
      const metaRaw = await fsp.readFile(metaPath, 'utf8')
      const parsedMeta = JSON.parse(metaRaw)
      meta = {
        agentType: typeof parsedMeta.agentType === 'string' ? parsedMeta.agentType : null,
        description: typeof parsedMeta.description === 'string' ? parsedMeta.description : null,
        toolUseId: typeof parsedMeta.toolUseId === 'string' ? parsedMeta.toolUseId : null,
      }
    } catch {
      // Meta missing or malformed — keep nulls.
    }

    let parsed: JsonlParseResult | null = null
    try {
      parsed = await parseJsonlFile(jsonlPath)
    } catch (err: any) {
      if (err?.code === 'EACCES') {
        errors.push({
          scope: 'subagent',
          agentId,
          code: 'unreadable',
          message: err.message,
        })
      } else {
        errors.push({
          scope: 'subagent',
          agentId,
          code: 'parse_error',
          message: err?.message ?? String(err),
        })
      }
    }

    // Skip agents that produced no LLM activity (no calls === no
    // tokens, no duration, no tools). The load failure (if any) stays
    // in `errors[]` for diagnostics.
    const row = buildSubagentRow(agentId, meta, parsed)
    if (row.requests === 0) continue
    subagents.push(row)
    if (parsed) subagentParses.push(parsed)
  }

  const toolAggregate = aggregateToolStats([main, ...subagentParses])

  return {
    calls: main.calls,
    prompts: main.prompts,
    lastTimestampByPromptId: main.lastTimestampByPromptId,
    subagents,
    errors,
    startedAt: main.firstTimestamp > 0 ? main.firstTimestamp : null,
    durationMs:
      main.firstTimestamp > 0 && main.lastTimestamp > main.firstTimestamp
        ? main.lastTimestamp - main.firstTimestamp
        : null,
    toolCalls: toolAggregate.toolCalls,
    filesRead: toolAggregate.filesRead,
    filesEdited: toolAggregate.filesEdited,
    gitCommits: toolAggregate.gitCommits,
    toolStats: toolAggregate.toolStats,
    // Real user prompts come from the main JSONL only — subagent
    // JSONLs synthesize "user" lines for the parent's Agent tool
    // invocation, not user keystrokes.
    userPrompts: main.userPromptUuids.size,
  }
}

const GIT_COMMIT_REGEX = /\bgit\s+commit\b/

interface ToolAggregateResult {
  toolCalls: number
  filesRead: number
  filesEdited: number
  gitCommits: number
  toolStats: TranscriptToolStat[]
}

/**
 * Combine the main + per-subagent JsonlParseResult lists into a single
 * tool-stats view. tool_use_ids are unique within a session, so the
 * merge across files is straightforward: each id appears in exactly
 * one toolUses map. Pairing with toolResults works the same way for
 * regular tools; for the Agent tool the tool_use is in main and the
 * tool_result is also in main (the subagent's own jsonl carries its
 * internal tool activity but not the parent pairing), which the
 * cross-file merge handles naturally.
 */
function aggregateToolStats(parses: JsonlParseResult[]): ToolAggregateResult {
  const filesRead = new Set<string>()
  const filesEdited = new Set<string>()
  let gitCommits = 0

  // Group durations + names per tool, tracking the longest invocation.
  interface ToolAcc {
    count: number
    durations: number[]
    longestMs: number
    longestId: string | null
  }
  const perTool = new Map<string, ToolAcc>()
  let toolCalls = 0

  // First pass: walk every tool_use; populate file sets, gitCommits,
  // and per-tool counts. We don't compute durations yet — that's a
  // separate pass below so the result merge order doesn't matter.
  for (const p of parses) {
    for (const [, use] of p.toolUses) {
      toolCalls += 1
      if (use.name === 'Read' && use.filePath) filesRead.add(use.filePath)
      else if ((use.name === 'Edit' || use.name === 'Write') && use.filePath) {
        filesEdited.add(use.filePath)
      } else if (use.name === 'Bash' && use.command && GIT_COMMIT_REGEX.test(use.command)) {
        gitCommits += 1
      }
      const acc = perTool.get(use.name) ?? {
        count: 0,
        durations: [],
        longestMs: 0,
        longestId: null,
      }
      acc.count += 1
      perTool.set(use.name, acc)
    }
  }

  // Second pass: pair each tool_use with its tool_result (looked up
  // across every parse since toolUseIds are session-unique). Track
  // per-tool durations + longest.
  const allResults = new Map<string, number>()
  for (const p of parses) for (const [id, ts] of p.toolResults) allResults.set(id, ts)
  for (const p of parses) {
    for (const [id, use] of p.toolUses) {
      const endTs = allResults.get(id)
      if (!endTs || endTs <= use.timestamp) continue
      const dur = endTs - use.timestamp
      const acc = perTool.get(use.name)!
      acc.durations.push(dur)
      if (dur > acc.longestMs) {
        acc.longestMs = dur
        acc.longestId = id
      }
    }
  }

  const toolStats: TranscriptToolStat[] = [...perTool.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, acc]) => {
      const durs = acc.durations.slice().sort((a, b) => a - b)
      const mid = Math.floor(durs.length / 2)
      const median =
        durs.length === 0
          ? null
          : durs.length % 2 === 0
            ? Math.round((durs[mid - 1] + durs[mid]) / 2)
            : durs[mid]
      return {
        name,
        count: acc.count,
        minMs: durs.length > 0 ? durs[0] : null,
        medianMs: median,
        maxMs: durs.length > 0 ? durs[durs.length - 1] : null,
        longestToolUseId: acc.longestId,
      }
    })

  return {
    toolCalls,
    filesRead: filesRead.size,
    filesEdited: filesEdited.size,
    gitCommits,
    toolStats,
  }
}

function buildSubagentRow(
  agentId: string,
  meta: { agentType: string | null; description: string | null; toolUseId: string | null },
  parsed: JsonlParseResult | null,
): TranscriptSubagent {
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheCreate5mTokens = 0
  let cacheCreate1hTokens = 0
  let model = ''
  const calls = parsed?.calls ?? []
  for (const c of calls) {
    if (!model && c.model) model = c.model
    inputTokens +=
      c.usage.inputTokens +
      c.usage.cacheReadTokens +
      c.usage.cacheCreate5mTokens +
      c.usage.cacheCreate1hTokens
    outputTokens += c.usage.outputTokens
    cacheReadTokens += c.usage.cacheReadTokens
    cacheCreate5mTokens += c.usage.cacheCreate5mTokens
    cacheCreate1hTokens += c.usage.cacheCreate1hTokens
  }
  return {
    agentId,
    agentType: meta.agentType,
    description: meta.description,
    toolUseId: meta.toolUseId,
    model,
    requests: calls.length,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreate5mTokens,
    cacheCreate1hTokens,
    durationMs: parsed ? parsed.lastTimestamp - parsed.firstTimestamp : 0,
    toolCount: parsed?.toolCount ?? 0,
    costCents: null, // populated by parseSessionTranscripts
  }
}
