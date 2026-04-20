# Implementation Plan: CLI-Stamped Event Descriptors

Companion to [spec-cli-event-descriptors.md](./spec-cli-event-descriptors.md).
Read the spec first.

## Branch

`feat/cli-event-descriptors` off `main`.

## Phasing

Five phases. Each leaves the tree type-clean, `just check`-green, and
testable. CLI + server + client ship together in the final commit — no
phase is independently deployable, but each can be reviewed as a PR.

---

### Phase 1 — Envelope types + CLI stamping

Pure plumbing plus a CLI change that the server ignores. Low blast
radius; server-side behavior unchanged.

**Files:**

- `app/server/src/types.ts`
  - `EventEnvelopeMeta` gains:
    ```ts
    hookName?: string
    type?: string
    subtype?: string | null
    toolName?: string | null
    sessionId?: string
    agentId?: string | null
    ```
  - `ParsedEvent` gains `hookName: string | null`. Keep `toolUseId` for
    now (dropped in Phase 4 to keep this phase non-breaking).

- `hooks/scripts/lib/agents/claude-code.mjs`
  - Port the `switch (hookEventName)` block from `parser.ts` into a new
    local helper `deriveTypeSubtype(hookName, payload)`. Same cases,
    same mapping.
  - Update `buildHookEvent` to stamp the six new meta fields (see spec
    code sketch). Keep the existing `isNotification` / `clearsNotification`
    flag logic.

- `hooks/scripts/lib/agents/codex.mjs`
  - Stamp `meta.hookName` from `hookPayload.hook_event_name` if present.
  - Stamp `meta.sessionId` from `hookPayload.session_id` (Codex uses
    same key today — adjust if schema differs).
  - Leave `type` / `subtype` / `toolName` / `agentId` null.

- `hooks/scripts/lib/agents/unknown.mjs`
  - Stamp `meta.hookName` / `meta.sessionId` if the standard payload
    keys are present. Everything else null.

**Tests:**

- `test/hooks/scripts/lib/agents/claude-code.test.mjs` — new cases:
  - Each hook event (`Notification`, `SubagentStop`, `Stop`,
    `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`,
    `SessionEnd`) stamps the expected `hookName` / `type` / `subtype` /
    `toolName` / `sessionId` / `agentId`.
  - PreToolUse with `tool_use_id` in payload: `meta.toolUseId` is NOT
    set (remember, we decided against stamping it).
  - Subagent event (payload has `agent_id`): `meta.agentId` matches.
  - Main-agent event (no `agent_id`): `meta.agentId` is null.
- `test/hooks/scripts/lib/agents/codex.test.mjs` — `hookName` and
  `sessionId` stamped when present; rest null.
- `test/hooks/scripts/lib/agents/unknown.test.mjs` — same pass-through
  expectations as today, plus `hookName` if payload has it.

**Done:** `just check` green; server happily ignores the new meta
fields; behavior unchanged from today.

---

### Phase 2 — Server parser reads from meta

Rewires the server's parse path to consume what the CLI now stamps,
with payload fallback for untagged envelopes.

**Files:**

- `app/server/src/parser.ts`
  - New signature: `parseRawEvent(raw, meta?)`.
  - Delete the `switch (hookEventName)` block for the hook-format branch.
  - Replace with meta-first reads:
    ```ts
    const hookName = meta?.hookName ?? (raw.hook_event_name as string) ?? null
    const type = meta?.type ?? null
    const subtype = meta?.subtype ?? null
    const toolName = meta?.toolName ?? (raw.tool_name as string) ?? null
    const sessionId = meta?.sessionId ?? (raw.session_id as string) ?? 'unknown'
    const ownerAgentId = meta?.agentId ?? (raw.agent_id as string) ?? null
    ```
  - Keep the non-hook-format branch (current lines 108+) as-is — those
    paths don't go through the agent-lib dispatch.
  - `toolUseId` extraction stays for one more phase (used by the
    in-memory subagent-pairing map in events.ts); removed in Phase 4.
  - The exported `ParsedRawEvent` gains `hookName: string | null`.

- `app/server/src/routes/events.ts`
  - Pass `meta` through to `parseRawEvent(hookPayload, meta)`.
  - No other behavior change.

**Tests:**

- `app/server/src/parser.test.ts` (existing file) — new cases:
  - Given a raw payload with `hook_event_name: 'PreToolUse'` and no
    meta, parser falls back to raw, returns `hookName: 'PreToolUse'`,
    leaves `type` / `subtype` null.
  - Given meta with all fields, parser returns meta values verbatim
    and does not invoke any subtype derivation.
  - Given meta with partial fields (e.g. only `hookName`), parser
    returns those from meta and fills remaining from payload where
    possible.

**Done:** `just check` green; a round-trip from CLI → server produces
the same `type` / `subtype` / `toolName` it used to — just sourced
from meta now.

