# Transcript Stats UI Revamp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Stats tab as three collapsible sections (Overview / Tool Usage / Token Usage), parse subagent jsonls in addition to the main, add models.dev pricing with tooltip, widen the modal.

**Architecture:** Server side: refactor `services/transcript-parser.ts` into a `transcript-parser/` directory with agent-class-aware dispatch and a pricing module that caches `models.dev` data. Client side: replace `TokenUsageCard` with `TokenUsageSection` and lift two new sibling sections (Overview, ToolUsage) out of inline JSX in `session-modal.tsx`. Sortable tables and a Radix-tooltip model badge are shared primitives.

**Tech Stack:** Same as v1 — Hono + better-sqlite3 server, React + Zustand + TanStack Query + Radix UI client, Vitest throughout.

**Spec:** `docs/superpowers/specs/2026-05-22-transcript-stats-ui-revamp-design.md`

---

## File Structure

**Create:**
- `app/server/src/transcript-parser/index.ts` — `parseSessionTranscripts(sessionId, store)` entry point.
- `app/server/src/transcript-parser/types.ts` — shared types.
- `app/server/src/transcript-parser/models-pricing.ts` — `models.dev` fetch + cache + lookup.
- `app/server/src/transcript-parser/agents/claude.ts` — main + subagent jsonl parser.
- Tests beside each.
- `app/client/src/components/settings/sections/collapsible-section.tsx` — shared shell.
- `app/client/src/components/settings/sections/overview-section.tsx` — Overview section.
- `app/client/src/components/settings/sections/tool-usage-section.tsx` — Tool Usage section.
- `app/client/src/components/settings/sections/token-usage-section.tsx` — Token Usage section (replaces TokenUsageCard).
- `app/client/src/components/settings/sections/model-badge.tsx` — model badge + tooltip.
- `app/client/src/components/settings/sections/sortable-table.tsx` — generic sortable table.
- Tests beside each.

**Modify:**
- `app/server/src/routes/transcript-stats.ts` — call new entry point, expand error coverage, response shape.
- `app/server/src/routes/transcript-stats.test.ts` — update tests for new response shape.
- `app/client/src/lib/api-client.ts` — update `TranscriptStatsData` to match new shape.
- `app/client/src/components/settings/session-modal.tsx` — restructure `SessionStats`, widen modal, remove old Token Usage (Subagents) block.

**Delete:**
- `app/server/src/services/transcript-parser.ts` — moved into the new directory.
- `app/server/src/services/transcript-parser.test.ts` — moved.
- `app/client/src/components/settings/token-usage-card.tsx` — replaced by `token-usage-section.tsx`.
- `app/client/src/components/settings/token-usage-card.test.tsx` — replaced.

`app/server/src/services/transcript-path.ts` stays where it is — still a pure helper.

---

## Task 1: Move and rename the parser into `transcript-parser/agents/claude.ts`

Restructure the existing v1 parser into the new directory layout. No behavior change yet — pure move + rename. Establishes the layout for Tasks 2–5.

**Files:**
- Move: `app/server/src/services/transcript-parser.ts` → `app/server/src/transcript-parser/agents/claude.ts`
- Move: `app/server/src/services/transcript-parser.test.ts` → `app/server/src/transcript-parser/agents/claude.test.ts`
- Create: `app/server/src/transcript-parser/types.ts`
- Modify: `app/server/src/routes/transcript-stats.ts` (update import path)

- [ ] **Step 1.1: Move and split the file**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
mkdir -p app/server/src/transcript-parser/agents
git mv app/server/src/services/transcript-parser.ts app/server/src/transcript-parser/agents/claude.ts
git mv app/server/src/services/transcript-parser.test.ts app/server/src/transcript-parser/agents/claude.test.ts
```

- [ ] **Step 1.2: Extract types into the shared `types.ts`**

Open the new `app/server/src/transcript-parser/agents/claude.ts`. Cut everything inside the `// ── Types ──` section (interfaces `TranscriptUsage`, `TranscriptCall`, `TranscriptByModel`, `TranscriptSummary`, `TranscriptStats`) and paste into a new file:

```ts
// app/server/src/transcript-parser/types.ts

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

export interface TranscriptByModel extends TranscriptUsage {
  model: string
  calls: number
}

export interface TranscriptSummary {
  totalCalls: number
  byModel: TranscriptByModel[]
}

export interface TranscriptStats {
  source: 'jsonl'
  summary: TranscriptSummary
  calls: TranscriptCall[]
  prompts: Record<string, { text: string; timestamp: number }>
}
```

Add an import to the top of `claude.ts`:

```ts
import type {
  TranscriptStats,
  TranscriptUsage,
  TranscriptCall,
  TranscriptByModel,
  TranscriptSummary,
} from '../types'
```

Update the test file's import accordingly:

```ts
import { parseTranscriptFile } from './claude'
```

- [ ] **Step 1.3: Update route import**

In `app/server/src/routes/transcript-stats.ts`, change the import:

```ts
// from
import { parseTranscriptFile } from '../services/transcript-parser'
// to
import { parseTranscriptFile } from '../transcript-parser/agents/claude'
```

- [ ] **Step 1.4: Run tests, confirm pass**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe/app/server
npx vitest run --no-coverage 2>&1 | tail -15
```

Expected: all server tests pass; nothing has changed behaviorally.

- [ ] **Step 1.5: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add -A app/server/src/transcript-parser app/server/src/services app/server/src/routes/transcript-stats.ts
git commit -m "refactor: move transcript parser into transcript-parser/ directory"
```

---

## Task 2: Add subagent jsonl parsing in `agents/claude.ts`

Extend the claude parser to also discover and parse each subagent's jsonl. Subagent paths are derived from the main session's container path: `<dirname of main jsonl>/<basename of main jsonl, no .jsonl extension>/subagents/agent-<agentId>.jsonl`. Aggregate per-subagent usage + meta.

**Files:**
- Modify: `app/server/src/transcript-parser/agents/claude.ts`
- Modify: `app/server/src/transcript-parser/types.ts`
- Modify: `app/server/src/transcript-parser/agents/claude.test.ts`

- [ ] **Step 2.1: Add Subagent types**

Append to `transcript-parser/types.ts`:

```ts
export interface TranscriptSubagent {
  agentId: string
  agentType: string | null            // from .meta.json
  description: string | null          // from .meta.json
  toolUseId: string | null            // from .meta.json — links to spawning PreToolUse:Agent event
  model: string                       // first non-empty model from the subagent's assistant lines
  requests: number                    // distinct message.id count
  inputTokens: number                 // bundled (input + cache_read + cache_create)
  outputTokens: number
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
  durationMs: number                  // last - first event timestamp in this subagent's jsonl
  toolCount: number                   // count of tool_use blocks across assistant lines
}

export interface TranscriptParseError {
  scope: 'main' | 'subagent'
  agentId?: string
  code: 'missing' | 'unreadable' | 'parse_error'
  message: string
}

export interface AgentParseResult {
  /** Main-agent calls (deduped by messageId). */
  calls: TranscriptCall[]
  /** Originating prompts from the main jsonl. */
  prompts: Record<string, { text: string; timestamp: number }>
  /** Per-subagent rollups. */
  subagents: TranscriptSubagent[]
  /** Partial failures (missing subagent jsonl, etc). */
  errors: TranscriptParseError[]
}
```

- [ ] **Step 2.2: Add failing tests for subagent parsing**

Append to `app/server/src/transcript-parser/agents/claude.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseClaudeSession } from './claude'

// Helper to write a tiny subagent jsonl + meta in the expected layout.
function writeSubagent(
  mainTranscriptPath: string,
  agentId: string,
  meta: { agentType: string; description: string; toolUseId: string },
  assistantLines: Array<{ model: string; usage: any; content: any[]; ts: string }>,
) {
  const dir = mainTranscriptPath.replace(/\.jsonl$/, '') + '/subagents'
  mkdirSync(dir, { recursive: true })
  const jsonl = dir + `/agent-${agentId}.jsonl`
  const lines = assistantLines.map((a, i) => ({
    type: 'assistant',
    uuid: `${agentId}-u${i}`,
    parentUuid: i === 0 ? null : `${agentId}-u${i - 1}`,
    timestamp: a.ts,
    isSidechain: true,
    message: {
      id: `${agentId}-msg${i}`,
      model: a.model,
      stop_reason: 'end_turn',
      usage: a.usage,
      content: a.content,
    },
  }))
  writeFileSync(jsonl, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  writeFileSync(dir + `/agent-${agentId}.meta.json`, JSON.stringify(meta))
}

describe('parseClaudeSession — subagents', () => {
  test('discovers and parses subagent jsonls for the given agentIds', async () => {
    // Reuse the main fixture path from earlier tests (FIXTURE_PATH).
    writeSubagent(
      FIXTURE_PATH,
      'abbbe04b48fa19be8',
      {
        agentType: 'Explore',
        description: 'Explore filter system architecture',
        toolUseId: 'toolu_01L9nccf5aK3cVFpa8VZnyYW',
      },
      [
        {
          model: 'claude-haiku-4-5-20251001',
          ts: '2026-05-22T00:00:10.000Z',
          usage: {
            input_tokens: 5,
            output_tokens: 40,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
            service_tier: 'standard',
          },
          content: [{ type: 'tool_use', id: 'toolu_sub1', name: 'Read' }],
        },
        {
          model: 'claude-haiku-4-5-20251001',
          ts: '2026-05-22T00:00:20.000Z',
          usage: {
            input_tokens: 3,
            output_tokens: 20,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
            service_tier: 'standard',
          },
          content: [{ type: 'text', text: 'done' }],
        },
      ],
    )

    const result = await parseClaudeSession(FIXTURE_PATH, ['abbbe04b48fa19be8'])
    expect(result.subagents).toHaveLength(1)
    const sub = result.subagents[0]
    expect(sub.agentId).toBe('abbbe04b48fa19be8')
    expect(sub.agentType).toBe('Explore')
    expect(sub.description).toBe('Explore filter system architecture')
    expect(sub.toolUseId).toBe('toolu_01L9nccf5aK3cVFpa8VZnyYW')
    expect(sub.model).toBe('claude-haiku-4-5-20251001')
    expect(sub.requests).toBe(2)
    expect(sub.inputTokens).toBe(8) // 5+3
    expect(sub.outputTokens).toBe(60) // 40+20
    expect(sub.toolCount).toBe(1)
    expect(sub.durationMs).toBe(10_000) // 10s
  })

  test('missing subagent jsonl pushes to errors[] without failing the parse', async () => {
    const result = await parseClaudeSession(FIXTURE_PATH, ['nonexistent-id'])
    expect(result.subagents).toHaveLength(0)
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        scope: 'subagent',
        agentId: 'nonexistent-id',
        code: 'missing',
      }),
    )
  })

  test('subagent without .meta.json sibling still parses with null meta fields', async () => {
    // Write only the jsonl, not the meta file.
    const dir = FIXTURE_PATH.replace(/\.jsonl$/, '') + '/subagents'
    mkdirSync(dir, { recursive: true })
    const jsonl = dir + '/agent-orphan.jsonl'
    writeFileSync(
      jsonl,
      JSON.stringify({
        type: 'assistant',
        uuid: 'orphan-u0',
        parentUuid: null,
        timestamp: '2026-05-22T00:00:30.000Z',
        isSidechain: true,
        message: {
          id: 'orphan-msg0',
          model: 'claude-opus-4-7',
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 1,
            output_tokens: 5,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
            service_tier: 'standard',
          },
          content: [{ type: 'text', text: 'ok' }],
        },
      }) + '\n',
    )
    const result = await parseClaudeSession(FIXTURE_PATH, ['orphan'])
    const sub = result.subagents.find((s) => s.agentId === 'orphan')
    expect(sub).toBeDefined()
    expect(sub!.agentType).toBeNull()
    expect(sub!.description).toBeNull()
    expect(sub!.toolUseId).toBeNull()
    expect(sub!.model).toBe('claude-opus-4-7')
  })
})
```

