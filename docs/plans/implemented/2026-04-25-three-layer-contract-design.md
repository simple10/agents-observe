# Three-Layer Contract Refactor — Design

**Date:** 2026-04-25
**Status:** Draft (ready for plan)
**Supersedes:** 2026-04-24-server-simplification-design.md

## Goal

Lock down clean, minimal contracts between the three layers of the system so that:

1. Adding a new agent class never requires touching server code.
2. The server has zero implicit behavior — every action is the result of an explicit envelope signal.
3. Database fields and API responses contain only what is genuinely required to function. Display- and convenience-derived data lives in the client.

This refactor is in service of agents-observe being reused across multiple Mission Control projects. The cost of getting layer separation wrong scales with the number of downstream consumers, so we pay the refactor tax once here.

## The Three Layers

### Layer 1 — Hook libs (`hooks/scripts/lib/agents/*.mjs`)

Per-agent-class libs that read raw hook payloads, build the envelope, and POST to the server. Their job is **payload normalization into the envelope only**. They never mutate the raw payload.

Specifically, hook libs are responsible for lifting the following identity / hint fields **from** the raw payload **into** the envelope (top-level or `_meta`):
- `sessionId` (envelope identity)
- `agentId` (envelope identity; default to `sessionId` if not present)
- `hookName` (envelope identity)
- `cwd` (envelope optional, per-event)
- `timestamp` (envelope optional)
- `_meta.session.transcriptPath` (when present and starting a new session)
- `_meta.session.startCwd` (the cwd at session start — used by project resolution)
- `_meta.session.slug` / `gitBranch` / etc. (prefetched from transcript or env)

The raw payload itself is forwarded unchanged. Field extraction logic is the only place agent-class-specific payload knowledge lives in Layer 1.

A `default.mjs` lib is the canonical implementation. It assumes the standard hook-event shape (`session_id`, `transcript_path`, `cwd`, `hook_event_name`) and does the lifting above. Any agent whose payload uses that shape needs no custom code — its entry just calls `default.buildHookEvent` with its `agentClass` constant. Custom libs only exist for agents whose payloads diverge.

### Layer 2 — Server (`app/server/`)

The server stores events, attributes them to sessions/agents/projects, and broadcasts notifications. It is **agent-class-agnostic**: it never inspects payload shape, never branches on hook names. It only acts on:

- **Identity fields** at the envelope top level — required for routing.
- **Creation hints** under `envelope._meta` — used only when creating a new row.
- **Behavior flags** under `envelope.flags` — direct instructions, log-only, never persisted.

That's the whole contract. A hook lib author can read this contract and predict server behavior with no surprises.

### Layer 3 — Client (`app/client/src/agents/<class>/`)

Per-agent-class registrations that own everything user-facing: how events are summarized, threaded, grouped, displayed; how subagent hierarchies are reconstructed; how status is derived. The client receives raw payloads and parses them itself. Anything class-specific lives here and only here.

Layer 3 also patches mutable state back to the server via REST (e.g. agent name/description discovered in PostToolUse payloads, manual project assignments, manual session moves). The server treats these as authoritative writes; it does not validate them against payload heuristics.

## Layer 1 Contract — The Envelope

```ts
type Envelope = {
  // Identity (required)
  agentClass: string             // Picks Layer 3 registration on the client
  sessionId: string              // Required; rejected if absent
  agentId: string                // Required; defaults to sessionId in hook lib if payload has no agent_id
  hookName: string               // Identity / filter field

  // Optional event-level data
  cwd?: string                   // Per-event cwd (varies across subagents/worktrees)
  timestamp?: number             // Defaults to ingest time if absent

  // Raw payload — never mutated
  payload: object

  // Creation hints — server reads these only when creating a new row
  _meta?: {
    session?: {
      slug?: string
      transcriptPath?: string
      startCwd?: string          // For sibling-project matching
      metadata?: object          // Populates sessions.metadata blob
    }
    project?: {
      id?: number                // Exact match, obeyed
      slug?: string              // Find-or-create by slug, obeyed
    }
    agent?: {
      name?: string
      description?: string
      type?: string
      // Note: parentId intentionally omitted — Layer 3 derives hierarchy from events
    }
  }

  // Behavior flags — server reacts, then discards. Not persisted.
  flags?: {
    startsNotification?: boolean
    clearsNotification?: boolean
    stopsSession?: boolean
    resolveProject?: boolean
  }
}
```

