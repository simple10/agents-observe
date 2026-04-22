# Design Spec: CLI-Stamped Event Descriptors

## Problem

Two issues, related:

1. The server's `app/server/src/parser.ts` contains a Claude-Code-specific
   switch statement that maps `hook_event_name` to `type` / `subtype` /
   `toolName`. That's the last chunk of agent-class knowledge on the
   server's hot path — notification flag decisions already moved to the
   CLI.
2. The events table stores `subtype` (derived) but not the raw
   `hook_event_name`. Users can filter by categorized subtype, but not
   by "what did this agent actually fire?" — values that coincide for
   Claude Code today but will diverge for Codex.

Separately: `tool_use_id` is a column + index, but the server never
queries on it (verified via grep — zero WHERE clauses, zero filter
params). The client uses `toolUseId` purely for local Pre/Post pairing
via `groupId`. Column + index are dead storage; the response-level
field is only needed for the client's convenience.

## Goal

Establish a clean boundary: **if a field has its own column, the CLI
stamps it on the envelope. If it doesn't, the client extracts from the
raw payload.** Server stays agent-class-neutral on the parse + store
path, with minimal payload fallback for untagged envelopes.

Concretely:

- Add a new `hook_name` column for the raw hook event name.
- Move the Claude-Code switch statement out of `parser.ts` into the CLI.
- **Drop the `tool_use_id` column + index.** It's never queried on the
  server; the client's Pre/Post pairing reads it from payload going
  forward.
- CLI stamps: `hookName`, `type`, `subtype`, `toolName`, `sessionId`,
  `agentId` — every field that becomes a column.
- No agent-class-specific payload keys survive on the server's hot path
  (the subagent-pairing in-memory map in `events.ts` is scoped in
  non-goals).

## Non-goals

- **Route-layer Claude-Code-specific logic** in `events.ts` (subagent
  spawn pairing keyed on `toolUseId`, SessionStart/End lifecycle,
  `agent_progress` handling). That's still server-side and still
  Claude-Code-shaped. Separate, larger refactor to push it into a
  server-side agent-class registry.
- **Codex hook-event mapping.** Codex stays a pass-through this pass
  (stamps `hookName` from payload, leaves type/subtype null). Concrete
  Codex categorization lands when its hook schema is stabilized.
- **Removing or altering the existing `type` / `subtype` / `tool_name`
  columns.** They stay. Indexes stay. Server-side filtering stays.
  Only the *source* of those values changes.
- **Changing the client's rendering.** Client reads whatever the server
  returns, same as today.

## Concepts

### Envelope additions (`meta`)

Six new optional fields on `EventEnvelopeMeta`, all CLI-stamped. Each
corresponds to a column on the events table:

```ts
interface EventEnvelopeMeta {
  agentClass?: string
  env?: Record<string, string>
  isNotification?: boolean
  clearsNotification?: boolean

  // NEW — one per indexed column
  hookName?: string          // raw hook event name (agent-class-native)
  type?: string              // normalized category (e.g. 'tool', 'user', 'session')
  subtype?: string | null    // normalized sub-category (e.g. 'PreToolUse')
  toolName?: string | null   // extracted from payload
  sessionId?: string         // per-agent-class session id extraction
  agentId?: string | null    // set when payload carries a subagent id
}
```

Notably **absent**: `toolUseId`. It has no column, so it doesn't travel
in meta. The client reads `payload.tool_use_id` directly when it needs
it for Pre/Post pairing — it already reads other agent-specific payload
fields (`tool_input.*`, `tool_response.agentId`, etc.) so this is
consistent.

`hookName` is the **raw** agent-native value. `type` / `subtype` are the
agent lib's **derivation** of that raw value into a cross-class category
the client can filter on consistently. Two layers; both travel; both
get columns + indexes.

All six are optional. If the CLI hasn't been updated for a given agent
class, the server falls back to a minimal payload extraction (see
below) — the lights stay on, just with partial data.

### Server parser becomes a thin extractor

`parseRawEvent(raw, meta)` reads from `meta` first and falls back to
payload shape only for the fields with well-known payload keys that
don't require agent-class knowledge to infer:

