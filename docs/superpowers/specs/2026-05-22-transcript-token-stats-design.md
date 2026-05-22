# Transcript Token Stats — Design Spec

**Status:** Draft
**Date:** 2026-05-22
**Branch:** `feat/transcript-token-stats`

## Summary

Claude Code only emits token-usage data via hooks for subagent turns. For the main agent, token usage lives only in the on-disk session transcript (`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`). Users have been asking for main-agent token stats in the Session Stats tab. This spec adds an opt-in server endpoint that parses the relevant session's jsonl on demand and returns per-call usage + a per-model summary, so the UI can render token stats without persisting anything new to the database.

Implementation is deliberately minimal: no DB schema changes, no background indexing, no pricing. Pricing and persistence are flagged for v1.1+.

## Goals

- Render main-agent token usage in the existing Session Stats tab for any session whose `.jsonl` is readable.
- Keep the feature opt-in via a single env flag — users who don't want bind-mounting `~/.claude` into the container can leave it off.
- Preserve the principle that data recreatable from upstream sources stays out of the database.
- Expose enough information per API call (model, usage, `toolUseIds`, originating prompt text) for the UI to join with its in-memory event store and attribute tokens back to specific tool calls or prompts.

## Non-goals (v1)

- Persisting any token data to SQLite. The endpoint parses on demand.
- Pricing / cost computation. Reserved for v1.1+ when we can also surface cost-per-session in the Projects sessions list (which will likely need new sessions-table columns).
- Live streaming / WebSocket push. v1 uses fetch-on-tab-open plus a manual refresh button.
- Codex / non-Claude agent classes. v1 hardcodes the Claude Code transcript layout; the parser sits behind a clear interface so other classes can be added later.
- Server-side caching. Re-parse on every request. Sessions in practice have <1000 assistant lines and parse in milliseconds.

## User experience

The Session Stats tab gains a new "Token Usage" card below the existing tool-stats card. While loading: a small spinner. On success: a per-model summary table plus a refresh button. On failure (file missing, feature disabled, jsonl unreadable): a single-line muted message explaining why ("Token stats unavailable — transcript parsing not enabled" / "Transcript file not found"), with no other side effects on the tab.

Per-call drill-down is **out of scope for v1's UI** but the API returns the data so a follow-up commit can wire it up without changing the wire format.

## Feature flag and path translation

Single user-facing flag:

```
AGENTS_OBSERVE_TRANSCRIPT_STATS=1
```

When set, the feature is enabled. When unset (default), the endpoint returns 404 with `{ disabled: true }` and the UI renders the disabled-state message.

**Local-server mode** (`just dev`, `just start-local`): no mounts needed. The server reads `transcript_path` from the captured hook payload and opens it directly.

**Docker mode** (`just start`): when the flag is set, `hooks/scripts/lib/docker.mjs` adds two things to `docker run`:

1. A read-only bind mount: `-v $HOME/.claude:/host/.claude:ro`.
2. Env vars that tell the server how to translate host paths into the mounted path:
   - `AGENTS_OBSERVE_TRANSCRIPT_HOST_HOME=$HOME` (e.g., `/Users/joe`)
   - `AGENTS_OBSERVE_TRANSCRIPT_CONTAINER_HOME=/host` (always `/host` since we mount `~/.claude` at `/host/.claude`)

Translation rule (server-side): given a `transcript_path` whose value equals `${HOST_HOME}` or starts with `${HOST_HOME}/`, replace that prefix with `${CONTAINER_HOME}` (preserving the slash). The trailing-slash check matters — otherwise `/Users/joe-other/...` would falsely match `/Users/joe`. Other paths are returned unchanged. If translation produces a path that doesn't exist on disk, the endpoint returns a "file not found" failure.

Both env vars are added to `getServerEnv()` in `hooks/scripts/lib/config.mjs`. They're empty strings in local mode (server detects empties and skips translation).

## Data model

No DB schema changes. The endpoint reads:

- `transcript_path` from the most recent hook event for the given session (any `hookName`, since every Claude Code hook payload carries it).
- The `.jsonl` file itself, parsed line-by-line.

## API

### Endpoint

```
GET /api/sessions/:sessionId/transcript-stats
```

### Responses

**Success (200):**

