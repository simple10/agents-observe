import { promises as fsp, createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type {
  TranscriptCall,
  TranscriptUsage,
  TranscriptSubagent,
  TranscriptParseError,
  AgentParseResult,
} from '../types'

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
}

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
      const existing = callMap.get(msg.id)
      const toolUseIds: string[] = []
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && block.type === 'tool_use' && typeof block.id === 'string') {
            toolUseIds.push(block.id)
            toolCount += 1
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
    } else if (line.type === 'user' && line.promptId && line.message) {
      const content = line.message.content
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

  return {
    calls: [...callMap.values()],
    prompts,
    firstTimestamp: firstTimestamp === Infinity ? 0 : firstTimestamp,
    lastTimestamp,
    toolCount,
  }
}

// ── Public entrypoint ─────────────────────────────────────────────

/**
 * Parse the main Claude Code session jsonl plus every subagent jsonl
 * for the given agent ids. Subagent jsonls live at
 * `<dirname(mainJsonl)>/<basename(mainJsonl) without .jsonl>/subagents/agent-<agentId>.jsonl`,
 * and each has a sibling `.meta.json` with `{agentType, description, toolUseId}`.
 *
 * Subagent-level failures (missing file, EACCES, parse errors) populate
 * `errors[]` and are skipped — they don't fail the whole parse.
 */
export async function parseClaudeSession(
  mainJsonlPath: string,
  subagentAgentIds: string[],
): Promise<AgentParseResult> {
  const main = await parseJsonlFile(mainJsonlPath)

  const subagentsDir = mainJsonlPath.replace(/\.jsonl$/, '') + '/subagents'
  const errors: TranscriptParseError[] = []
  const subagents: TranscriptSubagent[] = []

  for (const agentId of subagentAgentIds) {
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
      if (err?.code === 'ENOENT') {
        errors.push({
          scope: 'subagent',
          agentId,
          code: 'missing',
          message: `Subagent transcript not found: ${jsonlPath}`,
        })
      } else if (err?.code === 'EACCES') {
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

    // Push the row even when the jsonl couldn't be loaded — agents that
    // exist in the DB but have no transcript on disk still appear in the
    // Agents table with zero stats, so the user sees they exist. The
    // load failure is still surfaced via `errors[]`.
    subagents.push(buildSubagentRow(agentId, meta, parsed))
  }

  return {
    calls: main.calls,
    prompts: main.prompts,
    subagents,
    errors,
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