| Field | Primary source | Fallback |
| --- | --- | --- |
| `hookName` | `meta.hookName` | `raw.hook_event_name` |
| `type` | `meta.type` | *none — null* |
| `subtype` | `meta.subtype` | *none — null* |
| `toolName` | `meta.toolName` | `raw.tool_name` |
| `sessionId` | `meta.sessionId` | `raw.session_id` |
| `agentId` | `meta.agentId` | `raw.agent_id` |

The Claude-Code-specific switch statement is **deleted**. The parser
shrinks from ~150 lines to a handful of reads.

Deriving `type` / `subtype` requires agent-class knowledge (the switch)
and that knowledge now lives in `claude-code.mjs::buildHookEvent`. If
the CLI is out of date and doesn't stamp those fields, they stay null
on the server — the client's filter bar handles null categories
gracefully (events surface as "uncategorized," still visible in the
stream and filterable by the raw `hookName`).

`toolUseId` is **not** extracted by the server parser. The client reads
`payload.tool_use_id` directly from the ParsedEvent's `payload` field
when it needs to compute `groupId` for Pre/Post pairing.

### New `hook_name` column

`sessions.events` gains:

- `hook_name TEXT` (nullable) — the raw hook event name.
- `CREATE INDEX idx_events_hook_name ON events(hook_name)` — mirrors
  the existing `idx_events_type` pattern, enables filter bar queries
  by raw hook name without full-table scans.

Migration: add the column, backfill from `json_extract(payload, '$.hook_event_name')`
for existing rows. One-time bootstrap comment explicitly scopes this
payload read as migration-only.

### Server-side filtering

`getEventsForSession` extends `EventFilters` with an optional
`hookName?: string` field. New WHERE clause: `AND hook_name = ?`.
Mirrors the existing `type` / `subtype` filter pattern. The
`/sessions/:id/events?hookName=Stop` query param is plumbed through
the route in `events.ts` alongside the existing `type` / `subtype` /
`search` params.

## CLI changes

### `hooks/scripts/lib/agents/claude-code.mjs`

`buildHookEvent` absorbs the server's old switch statement. Envelope's
`meta` gains the six new fields (one per column on `events`):

```js
export function buildHookEvent(config, _log, hookPayload) {
  const hookName = hookPayload?.hook_event_name || 'unknown'
  const toolName = hookPayload?.tool_name || hookPayload?.tool?.name || null
  const sessionId = hookPayload?.session_id || null
  const agentId = hookPayload?.agent_id || null  // only present for subagent events
  const { type, subtype } = deriveTypeSubtype(hookName, hookPayload)

  const flags = {}
  if (isNotificationEvent(config, hookName, hookPayload)) {
    flags.isNotification = true
  } else if (NON_CLEARING_EVENTS.has(hookName)) {
    flags.clearsNotification = false
  }

  const envelope = {
    hook_payload: hookPayload,
    meta: {
      agentClass: 'claude-code',
      env: buildEnv(config),
      hookName,
      type,
      subtype,
      toolName,
      sessionId,
      agentId,
      ...flags,
    },
  }
  return { envelope, hookEvent: hookName, toolName }
}
```

`deriveTypeSubtype` is the ported switch statement. Same cases as
today's parser (`SessionStart → session`, `UserPromptSubmit → user`,
`PreToolUse → tool`, ...), just living next to where envelope is built.

### `hooks/scripts/lib/agents/codex.mjs`

Stamp `hookName` and `sessionId` from the Codex payload (the keys may
differ from Claude Code — that's exactly why this lives in the agent
lib). Leave `type` / `subtype` null. Extract `toolName` / `agentId`
if the Codex schema exposes them; otherwise null.

### `hooks/scripts/lib/agents/unknown.mjs`

Stamp `hookName` / `sessionId` from standard-named payload fields
(`hook_event_name`, `session_id`) if present; everything else null.
Keeps behavior identical to today — zero flags, server-side fallback
handles the rest.

## Server changes

### `app/server/src/types.ts`

- `EventEnvelopeMeta` gains `hookName` / `type` / `subtype` / `toolName` /
  `sessionId` / `agentId` (all optional).
- `ParsedEvent` gains `hookName: string | null` alongside existing
  fields. `toolUseId` is **removed** from `ParsedEvent` — client reads
  it from `payload` directly.

### `app/server/src/parser.ts`