```ts
{
  source: "jsonl",
  summary: {
    totalCalls: number,
    byModel: Array<{
      model: string,                    // e.g. "claude-opus-4-7"
      calls: number,
      inputTokens: number,
      outputTokens: number,
      cacheReadTokens: number,
      cacheCreate5mTokens: number,
      cacheCreate1hTokens: number,
    }>,
  },
  calls: Array<{
    messageId: string,                  // "msg_01..." — stable React key
    timestamp: number,                  // ms epoch from the jsonl line
    model: string,
    isSidechain: boolean,               // false = main agent; true = subagent
    usage: {
      inputTokens: number,
      outputTokens: number,
      cacheReadTokens: number,
      cacheCreate5mTokens: number,
      cacheCreate1hTokens: number,
    },
    toolUseIds: string[],               // links to PreToolUse/PostToolUse event.toolUseId
    originatingPrompt: {                // links to UserPromptSubmit event by text match
      text: string,
      timestamp: number,                // ms epoch of the originating user line
    } | null,
  }>
}
```

**Feature disabled (404):**

```json
{ "error": "disabled", "message": "Transcript parsing not enabled. Set AGENTS_OBSERVE_TRANSCRIPT_STATS=1." }
```

**Session not found / no transcript_path captured (404):**

```json
{ "error": "no_transcript", "message": "No transcript path found for session." }
```

**Transcript file missing or unreadable (404):**

```json
{ "error": "file_not_found", "message": "Transcript file not found." }
```

**Parse failure (500):**

```json
{ "error": "parse_error", "message": "..." }
```

### Behavior

1. If the feature flag is unset → 404 `disabled`.
2. Look up `transcript_path` from the most recent event for `sessionId`. Missing → 404 `no_transcript`.
3. Translate the path through the mount-prefix rule.
4. Read the file. If absent → 404 `file_not_found`.
5. Parse line-by-line:
   - For each `type: "assistant"` line: collect `message.id`, `message.model`, `message.usage`, `isSidechain`, `timestamp`, the union of `tool_use.id` values across its `message.content` blocks, and `parentUuid`.
   - For each `type: "user"` line: collect `uuid`, `parentUuid`, `promptId`, the prompt text, and `timestamp`. A user line's `message.content` is either a string (the literal prompt text) or an array of blocks (tool results, attachments, etc.). Only lines whose `message.content` is a plain string — or whose array's first block has `type: "text"` — are treated as **originating prompts**; everything else is a tool-result follow-up that propagates the same `promptId`.
6. Dedupe assistant lines by `message.id` (one jsonl can have multiple lines per API call — text + tool_use blocks share the same message id and usage). Keep the first occurrence's `timestamp` and merge `tool_use.id`s across blocks.
7. Build a `promptId → { text, timestamp }` index from the originating-prompt user lines discovered in step 5. For each deduped assistant call, walk `parentUuid` back through the line index until we hit any line carrying a `promptId` (typically a user line — could be either a real prompt or a tool-result follow-up; both share the same `promptId`). Look that `promptId` up in the index from step 5 to attach `originatingPrompt = { text, timestamp }`. If no match → `originatingPrompt: null`.
8. Aggregate the per-model summary across deduped calls.

## Server-side parser

New module at `app/server/src/services/transcript-parser.ts`. Exports:

```ts
export interface TranscriptStats {
  source: "jsonl"
  summary: TranscriptSummary
  calls: TranscriptCall[]
}

export function parseTranscriptFile(filePath: string): Promise<TranscriptStats>
```

The parser is pure — no I/O outside reading the file, no DB access. Uses streaming line-by-line read (`readline` over a file stream) to avoid loading the full file into memory; for the 3 MB example session the working set is bounded by `lines.length × O(small struct)`.

A small `app/server/src/services/transcript-path.ts` helper handles the host→container path translation, reading the two env vars and exposing a single `resolveTranscriptPath(hostPath: string): string` function.

## Route

New route file at `app/server/src/routes/transcript-stats.ts`:

```ts
app.get('/api/sessions/:sessionId/transcript-stats', async (c) => { … })
```

Wired into `app/server/src/app.ts` alongside the other routes. The route handler does the disabled / no-transcript / file-not-found / parse-error branching, calls `parseTranscriptFile`, and returns the response.

## Client integration

A new component `<TokenUsageCard>` is added to `SessionStats` in `app/client/src/components/settings/session-modal.tsx`. It:

- Owns a `useQuery` with `queryKey: ['transcript-stats', sessionId]`, `queryFn: api.getTranscriptStats(sessionId)`, `staleTime: Infinity`, `gcTime: 0` (matches the existing logs-modal memory pattern).
- Renders the per-model summary table.
- Renders a "Refresh" button that invalidates the query.
- Renders the disabled / not-found / error states inline with a single muted line of text.

