# Transcript Token Stats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in server endpoint that parses `~/.claude/projects/.../<session>.jsonl` on demand and returns per-call token usage + per-model summary, rendered in the Session Stats tab.

**Architecture:** New pure parser (`transcript-parser.ts`), path-translation helper (`transcript-path.ts`), and Hono route (`routes/transcript-stats.ts`) on the server. Single env flag (`AGENTS_OBSERVE_TRANSCRIPT_STATS`) gates the whole feature; in docker mode the flag also drives a narrow read-only bind mount of `~/.claude/projects`. No DB schema changes — `transcript_path` is already a `sessions` table column. UI adds a `TokenUsageCard` to the existing `SessionStats` component, fetched via React Query with `gcTime: 0`.

**Tech Stack:** TypeScript, Node `node:readline` + `node:fs` for streaming, Hono on the server, React + Zustand + TanStack Query on the client, Vitest throughout. Existing code style: snake_case in DB rows, camelCase in TS types, kebab-case file names.

**Spec:** `docs/superpowers/specs/2026-05-22-transcript-token-stats-design.md`

---

## File Structure

**Create:**
- `app/server/src/services/transcript-path.ts` — `resolveTranscriptPath(hostPath, hostBase, containerBase)`. Pure function, ~30 lines.
- `app/server/src/services/transcript-path.test.ts` — unit tests.
- `app/server/src/services/transcript-parser.ts` — `parseTranscriptFile(filePath)` streams jsonl, returns `TranscriptStats`. ~150 lines.
- `app/server/src/services/transcript-parser.test.ts` — unit tests with hand-rolled jsonl fixture.
- `app/server/src/routes/transcript-stats.ts` — Hono route handler.
- `app/server/src/routes/transcript-stats.test.ts` — integration tests.
- `app/client/src/components/settings/token-usage-card.tsx` — UI card.
- `app/client/src/components/settings/token-usage-card.test.tsx` — UI tests.

**Modify:**
- `hooks/scripts/lib/config.mjs` — add `transcriptStatsEnabled` config field; thread three new env vars through `getServerEnv()`.
- `hooks/scripts/lib/docker.mjs` — conditionally append the bind mount when `transcriptStatsEnabled`.
- `test/hooks/scripts/lib/docker.test.mjs` (or create if missing) — bind-mount conditionality test.
- `app/server/src/config.ts` — surface `transcriptStats` config block (flag + host/container bases).
- `app/server/src/storage/types.ts` + `sqlite-adapter.ts` + `sqlite-adapter.test.ts` — add a focused `getSessionTranscriptPath(sessionId): Promise<string | null>` method (avoids using fat `getSessionById` which does multiple subqueries for `event_count`, `agent_count`, `agent_classes` — unnecessary work on the tab-open path).
- `app/server/src/app.ts` — wire up the new route.
- `app/client/src/lib/api-client.ts` — add `getTranscriptStats(sessionId)`.
- `app/client/src/components/settings/session-modal.tsx` — mount `<TokenUsageCard>` inside `SessionStats`.

---

## Task 1: Server config — feature flag + path env vars

**Files:**
- Modify: `app/server/src/config.ts`

- [ ] **Step 1.1: Add the transcriptStats block to the server config**

Open `app/server/src/config.ts` and add a new section to the exported `config` object **as the last field before the closing `}` of the config literal** (i.e., right after `startupGraceMs: 60_000,`):

```ts
  transcriptStats: {
    enabled: process.env.AGENTS_OBSERVE_TRANSCRIPT_STATS === '1',
    // Strip a single trailing slash on the host base at boot — defensive
    // against users who export HOME with a trailing slash. The runtime
    // comparison expects no trailing slash.
    hostBase: (process.env.AGENTS_OBSERVE_TRANSCRIPT_HOST_BASE || '').replace(/\/$/, ''),
    containerBase: (process.env.AGENTS_OBSERVE_TRANSCRIPT_CONTAINER_BASE || '').replace(/\/$/, ''),
    // 100 MB safety cap — defensive, not an expected operating point.
    maxFileBytes: 100 * 1024 * 1024,
  },
```

- [ ] **Step 1.2: Commit**

```bash
git add app/server/src/config.ts
git commit -m "chore: server config for transcript-stats feature flag"
```

---

## Task 1.5: Storage method — `getSessionTranscriptPath`

The route needs the session's host-side transcript path. The existing `getSessionById` runs three subqueries (event_count, agent_count, agent_classes) that we don't need on every tab open. Add a focused method.

**Files:**
- Modify: `app/server/src/storage/types.ts`
- Modify: `app/server/src/storage/sqlite-adapter.ts`
- Modify: `app/server/src/storage/sqlite-adapter.test.ts`

- [ ] **Step 1.5.1: Add failing test**

Find the existing `getSessionById` test block in `app/server/src/storage/sqlite-adapter.test.ts` (search `getSessionById returns`). Append a new test in the same `describe` block:

```ts
  test('getSessionTranscriptPath returns the transcript_path column or null', async () => {
    const projId = await store.createProject('proj-tp', 'P')
    await store.upsertSession(
      'sess-with-tp',
      projId,
      null,
      null,
      1000,
      '/Users/test/.claude/projects/proj/sess-with-tp.jsonl',
    )
    await store.upsertSession('sess-no-tp', projId, null, null, 1000, null)

    expect(await store.getSessionTranscriptPath('sess-with-tp')).toBe(
      '/Users/test/.claude/projects/proj/sess-with-tp.jsonl',
    )
    expect(await store.getSessionTranscriptPath('sess-no-tp')).toBeNull()
    expect(await store.getSessionTranscriptPath('nonexistent')).toBeNull()
  })
```

(`upsertSession` signature is `(id, projectId, slug, metadata, startedAt, transcriptPath?)` — verify by reading the existing test or `storage/types.ts:76`.)

- [ ] **Step 1.5.2: Run, confirm fail**

```bash
cd app/server && npx vitest run --no-coverage src/storage/sqlite-adapter.test.ts -t "getSessionTranscriptPath" 2>&1 | tail -10
```

Expected: fail — method doesn't exist.

- [ ] **Step 1.5.3: Add to the interface**

In `app/server/src/storage/types.ts`, find the `EventStore` interface (search `getSessionById(sessionId: string)` — around line 113). Add the new method right after `getSessionById`:

```ts
  getSessionTranscriptPath(sessionId: string): Promise<string | null>
```

- [ ] **Step 1.5.4: Implement in SqliteAdapter**