- Delete the `switch (hookEventName)` block for the hook-format branch.
- New `parseRawEvent(raw, meta?)` signature: reads from `meta` first,
  falls back to raw payload for `hookName` / `toolName` / `sessionId` /
  `agentId`.
- `type` / `subtype` default to `null` when not in `meta`.
- `toolUseId` is no longer extracted — clients read `payload.tool_use_id`
  directly when needed.
- Keeps the non-hook-format branch (line 110 onward — handles events
  that already carry `subtype` / `data.hookEvent` / the synthesized
  `agent_progress` case) unchanged; those don't go through the
  agent-lib path and already work off the payload.

### `app/server/src/storage/sqlite-adapter.ts`

- `events` table schema gains `hook_name TEXT` (nullable).
- `events` table schema **drops** `tool_use_id` and the
  `idx_events_tool_use_id` index.
- Migration (additive):

  ```sql
  ALTER TABLE events ADD COLUMN hook_name TEXT;
  UPDATE events
  SET hook_name = json_extract(payload, '$.hook_event_name')
  WHERE hook_name IS NULL;
  CREATE INDEX IF NOT EXISTS idx_events_hook_name ON events(hook_name);
  ```

- Migration (subtractive):

  ```sql
  DROP INDEX IF EXISTS idx_events_tool_use_id;
  ALTER TABLE events DROP COLUMN tool_use_id;  -- SQLite ≥3.35
  ```

  Defensive fallback (older SQLite) recreates the table without the
  column — same pattern as the `pending_notification_ts` rename.

- `insertEvent` accepts `hookName` in `InsertEventParams`, drops
  `toolUseId`.

### `app/server/src/storage/types.ts`

- `InsertEventParams` gains `hookName?: string | null`, drops `toolUseId`.
- `EventRow` / `StoredEvent` gain `hook_name: string | null`, drop
  `tool_use_id`.
- `EventFilters` gains `hookName?: string`.

### `app/server/src/routes/events.ts`

- Call `parseRawEvent(hookPayload, meta)` — pass `meta` through.
- `insertEvent({ ..., hookName: parsed.hookName })`.
- Response shape includes `hookName` alongside `type` / `subtype` / `toolName`.
- GET query accepts `hookName=` and passes it to `getEventsForSession`.

### `app/server/src/routes/sessions.ts`

`GET /sessions/:id/events` — verify its query-param plumbing. Add
`hookName` to the pass-through filter set alongside the existing
`type` / `subtype` / `search`.

## Client changes

Small but non-zero — `toolUseId` no longer arrives as a top-level
response field.

- `app/client/src/types/index.ts` — `ParsedEvent` gains
  `hookName: string | null`, drops `toolUseId`.