- [ ] **Step 2.3: Run, confirm fail**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe/app/server
npx vitest run --no-coverage src/transcript-parser/agents/claude.test.ts -t "subagents" 2>&1 | tail -10
```

Expected: tests fail — `parseClaudeSession` doesn't exist yet.

- [ ] **Step 2.4: Refactor `claude.ts` to expose `parseClaudeSession`**

Extract the existing `parseTranscriptFile` body into a private helper, then build `parseClaudeSession` on top of it. The new public API:

```ts
import { promises as fsp } from 'node:fs'
import { dirname, basename } from 'node:path'
import type {
  TranscriptStats,
  TranscriptUsage,
  TranscriptCall,
  TranscriptByModel,
  TranscriptSummary,
  TranscriptSubagent,
  TranscriptParseError,
  AgentParseResult,
} from '../types'

/**
 * Parse the main session jsonl plus every subagent jsonl listed in
 * `subagentAgentIds`. Returns per-call + per-prompt + per-subagent
 * rollups along with any partial-failure errors.
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
    let parsed
    try {
      await fsp.access(jsonlPath)
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
      continue
    }

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
  parsed: { calls: TranscriptCall[]; firstTimestamp: number; lastTimestamp: number; toolCount: number },
): TranscriptSubagent {
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheCreate5mTokens = 0
  let cacheCreate1hTokens = 0
  let model = ''
  for (const c of parsed.calls) {
    if (!model && c.model) model = c.model
    inputTokens +=
      c.usage.inputTokens + c.usage.cacheReadTokens + c.usage.cacheCreate5mTokens + c.usage.cacheCreate1hTokens
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
    requests: parsed.calls.length,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreate5mTokens,
    cacheCreate1hTokens,
    durationMs: parsed.lastTimestamp - parsed.firstTimestamp,
    toolCount: parsed.toolCount,
  }
}
```

The `parseJsonlFile` helper is the existing `parseTranscriptFile` body, renamed and made to also return `firstTimestamp`, `lastTimestamp`, `toolCount` alongside `calls` and `prompts`. Restructure the existing function:

```ts
async function parseJsonlFile(filePath: string): Promise<{
  calls: TranscriptCall[]
  prompts: Record<string, { text: string; timestamp: number }>
  firstTimestamp: number
  lastTimestamp: number
  toolCount: number
}> {
  // (existing body of parseTranscriptFile, instrumented to track:
  //   - firstTimestamp: min(timestamp) across all lines
  //   - lastTimestamp: max(timestamp) across all lines
  //   - toolCount: incremented per tool_use content block across assistant lines)
  // Return shape changes from TranscriptStats to the structure above.
}
```

Keep the old `parseTranscriptFile` as a thin wrapper for backward compatibility within this task (it's removed in Task 3 when the route switches to the new entry point):

```ts
export async function parseTranscriptFile(filePath: string): Promise<TranscriptStats> {
  const result = await parseJsonlFile(filePath)
  // Compute summary same as before (main-agent only) for v1 compatibility.
  const byModelMap = new Map<string, TranscriptByModel>()
  for (const c of result.calls) {
    if (c.isSidechain) continue
    const cur = byModelMap.get(c.model) ?? {
      model: c.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreate5mTokens: 0,
      cacheCreate1hTokens: 0,
    }
    cur.calls += 1
    cur.inputTokens += c.usage.inputTokens
    cur.outputTokens += c.usage.outputTokens
    cur.cacheReadTokens += c.usage.cacheReadTokens
    cur.cacheCreate5mTokens += c.usage.cacheCreate5mTokens
    cur.cacheCreate1hTokens += c.usage.cacheCreate1hTokens
    byModelMap.set(c.model, cur)
  }
  return {
    source: 'jsonl',
    summary: {
      totalCalls: result.calls.filter((c) => !c.isSidechain).length,
      byModel: [...byModelMap.values()],
    },
    calls: result.calls,
    prompts: result.prompts,
  }
}
```

- [ ] **Step 2.5: Run, confirm pass**

```bash
npx vitest run --no-coverage src/transcript-parser/agents/claude.test.ts 2>&1 | tail -10
```

Expected: all tests pass (existing + 3 new subagent tests).

- [ ] **Step 2.6: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/server/src/transcript-parser app/server/src/routes
git commit -m "feat: parseClaudeSession parses subagent jsonls with per-subagent rollups"
```

---

## Task 3: Add models pricing module

`transcript-parser/models-pricing.ts` fetches from <https://models.dev/api.json>, caches in-memory with 24-hour TTL, returns a model→pricing map.

**Files:**
- Create: `app/server/src/transcript-parser/models-pricing.ts`
- Create: `app/server/src/transcript-parser/models-pricing.test.ts`

- [ ] **Step 3.1: Add failing tests**

Create `app/server/src/transcript-parser/models-pricing.test.ts`:

```ts
import { describe, test, expect, beforeEach, vi } from 'vitest'

// Provide a representative slice of the models.dev API response.
const MODELS_DEV_FIXTURE = {
  anthropic: {
    models: {
      'claude-opus-4-7': {
        id: 'claude-opus-4-7',
        cost: {
          input: 15,
          output: 75,
          cache_read: 1.5,
          cache_write: 18.75,
        },
      },
      'claude-haiku-4-5': {
        id: 'claude-haiku-4-5',
        cost: {
          input: 1,
          output: 5,
          cache_read: 0.1,
          cache_write: 1.25,
        },
      },
      'gpt-4o': {
        id: 'gpt-4o',
        cost: { input: 5, output: 15 },
      },
    },
  },
}

describe('getModelsPricing', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  test('fetches and returns claude- models only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MODELS_DEV_FIXTURE,
      }),
    )
    const { getModelsPricing } = await import('./models-pricing')
    const map = await getModelsPricing()
    expect(map['claude-opus-4-7']).toBeDefined()
    expect(map['claude-haiku-4-5']).toBeDefined()
    expect(map['gpt-4o']).toBeUndefined()
  })

  test('parses per-million-token rates correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => MODELS_DEV_FIXTURE }))
    const { getModelsPricing } = await import('./models-pricing')
    const map = await getModelsPricing()
    expect(map['claude-opus-4-7']).toMatchObject({
      inputPerM: 15,
      outputPerM: 75,
      cacheReadPerM: 1.5,
    })
  })

  test('returns cached map on second call without re-fetching', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => MODELS_DEV_FIXTURE })
    vi.stubGlobal('fetch', fetchSpy)
    const { getModelsPricing } = await import('./models-pricing')
    await getModelsPricing()
    await getModelsPricing()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('fetch failure with empty cache returns empty map (no throw)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { getModelsPricing } = await import('./models-pricing')
    const map = await getModelsPricing()
    expect(map).toEqual({})
  })

  test('fetch failure with stale cache returns stale data', async () => {
    let callCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount += 1
        if (callCount === 1) return Promise.resolve({ ok: true, json: async () => MODELS_DEV_FIXTURE })
        return Promise.reject(new Error('network down'))
      }),
    )
    const mod = await import('./models-pricing')
    // First call populates cache.
    await mod.getModelsPricing()
    // Force expiry.
    mod._testForceExpiry()
    // Second call: fetch fails, returns stale cache.
    const map = await mod.getModelsPricing()
    expect(map['claude-opus-4-7']).toBeDefined()
  })
})
```

- [ ] **Step 3.2: Run, confirm fail**

```bash
npx vitest run --no-coverage src/transcript-parser/models-pricing.test.ts 2>&1 | tail -10
```

Expected: fail — module doesn't exist.

- [ ] **Step 3.3: Implement**

Create `app/server/src/transcript-parser/models-pricing.ts`:

```ts
export interface ModelPricing {
  inputPerM: number
  outputPerM: number
  cacheReadPerM: number
  cacheCreate5mPerM: number
  cacheCreate1hPerM: number
}

const MODELS_DEV_URL = 'https://models.dev/api.json'
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

let cache: Record<string, ModelPricing> = {}
let cacheTimestamp = 0
let inFlight: Promise<Record<string, ModelPricing>> | null = null

/**
 * Returns a model-id → pricing map. Fetches from models.dev on first
 * call; caches for 24 hours; on fetch failure returns whatever is
 * cached (empty map if nothing yet).
 */