In `app/server/src/storage/sqlite-adapter.ts`, find the existing `getSessionById` method (around line 821). Add the new method directly after it:

```ts
  async getSessionTranscriptPath(sessionId: string): Promise<string | null> {
    const row = this.db
      .prepare(`SELECT transcript_path FROM sessions WHERE id = ?`)
      .get(sessionId) as { transcript_path: string | null } | undefined
    return row?.transcript_path ?? null
  }
```

- [ ] **Step 1.5.5: Run, confirm pass**

```bash
npx vitest run --no-coverage src/storage/sqlite-adapter.test.ts -t "getSessionTranscriptPath" 2>&1 | tail -10
```

Expected: pass.

- [ ] **Step 1.5.6: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/server/src/storage/types.ts app/server/src/storage/sqlite-adapter.ts app/server/src/storage/sqlite-adapter.test.ts
git commit -m "feat: storage.getSessionTranscriptPath — focused query for transcript-stats route"
```

---

## Task 2: `transcript-path` helper

**Files:**
- Create: `app/server/src/services/transcript-path.ts`
- Test: `app/server/src/services/transcript-path.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Create `app/server/src/services/transcript-path.test.ts`:

```ts
import { describe, test, expect } from 'vitest'
import { resolveTranscriptPath } from './transcript-path'

describe('resolveTranscriptPath', () => {
  test('returns input unchanged when both bases empty (local mode)', () => {
    expect(resolveTranscriptPath('/Users/joe/.claude/projects/foo/bar.jsonl', '', '')).toBe(
      '/Users/joe/.claude/projects/foo/bar.jsonl',
    )
  })

  test('returns input unchanged when only one base set', () => {
    expect(
      resolveTranscriptPath(
        '/Users/joe/.claude/projects/foo/bar.jsonl',
        '/Users/joe/.claude/projects',
        '',
      ),
    ).toBe('/Users/joe/.claude/projects/foo/bar.jsonl')
  })

  test('replaces host base prefix with container base', () => {
    expect(
      resolveTranscriptPath(
        '/Users/joe/.claude/projects/foo/bar.jsonl',
        '/Users/joe/.claude/projects',
        '/host/.claude/projects',
      ),
    ).toBe('/host/.claude/projects/foo/bar.jsonl')
  })

  test('exact host-base match maps cleanly', () => {
    expect(
      resolveTranscriptPath(
        '/Users/joe/.claude/projects',
        '/Users/joe/.claude/projects',
        '/host/.claude/projects',
      ),
    ).toBe('/host/.claude/projects')
  })

  test('adjacent-prefix safety: projects-other not translated', () => {
    expect(
      resolveTranscriptPath(
        '/Users/joe/.claude/projects-other/foo.jsonl',
        '/Users/joe/.claude/projects',
        '/host/.claude/projects',
      ),
    ).toBe('/Users/joe/.claude/projects-other/foo.jsonl')
  })

  test('path that does not start with host base is returned unchanged', () => {
    expect(
      resolveTranscriptPath(
        '/tmp/foo.jsonl',
        '/Users/joe/.claude/projects',
        '/host/.claude/projects',
      ),
    ).toBe('/tmp/foo.jsonl')
  })
})
```

- [ ] **Step 2.2: Run tests, confirm they fail**

```bash
cd app/server && npx vitest run --no-coverage src/services/transcript-path.test.ts 2>&1 | tail -10
```

Expected: fail with "Cannot find module './transcript-path'".

- [ ] **Step 2.3: Write the implementation**

Create `app/server/src/services/transcript-path.ts`:

```ts
/**
 * Translate a host-side transcript path into the path the server can
 * read inside its runtime. In docker mode with the transcript-stats
 * feature enabled, we bind-mount `~/.claude/projects` (host) to
 * `/host/.claude/projects` (container). The transcript_path stored in
 * the DB is always the host path; this helper rewrites it for the
 * container.
 *
 * Trailing-slash precision matters: a path equal to the base or one
 * that starts with `${base}/` is translated; everything else passes
 * through. This rejects e.g. `/Users/joe/.claude/projects-other` from
 * matching `/Users/joe/.claude/projects`.
 *
 * Empty bases (local mode) short-circuit to the identity function.
 */
export function resolveTranscriptPath(
  hostPath: string,
  hostBase: string,
  containerBase: string,
): string {
  if (!hostBase || !containerBase) return hostPath
  if (hostPath === hostBase) return containerBase
  if (hostPath.startsWith(hostBase + '/')) {
    return containerBase + hostPath.slice(hostBase.length)
  }
  return hostPath
}
```

- [ ] **Step 2.4: Run tests, confirm pass**

```bash
npx vitest run --no-coverage src/services/transcript-path.test.ts 2>&1 | tail -10
```

Expected: all 6 tests pass.

- [ ] **Step 2.5: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/server/src/services/transcript-path.ts app/server/src/services/transcript-path.test.ts
git commit -m "feat: transcript-path helper for docker bind-mount translation"
```

---

## Task 3: `transcript-parser` — types and shape skeleton

The parser is large enough to split into two TDD passes: shape/dedup first, then parentUuid resolution + prompts map. This task implements the deduped per-call extraction with stub `promptId: null` and empty `prompts`.

**Files:**
- Create: `app/server/src/services/transcript-parser.ts`
- Test: `app/server/src/services/transcript-parser.test.ts`

- [ ] **Step 3.1: Write the failing tests**

Create `app/server/src/services/transcript-parser.test.ts` with a hand-rolled fixture inline:

```ts
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTranscriptFile } from './transcript-parser'