### Why `_meta` (with leading underscore)

`_meta` is the bag of *instructional* envelope data the server inspects on first-write of a row. The leading underscore signals "internal / set by the hook lib for the server." It reserves a future `metadata` key for actual additional payload metadata if hook libs ever need to attach extra info that isn't part of the raw payload.

Hook libs are stateless and have no way to know whether a given event is the first one for its session. They populate `_meta.session.*` and `_meta.agent.*` fields on **every** event when the corresponding info is available in the raw payload. The server uses these fields **only** when actually creating a new row; on subsequent events for an existing row, the fields are ignored (or persisted in `events._meta` for traceability but not applied to the row).

Storage policy: the server persists `events._meta` to the events table for debugging traceability ("what did the hook lib say about this event when it ingested?"). Returned in the REST `/sessions/:id/events` response (full event), omitted from the WS broadcast.

### Why `flags` is log-only

Flags are signals that drive state transitions, not state themselves:

- `startsNotification` → server sets `sessions.pending_notification_ts`
- `clearsNotification` → server clears it
- `stopsSession` → server sets `sessions.stopped_at`
- `resolveProject` → server runs project resolution (see below)

After consumption the flag has done its job; the resulting state lives on the appropriate row. Storing the flag adds no information. Logged on receipt for debugging; not persisted.

### Default hook lib pattern

`default.mjs` exports `buildHookEvent(config, log, payload)` and a few helpers (`buildEnv`, `isNotificationEvent`, etc.) that other libs can compose:

```js
// codex.mjs
import * as defaultLib from './default.mjs'

export function buildHookEvent(config, log, payload) {
  const env = defaultLib.buildHookEvent(config, log, payload)
  env.agentClass = 'codex'
  // Codex-specific overrides go here
  return env
}
```

A new agent class with a conforming payload needs ~5 lines: import default, override `agentClass`, export.

## Layer 2 Contract — Server Behavior

### What the server does

For every POST `/api/events`:

1. **Validate identity.** If `agentClass`, `sessionId`, `agentId`, or `hookName` is missing, return HTTP 400 with `{ error: { message, missingFields: [...] } }`. No partial inserts.
2. **Upsert session row.** If new: insert with `started_at = event.timestamp`, `last_activity = event.timestamp`, populate from `_meta.session.*` (slug, transcriptPath, startCwd, metadata). If existing: update `last_activity = event.timestamp` only; never overwrite slug, transcript_path, start_cwd, or metadata (manual UI edits stick).
3. **Resolve project** if session has no `project_id` yet (algorithm below).
4. **Upsert agent row.** If new: insert with `agent_class = envelope.agentClass`, populate from `_meta.agent.*` (name, description, type). If existing: never overwrite `agent_class` (locked at first write); other fields are Layer 3's responsibility via PATCH.
5. **Insert event row** with the provided fields. `payload` and `_meta` stored as-is JSON. `created_at = Date.now()` server-side.
6. **Apply flags** in this order (so a single event can both clear an old notification and start a new one):
   - `clearsNotification` → set `pending_notification_ts = NULL`, `pending_notification_count = 0`. Leave `last_notification_ts` alone.
   - `startsNotification` → set `pending_notification_ts = event.timestamp`, `last_notification_ts = event.timestamp`, `pending_notification_count += 1`.
   - `stopsSession` → set `sessions.stopped_at = event.timestamp`.
7. **Compose response.** Default body is `{ id: eventId }`. If the server needs information it can't compute itself (e.g. session row was just created with no slug), it adds a `requests` array of named callbacks the CLI should dispatch. See "Server-initiated callbacks" below.
8. **Broadcast.** Per-session WS event broadcast (subscribed clients) + global activity ping (all clients).

### Server-initiated callbacks

The server stays agent-class-agnostic by *naming* the information it needs rather than parsing payloads or transcripts itself. When something is missing that an agent-class lib can compute, the event response includes a `requests` array:

```json
{
  "id": 12345,
  "requests": [
    {
      "name": "getSessionInfo",
      "callback": "/api/callbacks/session-info/sess-abc",
      "args": { "transcriptPath": "/path/to/transcript.jsonl", "agentClass": "claude-code" }
    }
  ]
}
```