export async function getModelsPricing(): Promise<Record<string, ModelPricing>> {
  const now = Date.now()
  if (cacheTimestamp && now - cacheTimestamp < TTL_MS) {
    return cache
  }
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const res = await fetch(MODELS_DEV_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      cache = extractClaudePricing(body)
      cacheTimestamp = Date.now()
      return cache
    } catch (err) {
      console.warn('[models-pricing] fetch failed, returning cached map:', err)
      return cache
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

function extractClaudePricing(body: any): Record<string, ModelPricing> {
  const out: Record<string, ModelPricing> = {}
  const models = body?.anthropic?.models ?? {}
  for (const [id, raw] of Object.entries(models)) {
    if (typeof id !== 'string' || !id.startsWith('claude-')) continue
    const cost = (raw as any)?.cost
    if (!cost) continue
    const inputPerM = Number(cost.input ?? 0)
    const outputPerM = Number(cost.output ?? 0)
    const cacheReadPerM = Number(cost.cache_read ?? 0)
    const cacheWritePerM = Number(cost.cache_write ?? cost.cache_creation ?? 0)
    // models.dev currently exposes a single `cache_write` rate. Use it
    // for both 5m and 1h until they split (the 1h is typically 1.6× the
    // 5m, but we don't have that distinction yet — same rate for both
    // is a conservative approximation that won't dramatically inflate
    // or deflate cost estimates).
    out[id] = {
      inputPerM,
      outputPerM,
      cacheReadPerM,
      cacheCreate5mPerM: cacheWritePerM,
      cacheCreate1hPerM: cacheWritePerM,
    }
  }
  return out
}

/** Test-only: force the next call to re-fetch. */
export function _testForceExpiry(): void {
  cacheTimestamp = 0
}

/** Test-only: reset cache entirely. */
export function _testReset(): void {
  cache = {}
  cacheTimestamp = 0
  inFlight = null
}
```

- [ ] **Step 3.4: Run, confirm pass**

```bash
npx vitest run --no-coverage src/transcript-parser/models-pricing.test.ts 2>&1 | tail -10
```

Expected: all 5 tests pass.

- [ ] **Step 3.5: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/server/src/transcript-parser/models-pricing.ts app/server/src/transcript-parser/models-pricing.test.ts
git commit -m "feat: models.dev pricing fetch with 24h in-memory cache"
```

---

## Task 4: Entry point + agent-class dispatch + pricing wiring

`transcript-parser/index.ts` exports `parseSessionTranscripts(sessionId, store)`. Looks up agents, dispatches by agent_class, merges results, computes byModel + summary, attaches pricing.

**Files:**
- Create: `app/server/src/transcript-parser/index.ts`
- Create: `app/server/src/transcript-parser/index.test.ts`
- Modify: `app/server/src/transcript-parser/types.ts` — add `TranscriptStatsV2` (the new full response shape).

- [ ] **Step 4.1: Add V2 response type**

Append to `transcript-parser/types.ts`:

```ts
import type { ModelPricing } from './models-pricing'

export interface TranscriptPrompt {
  promptId: string
  text: string
  timestamp: number
  durationMs: number | null
  toolCount: number
  requests: number
  inputTokens: number
  outputTokens: number
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
  totalCalls: number          // main + subagents
  inputTotal: number          // bundled
  outputTotal: number
  cacheHitRate: number        // 0..1
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
```

- [ ] **Step 4.2: Add failing tests**

Create `app/server/src/transcript-parser/index.test.ts`:

```ts
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSessionTranscripts } from './index'
import type { EventStore } from '../storage/types'
import * as pricing from './models-pricing'

beforeEach(() => {
  pricing._testReset()
  // Mock models.dev fetch with known pricing.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        anthropic: {
          models: {
            'claude-opus-4-7': {
              id: 'claude-opus-4-7',
              cost: { input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
            },
          },
        },
      }),
    }),
  )
})

const MAIN_FIXTURE_LINES = [
  {
    type: 'user',
    uuid: 'u1',
    parentUuid: null,
    promptId: 'p1',
    timestamp: '2026-05-22T00:00:00.000Z',
    message: { content: 'hi' },
  },
  {
    type: 'assistant',
    uuid: 'a1',
    parentUuid: 'u1',
    timestamp: '2026-05-22T00:00:01.000Z',
    isSidechain: false,
    message: {
      id: 'msg1',
      model: 'claude-opus-4-7',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        service_tier: 'standard',
      },
      content: [{ type: 'text', text: 'hi' }],
    },
  },
]

function writeMainFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'transcript-stats-v2-'))
  const p = join(dir, 'session.jsonl')
  writeFileSync(p, MAIN_FIXTURE_LINES.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return p
}

function makeStore(opts: { transcriptPath: string | null; agents: Array<{ id: string; agent_class: string }> }): EventStore {
  return {
    getSessionTranscriptPath: async () => opts.transcriptPath,
    getAgentsForSession: async () => opts.agents,
  } as unknown as EventStore
}

describe('parseSessionTranscripts', () => {
  test('aggregates main-only when there are no subagents and attaches pricing', async () => {
    const path = writeMainFixture()
    const store = makeStore({
      transcriptPath: path,
      agents: [{ id: 'main', agent_class: 'claude-code' }],
    })
    const stats = await parseSessionTranscripts('sess1', store)
    expect(stats.source).toBe('jsonl')
    expect(stats.summary.totalCalls).toBe(1)
    expect(stats.byModel).toHaveLength(1)
    expect(stats.byModel[0].model).toBe('claude-opus-4-7')
    // Cost: 1000 input * $15/M + 500 output * $75/M = $0.015 + $0.0375 = $0.0525 = 5 cents (rounded)
    expect(stats.byModel[0].costCents).toBe(5)
    expect(stats.summary.costTotalCents).toBe(5)
    expect(stats.models['claude-opus-4-7']).toBeDefined()
    expect(stats.models['claude-opus-4-7'].pricing).toMatchObject({ inputPerM: 15, outputPerM: 75 })
  })

  test('costCents is null when pricing is missing for any model in scope', async () => {
    // Override fetch to return empty anthropic models.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ anthropic: { models: {} } }) }))
    pricing._testReset()
    const path = writeMainFixture()
    const store = makeStore({
      transcriptPath: path,
      agents: [{ id: 'main', agent_class: 'claude-code' }],
    })
    const stats = await parseSessionTranscripts('sess1', store)
    expect(stats.byModel[0].costCents).toBeNull()
    expect(stats.summary.costTotalCents).toBeNull()
    expect(stats.models['claude-opus-4-7'].pricing).toBeNull()
  })

  test('unsupported agent class adds an entry to errors[] but does not fail', async () => {
    const path = writeMainFixture()
    const store = makeStore({
      transcriptPath: path,
      agents: [
        { id: 'main', agent_class: 'claude-code' },
        { id: 'codex-agent', agent_class: 'codex' },
      ],
    })
    const stats = await parseSessionTranscripts('sess1', store)
    expect(stats.errors).toContainEqual(
      expect.objectContaining({ scope: 'main', code: 'parse_error', message: expect.stringContaining('codex') }),
    )
    // Main parse still succeeds.
    expect(stats.byModel).toHaveLength(1)
  })
})
```

- [ ] **Step 4.3: Run, confirm fail**

```bash
npx vitest run --no-coverage src/transcript-parser/index.test.ts 2>&1 | tail -10
```

Expected: fail — module doesn't exist.

- [ ] **Step 4.4: Implement entry point**

Create `app/server/src/transcript-parser/index.ts`:

```ts
import type { EventStore } from '../storage/types'
import type {
  TranscriptStatsV2,
  TranscriptByModelV2,
  TranscriptPrompt,
  TranscriptSubagent,
  TranscriptParseError,
  TranscriptCall,
} from './types'
import { parseClaudeSession } from './agents/claude'
import { getModelsPricing, type ModelPricing } from './models-pricing'

export type { TranscriptStatsV2 } from './types'

/**
 * Top-level entry: parse the session's main jsonl + all subagent
 * jsonls, attach pricing, return the aggregated stats.
 *
 * The caller (route handler) is responsible for the feature-flag,
 * file-not-found, EACCES, and too-large checks — those happen on
 * the main path *before* this entrypoint is called. This function
 * assumes the main transcript exists and is readable.
 */
export async function parseSessionTranscripts(
  sessionId: string,
  store: EventStore,
  containerTranscriptPath: string,
): Promise<TranscriptStatsV2> {
  const agents = (await store.getAgentsForSession(sessionId)) ?? []
  const errors: TranscriptParseError[] = []

  // Group by agent_class for dispatch. v1: claude-code only.
  const claudeAgents = agents.filter((a) => (a.agent_class ?? 'claude-code') === 'claude-code')
  const otherAgents = agents.filter((a) => (a.agent_class ?? 'claude-code') !== 'claude-code')

  for (const a of otherAgents) {
    errors.push({
      scope: 'main',
      agentId: a.id,
      code: 'parse_error',
      message: `Agent class "${a.agent_class}" not supported for transcript stats yet.`,
    })
  }

  // The first claude agent's id is the session id (main agent). Anything else is a subagent.
  const subagentIds = claudeAgents.map((a) => a.id).filter((id) => id !== sessionId)

  const result = await parseClaudeSession(containerTranscriptPath, subagentIds)
  errors.push(...result.errors)

  // Aggregate models seen across main + subagents.
  const pricingMap = await getModelsPricing()

  const byModel = aggregateByModel(result.calls, result.subagents, pricingMap)
  const prompts = aggregatePrompts(result.calls, result.prompts, result.subagents, pricingMap)
  const subagents = attachSubagentCosts(result.subagents, pricingMap)
  const summary = aggregateSummary(result.calls, subagents, pricingMap)
  const models = buildModelsMap([...byModel.map((m) => m.model)], pricingMap)

  return {
    source: 'jsonl',
    summary,
    byModel,
    prompts,
    subagents,
    models,
    errors,
  }
}

function computeCallCostCents(usage: {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
}, pricing: ModelPricing): number {
  const dollars =
    (usage.inputTokens * pricing.inputPerM +
      usage.outputTokens * pricing.outputPerM +
      usage.cacheReadTokens * pricing.cacheReadPerM +
      usage.cacheCreate5mTokens * pricing.cacheCreate5mPerM +
      usage.cacheCreate1hTokens * pricing.cacheCreate1hPerM) /
    1_000_000
  return Math.round(dollars * 100)
}

function aggregateByModel(
  mainCalls: TranscriptCall[],
  subagents: TranscriptSubagent[],
  pricingMap: Record<string, ModelPricing>,
): TranscriptByModelV2[] {
  const m = new Map<string, TranscriptByModelV2>()
  for (const c of mainCalls) {
    const cur = m.get(c.model) ?? {
      model: c.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreate5mTokens: 0,
      cacheCreate1hTokens: 0,
      costCents: 0,
    }
    cur.calls += 1
    // Bundled input.
    cur.inputTokens +=
      c.usage.inputTokens + c.usage.cacheReadTokens + c.usage.cacheCreate5mTokens + c.usage.cacheCreate1hTokens
    cur.outputTokens += c.usage.outputTokens
    cur.cacheReadTokens += c.usage.cacheReadTokens
    cur.cacheCreate5mTokens += c.usage.cacheCreate5mTokens
    cur.cacheCreate1hTokens += c.usage.cacheCreate1hTokens
    m.set(c.model, cur)
  }
  for (const s of subagents) {
    const cur = m.get(s.model) ?? {
      model: s.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreate5mTokens: 0,
      cacheCreate1hTokens: 0,
      costCents: 0,
    }
    cur.calls += s.requests
    cur.inputTokens += s.inputTokens
    cur.outputTokens += s.outputTokens
    cur.cacheReadTokens += s.cacheReadTokens
    cur.cacheCreate5mTokens += s.cacheCreate5mTokens
    cur.cacheCreate1hTokens += s.cacheCreate1hTokens
    m.set(s.model, cur)
  }
  for (const row of m.values()) {
    const pricing = pricingMap[row.model]
    if (!pricing) {
      row.costCents = null
      continue
    }
    // Note: row.inputTokens here is the BUNDLED total; we need to split
    // it back into the parts to apply pricing correctly. Use the
    // separate cache tokens we tracked above. The "fresh" input slice
    // is total - cache_read - cache_create.
    const fresh = row.inputTokens - row.cacheReadTokens - row.cacheCreate5mTokens - row.cacheCreate1hTokens
    row.costCents = computeCallCostCents(
      {
        inputTokens: fresh,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheCreate5mTokens: row.cacheCreate5mTokens,
        cacheCreate1hTokens: row.cacheCreate1hTokens,
      },
      pricing,
    )
  }
  return [...m.values()]
}

function aggregatePrompts(
  mainCalls: TranscriptCall[],
  promptsIndex: Record<string, { text: string; timestamp: number }>,
  subagents: TranscriptSubagent[],
  pricingMap: Record<string, ModelPricing>,
): TranscriptPrompt[] {
  // Group calls by promptId.
  const buckets = new Map<string, TranscriptCall[]>()
  for (const c of mainCalls) {
    if (!c.promptId) continue
    const arr = buckets.get(c.promptId) ?? []
    arr.push(c)
    buckets.set(c.promptId, arr)
  }
  // Sort prompt ids by their originating prompt timestamp.
  const sortedPromptIds = Object.keys(promptsIndex).sort(
    (a, b) => promptsIndex[a].timestamp - promptsIndex[b].timestamp,
  )

  const out: TranscriptPrompt[] = []
  for (let i = 0; i < sortedPromptIds.length; i++) {
    const promptId = sortedPromptIds[i]
    const promptMeta = promptsIndex[promptId]
    const calls = buckets.get(promptId) ?? []
    let inputTokens = 0
    let outputTokens = 0
    const models = new Set<string>()
    let costCents: number | null = 0
    for (const c of calls) {
      inputTokens +=
        c.usage.inputTokens + c.usage.cacheReadTokens + c.usage.cacheCreate5mTokens + c.usage.cacheCreate1hTokens
      outputTokens += c.usage.outputTokens
      if (c.model) models.add(c.model)
      const pricing = pricingMap[c.model]
      if (!pricing) {
        costCents = null
      } else if (costCents !== null) {
        costCents += computeCallCostCents(
          {
            inputTokens: c.usage.inputTokens,
            outputTokens: c.usage.outputTokens,
            cacheReadTokens: c.usage.cacheReadTokens,
            cacheCreate5mTokens: c.usage.cacheCreate5mTokens,
            cacheCreate1hTokens: c.usage.cacheCreate1hTokens,
          },
          pricing,
        )
      }
    }
    // Attribute subagents to this prompt via toolUseId → find the spawning
    // call by tool_use_id, look up its promptId.
    for (const s of subagents) {
      if (!s.toolUseId) continue
      const owner = mainCalls.find((c) => c.toolUseIds.includes(s.toolUseId!))
      if (!owner || owner.promptId !== promptId) continue
      inputTokens += s.inputTokens
      outputTokens += s.outputTokens
      if (s.model) models.add(s.model)
      const pricing = pricingMap[s.model]
      if (!pricing) {
        costCents = null
      } else if (costCents !== null) {
        const fresh =
          s.inputTokens - s.cacheReadTokens - s.cacheCreate5mTokens - s.cacheCreate1hTokens
        costCents += computeCallCostCents(
          {
            inputTokens: fresh,
            outputTokens: s.outputTokens,
            cacheReadTokens: s.cacheReadTokens,
            cacheCreate5mTokens: s.cacheCreate5mTokens,
            cacheCreate1hTokens: s.cacheCreate1hTokens,
          },
          pricing,
        )
      }
    }
    const nextTimestamp =
      i + 1 < sortedPromptIds.length ? promptsIndex[sortedPromptIds[i + 1]].timestamp : null
    const durationMs = nextTimestamp ? nextTimestamp - promptMeta.timestamp : null

    out.push({
      promptId,
      text: promptMeta.text,
      timestamp: promptMeta.timestamp,
      durationMs,
      toolCount: calls.reduce((sum, c) => sum + c.toolUseIds.length, 0),
      requests: calls.length,
      inputTokens,
      outputTokens,
      models: [...models],
      costCents,
    })
  }
  return out
}

function attachSubagentCosts(
  subagents: TranscriptSubagent[],
  pricingMap: Record<string, ModelPricing>,
): TranscriptSubagent[] {
  // (Subagents already have most numeric fields; this is a no-op for
  // shape but attaches a `costCents` extension via the V2 type cast.)
  return subagents.map((s) => {
    const pricing = pricingMap[s.model]
    let costCents: number | null = null
    if (pricing) {
      const fresh = s.inputTokens - s.cacheReadTokens - s.cacheCreate5mTokens - s.cacheCreate1hTokens
      costCents = computeCallCostCents(
        {
          inputTokens: fresh,
          outputTokens: s.outputTokens,
          cacheReadTokens: s.cacheReadTokens,
          cacheCreate5mTokens: s.cacheCreate5mTokens,
          cacheCreate1hTokens: s.cacheCreate1hTokens,
        },
        pricing,
      )
    }
    return { ...s, costCents } as TranscriptSubagent & { costCents: number | null }
  }) as TranscriptSubagent[]
}

function aggregateSummary(
  mainCalls: TranscriptCall[],
  subagents: TranscriptSubagent[],
  pricingMap: Record<string, ModelPricing>,
): TranscriptStatsV2['summary'] {
  let totalCalls = mainCalls.length
  let inputTotal = 0
  let outputTotal = 0
  let cacheRead = 0
  let costTotalCents: number | null = 0
  for (const c of mainCalls) {
    inputTotal +=
      c.usage.inputTokens + c.usage.cacheReadTokens + c.usage.cacheCreate5mTokens + c.usage.cacheCreate1hTokens
    outputTotal += c.usage.outputTokens
    cacheRead += c.usage.cacheReadTokens
    const pricing = pricingMap[c.model]
    if (!pricing) {
      costTotalCents = null
    } else if (costTotalCents !== null) {
      costTotalCents += computeCallCostCents(c.usage, pricing)
    }
  }
  for (const s of subagents) {
    totalCalls += s.requests
    inputTotal += s.inputTokens
    outputTotal += s.outputTokens
    cacheRead += s.cacheReadTokens
    const sCost = (s as TranscriptSubagent & { costCents: number | null }).costCents
    if (sCost == null) costTotalCents = null
    else if (costTotalCents !== null) costTotalCents += sCost
  }
  return {
    totalCalls,
    inputTotal,
    outputTotal,
    cacheHitRate: inputTotal > 0 ? cacheRead / inputTotal : 0,
    costTotalCents,
  }
}

function buildModelsMap(
  modelIds: string[],
  pricingMap: Record<string, ModelPricing>,
): Record<string, { pricing: ModelPricing | null }> {
  const out: Record<string, { pricing: ModelPricing | null }> = {}
  for (const id of modelIds) {
    out[id] = { pricing: pricingMap[id] ?? null }
  }
  return out
}
```

- [ ] **Step 4.5: Run, confirm pass**

```bash
npx vitest run --no-coverage src/transcript-parser/index.test.ts 2>&1 | tail -10
```

Expected: all 3 tests pass.

- [ ] **Step 4.6: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/server/src/transcript-parser
git commit -m "feat: parseSessionTranscripts entry point with byModel + prompts + subagents + pricing"
```

---

## Task 5: Update route to use the new entry point

Switch `routes/transcript-stats.ts` to call `parseSessionTranscripts` and return the V2 shape. Update tests.

**Files:**
- Modify: `app/server/src/routes/transcript-stats.ts`
- Modify: `app/server/src/routes/transcript-stats.test.ts`

- [ ] **Step 5.1: Update the route**

Open `app/server/src/routes/transcript-stats.ts`. Replace the parse call:

```ts
// from
import { parseTranscriptFile } from '../transcript-parser/agents/claude'
// to
import { parseSessionTranscripts } from '../transcript-parser'
```

Replace the `try { const stats = await parseTranscriptFile(resolved) ... }` block with:

```ts
  try {
    const stats = await parseSessionTranscripts(sessionId, store, resolved)
    return c.json(stats, 200)
  } catch (err: any) {
    if (err?.code === 'EACCES') {
      return c.json(
        {
          error: 'file_unreadable',
          message: `Transcript file exists but is not readable by the server process: ${err.message}`,
        },
        403,
      )
    }
    return c.json({ error: 'parse_error', message: err?.message ?? String(err) }, 500)
  }
```

- [ ] **Step 5.2: Update existing route tests for the new shape**

In `app/server/src/routes/transcript-stats.test.ts`, the "returns 200 with parsed stats when transcript exists" test currently asserts the V1 shape (`body.calls`, `body.prompts.p1.text`). Update to assert the V2 shape:

```ts
  test('returns 200 with parsed stats when transcript exists', async () => {
    const path = writeFixture()
    const app = makeApp({
      getSessionTranscriptPath: async () => path,
      getAgentsForSession: async () => [{ id: 'sess1', agent_class: 'claude-code' }],
    })
    const res = await app.request('/api/sessions/sess1/transcript-stats')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('jsonl')
    expect(body.summary.totalCalls).toBe(1)
    expect(body.byModel).toHaveLength(1)
    expect(body.byModel[0].model).toBe('claude-opus-4-7')
    expect(body.prompts).toEqual(expect.any(Array))
    expect(body.subagents).toEqual(expect.any(Array))
    expect(body.models).toBeDefined()
    expect(body.errors).toEqual(expect.any(Array))
  })
```

The other error-branch tests (disabled / no_transcript / file_not_found / file_unreadable / file_too_large / parse_error) still pass — same code paths.

Update `makeApp` and the mocks to include `getAgentsForSession`:

```ts
function makeApp(store: Partial<EventStore>) {
  const app = new Hono<{ Variables: { store: EventStore } }>()
  app.use('*', async (c, next) => {
    c.set('store', {
      getAgentsForSession: async () => [],
      ...store,
    } as EventStore)
    await next()
  })
  app.route('/api', transcriptStatsRouter)
  return app
}
```

- [ ] **Step 5.3: Stub fetch in this test file so models.dev is mocked**

Add at the top of `routes/transcript-stats.test.ts`, alongside the existing vi.mock for config:

```ts
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        anthropic: {
          models: {
            'claude-opus-4-7': {
              id: 'claude-opus-4-7',
              cost: { input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
            },
          },
        },
      }),
    }),
  )
})
```

- [ ] **Step 5.4: Run, confirm pass**

```bash
npx vitest run --no-coverage src/routes/transcript-stats.test.ts 2>&1 | tail -15
```

Expected: all route tests pass.

- [ ] **Step 5.5: Delete the V1 wrapper from `claude.ts`**

Since the route no longer calls `parseTranscriptFile`, remove its export (and the wrapper body) from `agents/claude.ts`. Keep `parseClaudeSession` and the internal `parseJsonlFile`. Update the v1-only tests that import `parseTranscriptFile` to import and use `parseClaudeSession` instead, or delete them if the behavior is covered by Task 4's tests (it is — both `parseClaudeSession` and `parseSessionTranscripts` exercise the same parsing primitive).

Run tests once more to confirm nothing is left depending on `parseTranscriptFile`:

```bash
npx vitest run --no-coverage 2>&1 | tail -10
```

- [ ] **Step 5.6: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/server/src/routes app/server/src/transcript-parser
git commit -m "feat: route returns V2 transcript stats with subagents + pricing"
```