---

### Phase 3 — `hook_name` column + filter support

Adds the new column, the index, the migration backfill, and the
`?hookName=` query param. Storage change is purely additive in this
phase (no drops yet).

**Files:**

- `app/server/src/storage/sqlite-adapter.ts`
  - `CREATE TABLE events (... , hook_name TEXT, ...)` — add the column.
  - Migration: detect missing column via `PRAGMA table_info('events')`,
    `ALTER TABLE events ADD COLUMN hook_name TEXT`, backfill from
    `json_extract(payload, '$.hook_event_name')`. Same defensive pattern
    as other additive migrations.
  - `CREATE INDEX IF NOT EXISTS idx_events_hook_name ON events(hook_name)`
    — create the index AFTER the backfill to avoid contention.
  - `insertEvent` accepts `params.hookName` and writes the column.
  - `getEventsForSession` WHERE clause extended: `AND hook_name = ?`
    when `filters.hookName` is set.

- `app/server/src/storage/types.ts`
  - `InsertEventParams` gains `hookName?: string | null`.
  - `StoredEvent` gains `hook_name: string | null`.
  - `EventFilters` gains `hookName?: string`.

- `app/server/src/routes/events.ts`
  - Pass `hookName: parsed.hookName` into `insertEvent`.
  - Response shape picks up `hookName` alongside `type` / `subtype`.

- `app/server/src/routes/sessions.ts`
  - Accept `?hookName=` query param; pass to `getEventsForSession` in
    the filter set.

- `app/client/src/types/index.ts`
  - `ParsedEvent` gains `hookName: string | null`.

**Tests:**

- `app/server/src/storage/sqlite-adapter.test.ts` — new cases:
  - `insertEvent` persists `hookName` when passed.
  - Migration backfill: pre-seed events with payload carrying
    `hook_event_name` and `hook_name` NULL; after the migration sweep,
    `hook_name` is populated from payload.
  - `getEventsForSession({ hookName: 'Stop' })` returns only matching
    rows.
- `app/server/src/routes/sessions.test.ts` — new case:
  - `GET /sessions/:id/events?hookName=Stop` returns only Stop rows.
- Spot-check client: `ParsedEvent.hookName` typechecks wherever the
  shape is constructed.

**Done:** Migration runs cleanly on an existing DB; client sees
`hookName` on every event; filter works end-to-end.

---

### Phase 4 — Drop `tool_use_id` column; client reads from payload

The breaking-but-trivial phase. ParsedEvent shape changes (one field
drops); client reads are redirected to payload. Grep-driven changes.

**Files:**

- `app/server/src/storage/sqlite-adapter.ts`
  - Migration: `DROP INDEX IF EXISTS idx_events_tool_use_id;
    ALTER TABLE events DROP COLUMN tool_use_id`. SQLite ≥3.35 supports
    DROP COLUMN natively; bundled better-sqlite3 meets this. Defensive
    fallback (recreate table) if the ALTER fails — same pattern used
    for the `pending_notification_ts` rename.
  - `insertEvent` no longer accepts `toolUseId`; remove from the
    INSERT column list.

- `app/server/src/storage/types.ts`
  - `InsertEventParams` drops `toolUseId`.
  - `StoredEvent` drops `tool_use_id`.

- `app/server/src/parser.ts`
  - Remove the `toolUseId` extraction entirely. Remove it from
    `ParsedRawEvent`.

- `app/server/src/routes/events.ts`
  - The in-memory subagent-pairing maps (`pendingAgentMeta`,
    `pendingAgentTypes`, `pendingAgentMetaQueue`) keyed on toolUseId
    now read it from the raw payload at ingest:
    ```ts
    const toolUseId = (hookPayload.tool_use_id as string) || null
    ```
  - Remove `parsed.toolUseId` references; substitute the local
    `toolUseId` derived above.
  - Stop emitting `toolUseId` on the ParsedEvent response.

- `app/server/src/routes/sessions.ts`, `agents.ts`
  - Remove `toolUseId: r.tool_use_id || null` mappings.

- `app/server/src/types.ts`
  - `ParsedEvent` drops `toolUseId`.

- `app/client/src/types/index.ts`
  - `ParsedEvent` drops `toolUseId`.

- `app/client/src/agents/claude-code/process-event.ts`
  - Change `const toolUseId = raw.toolUseId` to read from raw.payload:
    ```ts
    const toolUseId = (raw.payload as Record<string, unknown>).tool_use_id as
      | string
      | undefined
    ```
  - Ensure the Pre/Post pairing groupId logic continues to work.

- `app/client/src/agents/claude-code/event-detail.tsx`
  - The Pre/Post pairing loop reads `e.toolUseId` — substitute
    `(e.payload as Record<string, unknown>).tool_use_id`.