The CLI dispatches each named request to the matching function on its hook lib (e.g. `lib.getSessionInfo(args, ctx)`), then POSTs the result to the supplied callback URL. This keeps Layer 2 from inspecting payloads while letting it fill in agent-class-specific session metadata on demand. The flow is amortized: callbacks fire only when state is missing, not on every event.

Defined callbacks (Layer 2 contract):

- **`getSessionInfo`** — fired when a session row is created and lacks `slug`. CLI returns `{ slug, gitBranch }`. Server populates the session row.

Hook libs implement only the callbacks their agent class can satisfy. The server gracefully degrades when a callback isn't implemented or fails — slug stays NULL, project resolution falls through to other branches.

### What the server does NOT do

- Inspect event payload contents (with one narrow exception: `events.cwd` extraction if hook lib didn't provide it at the envelope level — and even this is a transitional convenience worth questioning).
- Branch on `hookName` values.
- Derive event status, type, subtype, or category.
- Auto-resolve projects without an explicit flag.
- Compute denormalized counters (`event_count`, `agent_count`).
- Walk transcripts itself. (It *requests* this work via callbacks — the work happens in Layer 1.)
- Build agent hierarchies.
- Generate event summaries.

### Project resolution algorithm

Note: project resolution evaluates against `sessions.start_cwd` and `sessions.transcript_path`, not the per-event `cwd`. The current event's cwd may diverge (worktrees, subagents, `cd`); session-level fields are the stable identity for grouping.

```
on event for session S:
  if S.project_id is not null:
    skip (sticky after first assignment)
  elif _meta.project.id is set:
    assign that id (validated to exist; if not, fall through to next branch)
  elif _meta.project.slug is set:
    find-or-create-by-slug(slug)  // retry-once on UNIQUE collision
  elif flags.resolveProject is true:
    candidate_cwd = S.start_cwd  // already populated in step 2
    candidate_basedir = dirname(S.transcript_path)
    candidates = sessions WHERE id != S.id AND project_id IS NOT NULL AND (
        (start_cwd = candidate_cwd AND candidate_cwd IS NOT NULL) OR
        (dirname(transcript_path) = candidate_basedir AND candidate_basedir IS NOT NULL)
      )
      ORDER BY last_activity DESC LIMIT 1
    if candidate found:
      assign candidate.project_id
    else:
      slug = derive_slug_from(candidate_cwd or candidate_basedir or 'unnamed')
      find-or-create-by-slug(slug)
  else:
    leave S.project_id as NULL  // frontend renders in "Unassigned"
```

Sessions with `project_id IS NULL` render in a frontend-managed "Unassigned" group. There is no "unknown" project row.

**Slug-collision handling:** `find-or-create-by-slug` runs `INSERT … ON CONFLICT(slug) DO NOTHING` then `SELECT id FROM projects WHERE slug = ?`. If both the insert and the select fail (impossible under SQLite's serial writes, but defend anyway), retry the SELECT once. Never auto-suffix (`-2`) — concurrent inserts must converge on the same row.

**Sibling-match tiebreaker:** most recent `last_activity` wins. Stable: SQLite's `ORDER BY last_activity DESC LIMIT 1` is deterministic.

**Transcript basedir:** plain `dirname(transcript_path)` — no agent-class-specific extraction. The current `extractProjectDir` heuristic in `utils/slug.ts` goes away.

## Layer 3 Contract — Client

The client receives raw `payload` plus minimal envelope identity fields. It owns:

- Event summaries (per-agent-class registration).
- Event grouping (`groupId`, `turnId` derivation).
- Status derivation (PreToolUse → running, etc.).
- Subagent hierarchy reconstruction by walking events.
- Threading (UserPromptSubmit → Stop boundaries).
- Tool-name extraction and filtering.
- Display-time patching of agent metadata back to the server when richer info shows up in events (PostToolUse for Agent tool, etc.).

The client maintains an in-memory UI store keyed by `agent_id` for derived agent state (cwd, parent, etc.). When this state stabilizes (e.g. after seeing a definitive PostToolUse Agent event), the client may PATCH `/api/agents/:id` to persist canonical fields (`name`, `description`, `agent_type`).

## Database Schema

### `events`

```sql
id              integer  PK
session_id      text     NOT NULL  REFERENCES sessions(id)
agent_id        text     NOT NULL  REFERENCES agents(id)
hook_name       text     NOT NULL
payload         json     NOT NULL
timestamp       integer  NOT NULL
cwd             text     NULL
_meta           json     NULL
created_at      integer  NOT NULL
```

Indexes: `(session_id, timestamp)`, `(agent_id, timestamp)`, `(session_id, hook_name)`.

Removed from current schema: `type`, `subtype`, `tool_name`, `composite type+subtype index`.

### `sessions`

```sql
id                          text     PK
project_id                  integer  NULL  REFERENCES projects(id)
slug                        text     NULL
started_at                  integer  NOT NULL
stopped_at                  integer  NULL
transcript_path             text     NULL
start_cwd                   text     NULL
last_activity               integer  NOT NULL
pending_notification_ts     integer  NULL
pending_notification_count  integer  NOT NULL DEFAULT 0
last_notification_ts        integer  NULL
metadata                    json     NULL
created_at                  integer  NOT NULL
updated_at                  integer  NOT NULL
```

Removed: `status` (derive from `stopped_at`), `event_count`, `agent_count` (compute via GROUP BY).

Added: `start_cwd` (the cwd recorded when the session was first observed; used by project resolution to find sibling sessions). Set from `_meta.session.startCwd` on session insert; never updated thereafter.

`project_id` is nullable; sessions with NULL render in "Unassigned" client-side.

Indexes: `(project_id, last_activity)` for sidebar queries, `(start_cwd)` and `(transcript_path)` for project-resolution sibling matching.

### `agents`

```sql
id           text     PK
agent_class  text     NOT NULL
name         text     NULL
description  text     NULL
agent_type   text     NULL
created_at   integer  NOT NULL
updated_at   integer  NOT NULL
```

Removed: `session_id` (agents are not 1:1 with sessions in all classes), `parent_agent_id` (Layer 3 derives from events), `transcript_path` (write-only in current schema), `metadata` (unused; can come back if needed).

### `projects`

```sql
id          integer  PK
slug        text     NOT NULL UNIQUE
name        text     NOT NULL
created_at  integer  NOT NULL
updated_at  integer  NOT NULL
```

Removed: `cwd`, `transcript_path` (sessions are source of truth for project resolution), `metadata` (unused).

### `agents_sessions` — deferred

Not added in this refactor. The `agent_classes[]` aggregate query becomes:

```sql
SELECT DISTINCT a.agent_class
FROM events e JOIN agents a ON e.agent_id = a.id
WHERE e.session_id = ?
```

If profiling shows this is hot, add `agents_sessions(agent_id, session_id, agent_class)` with `INSERT OR IGNORE` on every event. Not before.

## Wire Protocols

### REST `/api/sessions/:id/events`

Returns the full event row (per event):

```json
{
  "id": 12345,
  "timestamp": 1777056008484,
  "agent_id": "abc...",
  "hook_name": "PostToolUse",
  "cwd": "/path/...",
  "payload": { ... },
  "_meta": { ... },
  "created_at": 1777056008485
}
```

`session_id` omitted — implicit from the URL. Bandwidth is bounded by session size and the user is explicitly asking for one session's history; full payloads here are fine.

No `?fields=` parameter. The historical-load REST path returns everything; trimming happens only on the high-volume WS broadcast path below.

### WebSocket — per-session subscribed broadcast

Trimmed to the minimum the client needs to render a new event row. Layer 3 derives display data from `payload` and `hook_name`; cwd, `_meta`, and `created_at` are not used by any client renderer.

```json
{ "type": "event",
  "data": { "id", "timestamp", "agent_id", "hook_name", "payload" } }
```

`session_id` omitted — subscription scope makes it implicit.

### WebSocket — global activity broadcast

```json
{ "type": "activity",
  "data": { "sessionId", "eventId", "ts" } }
```

Unchanged from current implementation.

### REST `/api/agents/:id` (PATCH)

Layer 3's persistence path for derived agent metadata. Accepts a partial body containing any subset of `{ name, description, agent_type }` (all string-or-null). Unrecognized fields and attempts to change `id` / `agent_class` are silently ignored — keeps the endpoint forgiving as agent classes evolve. Returns the updated row. Replaces the currently-dead `updateAgentMetadata` endpoint.

## Notification Semantics

Server-side state lives on `sessions`:
- `pending_notification_ts` — non-null means a notification is currently waiting
- `pending_notification_count` — how many start signals have fired since last clear
- `last_notification_ts` — most recent start signal ever (for sort-by-recent-attention)

Hook libs decide what counts as a notification per agent class; envelope flags carry the signal. Server has no special knowledge of which hook events should notify — it only obeys `flags.*Notification`.

## Removals (concrete list)

### Server endpoints

- `GET /api/events/:id/thread` — dead
- `GET /api/agents/:id/events` — dead
- (Callbacks: kept. `POST /api/callbacks/session-info/:id` stays as the canonical channel for `getSessionInfo` results — see Layer 2 contract.)

### Server logic

- `getThreadForEvent` in storage adapter
- `deriveEventStatus` in routes
- All `subtype === 'X'` branches in `routes/events.ts`
- `parser.ts` simplifies to envelope validation + identity extraction. Subagent-extraction (PreToolUse/PostToolUse/SubagentStop branches) and the transcript-JSONL fallback path go away — moves to Layer 3.
- `extractProjectDir` heuristic in `utils/slug.ts` — replaced by plain `dirname()` in the resolver
- `services/project-resolver.ts` — rewritten per the new algorithm
- "Unknown" singleton project shim
- `event_count` / `agent_count` denormalization on session insert/delete
- Pending-agent maps (`pendingAgentMeta`, `pendingAgentMetaQueue`, `pendingAgentTypes`) — Layer 3 reconstructs subagent metadata from events; server holds no pairing state.

### Database columns

- `events.type`, `events.subtype`, `events.tool_name`
- `sessions.status`, `sessions.event_count`, `sessions.agent_count`
- `agents.session_id`, `agents.parent_agent_id`, `agents.transcript_path`, `agents.metadata`
- `projects.cwd`, `projects.transcript_path`, `projects.metadata`

### Hook lib code

- `deriveTypeSubtype` from all three libs
- `unknown.mjs` renames to `default.mjs`; per-class libs delegate to it
- (`getSessionInfo`: kept as a callback handler. Hook libs continue to implement it; the CLI dispatches when the server's response carries a matching `requests` entry.)

### Client code

The wide one. Every site that reads `event.subtype`, `event.type`, `event.tool_name`, or `event.status` from API responses moves to deriving from `event.hookName` + `event.payload` via the agent-class registration. Tests need parallel updates.

## Migration Considerations

This spec is deliberately silent on phasing — the actual implementation plan should sequence work to keep `main` green at each step. High-level: phases that drop dead code can ship independently before the wire-protocol changes; the wire-protocol changes need to be coordinated with the client refactor; the column drops need a SQLite table-rebuild migration.

A separate plan doc (`docs/plans/YYYY-MM-DD-three-layer-contract-impl.md`) will spell out phasing, testing strategy, and risk-ordered rollout.

## Open questions deferred to plan time

- **Frontend rendering of NULL-project sessions.** "Unassigned" bucket in sidebar; new UI element. Sketch lives in the implementation plan.
- **Migration data path.** Existing rows have `type` / `subtype` / `tool_name` / `agent_class` denormalized in places that will move. Plan must specify whether to backfill `_meta` from existing data or accept that legacy events lack envelope traceability. Recommendation: don't backfill — drop columns, leave existing event rows with NULL `_meta`. Pre-refactor events still display correctly via Layer 3 deriving from `hook_name` + `payload`.
- **Concrete agent-class registration shape on the client.** Today's `AgentClassRegistration` interface (`app/client/src/agents/types.ts`) needs additions for status derivation, hierarchy reconstruction, and subagent-pairing. Plan time decides exact signatures.

## Summary in one paragraph

The server becomes a pure event-attribution and state-transition machine driven by an explicit envelope contract. Hook libs do all payload-shape normalization in their own layer; the client does all display- and hierarchy-derivation in its layer. The server's behavior is fully predictable from the envelope alone. New agent classes whose payloads conform to the standard shape need only an `agentClass` constant; non-conforming agents need a thin lib that translates into the standard envelope. Database fields and API responses are pruned to what genuinely must persist or cross the wire. Everything else lives in the client.