The card is mounted unconditionally in the Stats tab — the disabled-flag case becomes one of the rendered states rather than a conditional mount, so toggling the env flag doesn't require any client changes.

New `api.getTranscriptStats(sessionId)` method added to `app/client/src/lib/api-client.ts`.

## Architecture sketch

```
UI (Stats tab)
   │  click "Stats" or "Refresh"
   ▼
GET /api/sessions/:id/transcript-stats
   │
   ▼
route → checks feature flag
       │
       ├─ looks up latest event's transcript_path
       │
       ├─ resolveTranscriptPath() translates host→container path if needed
       │
       └─ parseTranscriptFile() streams jsonl, returns TranscriptStats
       │
       ▼
JSON response (summary + per-call)
   │
   ▼
UI renders summary table, holds calls[] for future drill-downs
```

## Testing

### Server

1. `transcript-parser.test.ts` — feed a hand-rolled small jsonl through `parseTranscriptFile` and assert:
   - Correct dedup of assistant lines by `message.id`.
   - Tool-use ids collected across multiple content blocks of the same message.
   - `originatingPrompt` resolved via parentUuid walk for both tool-call and text-only assistant calls.
   - `summary.byModel` aggregated correctly (multiple models).
   - `isSidechain` propagated.
2. `transcript-path.test.ts`:
   - With both env vars unset → returns input path unchanged.
   - With both env vars set → replaces the host-home prefix with container-home prefix.
   - Path that doesn't start with host-home → returned unchanged.
3. `transcript-stats.test.ts` (route):
   - Feature flag unset → 404 disabled.
   - Session with no events → 404 no_transcript.
   - Session whose transcript file is missing → 404 file_not_found.
   - Happy path → 200 with expected shape, using a tiny on-disk fixture jsonl.

### Client

4. `token-usage-card.test.tsx`:
   - Mock the query to return a fixture → renders the per-model summary table.
   - Mock the query to return the disabled-error shape → renders the disabled-state message.
   - Mock the query to return file_not_found → renders the not-found message.
   - Refresh button invalidates the query (asserted via `queryClient.invalidateQueries` spy).

## Memory / performance considerations

- **Parsing.** Streaming read with `readline`. Each line is parsed individually and only the fields we need are retained. For your example 3 MB session: ~1k lines × ~500 bytes-of-retained-state ≈ 500 KB working set during parse. Released as soon as the response serializes.
- **Response size.** Per-call objects are ~150 bytes each. For a 1000-call session: ~150 KB JSON. Acceptable.
- **No caching.** Re-parse on every request is intentional. Stats tab opens are user-driven, not high-frequency.
- **No persistence.** Nothing written to disk or DB; one read of a jsonl per request.
- **gcTime: 0** on the client query mirrors the existing logs-modal pattern so the per-call list doesn't sit in React Query cache after the modal closes.

## Risks and mitigations

- **Path translation correctness.** Mitigated by the dedicated `transcript-path` module + tests. Host home is captured at container start from the user's actual `$HOME`, not guessed.
- **Bind-mount privacy.** `~/.claude` contains every Claude Code session's transcript. Mitigated by: (a) the feature is opt-in; (b) mount is read-only; (c) only the requested session's file is opened, no directory scanning.
- **jsonl format drift.** If Claude changes the shape (e.g., `message.usage` moves), parsing yields zeros and the UI shows zeros rather than crashing. Tests assert current shape; a future regression will be visible.
- **Prompt text matching ambiguity** (UI side). Identical repeated prompts in the same session would ambiguate the join from `originatingPrompt.text` to `UserPromptSubmit` event. For v1 the UI doesn't yet do this join, so it's only a constraint on the v1.x drill-down. Will document the edge case there.

## Out of scope / follow-ups

- **v1.1: Pricing.** Multiply usage × model-rate. Probably fetched once at boot from `models.dev` and cached. Reasoning effort (from our existing event payloads) feeds tier-pricing decisions.
- **v1.1: Cost-per-session in Projects view.** Likely requires storing aggregate token counts on the sessions table at session-end time so we don't re-parse every jsonl when listing. New columns: `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_create_tokens`, `last_token_stats_at` (or similar).
- **v1.x: Drill-down UI.** Join `calls[].toolUseIds` against the event store to show tokens per tool call; join `calls[].originatingPrompt` against `UserPromptSubmit` events to show tokens per prompt.
- **v2: Other agent classes** (Codex, etc.). Implement an interface `TranscriptParser` keyed by agent class.
- **v2: Live streaming.** Tail the file or hook into PostToolUse to push delta tokens via the existing WebSocket.