// Hand-rolled jsonl exercising:
//   - assistant lines split across multiple content blocks of the same message.id
//   - tool_use ids unioned from two blocks
//   - parentUuid chain traversing an attachment line
//   - subagent (isSidechain=true) excluded from summary but in calls[]
//   - two distinct models
//   - one originating user prompt with promptId="p1"
const FIXTURE_LINES = [
  // Originating user prompt (string content)
  {
    type: 'user',
    uuid: 'u1',
    parentUuid: null,
    promptId: 'p1',
    sessionId: 's',
    timestamp: '2026-05-22T00:00:00.000Z',
    message: { content: 'hello world' },
  },
  // Attachment line in the parent chain (tests chain traversal)
  {
    type: 'attachment',
    uuid: 'a1',
    parentUuid: 'u1',
    sessionId: 's',
    timestamp: '2026-05-22T00:00:00.500Z',
  },
  // Assistant msg1, block 1 (thinking)
  {
    type: 'assistant',
    uuid: 'as1a',
    parentUuid: 'a1',
    sessionId: 's',
    timestamp: '2026-05-22T00:00:01.000Z',
    isSidechain: false,
    requestId: 'req_aaaa',
    message: {
      id: 'msg1',
      model: 'claude-opus-4-7',
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 10,
        output_tokens: 100,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 20,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 20 },
        service_tier: 'standard',
      },
      content: [{ type: 'thinking', thinking: '' }],
    },
  },
  // Assistant msg1, block 2 (tool_use) — same message.id, same usage object
  {
    type: 'assistant',
    uuid: 'as1b',
    parentUuid: 'as1a',
    sessionId: 's',
    timestamp: '2026-05-22T00:00:01.500Z',
    isSidechain: false,
    requestId: 'req_aaaa',
    message: {
      id: 'msg1',
      model: 'claude-opus-4-7',
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 10,
        output_tokens: 100,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 20,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 20 },
        service_tier: 'standard',
      },
      content: [
        { type: 'tool_use', id: 'toolu_1', name: 'Read' },
        { type: 'tool_use', id: 'toolu_2', name: 'Bash' },
      ],
    },
  },
  // Assistant msg1, block 3 (text) — third duplicate. Verifies that the
  // dedup happens at the message.id level AND that usage isn't summed
  // across blocks. A naive "stamp every line" implementation would
  // tripled-count input_tokens here.
  {
    type: 'assistant',
    uuid: 'as1c',
    parentUuid: 'as1b',
    sessionId: 's',
    timestamp: '2026-05-22T00:00:01.700Z',
    isSidechain: false,
    requestId: 'req_aaaa',
    message: {
      id: 'msg1',
      model: 'claude-opus-4-7',
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 10,
        output_tokens: 100,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 20,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 20 },
        service_tier: 'standard',
      },
      content: [{ type: 'text', text: 'wrap-up' }],
    },
  },
  // Tool-result follow-up user line (propagates promptId)
  {
    type: 'user',
    uuid: 'u2',
    parentUuid: 'as1b',
    promptId: 'p1',
    sessionId: 's',
    timestamp: '2026-05-22T00:00:02.000Z',
    message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
  },
  // Assistant msg2 — different model
  {
    type: 'assistant',
    uuid: 'as2',
    parentUuid: 'u2',
    sessionId: 's',
    timestamp: '2026-05-22T00:00:03.000Z',
    isSidechain: false,
    requestId: 'req_bbbb',
    message: {
      id: 'msg2',
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 5,
        output_tokens: 200,
        cache_read_input_tokens: 60,
        cache_creation_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        service_tier: 'standard',
      },
      content: [{ type: 'text', text: 'done' }],
    },
  },
  // Subagent assistant — must appear in calls[] but NOT in summary
  {
    type: 'assistant',
    uuid: 'as3',
    parentUuid: 'u2',
    sessionId: 's',
    timestamp: '2026-05-22T00:00:04.000Z',
    isSidechain: true,
    requestId: 'req_cccc',
    message: {
      id: 'msg3',
      model: 'claude-haiku-4-5',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 1,
        output_tokens: 50,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        service_tier: 'standard',
      },
      content: [{ type: 'text', text: 'sub' }],
    },
  },
]

const TMP_DIR = mkdtempSync(join(tmpdir(), 'transcript-parser-'))
const FIXTURE_PATH = join(TMP_DIR, 'fixture.jsonl')

beforeAll(() => {
  writeFileSync(FIXTURE_PATH, FIXTURE_LINES.map((l) => JSON.stringify(l)).join('\n') + '\n')
})

afterAll(() => {
  try {
    unlinkSync(FIXTURE_PATH)
  } catch {}
})

describe('parseTranscriptFile — shape and dedup', () => {
  test('summary aggregates main-agent only across models — usage NOT summed across duplicate blocks of the same messageId', async () => {
    const stats = await parseTranscriptFile(FIXTURE_PATH)
    expect(stats.summary.totalCalls).toBe(2) // msg1 + msg2, NOT msg3 (sub), NOT msg1×3
    const byModel = [...stats.summary.byModel].sort((a, b) => a.model.localeCompare(b.model))
    // Opus row: calls === 1 (not 3) and inputTokens === 10 (not 30).
    // Catches a regression where dedup checks messageId presence but
    // still updates usage on every block.
    expect(byModel).toEqual([
      {
        model: 'claude-opus-4-7',
        calls: 1,
        inputTokens: 10,
        outputTokens: 100,
        cacheReadTokens: 50,
        cacheCreate5mTokens: 0,
        cacheCreate1hTokens: 20,
      },
      {
        model: 'claude-sonnet-4-6',
        calls: 1,
        inputTokens: 5,
        outputTokens: 200,
        cacheReadTokens: 60,
        cacheCreate5mTokens: 0,
        cacheCreate1hTokens: 0,
      },
    ])
  })

  test('calls[] deduped by message.id with tool_use ids unioned across blocks', async () => {
    const stats = await parseTranscriptFile(FIXTURE_PATH)
    expect(stats.calls.length).toBe(3) // msg1, msg2, msg3 (subagent included here)
    const msg1 = stats.calls.find((c) => c.messageId === 'msg1')!
    expect(msg1.toolUseIds).toEqual(['toolu_1', 'toolu_2'])
    expect(msg1.model).toBe('claude-opus-4-7')
    expect(msg1.isSidechain).toBe(false)
    expect(msg1.requestId).toBe('req_aaaa')
    expect(msg1.serviceTier).toBe('standard')
    expect(msg1.stopReason).toBe('tool_use')
    expect(msg1.usage).toEqual({
      inputTokens: 10,
      outputTokens: 100,
      cacheReadTokens: 50,
      cacheCreate5mTokens: 0,
      cacheCreate1hTokens: 20,
    })
  })

  test('subagent call present in calls[] but excluded from summary', async () => {
    const stats = await parseTranscriptFile(FIXTURE_PATH)
    const sub = stats.calls.find((c) => c.messageId === 'msg3')!
    expect(sub.isSidechain).toBe(true)
    expect(stats.summary.byModel.some((m) => m.model === 'claude-haiku-4-5')).toBe(false)
  })
})
```

- [ ] **Step 3.2: Run tests, confirm they fail**

```bash
npx vitest run --no-coverage src/services/transcript-parser.test.ts 2>&1 | tail -10
```

Expected: fail with "Cannot find module './transcript-parser'".

- [ ] **Step 3.3: Write the parser**

Create `app/server/src/services/transcript-parser.ts`:

```ts
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

// ── Types ─────────────────────────────────────────────────────────

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