---

## Task 6: Update client API types and method

Adjust `lib/api-client.ts` so `TranscriptStatsData` matches the V2 shape.

**Files:**
- Modify: `app/client/src/lib/api-client.ts`

- [ ] **Step 6.1: Update types**

Open `app/client/src/lib/api-client.ts`. Find the existing transcript stats type block (search `TranscriptStatsCall`) and replace with:

```ts
export interface TranscriptStatsUsageBundle {
  inputTokens: number          // bundled
  outputTokens: number
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
}

export interface TranscriptStatsByModel extends TranscriptStatsUsageBundle {
  model: string
  calls: number
  costCents: number | null
}

export interface TranscriptStatsPrompt {
  promptId: string
  text: string
  timestamp: number
  durationMs: number | null
  toolCount: number
  requests: number
  inputTokens: number
  outputTokens: number
  models: string[]
  costCents: number | null
}

export interface TranscriptStatsSubagent {
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

export interface TranscriptStatsModelPricing {
  inputPerM: number
  outputPerM: number
  cacheReadPerM: number
  cacheCreate5mPerM: number
  cacheCreate1hPerM: number
}

export interface TranscriptStatsParseError {
  scope: 'main' | 'subagent'
  agentId?: string
  code: 'missing' | 'unreadable' | 'parse_error'
  message: string
}

export interface TranscriptStatsData {
  source: 'jsonl'
  summary: {
    totalCalls: number
    inputTotal: number
    outputTotal: number
    cacheHitRate: number
    costTotalCents: number | null
  }
  byModel: TranscriptStatsByModel[]
  prompts: TranscriptStatsPrompt[]
  subagents: TranscriptStatsSubagent[]
  models: Record<string, { pricing: TranscriptStatsModelPricing | null }>
  errors: TranscriptStatsParseError[]
}

export type TranscriptStatsErrorCode =
  | 'disabled'
  | 'no_transcript'
  | 'file_not_found'
  | 'file_unreadable'
  | 'file_too_large'
  | 'parse_error'
  | 'unknown'

export type TranscriptStatsResponse =
  | { ok: true; status: 200; data: TranscriptStatsData }
  | { ok: false; status: number; error: TranscriptStatsErrorCode; message: string }
```