- `app/client/src/agents/claude-code/process-event.ts` — change
  `const toolUseId = raw.toolUseId` to read
  `(raw.payload as Record<string, unknown>).tool_use_id` instead.
  Same change anywhere else that reads `e.toolUseId` (about half a
  dozen places across `process-event.ts`, `event-detail.tsx`, and
  `session-modal.tsx`'s stats helper).
- Filter bar (optional, follow-up): expose a "Hook name" filter
  dimension. Not required for this spec to land — the column and query
  support go in now; UI filter follows on user demand.

## Migration / rollout

Server + CLI + client ship together (same release), same as the
notification envelope-flags change. Because of the payload fallback,
an older CLI against a newer server still works:

- CLI sends envelope without the new meta fields → server falls back
  to `raw.hook_event_name` / `raw.tool_name` / `raw.session_id` /
  `raw.agent_id` for those four. `type` / `subtype` stay null; events
  still display with a `hookName` category in the filter bar.
- CLI sends full meta → server reads from meta. `parseRawEvent` does
  no agent-class-specific work.

In the opposite direction (newer CLI, older server), the server
silently ignores the new meta fields — also fine.

The client update is coupled: the new ParsedEvent shape (no
`toolUseId`, yes `hookName`) requires the client build to match.

## File-level change list

**CLI:**

- `hooks/scripts/lib/agents/claude-code.mjs` — port the parser switch; stamp `hookName` / `type` / `subtype` / `toolName` / `sessionId` / `agentId` on envelope.
- `hooks/scripts/lib/agents/codex.mjs` — stamp `hookName` / `sessionId`; leave the rest null.
- `hooks/scripts/lib/agents/unknown.mjs` — stamp `hookName` / `sessionId` from standard payload fields if present.

**Server:**

- `app/server/src/types.ts` — extend `EventEnvelopeMeta`; `ParsedEvent` gains `hookName`, drops `toolUseId`.
- `app/server/src/parser.ts` — delete the Claude-Code switch; `parseRawEvent(raw, meta)` with meta-first reads.
- `app/server/src/storage/types.ts` — extend `InsertEventParams` (add `hookName`, drop `toolUseId`), `StoredEvent`, `EventFilters`.
- `app/server/src/storage/sqlite-adapter.ts` — add `hook_name` column + index; drop `tool_use_id` column + index; migration; filter WHERE clause.
- `app/server/src/routes/events.ts` — pass meta to parser; write `hookName`; accept `?hookName=` query param. Stop returning `toolUseId` on the response.
- `app/server/src/routes/sessions.ts` — plumb `hookName` query param.

**Client:**

- `app/client/src/types/index.ts` — `ParsedEvent` gains `hookName`, loses `toolUseId`.
- `app/client/src/agents/claude-code/process-event.ts` — read `tool_use_id` from `raw.payload` instead of the top-level field.
- `app/client/src/agents/claude-code/event-detail.tsx` — same substitution in the Pre/Post pairing loop.
- `app/client/src/components/settings/session-modal.tsx` — same for the stats helper.
- `app/client/src/components/event-stream/event-row.tsx` — if it reads `toolUseId`, switch to payload-sourced.
- Filter bar additions deferred.

**Docs:**

- No README / DEVELOPMENT / ENVIRONMENT changes required.

**Tests:**

- `test/hooks/scripts/lib/agents/claude-code.test.mjs` — each hook event case stamps expected `hookName` / `type` / `subtype` / `toolName` / `sessionId` / `agentId`.
- `test/hooks/scripts/lib/agents/codex.test.mjs` — `hookName` / `sessionId` stamped when present; type/subtype null.
- `test/hooks/scripts/lib/agents/unknown.test.mjs` — `hookName` pass-through.
- `app/server/src/parser.test.ts` — reads from meta when present; falls back to raw payload when meta fields absent; does not attempt to extract `toolUseId`.
- `app/server/src/storage/sqlite-adapter.test.ts` — `insertEvent` stores `hookName`; migration backfill test; `tool_use_id` column absent post-migration; filter by `hookName`.
- `app/server/src/routes/sessions.test.ts` — `GET /sessions/:id/events?hookName=Stop` returns only matching rows.
- Client tests — update any fixtures that set `toolUseId` on raw events to set `payload.tool_use_id` instead.

## Risks

| Risk | Mitigation |
| ---- | ---------- |
| Parser fallback silently loses `type` / `subtype` for events from an older CLI. | Acceptable in a coordinated release. Client renders events with `hookName` when `subtype` is null. |
| Migration backfill slow on large DBs (json_extract per row). | One-time. Create index *after* backfill so CREATE INDEX doesn't contend with the UPDATE. |
| `type` / `subtype` values diverge between CLI and old server parser. | Port the switch verbatim; cover every existing case in tests. |
| `tool_use_id` column drop breaks something I missed. | Grep for all `tool_use_id` / `toolUseId` uses before merging; verified today: zero SQL WHERE clauses on the server. |
| Route-layer branching in `events.ts` still reads subagent-pairing via payload `tool_use_id`. | Unchanged — reads from the stored payload, not the column. |
| Additional meta fields balloon envelope size. | Six optional strings, most under 20 chars. Negligible. |

## Open questions

1. **Should we delete the non-hook-format branch** in `parseRawEvent`
   (lines 108+ that handle `raw.subtype` / `data.hookEvent` /
   `agent_progress` directly)? Those don't go through the agent-lib
   path today — they come from direct API callers or synthetic events.
   Probably leave alone; they're rarely-used compatibility paths.
2. **Should `hookName` be non-null in the column** (with a default
   like `'unknown'` for untagged events)? Leaning no — NULL is a
   meaningful signal that the event came in without a hook-format
   payload.
3. **Filter bar UI for `hookName`** — include in this spec or follow-up?
   Recommend: defer to a small follow-up once the column lands; users
   might want it as a distinct dimension or folded into `subtype` in
   the default view.