// ── Public entrypoint ─────────────────────────────────────────────

export async function parseTranscriptFile(filePath: string): Promise<TranscriptStats> {
  // First pass: stream the file once. Build:
  //   - the per-call map (dedup by message.id)
  //   - the all-types line index (uuid → IndexedLine) for parentUuid walks
  //   - the originating-prompt map (promptId → {text, timestamp})
  const callMap = new Map<string, TranscriptCall>()
  const lineIndex = new Map<string, IndexedLine>()
  const prompts: Record<string, { text: string; timestamp: number }> = {}

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
          }
        }
      }
      if (existing) {
        // Union tool_use ids across content blocks of the same message
        for (const id of toolUseIds) if (!existing.toolUseIds.includes(id)) existing.toolUseIds.push(id)
      } else {
        callMap.set(msg.id, {
          messageId: msg.id,
          requestId: typeof line.requestId === 'string' ? line.requestId : null,
          timestamp: ts, // first occurrence's timestamp
          model: typeof msg.model === 'string' ? msg.model : '',
          isSidechain: line.isSidechain === true,
          serviceTier: typeof msg.usage?.service_tier === 'string' ? msg.usage.service_tier : null,
          stopReason: typeof msg.stop_reason === 'string' ? msg.stop_reason : null,
          usage: extractUsage(msg.usage),
          toolUseIds,
          promptId: null, // resolved in Task 4
        })
      }
    } else if (line.type === 'user' && line.promptId && line.message) {
      // Originating prompt: content is a string OR content[0].type === 'text'.
      // Tool-result follow-ups have content as an array with first block type=tool_result.
      const content = line.message.content
      let text: string | null = null
      if (typeof content === 'string') {
        text = content
      } else if (Array.isArray(content) && content[0]?.type === 'text' && typeof content[0].text === 'string') {
        text = content[0].text
      }
      if (text !== null && !(line.promptId in prompts)) {
        prompts[line.promptId] = { text, timestamp: ts }
      }
    }
  }

  // Task 4 will walk parentUuid chains to populate call.promptId.

  // Summary: main-agent only.
  const byModelMap = new Map<string, TranscriptByModel>()
  for (const c of callMap.values()) {
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
  const summary: TranscriptSummary = {
    totalCalls: [...callMap.values()].filter((c) => !c.isSidechain).length,
    byModel: [...byModelMap.values()],
  }

  // Reference lineIndex so TS doesn't complain about unused — Task 4 uses it.
  void lineIndex

  return {
    source: 'jsonl',
    summary,
    calls: [...callMap.values()],
    prompts,
  }
}
```

- [ ] **Step 3.4: Run tests, confirm pass**

```bash
npx vitest run --no-coverage src/services/transcript-parser.test.ts 2>&1 | tail -10
```

Expected: all 3 tests pass.

- [ ] **Step 3.5: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/server/src/services/transcript-parser.ts app/server/src/services/transcript-parser.test.ts
git commit -m "feat: transcript jsonl parser with per-call dedup and main-agent summary"
```

---

## Task 4: `transcript-parser` — parentUuid resolution + prompts wiring

**Files:**
- Modify: `app/server/src/services/transcript-parser.ts`
- Test: `app/server/src/services/transcript-parser.test.ts`

- [ ] **Step 4.1: Add failing tests**

Append to `app/server/src/services/transcript-parser.test.ts`:

```ts
describe('parseTranscriptFile — promptId resolution', () => {
  test('walks parentUuid through attachment lines to find promptId', async () => {
    const stats = await parseTranscriptFile(FIXTURE_PATH)
    // msg1 chain: as1b -> as1a -> a1 (attachment) -> u1 (user, promptId=p1)
    const msg1 = stats.calls.find((c) => c.messageId === 'msg1')!
    expect(msg1.promptId).toBe('p1')
  })

  test('resolves promptId via tool_result follow-up user line', async () => {
    const stats = await parseTranscriptFile(FIXTURE_PATH)
    // msg2 chain: as2 -> u2 (tool_result, promptId=p1)
    const msg2 = stats.calls.find((c) => c.messageId === 'msg2')!
    expect(msg2.promptId).toBe('p1')
  })

  test('prompts map contains originating prompt text, not tool_result content', async () => {
    const stats = await parseTranscriptFile(FIXTURE_PATH)
    expect(stats.prompts).toEqual({
      p1: { text: 'hello world', timestamp: Date.parse('2026-05-22T00:00:00.000Z') },
    })
    // Explicit anti-regression: no entry leaks from u2 (tool_result user
    // line that propagates promptId=p1 but isn't an originating prompt).
    expect(Object.keys(stats.prompts).length).toBe(1)
    expect(Object.values(stats.prompts).every((p) => p.text !== 'ok')).toBe(true)
  })
})
```

- [ ] **Step 4.2: Run, confirm fail**

```bash
npx vitest run --no-coverage src/services/transcript-parser.test.ts 2>&1 | tail -10
```

Expected: 3 new tests fail (`msg1.promptId` is null, etc.).

- [ ] **Step 4.3: Implement the walk**

Track each call's starting uuid in a parallel map (cleaner than stashing on the public TranscriptCall object), then walk back via the line index.

In `transcript-parser.ts`, add this local map declaration right after `const callMap = new Map<string, TranscriptCall>()`:

```ts
  // Parallel map: messageId → uuid of the first jsonl line that
  // introduced this call. Used as the starting point for the
  // parentUuid walk below. Kept separate from `callMap` so the public
  // TranscriptCall type stays clean.
  const firstUuidByMessageId = new Map<string, string>()
```

Then find this block:

```ts
      if (existing) {
        // Union tool_use ids across content blocks of the same message
        for (const id of toolUseIds) if (!existing.toolUseIds.includes(id)) existing.toolUseIds.push(id)
      } else {
        callMap.set(msg.id, {
```

And update the `else` branch to also stamp the parallel map. Replace with:

```ts
      if (existing) {
        // Union tool_use ids across content blocks of the same message
        for (const id of toolUseIds) if (!existing.toolUseIds.includes(id)) existing.toolUseIds.push(id)
      } else {
        if (uuid) firstUuidByMessageId.set(msg.id, uuid)
        callMap.set(msg.id, {
```

Now replace the line `// Task 4 will walk parentUuid chains to populate call.promptId.` with the walk:

```ts
  // Resolve promptId for each call by walking parentUuid back through
  // the line index until we hit any line carrying a non-null promptId.
  // Walk traverses every line type (attachments, system lines, etc.)
  // since they appear in real parent chains. Bounded by line count to
  // defend against pathological cycles.
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
```

