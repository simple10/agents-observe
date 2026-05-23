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
- Codex / non-Claude agent classes. v1 hardcodes the Claude Code transcript layout. Adding other agents later means a new route + parser, not a runtime-dispatched interface; we're not pre-building that abstraction.
- Server-side caching. Re-parse on every request. Sessions in practice have <1000 assistant lines and parse in milliseconds.

## User experience

The Session Stats tab gains a new "Token Usage" card below the existing tool-stats card. While loading: a small spinner. On success: a per-model summary table. On failure (feature disabled, file missing, file unreadable, file too large, parse error): a single-line muted message explaining why, with no other side effects on the tab.

The card refreshes naturally on modal close/reopen — the existing `useEvents`-style pattern in `logs-modal.tsx` uses `gcTime: 0` so each open re-fetches. No dedicated refresh button. (For active sessions a user wants to monitor live, the snapshot is from tab-open time; live polling is a v1.1+ consideration.)

Per-call drill-down is **out of scope for v1's UI** but the API returns the data so a follow-up commit can wire it up without changing the wire format.

## Feature flag and path translation

Single user-facing flag:

```
AGENTS_OBSERVE_TRANSCRIPT_STATS=1
```

When set, the feature is enabled. When unset (default), the endpoint returns 404 with `{ disabled: true }` and the UI renders the disabled-state message.

**Local-server mode** (`just dev`, `just start-local`): no mounts needed. The server reads `transcript_path` from the captured hook payload and opens it directly.

**Docker mode** (`just start`): when the flag is set, `hooks/scripts/lib/docker.mjs` adds two things to `docker run`:

1. A read-only bind mount, narrowed to the projects subtree to minimize blast radius (transcripts only — not credentials, settings, MCP config, etc.): `-v $HOME/.claude/projects:/host/.claude/projects:ro`.
2. Env vars that tell the server how to translate host paths into the mounted path:
   - `AGENTS_OBSERVE_TRANSCRIPT_HOST_BASE=$HOME/.claude/projects` (e.g., `/Users/joe/.claude/projects`)
   - `AGENTS_OBSERVE_TRANSCRIPT_CONTAINER_BASE=/host/.claude/projects`

Translation rule (server-side): trim any trailing slash off `HOST_BASE` at boot (defensive — `$HOME=/Users/joe/` is rare but legal). Then, given a `transcript_path` whose value equals `${HOST_BASE}` or starts with `${HOST_BASE}/`, replace that prefix with `${CONTAINER_BASE}` (preserving the slash). The trailing-slash check matters — otherwise `/Users/joe/.claude/projects-other/...` would falsely match `/Users/joe/.claude/projects`. Other paths are returned unchanged. If translation produces a path that doesn't exist on disk, the endpoint returns a "file not found" failure; if it exists but isn't readable (EACCES, e.g., container UID mismatch with host-side file mode 600), it returns a distinct "file unreadable" failure (see API section).

Known edge cases (documented, not handled in v1):

- **Symlinks / realpath drift.** If Claude Code ever emits a `transcript_path` resolved through `/private/var/...` rather than `/Users/...` (macOS realpath), the prefix match fails and the endpoint reports `file_not_found`. We've never observed this in practice.
- **Case sensitivity.** macOS APFS is case-insensitive by default but the prefix match is case-sensitive. A user whose `$HOME` differs in case from the path emitted by Claude would see `file_not_found`. Unlikely in practice; not handled.
- **Cross-host transcripts.** Transcripts copied from another machine won't have the local `HOST_BASE` prefix and won't be translatable. By design — the feature serves the local user's own sessions.

Both env vars are added to `getServerEnv()` in `hooks/scripts/lib/config.mjs`. They're empty strings in local mode (server detects empties and skips translation).

## Data model

No DB schema changes. The endpoint reads:

- `transcript_path` from the `sessions` table — it's already a top-level column (`sessions.transcript_path`) populated at SessionStart, indexed via `idx_sessions_transcript_path`. No JSON extraction needed; a single `SELECT transcript_path FROM sessions WHERE id = ?` returns it.
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
  // summary aggregates MAIN AGENT calls only (isSidechain === false).
  // Hooks already capture subagent token usage on PostToolUse:Agent
  // events; including subagents here would double-count.
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
  // Per-call data covers BOTH main and subagent calls. Filter via
  // `isSidechain` if you want a particular subset. v1 UI consumes
  // only `summary` so this list is wire-only / for future drill-downs.
  calls: Array<{
    messageId: string,                  // "msg_01..." — stable React key
    requestId: string | null,           // "req_..." — cross-references Anthropic-side logs if needed
    timestamp: number,                  // ms epoch of the FIRST jsonl line for this messageId
    model: string,
    isSidechain: boolean,               // false = main agent; true = subagent
    serviceTier: string | null,         // "standard" / "batch" / "priority" — feeds v1.1 pricing
    stopReason: string | null,          // "end_turn" / "tool_use" / "max_tokens" / etc.
    usage: {
      inputTokens: number,
      outputTokens: number,
      cacheReadTokens: number,
      cacheCreate5mTokens: number,
      cacheCreate1hTokens: number,
    },
    toolUseIds: string[],               // union across content blocks of this messageId.
                                        // Links to PreToolUse/PostToolUse event.toolUseId.
                                        // Known limitation: a single call invoking the same
                                        // tool twice loses per-block boundaries.
    promptId: string | null,            // jsonl promptId — index into `prompts` below
  }>,
  // Prompt text is normalized into its own map so we don't repeat a
  // potentially-large prompt across every call it generated. UI joins
  // `calls[i].promptId` → `prompts[promptId]` for drill-down.
  prompts: Record<string, {
    text: string,                       // prompt text (uncapped — see "Risks" for sizing notes)
    timestamp: number,                  // ms epoch of the originating user line
  }>,
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

**Transcript file missing (404):**

```json
{ "error": "file_not_found", "message": "Transcript file not found." }
```

**Transcript file unreadable — EACCES, e.g. container UID mismatch with host file mode 600 (403):**

```json
{ "error": "file_unreadable", "message": "Transcript file exists but is not readable by the server process: <OS error>" }
```

**Transcript file exceeds size cap (413):**

```json
{ "error": "file_too_large", "message": "Transcript file exceeds the 100 MB safety cap." }
```

**Parse failure (500):**

```json
{ "error": "parse_error", "message": "..." }
```

### Behavior

1. If the feature flag is unset → 404 `disabled`.
2. Look up `sessions.transcript_path` for `sessionId`. Missing → 404 `no_transcript`.
3. Translate the path through the mount-prefix rule.
4. Stat the file. Absent → 404 `file_not_found`. Permission denied → 403 `file_unreadable`. Larger than 100 MB → 413 `file_too_large`.
5. Stream the file line-by-line (`readline` over a file `ReadStream`). Build a single in-memory line index keyed by `uuid`, retaining for every line the fields needed by step 7: `{ uuid, parentUuid, type, promptId, timestamp, …type-specific fields }`. **Every line type is indexed** — including `attachment`, `system`, `file-history-snapshot`, etc. — because these can appear in `parentUuid` chains and the walk has to traverse them.
   - For `type: "assistant"` lines, additionally extract: `message.id`, `message.model`, `message.usage`, `message.stop_reason`, `requestId`, `isSidechain`, and the list of `tool_use.id` values from `message.content` blocks.
   - For `type: "user"` lines, additionally extract the prompt text. `message.content` is either a string (the literal prompt text) or an array of blocks (tool results, text, attachments). A user line is treated as an **originating prompt** only when `message.content` is a string OR its array's first block has `type: "text"`. Tool-result user lines propagate the same `promptId` but aren't originating prompts.
   - Lines whose `type` is none of the recognized values are still indexed (for parent-chain traversal) but contribute nothing to outputs.