- `app/client/src/components/settings/session-modal.tsx`
  - Stats helper reads `e.toolUseId` — same substitution.

- `app/client/src/components/event-stream/event-row.tsx` and any other
  place that reads `toolUseId` directly — grep for `toolUseId` across
  `app/client/src` and update each.

- `app/client/src/agents/default/index.tsx`
  - Drop `toolUseId: raw.toolUseId`. This agent's output shape
    continues to match `EnrichedEvent` — if `EnrichedEvent` carries a
    `toolUseId`, compute it from payload here too.

**Tests:**

- `app/server/src/storage/sqlite-adapter.test.ts`:
  - Migration test: pre-seed a DB with the old schema (having
    `tool_use_id`); after migration, column is absent and existing
    rows are preserved.
  - `insertEvent` test signature no longer accepts `toolUseId`.
- `app/server/src/parser.test.ts` — remove `toolUseId` assertions.
- Client tests — update fixtures that set `toolUseId` on raw events to
  set `payload.tool_use_id` instead. Pre/Post pairing tests should
  still pass.

**Done:** `tool_use_id` column gone; client reads payload; no
server-side references remain.

---

### Phase 5 — Integration + `just check`

**Steps:**

1. `just check` from a clean tree.
2. Grep audit:
   - `grep -rn "toolUseId\|tool_use_id" app/server/src` — expect zero
     hits outside migration / payload-extraction code.
   - `grep -rn "switch (hookEventName)" app/server/src` — expect zero
     hits.
   - `grep -rn "hook_name" app/server/src` — expect column + index +
     filter + route wiring.
3. Manual smoke via `just dev`:
   - Start a Claude Code session; confirm events stream into the
     dashboard with `hookName` populated on every row.
   - Filter the event stream by a specific hook (via direct URL:
     `/api/sessions/:id/events?hookName=PreToolUse`).
   - Confirm Pre/Post tool rows still merge in the UI (client reads
     payload's `tool_use_id`).
   - Confirm subagent spawns still name correctly (server's in-memory
     pairing map still works, now reading from payload).
4. Fresh-install test path:
   - `just db-reset`; confirm migrations run cleanly on an empty DB.
   - Rollback check: spin up a separate checkout on `main` with the
     same data directory; events written by the new code should still
     load (payload preserves every field; only columns changed).

**Done criteria:**

- `just check` passes (CLI + server + client suites).
- No Claude-Code switch statement on the server hot path.
- `hook_name` column present, indexed, filterable via `?hookName=`.
- `tool_use_id` column absent; client reads from payload.
- Subagent pairing still works (server in-memory map).
- Pre/Post tool rows still merge (client groupId from payload).
- Filter bar still works on existing dimensions; no client-facing UX
  regressions.

---

## Risks

| Risk | Mitigation |
| ---- | ---------- |
| Phase 4 client refactor misses a `toolUseId` read → type error or runtime undefined. | TypeScript catches the former; grep before merging for the latter. Add a quick `app/client/src` search-replace audit to the Phase 5 checklist. |
| Migration DROP COLUMN fails on an older SQLite. | Defensive table-recreate fallback — same pattern used for `pending_notification_ts` rename. |
| `deriveTypeSubtype` in the CLI drifts from the old server parser on an edge case. | Port the switch statement verbatim. All existing cases covered by tests ported from the parser test file. |
| Server in-memory pairing map in events.ts breaks when reading from payload (wrong key?). | Payload always carries `tool_use_id` for tool events — same source the parser used until this PR. Grep confirms no other keys involved. |
| Fresh-install users hit the migration backfill as a slow first-boot. | `json_extract` on a small table is sub-second; the existing session count column migration does the same thing today. |
| `ParsedEvent.toolUseId` drop breaks downstream consumers I don't know about. | No external consumers — `ParsedEvent` is the client's type. Grep `app/client/src` finishes the trail. |

## Open questions

1. **Should the filter bar expose `hookName` as a distinct dimension?**
   Defer to a follow-up once users can try the `?hookName=` query
   param directly. The column lands now; UI comes next.
2. **Should Phase 4 ship in the same release as Phase 3?** Yes — the
   spec commits to it. Rolling out Phase 3 alone would leave a useless
   column on the table during a partial-deploy window.
3. **Should `deriveTypeSubtype` live in claude-code.mjs or its own
   module?** Put it inline for now; extract to
   `hooks/scripts/lib/agents/claude-code/derive-type.mjs` if it grows
   past ~50 lines.

## Out of scope

- Filter bar UI for `hookName` (Phase 6 follow-up spec).
- Route-layer Claude-Code-specific branching in `events.ts` (subagent
  pairing, SessionStart/End lifecycle, `agent_progress`). Those stay
  server-side; pushing them into an agent-class registry is a larger
  separate refactor.
- Codex hook-event → type/subtype mapping (lands when Codex semantics
  are stable).