No changes needed to the `TranscriptCall` interface or the returned `calls` array — the public shape stays exactly as defined in Task 3.

- [ ] **Step 4.4: Run, confirm pass**

```bash
npx vitest run --no-coverage src/services/transcript-parser.test.ts 2>&1 | tail -10
```

Expected: all 6 tests pass.

- [ ] **Step 4.5: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/server/src/services/transcript-parser.ts app/server/src/services/transcript-parser.test.ts
git commit -m "feat: transcript parser resolves promptId via parentUuid walk"
```

---

## Task 5: Route handler

**Files:**
- Create: `app/server/src/routes/transcript-stats.ts`
- Create: `app/server/src/routes/transcript-stats.test.ts`
- Modify: `app/server/src/app.ts`

- [ ] **Step 5.1: Add failing tests**

Create `app/server/src/routes/transcript-stats.test.ts`:

```ts
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { writeFileSync, mkdtempSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventStore } from '../storage/types'

// Use vi.hoisted so the mocked config object is mutable across tests.
// The plain vi.mock factory is evaluated once at module load and
// vi.doMock + dynamic import is unreliable here because the router
// closes over the imported `config` reference. With a hoisted mutable
// object, flipping `transcriptConfig.enabled = false` in a test
// changes what the already-loaded router sees on its next request.
const transcriptConfig = vi.hoisted(() => ({
  enabled: true,
  hostBase: '',
  containerBase: '',
  maxFileBytes: 100 * 1024 * 1024,
}))
vi.mock('../config', () => ({
  config: { transcriptStats: transcriptConfig },
}))

// Import after the mock is set up.
import transcriptStatsRouter from './transcript-stats'

function makeApp(store: Partial<EventStore>) {
  const app = new Hono<{ Variables: { store: EventStore } }>()
  app.use('*', async (c, next) => {
    c.set('store', store as EventStore)
    await next()
  })
  app.route('/api', transcriptStatsRouter)
  return app
}

const MINIMAL_FIXTURE = [
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
        input_tokens: 1,
        output_tokens: 10,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        service_tier: 'standard',
      },
      content: [{ type: 'text', text: 'hi' }],
    },
  },
]

function writeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'transcript-route-'))
  const p = join(dir, 'session.jsonl')
  writeFileSync(p, MINIMAL_FIXTURE.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return p
}

describe('GET /api/sessions/:sessionId/transcript-stats', () => {
  beforeEach(() => {
    // Reset the hoisted mutable config to defaults before each test.
    transcriptConfig.enabled = true
    transcriptConfig.hostBase = ''
    transcriptConfig.containerBase = ''
    transcriptConfig.maxFileBytes = 100 * 1024 * 1024
  })

  test('returns 200 with parsed stats when transcript exists', async () => {
    const path = writeFixture()
    const app = makeApp({
      getSessionTranscriptPath: async () => path,
    })
    const res = await app.request('/api/sessions/sess1/transcript-stats')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('jsonl')
    expect(body.summary.totalCalls).toBe(1)
    expect(body.calls).toHaveLength(1)
    expect(body.calls[0].model).toBe('claude-opus-4-7')
    expect(body.prompts.p1.text).toBe('hi')
  })

  test('returns 404 disabled when feature flag is off', async () => {
    transcriptConfig.enabled = false
    const app = makeApp({
      getSessionTranscriptPath: async () => '/never/reached.jsonl',
    })
    const res = await app.request('/api/sessions/sess1/transcript-stats')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('disabled')
  })

  test('returns 404 no_transcript when session has no transcript_path', async () => {
    const app = makeApp({
      getSessionTranscriptPath: async () => null,
    })
    const res = await app.request('/api/sessions/sess1/transcript-stats')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('no_transcript')
  })

  test('returns 404 file_not_found when transcript file does not exist', async () => {
    const app = makeApp({
      getSessionTranscriptPath: async () => '/nonexistent/foo.jsonl',
    })
    const res = await app.request('/api/sessions/sess1/transcript-stats')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('file_not_found')
  })

  test('returns 413 file_too_large when transcript exceeds cap', async () => {
    transcriptConfig.maxFileBytes = 10
    const path = writeFixture()
    const app = makeApp({
      getSessionTranscriptPath: async () => path,
    })
    const res = await app.request('/api/sessions/sess1/transcript-stats')
    expect(res.status).toBe(413)
    const body = await res.json()
    expect(body.error).toBe('file_too_large')
  })

  test('returns 403 file_unreadable when EACCES (best-effort, skipped if cannot chmod)', async () => {
    const path = writeFixture()
    try {
      chmodSync(path, 0o000)
    } catch {
      return // Some filesystems / CI environments forbid mode 000; skip.
    }
    const app = makeApp({
      getSessionTranscriptPath: async () => path,
    })
    const res = await app.request('/api/sessions/sess1/transcript-stats')
    chmodSync(path, 0o600)
    expect([403, 404]).toContain(res.status)
    const body = await res.json()
    expect(['file_unreadable', 'file_not_found']).toContain(body.error)
  })

  test('returns 500 parse_error when the file contains malformed jsonl that throws', async () => {
    // The current parser swallows JSON.parse errors per-line silently
    // (this is intentional — partial corruption shouldn't fail the
    // whole response). To exercise the parse_error branch, simulate a
    // throw from inside the parser by mocking `parseTranscriptFile`.
    const path = writeFixture()
    vi.doMock('../services/transcript-parser', () => ({
      parseTranscriptFile: async () => {
        throw new Error('boom')
      },
    }))
    // Force re-import of the route so it picks up the mocked parser.
    vi.resetModules()
    const reloaded = (await import('./transcript-stats')).default
    const app = new Hono<{ Variables: { store: EventStore } }>()
    app.use('*', async (c, next) => {
      c.set(
        'store',
        { getSessionTranscriptPath: async () => path } as unknown as EventStore,
      )
      await next()
    })
    app.route('/api', reloaded)
    const res = await app.request('/api/sessions/sess1/transcript-stats')
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('parse_error')
    expect(body.message).toContain('boom')
    vi.doUnmock('../services/transcript-parser')
  })
})
```

- [ ] **Step 5.2: Run, confirm fail (route doesn't exist)**

```bash
npx vitest run --no-coverage src/routes/transcript-stats.test.ts 2>&1 | tail -10
```

Expected: fail with "Cannot find module './transcript-stats'".

- [ ] **Step 5.3: Create the route**

Create `app/server/src/routes/transcript-stats.ts`:

```ts
import { Hono } from 'hono'
import { promises as fs } from 'node:fs'
import type { EventStore } from '../storage/types'
import { config } from '../config'
import { resolveTranscriptPath } from '../services/transcript-path'
import { parseTranscriptFile } from '../services/transcript-parser'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