6. Dedupe assistant lines by `message.id`. One API call's response is split across multiple jsonl lines (one per content block: thinking, text, tool_use) and the same `message.usage` object is replicated on each. Keep the first occurrence's `timestamp` (which corresponds to the first emitted content block — typically `thinking`; documented for test stability) and union the `tool_use.id` values across all blocks of that message id.
7. Build a `promptId → { text, timestamp }` map from the originating-prompt user lines discovered in step 5. For each deduped assistant call, walk `parentUuid` back through the line index until we hit any line carrying a non-null `promptId`. Set `call.promptId` to that value. If no chain hit → `call.promptId: null`. The walk traverses every line type, not just user/assistant, because attachments and system lines sit in real parent chains.
8. Aggregate the per-model summary across deduped calls **with `isSidechain === false` only**. Subagent calls remain in the `calls[]` list (filterable by clients that want them) but never contribute to the headline summary, since the existing hook pipeline already reports subagent tokens via `PostToolUse:Agent` events and the v1 UI sums those there.
9. Serialize and return.

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

- Owns a `useQuery` with `queryKey: ['transcript-stats', sessionId]`, `queryFn: api.getTranscriptStats(sessionId)`, `gcTime: 0` (mirrors the existing logs-modal pattern so the per-call list doesn't sit in cache after the modal closes). No `staleTime` override — the data is treated as a snapshot from tab open; closing/reopening the modal triggers a fresh fetch.
- Renders the per-model summary table.
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
   - Correct dedup of assistant lines by `message.id` (multiple lines per call collapse to one).
   - Tool-use ids unioned across all content blocks of the same message id.
   - `requestId`, `serviceTier`, `stopReason` extracted correctly.
   - For each assistant call: `promptId` resolved via parentUuid walk for both tool-call and text-only calls; resolves correctly even when the chain traverses `attachment` / `system` lines.
   - `prompts` map contains one entry per distinct promptId observed on originating-prompt user lines, with text from either string-typed content or array-typed content's first `text` block.
   - `summary.byModel` aggregates **main-agent only** (subagent calls excluded from summary but present in `calls[]`).
   - Multiple models in the same file aggregate into separate `byModel` entries.
2. `transcript-path.test.ts`:
   - With both env vars unset → returns input path unchanged (local mode).
   - With both env vars set → replaces `HOST_BASE` prefix with `CONTAINER_BASE`.
   - Trailing slash on `HOST_BASE` is stripped at boot — a path equal to `HOST_BASE` (no trailing slash) maps cleanly.
   - Adjacent-prefix safety: `/Users/joe/.claude/projects-other/foo` is NOT translated when `HOST_BASE=/Users/joe/.claude/projects`.
   - Path that doesn't start with `HOST_BASE` → returned unchanged.
3. `transcript-stats.test.ts` (route):
   - Feature flag unset → 404 `disabled`.
   - Session with null transcript_path → 404 `no_transcript`.
   - Session whose transcript file is missing → 404 `file_not_found`.
   - File exists but unreadable (simulate EACCES via temp file with mode 000) → 403 `file_unreadable`.
   - File exceeds 100 MB cap → 413 `file_too_large` (use a stub that fakes `stat.size`).
   - Happy path → 200 with expected shape, using a tiny on-disk fixture jsonl.

### Client

4. `token-usage-card.test.tsx`:
   - Mock the query to return a fixture → renders the per-model summary table.
   - Mock the query to return the disabled-error shape → renders the disabled-state message.
   - Mock the query to return file_not_found → renders the not-found message.
   - Mock the query to return file_unreadable → renders an unreadable message distinct from not-found.

## Memory / performance considerations

- **Parsing.** Streaming read with `readline`. Each line is parsed individually; we keep only `{uuid, parentUuid, type, promptId, timestamp}` plus assistant-specific fields (`messageId, model, usage, requestId, serviceTier, stopReason, isSidechain, toolUseIds[]`) and user-specific prompt text. The full line index is required (not just user/assistant) so the parentUuid walk can traverse attachment/system lines, but the retained struct per non-user/assistant line is just the 5-field header (~100 bytes). For the example 3 MB / ~1.3k-line session this is well under 1 MB resident.
- **Large-session sizing.** A 50k-line session retains roughly 100 bytes × 50k = ~5 MB for headers plus the per-assistant extras (~300 bytes × ~25k assistant lines = ~7.5 MB) for ~13 MB peak. The 100 MB file-size cap (see Failure modes) is a defensive hard limit, not an expected operating point — it's there to prevent a runaway from a pathological file.
- **Prompt-text payload.** Prompts are normalized into a `prompts` map keyed by `promptId`. A prompt referenced by 30 assistant calls is serialized once, not 30 times. Prompt text itself is uncapped in v1; if we observe sessions with 1 MB+ prompts in the wild we'll add a `textTruncated: boolean` follow-up.
- **Response size.** Per-call objects are ~200 bytes each (incl. new requestId/serviceTier/stopReason). A 1000-call session with average prompt size ~2KB and ~50 distinct prompts: ~200 KB calls + ~100 KB prompts = ~300 KB JSON. Acceptable.
- **No caching.** Re-parse on every request is intentional. Stats tab opens are user-driven, not high-frequency.
- **No persistence.** Nothing written to disk or DB; one read of a jsonl per request.
- **gcTime: 0** on the client query mirrors the existing logs-modal pattern so the per-call list doesn't sit in React Query cache after the modal closes.

## Risks and mitigations

- **Path translation correctness.** Mitigated by the dedicated `transcript-path` module + tests. Host base is captured at container start from `$HOME/.claude/projects`, not guessed.
- **Bind-mount privacy.** Mount narrowed to `~/.claude/projects` only — credentials (`.credentials.json`), settings, MCP config, and IDE state stay outside the mount. Still contains every Claude Code session's transcript. Further mitigated by: (a) the feature is opt-in; (b) mount is read-only; (c) only the requested session's file is opened, no directory scanning.
- **Container UID mismatch (EACCES).** Transcript files are mode 600 on host. If the container process runs as a UID that doesn't match the host file owner, the read fails with EACCES even with the mount in place. We surface this distinctly as `file_unreadable` rather than collapsing into `file_not_found`, so the UI message is accurate. Fix is user-side (run the container with `--user $(id -u):$(id -g)`); documenting the symptom is V1's responsibility.
- **jsonl format drift.** If Claude changes the shape (e.g., `message.usage` moves), parsing yields zeros and the UI shows zeros rather than crashing. Tests assert current shape; a future regression will be visible.
- **Prompt text matching ambiguity** (UI side). Identical repeated prompts in the same session would ambiguate the join from `prompts[promptId].text` to a `UserPromptSubmit` event by text content. For v1 the UI doesn't yet do this join, so it's only a constraint on the v1.x drill-down. Will document the edge case there.

## Out of scope / follow-ups

- **v1.1: Pricing.** Multiply usage × model-rate. Probably fetched once at boot from `models.dev` and cached. Reasoning effort (from our existing event payloads) feeds tier-pricing decisions.
- **v1.1: Cost-per-session in Projects view.** Likely requires storing aggregate token counts on the sessions table at session-end time so we don't re-parse every jsonl when listing. New columns: `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_create_tokens`, `last_token_stats_at` (or similar).
- **v1.x: Drill-down UI.** Join `calls[].toolUseIds` against the event store to show tokens per tool call; join `prompts[calls[].promptId].text` against `UserPromptSubmit` events to show tokens per prompt.
- **v2: Other agent classes** (Codex, etc.). Implement an interface `TranscriptParser` keyed by agent class.
- **v2: Live streaming.** Tail the file or hook into PostToolUse to push delta tokens via the existing WebSocket.