The `getTranscriptStats` method body is unchanged.

- [ ] **Step 6.2: Confirm typecheck**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe/app/client
npx tsc --noEmit 2>&1 | head -10
```

Expected: type errors in `token-usage-card.tsx` and any test that references old field names (`TranscriptStatsCall`). Those are expected — they're removed in Task 12.

- [ ] **Step 6.3: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/client/src/lib/api-client.ts
git commit -m "feat: client TranscriptStatsData types match V2 server shape"
```

---

## Task 7: `CollapsibleSection` shared component

A bordered section with title and bottom "View details" row. Open/closed state owned by the component.

**Files:**
- Create: `app/client/src/components/settings/sections/collapsible-section.tsx`
- Create: `app/client/src/components/settings/sections/collapsible-section.test.tsx`

- [ ] **Step 7.1: Failing tests**

Create `app/client/src/components/settings/sections/collapsible-section.test.tsx`:

```tsx
import { describe, test, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CollapsibleSection } from './collapsible-section'

describe('CollapsibleSection', () => {
  test('renders preview content but not details by default', () => {
    render(
      <CollapsibleSection title="Overview" preview={<div>preview</div>} details={<div>details</div>} />,
    )
    expect(screen.getByText('preview')).toBeInTheDocument()
    expect(screen.queryByText('details')).not.toBeInTheDocument()
    expect(screen.getByText(/View details/i)).toBeInTheDocument()
  })

  test('expands when "View details" row is clicked', () => {
    render(
      <CollapsibleSection title="Overview" preview={<div>preview</div>} details={<div>details</div>} />,
    )
    fireEvent.click(screen.getByText(/View details/i))
    expect(screen.getByText('details')).toBeInTheDocument()
    expect(screen.getByText(/Hide details/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 7.2: Run, confirm fail**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe/app/client
npx vitest run --no-coverage src/components/settings/sections/collapsible-section.test.tsx 2>&1 | tail -8
```

Expected: fail — module doesn't exist.

- [ ] **Step 7.3: Implement**

Create `app/client/src/components/settings/sections/collapsible-section.tsx`:

```tsx
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export function CollapsibleSection({
  title,
  preview,
  details,
}: {
  title: string
  preview: ReactNode
  details: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-md border border-border mb-3 overflow-hidden">
      <div className="px-4 py-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
        {preview}
        {expanded && <div className="mt-3">{details}</div>}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full border-t border-border/60 py-1.5 text-[11px] text-muted-foreground hover:text-amber-500 hover:bg-muted/30 transition-colors flex items-center justify-center gap-1"
      >
        {expanded ? 'Hide details' : 'View details'}
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
    </div>
  )
}
```

- [ ] **Step 7.4: Run, confirm pass**

```bash
npx vitest run --no-coverage src/components/settings/sections/collapsible-section.test.tsx 2>&1 | tail -8
```

Expected: pass.

- [ ] **Step 7.5: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/client/src/components/settings/sections
git commit -m "feat: CollapsibleSection shared shell for stats sections"
```

---

## Task 8: `ModelBadge` component with tooltip

Renders the badge per spec (claude- stripped, version dashes → dots, date suffix removed, faint effort suffix). Tooltip via Radix.

**Files:**
- Create: `app/client/src/components/settings/sections/model-badge.tsx`
- Create: `app/client/src/components/settings/sections/model-badge.test.tsx`

- [ ] **Step 8.1: Failing tests**

```tsx
// app/client/src/components/settings/sections/model-badge.test.tsx
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ModelBadge, formatModelLabel } from './model-badge'

describe('formatModelLabel', () => {
  test('strips claude- prefix and converts version dashes', () => {
    expect(formatModelLabel('claude-opus-4-7')).toBe('opus-4.7')
  })
  test('strips trailing YYYYMMDD date suffix', () => {
    expect(formatModelLabel('claude-haiku-4-5-20251001')).toBe('haiku-4.5')
  })
  test('returns input unchanged when no claude- prefix', () => {
    expect(formatModelLabel('gpt-4o')).toBe('gpt-4o')
  })
})

describe('ModelBadge', () => {
  test('renders without effort', () => {
    render(<ModelBadge modelId="claude-opus-4-7" />)
    expect(screen.getByText(/opus-4\.7/)).toBeInTheDocument()
  })
  test('renders with effort suffix when provided', () => {
    render(<ModelBadge modelId="claude-opus-4-7" effort="xhigh" />)
    expect(screen.getByText('xhigh')).toBeInTheDocument()
  })
  test('stores full model id for tooltip access', () => {
    render(<ModelBadge modelId="claude-haiku-4-5-20251001" effort="medium" />)
    // Tooltip content lazily renders on hover; assert via data attribute instead.
    expect(screen.getByTestId('model-badge')).toHaveAttribute(
      'data-model-id',
      'claude-haiku-4-5-20251001',
    )
  })
})
```

- [ ] **Step 8.2: Run, confirm fail**

```bash
npx vitest run --no-coverage src/components/settings/sections/model-badge.test.tsx 2>&1 | tail -8
```

- [ ] **Step 8.3: Implement**

```tsx
// app/client/src/components/settings/sections/model-badge.tsx
import * as Tooltip from '@radix-ui/react-tooltip'
import type { TranscriptStatsModelPricing } from '@/lib/api-client'

/**
 * Format a model id for badge display: strip "claude-" prefix,
 * convert version dashes (4-7) to dots (4.7), strip any trailing
 * 8-digit date suffix.
 */