router.get('/sessions/:sessionId/transcript-stats', async (c) => {
  if (!config.transcriptStats.enabled) {
    return c.json(
      {
        error: 'disabled',
        message:
          'Transcript parsing not enabled. Set AGENTS_OBSERVE_TRANSCRIPT_STATS=1 on the server.',
      },
      404,
    )
  }

  const sessionId = c.req.param('sessionId')
  const store = c.get('store')
  const hostPath = await store.getSessionTranscriptPath(sessionId)
  if (!hostPath) {
    return c.json(
      { error: 'no_transcript', message: 'No transcript path found for session.' },
      404,
    )
  }

  const resolved = resolveTranscriptPath(
    hostPath,
    config.transcriptStats.hostBase,
    config.transcriptStats.containerBase,
  )

  let stat
  try {
    stat = await fs.stat(resolved)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return c.json(
        { error: 'file_not_found', message: 'Transcript file not found.' },
        404,
      )
    }
    if (err?.code === 'EACCES') {
      return c.json(
        {
          error: 'file_unreadable',
          message: `Transcript file exists but is not readable by the server process: ${err.message}`,
        },
        403,
      )
    }
    throw err
  }

  if (stat.size > config.transcriptStats.maxFileBytes) {
    return c.json(
      {
        error: 'file_too_large',
        message: `Transcript file exceeds the ${Math.round(
          config.transcriptStats.maxFileBytes / 1024 / 1024,
        )} MB safety cap.`,
      },
      413,
    )
  }

  try {
    const stats = await parseTranscriptFile(resolved)
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
    return c.json(
      { error: 'parse_error', message: err?.message ?? String(err) },
      500,
    )
  }
})

export default router
```

- [ ] **Step 5.4: Wire the route into app.ts**

Open `app/server/src/app.ts` and add the import alongside the others:

```ts
import transcriptStatsRouter from './routes/transcript-stats'
```

Then add the route registration alongside the others (search for `app.route('/api', filtersRouter)` and add the new line right after it):

```ts
  app.route('/api', filtersRouter)
  app.route('/api', transcriptStatsRouter)
```

- [ ] **Step 5.5: Run, confirm pass**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe/app/server && npx vitest run --no-coverage src/routes/transcript-stats.test.ts 2>&1 | tail -15
```

Expected: all 6 tests pass.

- [ ] **Step 5.6: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/server/src/routes/transcript-stats.ts app/server/src/routes/transcript-stats.test.ts app/server/src/app.ts
git commit -m "feat: transcript-stats route with disabled/not-found/too-large branches"
```

---

## Task 6: Wire env vars + bind mount in docker.mjs / config.mjs

**Files:**
- Modify: `hooks/scripts/lib/config.mjs`
- Modify: `hooks/scripts/lib/docker.mjs`

- [ ] **Step 6.1: Add config field**

In `hooks/scripts/lib/config.mjs`, inside the `return { ... }` object of `getConfig`, add (after the `testSkipPull` line):

```js
    /** When true, the server exposes /api/sessions/:id/transcript-stats and (in docker mode) the container bind-mounts ~/.claude/projects read-only. */
    transcriptStatsEnabled: process.env.AGENTS_OBSERVE_TRANSCRIPT_STATS === '1',
```

- [ ] **Step 6.2: Thread env vars into getServerEnv**

In the same file, inside `getServerEnv(config)`, add three new keys to the returned object. Put them right before the closing `}` of the return:

```js
    AGENTS_OBSERVE_TRANSCRIPT_STATS: config.transcriptStatsEnabled ? '1' : '',
    AGENTS_OBSERVE_TRANSCRIPT_HOST_BASE:
      isDocker && config.transcriptStatsEnabled
        ? resolve(config.homeDir, '.claude/projects')
        : '',
    AGENTS_OBSERVE_TRANSCRIPT_CONTAINER_BASE:
      isDocker && config.transcriptStatsEnabled ? '/host/.claude/projects' : '',
```

(The `resolve` import is already at the top of the file from `import { resolve, dirname } from 'node:path'`.)

- [ ] **Step 6.3: Add the conditional bind mount in docker.mjs**

Open `hooks/scripts/lib/docker.mjs`. Find the `dockerRunArgs` function (around line 178):

```js
  function dockerRunArgs(portMapping) {
    return [
      'run',
      '-d',
      '--name',
      config.containerName,
      '--label',
      `${config.dockerLabel}=${labelValue}`,
      '-p',
      portMapping,
      ...envArgs,
      '-v',
      `${config.dataDir}:/data`,
      config.dockerImage,
    ]
  }
```

Replace with:

```js
  function dockerRunArgs(portMapping) {
    const transcriptMount =
      config.transcriptStatsEnabled && config.homeDir
        ? ['-v', `${config.homeDir}/.claude/projects:/host/.claude/projects:ro`]
        : []
    return [
      'run',
      '-d',
      '--name',
      config.containerName,
      '--label',
      `${config.dockerLabel}=${labelValue}`,
      '-p',
      portMapping,
      ...envArgs,
      '-v',
      `${config.dataDir}:/data`,
      ...transcriptMount,
      config.dockerImage,
    ]
  }
```

- [ ] **Step 6.4: Add a config.test.mjs assertion that the env vars thread through correctly**

`test/hooks/scripts/lib/config.test.mjs` uses vitest. Add a new `describe` block at the bottom of the file:

```js
import { getConfig, getServerEnv } from '../../../../hooks/scripts/lib/config.mjs'

describe('getServerEnv — transcript-stats env vars', () => {
  beforeEach(() => {
    delete process.env.AGENTS_OBSERVE_TRANSCRIPT_STATS
  })
  afterEach(() => {
    delete process.env.AGENTS_OBSERVE_TRANSCRIPT_STATS
  })

  it('omits transcript-stats env vars when feature disabled', () => {
    const env = getServerEnv(getConfig({ runtime: 'docker' }))
    expect(env.AGENTS_OBSERVE_TRANSCRIPT_STATS).toBe('')
    expect(env.AGENTS_OBSERVE_TRANSCRIPT_HOST_BASE).toBe('')
    expect(env.AGENTS_OBSERVE_TRANSCRIPT_CONTAINER_BASE).toBe('')
  })

  it('populates transcript-stats env vars when feature enabled in docker', () => {
    process.env.AGENTS_OBSERVE_TRANSCRIPT_STATS = '1'
    const env = getServerEnv(getConfig({ runtime: 'docker' }))
    expect(env.AGENTS_OBSERVE_TRANSCRIPT_STATS).toBe('1')
    expect(env.AGENTS_OBSERVE_TRANSCRIPT_HOST_BASE).toMatch(/\.claude\/projects$/)
    expect(env.AGENTS_OBSERVE_TRANSCRIPT_CONTAINER_BASE).toBe('/host/.claude/projects')
  })

  it('omits transcript-stats bases in local mode even when enabled', () => {
    process.env.AGENTS_OBSERVE_TRANSCRIPT_STATS = '1'
    const env = getServerEnv(getConfig({ runtime: 'local' }))
    expect(env.AGENTS_OBSERVE_TRANSCRIPT_STATS).toBe('1')
    expect(env.AGENTS_OBSERVE_TRANSCRIPT_HOST_BASE).toBe('')
    expect(env.AGENTS_OBSERVE_TRANSCRIPT_CONTAINER_BASE).toBe('')
  })
})
```

The `getConfig`/`getServerEnv` imports may already be present at the top of the file — re-use them if so.

- [ ] **Step 6.5: Confirm tests pass**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe && npx vitest run --no-coverage test/hooks/scripts/lib/config.test.mjs 2>&1 | tail -10
```

Expected: existing tests + the three new ones all pass.

The docker mount conditionality itself (Task 6.3) is e2e-verified in Task 10 — adding a test for it would require extracting `dockerRunArgs` from its current closure scope in `docker.mjs`, which is out of scope for v1.

- [ ] **Step 6.6: Commit**

```bash
git add hooks/scripts/lib/config.mjs hooks/scripts/lib/docker.mjs test/hooks/scripts/lib/config.test.mjs
git commit -m "feat: transcript-stats env flag + docker bind mount for ~/.claude/projects"
```

---

## Task 7: Client API method

**Files:**
- Modify: `app/client/src/lib/api-client.ts`

- [ ] **Step 7.1: Inspect existing api-client shape**

```bash
head -15 app/client/src/lib/api-client.ts
grep -n "^export const api\|fetchJson" app/client/src/lib/api-client.ts | head -8
```

You're confirming two things:
1. `API_BASE` is imported from `@/config/api` at the top of the file.
2. Most methods are one-liners that call `fetchJson<T>(path)`, which throws `ApiError` on non-2xx.

This endpoint is the exception to that pattern — the body matters on non-200 because the UI renders distinct messages for `disabled` / `no_transcript` / `file_not_found` / `file_unreadable` / `file_too_large` / `parse_error`. We use `fetch` directly and return a discriminated-union response rather than throwing. Document the deviation in a comment.

- [ ] **Step 7.2: Add the method**

Find the last method in the `api` object literal (just before its closing `}`) and add this new entry as the very last property. Don't worry about thematic placement — the file groups by chronology of additions, not topic.

```ts
// Unlike other api.* methods which throw ApiError on non-2xx, this
// endpoint returns a discriminated-union response. The UI maps each
// `error` code to a distinct user-facing message; treating these as
// exceptions would lose that information.
getTranscriptStats: async (sessionId: string): Promise<TranscriptStatsResponse> => {
  const res = await fetch(
    `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/transcript-stats`,
  )
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: (body.error as TranscriptStatsErrorCode) ?? 'unknown',
      message: body.message ?? 'Unknown error',
    }
  }
  return { ok: true, status: 200, data: body as TranscriptStatsData }
},
```

Add the types at the top of the file alongside other exported types (after the existing `import type { … }` block):

```ts
export interface TranscriptStatsUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
}

export interface TranscriptStatsByModel extends TranscriptStatsUsage {
  model: string
  calls: number
}

export interface TranscriptStatsCall {
  messageId: string
  requestId: string | null
  timestamp: number
  model: string
  isSidechain: boolean
  serviceTier: string | null
  stopReason: string | null
  usage: TranscriptStatsUsage
  toolUseIds: string[]
  promptId: string | null
}

export interface TranscriptStatsData {
  source: 'jsonl'
  summary: {
    totalCalls: number
    byModel: TranscriptStatsByModel[]
  }
  calls: TranscriptStatsCall[]
  prompts: Record<string, { text: string; timestamp: number }>
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
  | {
      ok: false
      status: number
      error: TranscriptStatsErrorCode
      message: string
    }
```

- [ ] **Step 7.3: Confirm typecheck still passes**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe/app/client && npx tsc --noEmit 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 7.4: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/client/src/lib/api-client.ts
git commit -m "feat: client api.getTranscriptStats with typed response"
```

---

## Task 8: `<TokenUsageCard>` component

**Files:**
- Create: `app/client/src/components/settings/token-usage-card.tsx`
- Create: `app/client/src/components/settings/token-usage-card.test.tsx`

- [ ] **Step 8.1: Write failing tests**

Create `app/client/src/components/settings/token-usage-card.test.tsx`:

```tsx
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TokenUsageCard } from './token-usage-card'

vi.mock('@/lib/api-client', () => ({
  api: { getTranscriptStats: vi.fn() },
}))

const mockApi = (await import('@/lib/api-client')) as any