export function formatModelLabel(modelId: string): string {
  let s = modelId
  if (s.startsWith('claude-')) s = s.slice('claude-'.length)
  // Strip trailing -YYYYMMDD
  s = s.replace(/-\d{8}$/, '')
  // Convert version dashes (digit-dash-digit) to dots.
  s = s.replace(/(\d)-(\d)/g, '$1.$2')
  return s
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

export function ModelBadge({
  modelId,
  effort,
  pricing,
}: {
  modelId: string
  effort?: string | null
  pricing?: TranscriptStatsModelPricing | null
}) {
  const label = formatModelLabel(modelId)
  const badge = (
    <span
      data-testid="model-badge"
      data-model-id={modelId}
      className="inline-flex items-center text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-blue-300 cursor-help"
    >
      {label}
      {effort ? <span className="ml-1 text-[9px] text-slate-300">{effort}</span> : null}
    </span>
  )

  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{badge}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            align="start"
            className="bg-popover border border-border rounded-md p-2.5 shadow-lg text-[11px] z-50 max-w-xs"
          >
            <div className="font-mono text-foreground mb-1">{modelId}</div>
            {effort && (
              <div className="text-muted-foreground mb-2">
                Reasoning effort: <span className="text-slate-300">{effort}</span>
              </div>
            )}
            {pricing ? (
              <>
                <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">
                  Pricing · per million tokens
                </div>
                <table className="w-full font-mono text-[11px]">
                  <tbody>
                    <tr>
                      <td className="text-muted-foreground py-0.5">Input</td>
                      <td className="text-right">{fmtUsd(pricing.inputPerM)}</td>
                    </tr>
                    <tr>
                      <td className="text-muted-foreground py-0.5">Output</td>
                      <td className="text-right">{fmtUsd(pricing.outputPerM)}</td>
                    </tr>
                    <tr>
                      <td className="text-muted-foreground py-0.5">Cache read</td>
                      <td className="text-right">{fmtUsd(pricing.cacheReadPerM)}</td>
                    </tr>
                    <tr>
                      <td className="text-muted-foreground py-0.5">Cache write (5m)</td>
                      <td className="text-right">{fmtUsd(pricing.cacheCreate5mPerM)}</td>
                    </tr>
                    <tr>
                      <td className="text-muted-foreground py-0.5">Cache write (1h)</td>
                      <td className="text-right">{fmtUsd(pricing.cacheCreate1hPerM)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-2 text-[9px] italic text-muted-foreground">
                  Pricing from models.dev · refreshed daily
                </div>
              </>
            ) : (
              <div className="text-muted-foreground italic">Pricing not available for this model.</div>
            )}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
```

- [ ] **Step 8.4: Run, confirm pass**

```bash
npx vitest run --no-coverage src/components/settings/sections/model-badge.test.tsx 2>&1 | tail -8
```

- [ ] **Step 8.5: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/client/src/components/settings/sections/model-badge.tsx app/client/src/components/settings/sections/model-badge.test.tsx
git commit -m "feat: ModelBadge with formatted label + Radix pricing tooltip"
```

---

## Task 9: `SortableTable` generic component

A table that owns sort state. Header click toggles direction; clicking a different header moves the active sort there.

**Files:**
- Create: `app/client/src/components/settings/sections/sortable-table.tsx`
- Create: `app/client/src/components/settings/sections/sortable-table.test.tsx`

- [ ] **Step 9.1: Failing tests**

```tsx
// app/client/src/components/settings/sections/sortable-table.test.tsx
import { describe, test, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { SortableTable } from './sortable-table'

type Row = { name: string; cost: number }
const ROWS: Row[] = [
  { name: 'alpha', cost: 100 },
  { name: 'bravo', cost: 50 },
  { name: 'charlie', cost: 200 },
]

const COLUMNS = [
  { key: 'name' as const, label: 'Name', sortType: 'string' as const, render: (r: Row) => r.name },
  {
    key: 'cost' as const,
    label: 'Cost',
    sortType: 'number' as const,
    align: 'right' as const,
    render: (r: Row) => String(r.cost),
  },
]

describe('SortableTable', () => {
  test('default sort applies on initial render', () => {
    render(<SortableTable rows={ROWS} columns={COLUMNS} defaultSort={{ key: 'cost', dir: 'desc' }} />)
    const rows = screen.getAllByRole('row').slice(1) // skip header
    expect(within(rows[0]).getByText('charlie')).toBeInTheDocument()
  })

  test('clicking a column header changes sort to its default direction', () => {
    render(<SortableTable rows={ROWS} columns={COLUMNS} defaultSort={{ key: 'cost', dir: 'desc' }} />)
    fireEvent.click(screen.getByText('Name'))
    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('alpha')).toBeInTheDocument()
  })

  test('clicking the active column toggles direction', () => {
    render(<SortableTable rows={ROWS} columns={COLUMNS} defaultSort={{ key: 'cost', dir: 'desc' }} />)
    fireEvent.click(screen.getByText(/Cost/))
    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('bravo')).toBeInTheDocument()
  })

  test('active header shows direction indicator', () => {
    render(<SortableTable rows={ROWS} columns={COLUMNS} defaultSort={{ key: 'cost', dir: 'desc' }} />)
    expect(screen.getByText(/Cost/).textContent).toContain('▾')
  })
})
```

- [ ] **Step 9.2: Run, confirm fail**

- [ ] **Step 9.3: Implement**

```tsx
// app/client/src/components/settings/sections/sortable-table.tsx
import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SortableColumn<T> {
  key: string
  label: string
  sortType: 'string' | 'number'
  align?: 'left' | 'right'
  render: (row: T) => ReactNode
  /** Optional accessor for sort comparison; defaults to identity render-to-string. */
  sortValue?: (row: T) => string | number
  className?: string
}

export interface SortableTableProps<T> {
  rows: T[]
  columns: SortableColumn<T>[]
  defaultSort: { key: string; dir: 'asc' | 'desc' }
}

export function SortableTable<T>({ rows, columns, defaultSort }: SortableTableProps<T>) {
  const [sort, setSort] = useState(defaultSort)

  const sortedRows = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const accessor = col.sortValue ?? ((r: T) => (col.render(r) as string))
    const sorted = [...rows].sort((a, b) => {
      const av = accessor(a)
      const bv = accessor(b)
      if (col.sortType === 'number') {
        return (Number(av) || 0) - (Number(bv) || 0)
      }
      return String(av).localeCompare(String(bv))
    })
    return sort.dir === 'desc' ? sorted.reverse() : sorted
  }, [rows, columns, sort])

  function onHeaderClick(col: SortableColumn<T>) {
    setSort((cur) => {
      if (cur.key === col.key) {
        return { key: col.key, dir: cur.dir === 'desc' ? 'asc' : 'desc' }
      }
      return { key: col.key, dir: col.sortType === 'number' ? 'desc' : 'asc' }
    })
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground border-b border-border">
          {columns.map((col) => {
            const isActive = col.key === sort.key
            const indicator = isActive ? (sort.dir === 'desc' ? '▾' : '▴') : ''
            return (
              <th
                key={col.key}
                onClick={() => onHeaderClick(col)}
                className={cn(
                  'font-normal py-1.5 px-2 cursor-pointer select-none',
                  col.align === 'right' && 'text-right',
                  isActive && 'text-amber-500',
                  col.className,
                )}
              >
                {col.label}
                {indicator && <span className="ml-1">{indicator}</span>}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody className="font-mono">
        {sortedRows.map((row, i) => (
          <tr key={i} className="border-b border-border/40">
            {columns.map((col) => (
              <td
                key={col.key}
                className={cn('py-1 px-2 text-foreground', col.align === 'right' && 'text-right', col.className)}
              >
                {col.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 9.4: Run, confirm pass**

- [ ] **Step 9.5: Commit**

```bash
git add app/client/src/components/settings/sections/sortable-table.tsx app/client/src/components/settings/sections/sortable-table.test.tsx
git commit -m "feat: SortableTable generic component with click-to-sort headers"
```

---

## Task 10: `OverviewSection`, `ToolUsageSection`

Both wrap `CollapsibleSection`. They consume the same `stats` object (already computed by the existing `computeStats(events)` in session-modal.tsx). Extract that compute step into a shared hook or pass `stats` as a prop.

Since the compute lives in `session-modal.tsx`, the cleanest approach: keep it where it is and pass `stats` as a prop to each new section component.

**Files:**
- Create: `app/client/src/components/settings/sections/overview-section.tsx`
- Create: `app/client/src/components/settings/sections/tool-usage-section.tsx`
- Create: tests for each.

- [ ] **Step 10.1: Create `OverviewSection`**

```tsx
// app/client/src/components/settings/sections/overview-section.tsx
import { CollapsibleSection } from './collapsible-section'
import { StatCard } from '../session-stat-card' // see step 10.3 below
// Or inline a small <StatCard label value /> if no shared one exists yet.

export interface OverviewStats {
  duration: string
  totalEvents: number
  toolCalls: number
  userPrompts: number
  turns: number
  subagentsSpawned: number
  gitCommits: number
  filesTouched: number
  toolSuccessRate: string
  permissionRequests: number
  permissionDenials: number
}

export function OverviewSection({ stats }: { stats: OverviewStats }) {
  const preview = (
    <div className="grid grid-cols-6 gap-2">
      <StatCard label="Duration" value={stats.duration} />
      <StatCard label="Events" value={stats.totalEvents.toLocaleString()} />
      <StatCard label="Tool Calls" value={stats.toolCalls.toLocaleString()} />
      <StatCard label="Prompts" value={stats.userPrompts.toLocaleString()} />
      <StatCard label="Subagents" value={stats.subagentsSpawned.toLocaleString()} />
      <StatCard label="Success" value={stats.toolSuccessRate} />
    </div>
  )
  const details = (
    <>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <StatCard label="Turns" value={stats.turns.toLocaleString()} />
        <StatCard label="Git Commits" value={stats.gitCommits.toLocaleString()} />
        <StatCard label="Files Touched" value={stats.filesTouched.toLocaleString()} />
      </div>
      {(stats.permissionRequests > 0 || stats.permissionDenials > 0) && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
            Permissions
          </div>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Requests" value={stats.permissionRequests.toLocaleString()} />
            <StatCard label="Denials" value={stats.permissionDenials.toLocaleString()} />
          </div>
        </div>
      )}
    </>
  )
  return <CollapsibleSection title="Overview" preview={preview} details={details} />
}
```

- [ ] **Step 10.2: Create `ToolUsageSection`**

```tsx
// app/client/src/components/settings/sections/tool-usage-section.tsx
import { CollapsibleSection } from './collapsible-section'

export interface ToolUsageStats {
  topTools: { name: string; count: number }[]
  toolCalls: number
  longestTool: { name: string; durationMs: number } | null
  // Per-tool durations for the expanded view, populated from events.
  toolDurations: Record<string, { min: number; median: number; max: number; total: number; count: number }>
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

export function ToolUsageSection({ stats }: { stats: ToolUsageStats }) {
  const preview = (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">Top Tools</div>
      <div className="space-y-1 font-mono text-xs">
        {stats.topTools.slice(0, 6).map(({ name, count }) => {
          const pct = stats.toolCalls > 0 ? (count / stats.toolCalls) * 100 : 0
          return (
            <div key={name} className="flex items-center gap-2">
              <span className="w-20 truncate text-muted-foreground">{name}</span>
              <div className="flex-1 h-2 rounded-full bg-muted/50 overflow-hidden">
                <div className="h-full rounded-full bg-primary/40" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-12 text-right text-muted-foreground">{count}</span>
            </div>
          )
        })}
      </div>
      {stats.longestTool && (
        <div className="mt-3 text-xs flex items-center gap-2">
          <span className="text-muted-foreground">Longest tool call:</span>
          <span className="font-mono">{stats.longestTool.name}</span>
          <span className="text-muted-foreground">({formatMs(stats.longestTool.durationMs)})</span>
        </div>
      )}
    </div>
  )
  const details = (
    <table className="w-full text-xs font-mono">
      <thead>
        <tr className="text-muted-foreground border-b border-border">
          <th className="text-left py-1 px-2 font-normal">Tool</th>
          <th className="text-right py-1 px-2 font-normal">Calls</th>
          <th className="text-right py-1 px-2 font-normal">Min</th>
          <th className="text-right py-1 px-2 font-normal">Median</th>
          <th className="text-right py-1 px-2 font-normal">Max</th>
          <th className="text-right py-1 px-2 font-normal">Total</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(stats.toolDurations)
          .sort((a, b) => b[1].count - a[1].count)
          .map(([name, d]) => (
            <tr key={name} className="border-b border-border/40">
              <td className="py-1 px-2">{name}</td>
              <td className="py-1 px-2 text-right">{d.count}</td>
              <td className="py-1 px-2 text-right">{formatMs(d.min)}</td>
              <td className="py-1 px-2 text-right">{formatMs(d.median)}</td>
              <td className="py-1 px-2 text-right">{formatMs(d.max)}</td>
              <td className="py-1 px-2 text-right">{formatMs(d.total)}</td>
            </tr>
          ))}
      </tbody>
    </table>
  )
  return <CollapsibleSection title="Tool Usage" preview={preview} details={details} />
}
```

- [ ] **Step 10.3: Reuse the existing `StatCard`**

In `session-modal.tsx` there's an existing inline `StatCard` component (search for `function StatCard`). Export it for the new sections to import — change its declaration to `export function StatCard(...)` and re-export from a small `app/client/src/components/settings/session-stat-card.tsx`:

```ts
// app/client/src/components/settings/session-stat-card.tsx
export { StatCard } from './session-modal'
```

(Or just inline a tiny `StatCard` in each section if the existing one isn't easily exportable. Match the existing visual treatment.)

- [ ] **Step 10.4: Add a basic smoke test for each**

```tsx
// app/client/src/components/settings/sections/overview-section.test.tsx
import { render, screen } from '@testing-library/react'
import { OverviewSection } from './overview-section'

test('renders preview cards', () => {
  render(
    <OverviewSection
      stats={{
        duration: '2h',
        totalEvents: 100,
        toolCalls: 50,
        userPrompts: 5,
        turns: 10,
        subagentsSpawned: 2,
        gitCommits: 3,
        filesTouched: 8,
        toolSuccessRate: '95%',
        permissionRequests: 0,
        permissionDenials: 0,
      }}
    />,
  )
  expect(screen.getByText('Duration')).toBeInTheDocument()
  expect(screen.getByText('2h')).toBeInTheDocument()
})
```

Similar for `tool-usage-section.test.tsx`.

- [ ] **Step 10.5: Run, confirm pass**

- [ ] **Step 10.6: Commit**

```bash
git add app/client/src/components/settings/sections
git commit -m "feat: OverviewSection + ToolUsageSection with preview/details split"
```

---

## Task 11: `TokenUsageSection` component

The main payload of this revamp. Lives in `app/client/src/components/settings/sections/token-usage-section.tsx`. Uses the new V2 API shape.

**Files:**
- Create: `app/client/src/components/settings/sections/token-usage-section.tsx`
- Create: `app/client/src/components/settings/sections/token-usage-section.test.tsx`

- [ ] **Step 11.1: Failing tests**

```tsx
// app/client/src/components/settings/sections/token-usage-section.test.tsx
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TokenUsageSection } from './token-usage-section'

vi.mock('@/lib/api-client', () => ({ api: { getTranscriptStats: vi.fn() } }))
const mockApi = (await import('@/lib/api-client')) as any

function renderQ(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const OK_DATA = {
  source: 'jsonl' as const,
  summary: { totalCalls: 100, inputTotal: 1_000_000, outputTotal: 50_000, cacheHitRate: 0.95, costTotalCents: 1500 },
  byModel: [
    {
      model: 'claude-opus-4-7',
      calls: 100,
      inputTokens: 1_000_000,
      outputTokens: 50_000,
      cacheReadTokens: 900_000,
      cacheCreate5mTokens: 0,
      cacheCreate1hTokens: 50_000,
      costCents: 1500,
    },
  ],
  prompts: [],
  subagents: [],
  models: { 'claude-opus-4-7': { pricing: { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.5, cacheCreate5mPerM: 18.75, cacheCreate1hPerM: 18.75 } } },
  errors: [],
}

beforeEach(() => {
  vi.clearAllMocks()
})

test('renders 5 metric cards and By Model table on success', async () => {
  mockApi.api.getTranscriptStats.mockResolvedValueOnce({ ok: true, status: 200, data: OK_DATA })
  renderQ(<TokenUsageSection sessionId="s1" />)
  expect(await screen.findByText(/Requests/i)).toBeInTheDocument()
  expect(screen.getByText(/Total Input/i)).toBeInTheDocument()
  expect(screen.getByText(/Total Output/i)).toBeInTheDocument()
  expect(screen.getByText(/Cache Hit/i)).toBeInTheDocument()
  expect(screen.getByText(/Est Cost/i)).toBeInTheDocument()
})

test('renders disabled banner', async () => {
  mockApi.api.getTranscriptStats.mockResolvedValueOnce({
    ok: false,
    status: 404,
    error: 'disabled',
    message: 'feature off',
  })
  renderQ(<TokenUsageSection sessionId="s1" />)
  expect(await screen.findByText(/AGENTS_OBSERVE_TRANSCRIPT_STATS/i)).toBeInTheDocument()
})

test('renders file-not-found banner distinct from disabled', async () => {
  mockApi.api.getTranscriptStats.mockResolvedValueOnce({
    ok: false,
    status: 404,
    error: 'file_not_found',
    message: 'not found',
  })
  renderQ(<TokenUsageSection sessionId="s1" />)
  expect(await screen.findByText(/transcript file not found/i)).toBeInTheDocument()
})
```

- [ ] **Step 11.2: Implement**

```tsx
// app/client/src/components/settings/sections/token-usage-section.tsx
import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { api, type TranscriptStatsErrorCode, type TranscriptStatsData } from '@/lib/api-client'
import { AgentLabel } from '@/components/shared/agent-label'
import type { Agent } from '@/types'
import { CollapsibleSection } from './collapsible-section'
import { ModelBadge } from './model-badge'
import { SortableTable, type SortableColumn } from './sortable-table'

/**
 * Resolves the Agent record by id and renders it via the shared
 * AgentLabel component (slug + per-agent color). Falls back to a
 * monospace short-id when the agent isn't in the agents list.
 */
function AgentLabelByAgentId({ agentId, agents }: { agentId: string; agents: Agent[] }) {
  const agent = agents.find((a) => a.id === agentId)
  if (!agent) {
    return <span className="font-mono text-muted-foreground">{agentId.slice(0, 12)}</span>
  }
  return <AgentLabel agent={agent} />
}

function fmt(n: number): string {
  return n.toLocaleString()
}
function fmtCents(c: number | null): string {
  if (c == null) return '—'
  return `$${(c / 100).toFixed(2)}`
}
function fmtPct(r: number): string {
  return `${(r * 100).toFixed(1)}%`
}

const ERROR_MESSAGES: Record<TranscriptStatsErrorCode, string> = {
  disabled:
    "Session transcript parsing isn't enabled — set AGENTS_OBSERVE_TRANSCRIPT_STATS=1 to see models and token usage.",
  no_transcript:
    'Session transcript not available — models and token usage info not available for this session.',
  file_not_found:
    'Session transcript file not found — models and token usage info not available.',
  file_unreadable:
    "Session transcript exists but isn't readable by the server — check the bind-mount permissions.",
  file_too_large:
    'Session transcript exceeds the 100 MB safety cap — token stats skipped.',
  parse_error: "Couldn't parse this session's transcript — token usage info isn't available.",
  unknown: 'Token usage info is unavailable for this session.',
}

export function TokenUsageSection({ sessionId, agents }: { sessionId: string; agents: Agent[] }) {
  const { data, isLoading } = useQuery({
    queryKey: ['transcript-stats', sessionId],
    queryFn: () => api.getTranscriptStats(sessionId),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })

  if (isLoading || !data) {
    return (
      <CollapsibleSection
        title="Token Usage"
        preview={<div className="text-xs text-muted-foreground italic">Loading…</div>}
        details={null}
      />
    )
  }

  if (!data.ok) {
    return (
      <CollapsibleSection
        title="Token Usage"
        preview={
          <div className="flex items-start gap-2 text-xs text-muted-foreground italic">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{ERROR_MESSAGES[data.error] ?? data.message}</span>
          </div>
        }
        details={null}
      />
    )
  }

  const stats = data.data

  const byModelCols: SortableColumn<TranscriptStatsData['byModel'][number]>[] = [
    {
      key: 'model',
      label: 'Model',
      sortType: 'string',
      render: (r) => <ModelBadge modelId={r.model} pricing={stats.models[r.model]?.pricing} />,
      sortValue: (r) => r.model,
    },
    { key: 'calls', label: 'Requests', sortType: 'number', align: 'right', render: (r) => fmt(r.calls) },
    {
      key: 'input',
      label: 'Input',
      sortType: 'number',
      align: 'right',
      render: (r) => fmt(r.inputTokens),
      sortValue: (r) => r.inputTokens,
    },
    { key: 'output', label: 'Output', sortType: 'number', align: 'right', render: (r) => fmt(r.outputTokens), sortValue: (r) => r.outputTokens },
    {
      key: 'cachePct',
      label: 'Cache %',
      sortType: 'number',
      align: 'right',
      render: (r) =>
        r.inputTokens > 0 ? <span className="text-green-500">{fmtPct(r.cacheReadTokens / r.inputTokens)}</span> : '—',
      sortValue: (r) => (r.inputTokens > 0 ? r.cacheReadTokens / r.inputTokens : 0),
    },
    {
      key: 'cacheRead',
      label: 'Cache read',
      sortType: 'number',
      align: 'right',
      render: (r) => <span className="text-muted-foreground">{fmt(r.cacheReadTokens)}</span>,
      sortValue: (r) => r.cacheReadTokens,
      className: 'border-l border-border/30',
    },
    {
      key: 'cacheWrite',
      label: 'Cache write',
      sortType: 'number',
      align: 'right',
      render: (r) => (
        <span className="text-muted-foreground">{fmt(r.cacheCreate5mTokens + r.cacheCreate1hTokens)}</span>
      ),
      sortValue: (r) => r.cacheCreate5mTokens + r.cacheCreate1hTokens,
    },
    {
      key: 'cost',
      label: 'Est Cost',
      sortType: 'number',
      align: 'right',
      render: (r) => <span className="text-amber-500">{fmtCents(r.costCents)}</span>,
      sortValue: (r) => r.costCents ?? 0,
      className: 'border-l border-border/30',
    },
  ]

  const preview = (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-2">
        <Card label="Requests" value={fmt(stats.summary.totalCalls)} />
        <Card label="Total Input" value={fmt(stats.summary.inputTotal)} />
        <Card label="Total Output" value={fmt(stats.summary.outputTotal)} />
        <Card label="Cache Hit" value={fmtPct(stats.summary.cacheHitRate)} valueClass="text-green-500" />
        <Card label="Est Cost" value={fmtCents(stats.summary.costTotalCents)} valueClass="text-amber-500" />
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mt-2">By Model</div>
      <SortableTable rows={stats.byModel} columns={byModelCols} defaultSort={{ key: 'cost', dir: 'desc' }} />
    </div>
  )

  const details = <DetailsBlock stats={stats} agents={agents} />

  return <CollapsibleSection title="Token Usage" preview={preview} details={details} />
}

function Card({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm ${valueClass ?? 'text-foreground'}`}>{value}</div>
    </div>
  )
}

function DetailsBlock({ stats, agents }: { stats: TranscriptStatsData; agents: Agent[] }) {
  const promptCols: SortableColumn<TranscriptStatsData['prompts'][number]>[] = [
    {
      key: 'prompt',
      label: 'Prompt',
      sortType: 'string',
      render: (r) => <span className="block truncate max-w-[400px]" title={r.text}>{r.text}</span>,
      sortValue: (r) => r.text,
    },
    {
      key: 'duration',
      label: 'Duration',
      sortType: 'number',
      align: 'right',
      render: (r) => (r.durationMs == null ? '—' : formatMs(r.durationMs)),
      sortValue: (r) => r.durationMs ?? 0,
    },
    { key: 'tools', label: 'Tools', sortType: 'number', align: 'right', render: (r) => fmt(r.toolCount), sortValue: (r) => r.toolCount },
    { key: 'requests', label: 'Requests', sortType: 'number', align: 'right', render: (r) => fmt(r.requests), sortValue: (r) => r.requests },
    { key: 'input', label: 'Input', sortType: 'number', align: 'right', render: (r) => fmt(r.inputTokens), sortValue: (r) => r.inputTokens },
    { key: 'output', label: 'Output', sortType: 'number', align: 'right', render: (r) => fmt(r.outputTokens), sortValue: (r) => r.outputTokens },
    {
      key: 'models',
      label: 'Model',
      sortType: 'string',
      render: (r) => (
        <span className="flex gap-1">
          {r.models.map((m) => (
            <ModelBadge key={m} modelId={m} pricing={stats.models[m]?.pricing} />
          ))}
        </span>
      ),
      sortValue: (r) => r.models.join(','),
    },
    {
      key: 'cost',
      label: 'Est Cost',
      sortType: 'number',
      align: 'right',
      render: (r) => <span className="text-amber-500">{fmtCents(r.costCents)}</span>,
      sortValue: (r) => r.costCents ?? 0,
    },
  ]

  const subagentCols: SortableColumn<TranscriptStatsData['subagents'][number]>[] = [
    {
      key: 'agentId',
      label: 'Agent',
      sortType: 'string',
      // Render with the existing AgentLabel component so subagent names
      // match the rest of the UI (slug + per-agent color). The label
      // helper resolves the Agent record from the agents store; falls
      // back to the raw id when the agent isn't in the store.
      render: (r) => <AgentLabelByAgentId agentId={r.agentId} agents={agents} />,
      sortValue: (r) => r.agentId,
    },
    { key: 'agentType', label: 'Type', sortType: 'string', render: (r) => <span className="text-blue-300">{r.agentType ?? '—'}</span>, sortValue: (r) => r.agentType ?? '' },
    { key: 'duration', label: 'Duration', sortType: 'number', align: 'right', render: (r) => formatMs(r.durationMs), sortValue: (r) => r.durationMs },
    { key: 'tools', label: 'Tools', sortType: 'number', align: 'right', render: (r) => fmt(r.toolCount), sortValue: (r) => r.toolCount },
    { key: 'requests', label: 'Requests', sortType: 'number', align: 'right', render: (r) => fmt(r.requests), sortValue: (r) => r.requests },
    { key: 'input', label: 'Input', sortType: 'number', align: 'right', render: (r) => fmt(r.inputTokens), sortValue: (r) => r.inputTokens },
    { key: 'output', label: 'Output', sortType: 'number', align: 'right', render: (r) => fmt(r.outputTokens), sortValue: (r) => r.outputTokens },
    { key: 'model', label: 'Model', sortType: 'string', render: (r) => <ModelBadge modelId={r.model} pricing={stats.models[r.model]?.pricing} />, sortValue: (r) => r.model },
    { key: 'cost', label: 'Est Cost', sortType: 'number', align: 'right', render: (r) => <span className="text-amber-500">{fmtCents(r.costCents)}</span>, sortValue: (r) => r.costCents ?? 0 },
  ]

  return (
    <div className="space-y-4 mt-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">By Prompt</div>
        <SortableTable rows={stats.prompts} columns={promptCols} defaultSort={{ key: 'cost', dir: 'desc' }} />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Subagents</div>
        <SortableTable rows={stats.subagents} columns={subagentCols} defaultSort={{ key: 'cost', dir: 'desc' }} />
      </div>
    </div>
  )
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`
}
```

- [ ] **Step 11.3: Run, confirm pass**

```bash
npx vitest run --no-coverage src/components/settings/sections/token-usage-section.test.tsx 2>&1 | tail -10
```

- [ ] **Step 11.4: Commit**

```bash
git add app/client/src/components/settings/sections/token-usage-section.tsx app/client/src/components/settings/sections/token-usage-section.test.tsx
git commit -m "feat: TokenUsageSection with V2 data, sortable tables, model badges, graceful banners"
```

---

## Task 12: Update `session-modal.tsx` to use the three new sections + widen modal

**Files:**
- Modify: `app/client/src/components/settings/session-modal.tsx`
- Delete: `app/client/src/components/settings/token-usage-card.tsx`
- Delete: `app/client/src/components/settings/token-usage-card.test.tsx`

- [ ] **Step 12.1: Replace the SessionStats body**

Find the `function SessionStats` body in `session-modal.tsx`. Replace the inline JSX (grid of StatCards, Permissions block, Top Tools, Longest Tool Call, Token Usage Subagents block, mounted `<TokenUsageCard>`) with:

```tsx
return (
  <div className="px-5 py-4 space-y-3 text-xs overflow-y-auto max-h-[60vh]">
    <OverviewSection
      stats={{
        duration: stats.duration,
        totalEvents: stats.totalEvents,
        toolCalls: stats.toolCalls,
        userPrompts: stats.userPrompts,
        turns: stats.turns,
        subagentsSpawned: stats.subagentsSpawned,
        gitCommits: stats.gitCommits,
        filesTouched: stats.filesTouched,
        toolSuccessRate: stats.toolSuccessRate,
        permissionRequests: stats.permissionRequests,
        permissionDenials: stats.permissionDenials,
      }}
    />
    <ToolUsageSection
      stats={{
        topTools: stats.topTools,
        toolCalls: stats.toolCalls,
        longestTool: stats.longestTool ?? null,
        toolDurations: computeToolDurations(events ?? []),
      }}
    />
    <TokenUsageSection sessionId={sessionId} agents={agents} />
  </div>
)
```

Add the imports at the top of the file:

```ts
import { OverviewSection } from './sections/overview-section'
import { ToolUsageSection } from './sections/tool-usage-section'
import { TokenUsageSection } from './sections/token-usage-section'
```

Remove the old `import { TokenUsageCard } from './token-usage-card'` line.

If `stats.longestTool` doesn't exist on the existing stats shape, fall back to deriving it from `events`. The existing `computeStats(events)` likely already returns this (it's shown as "Agent (23m)" in the screenshot) — re-use whatever field name it uses. If it doesn't exist yet, compute it inline at the call site.

Implement `computeToolDurations(events)` inline (or in a sibling file) that returns the `toolDurations` shape `ToolUsageSection` expects — pairs `PreToolUse` → `PostToolUse` by `tool_use_id`, computes min/median/max/total per tool name.

- [ ] **Step 12.2: Widen the modal**

In the same file, find the `<DialogContent ...>` JSX (it has a width class like `max-w-3xl`). Change to `max-w-6xl`.

- [ ] **Step 12.3: Delete the old TokenUsageCard files**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git rm app/client/src/components/settings/token-usage-card.tsx app/client/src/components/settings/token-usage-card.test.tsx
```

- [ ] **Step 12.4: Run tests**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe/app/client
npx vitest run --no-coverage src/components/settings 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 12.5: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/client/src/components/settings/session-modal.tsx
git commit -m "feat: SessionStats restructured into Overview / Tool Usage / Token Usage sections; widen modal to max-w-6xl"
```

---

## Task 13: End-to-end verification

- [ ] **Step 13.1: Full check**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
just check 2>&1 | tail -8
```

Expected: all tests pass; build succeeds.

- [ ] **Step 13.2: Confirm route disabled-branch still works on running dev server**

```bash
curl -sf http://127.0.0.1:4981/api/health > /dev/null && echo "server up" || echo "SERVER NOT RUNNING"
curl -s "http://127.0.0.1:4981/api/sessions/5faf0a5f-9566-43e8-8483-74bbbba84e73/transcript-stats" | head -c 200
```

Expected: `server up`, then `{"error":"disabled",…}`.

- [ ] **Step 13.3: Report**

Don't restart the user's dev server. Print this:

```
Implementation landed. To see the new Stats tab:

  just stop
  AGENTS_OBSERVE_TRANSCRIPT_STATS=1 just dev

Then open any session → Stats tab. You'll see three sections —
Overview, Tool Usage, Token Usage — each with a "View details ▾"
row at the bottom. Hover any model badge for the pricing tooltip.
```

---

## Out of scope (follow-ups)

- v1.1 pricing for per-effort-tier rates (when models.dev exposes them).
- v1.1 sessions-table token / cost columns for cost-per-session in the Projects view.
- v2 Codex / other agent classes (`transcript-parser/agents/codex.ts`).
- v2 live WebSocket push of token deltas.
- Sub-cent precision in cost display.
- Cumulative session size cap across main + subagent jsonls.