function renderWithQuery(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const SUCCESS_DATA = {
  source: 'jsonl' as const,
  summary: {
    totalCalls: 2,
    byModel: [
      {
        model: 'claude-opus-4-7',
        calls: 2,
        inputTokens: 15,
        outputTokens: 300,
        cacheReadTokens: 110,
        cacheCreate5mTokens: 0,
        cacheCreate1hTokens: 20,
      },
    ],
  },
  calls: [],
  prompts: {},
}

describe('TokenUsageCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('renders per-model summary on success', async () => {
    mockApi.api.getTranscriptStats.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: SUCCESS_DATA,
    })
    renderWithQuery(<TokenUsageCard sessionId="s1" />)
    expect(await screen.findByText('claude-opus-4-7')).toBeInTheDocument()
    expect(screen.getByText(/Token Usage/i)).toBeInTheDocument()
  })

  test('renders disabled-state message', async () => {
    mockApi.api.getTranscriptStats.mockResolvedValueOnce({
      ok: false,
      status: 404,
      error: 'disabled',
      message: 'Transcript parsing not enabled.',
    })
    renderWithQuery(<TokenUsageCard sessionId="s1" />)
    expect(await screen.findByText(/not enabled/i)).toBeInTheDocument()
  })

  test('renders file-not-found message', async () => {
    mockApi.api.getTranscriptStats.mockResolvedValueOnce({
      ok: false,
      status: 404,
      error: 'file_not_found',
      message: 'Transcript file not found.',
    })
    renderWithQuery(<TokenUsageCard sessionId="s1" />)
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
  })

  test('renders file-unreadable message distinct from not-found', async () => {
    mockApi.api.getTranscriptStats.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'file_unreadable',
      message: 'Transcript file exists but is not readable.',
    })
    renderWithQuery(<TokenUsageCard sessionId="s1" />)
    expect(await screen.findByText(/not readable/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 8.2: Run, confirm fail**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe/app/client && npx vitest run --no-coverage src/components/settings/token-usage-card.test.tsx 2>&1 | tail -10
```

Expected: fail — module doesn't exist.

- [ ] **Step 8.3: Create the component**

Create `app/client/src/components/settings/token-usage-card.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

function fmt(n: number): string {
  return n.toLocaleString()
}

export function TokenUsageCard({ sessionId }: { sessionId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['transcript-stats', sessionId],
    queryFn: () => api.getTranscriptStats(sessionId),
    // Mirrors the existing SessionStats query (session-modal.tsx:715):
    //   - staleTime: Infinity  — snapshot from tab-open; no refetch on
    //     re-render or refocus
    //   - gcTime: 0            — drop from cache as soon as no
    //     component observes it; closing the modal effectively
    //     unmounts, so reopening triggers a fresh fetch
    //   - refetchOnWindowFocus: false — explicit (app-wide default
    //     already false, but documented locally)
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })

  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="text-xs font-semibold uppercase text-muted-foreground">Token Usage</div>

      {isLoading && <div className="text-xs text-muted-foreground italic">Loading…</div>}

      {data && !data.ok && (
        <div className="text-xs text-muted-foreground italic">{data.message}</div>
      )}

      {data && data.ok && (
        <div className="space-y-1">
          <div className="text-xs">
            <span className="text-muted-foreground">Total calls:</span>{' '}
            <span className="font-mono">{fmt(data.data.summary.totalCalls)}</span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-normal">Model</th>
                <th className="text-right font-normal">Calls</th>
                <th className="text-right font-normal">Input</th>
                <th className="text-right font-normal">Output</th>
                <th className="text-right font-normal">Cache read</th>
                <th className="text-right font-normal">Cache write</th>
              </tr>
            </thead>
            <tbody>
              {data.data.summary.byModel.map((m) => (
                <tr key={m.model}>
                  <td className="font-mono">{m.model}</td>
                  <td className="text-right font-mono">{fmt(m.calls)}</td>
                  <td className="text-right font-mono">{fmt(m.inputTokens)}</td>
                  <td className="text-right font-mono">{fmt(m.outputTokens)}</td>
                  <td className="text-right font-mono">{fmt(m.cacheReadTokens)}</td>
                  <td className="text-right font-mono">
                    {fmt(m.cacheCreate5mTokens + m.cacheCreate1hTokens)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 8.4: Run, confirm pass**

```bash
npx vitest run --no-coverage src/components/settings/token-usage-card.test.tsx 2>&1 | tail -10
```

Expected: all 4 tests pass.

- [ ] **Step 8.5: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/client/src/components/settings/token-usage-card.tsx app/client/src/components/settings/token-usage-card.test.tsx
git commit -m "feat: TokenUsageCard renders per-model summary + error states"
```

---

## Task 9: Mount the card in SessionStats

**Files:**
- Modify: `app/client/src/components/settings/session-modal.tsx`

- [ ] **Step 9.1: Locate SessionStats**

```bash
grep -n "function SessionStats\|SessionStats({" app/client/src/components/settings/session-modal.tsx
```

You'll see the component definition around line 703.

- [ ] **Step 9.2: Mount the card**

Open the file and find the `function SessionStats({ sessionId }: ...)` body. At the bottom of its return JSX (just before the closing tag of its outermost container), add:

```tsx
<TokenUsageCard sessionId={sessionId} />
```

Add the import at the top of the file alongside other settings imports:

```ts
import { TokenUsageCard } from './token-usage-card'
```

- [ ] **Step 9.3: Confirm existing tests still pass**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe/app/client && npx vitest run --no-coverage src/components/settings/session-modal 2>&1 | tail -10
```

Expected: all existing tests pass.

- [ ] **Step 9.4: Commit**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe
git add app/client/src/components/settings/session-modal.tsx
git commit -m "feat: mount TokenUsageCard in SessionStats tab"
```

---

## Task 10: End-to-end verification

- [ ] **Step 10.1: Full check**

```bash
just check
```

Expected: all tests pass, formatting clean.

- [ ] **Step 10.2: Confirm the disabled-state branch on the currently-running server**

The user's dev server is expected to be running without the flag set. First, confirm a server is actually listening — without this precondition check, a connection-refused error from the next curl can be mistakenly interpreted as success.

```bash
curl -sf http://127.0.0.1:4981/api/health > /dev/null && echo "server up" || echo "SERVER NOT RUNNING"
```

Expected: `server up`. If `SERVER NOT RUNNING`, stop here and report — don't proceed; the user needs to start the dev server first.

If the server is up, check the disabled branch:

```bash
curl -s "http://127.0.0.1:4981/api/sessions/5faf0a5f-9566-43e8-8483-74bbbba84e73/transcript-stats" | head -c 200
```

Expected: `{"error":"disabled",…}` and HTTP 404. If you get HTML, a 200, or a 404 with no `error` field, the route isn't wired into `app.ts` — go back to Task 5.

- [ ] **Step 10.3: Document the enable instructions**

Don't restart the user's dev server yourself. Print this snippet at the end of the implementation report so the user can enable the feature on their own:

```
To enable the feature on your dev server, restart it with the flag:

  just stop            # if running
  AGENTS_OBSERVE_TRANSCRIPT_STATS=1 just dev

Then open a session in the dashboard, click Stats, and confirm the
Token Usage card renders below the existing tool-stats card.
```

The implementing agent's responsibility ends at the disabled-branch check in step 10.2 plus the green test suite from step 10.1. Live-server enable is a user action, not part of the plan's automated steps.

---

## Out of scope (follow-ups)

- v1.1 pricing.
- v1.1+ sessions-table token columns for cost-per-session in Projects view.
- v1.x drill-downs: render per-tool-call and per-prompt token attributions using `calls[].toolUseIds` and `calls[].promptId`.
- v2 Codex / non-Claude transcripts (separate route).
- v2 live token push via WebSocket.
