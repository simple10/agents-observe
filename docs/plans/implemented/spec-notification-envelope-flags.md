# Design Spec: Notification Envelope Flags

## Problem

Claude Code sessions lose their bell indicator when a subagent emits an event
(e.g. `SubagentStop`) *after* the main agent's `Notification`. The current
server logic invalidates pending notifications on any non-Notification event,
without regard for which agent emitted it or what the event means.

Two root causes:

1. **The server decides what "clears" a notification.** It treats every
   non-Notification event as a clearing event, which is wrong when a
   subagent's stop happens after a main-agent notification.
2. **The concept is coupled to Claude Code's subtypes.** "Notification" and
   "SubagentStop" are Claude-Code-specific. Codex has different hook event
   names, so any server fix that inspects subtypes would either bake in
   Claude-Code semantics or require an ever-growing per-class allowlist.

## Goal

Keep the server agent-class-neutral. Move agent-class awareness into the CLI
(where we already have per-class hook modules) and the UI (where we already
have an `agents/` registry). Notification semantics become a contract
between CLI and UI; the server is a dumb, mechanical state-keeper.

## Non-goals

- **Per-agent notification tracking.** One slot per session is sufficient:
  a session either has a pending notification or it doesn't. Per-agent
  state is a future concern and, for Claude Code, would be a CLI concern
  (no real-world examples today of subagents emitting notifications).
- **Codex notifications.** Ship Claude Code in this pass. The Codex override
  will follow the same pattern once we have example hook payloads to test
  against.
- **UI redesign.** One bell per session stays. The bell's *source* changes;
  its presentation doesn't.
- **Multiple simultaneous pending notifications per session.** New
  notification overwrites the previous timestamp — same as today.

## Mental model

A session is in one of two notification states: **pending** or **clear**.
Transitions are driven by events:

- Some events **set** the session to pending (`isNotification: true`).
- Most events **clear** the session back to clear (default behavior).
- Some events are **neutral** and touch neither (`clearsNotification: false`).

The server applies these flags mechanically. It has no opinion about which
hook events deserve which flag — that's the CLI's job.

## Concepts

### Envelope flags (CLI → server)

Two new optional fields under `meta` on the event envelope. They're
metadata about the event — specifically, the CLI's declaration of how
this event should affect notification state — so they belong with the
other metadata, not at the top level:

```jsonc
{
  "hook_payload": { /* raw hook payload from the agent */ },
  "meta": {
    "agentClass": "claude-code",
    "env": { ... },
    "isNotification": true,       // optional, default false
    "clearsNotification": false   // optional, default true
  }
}
```

- `meta.isNotification === true` → set `pending_notification_ts = event.ts`.
- `meta.clearsNotification !== false` → set `pending_notification_ts = NULL`.
- Both flags together → `isNotification` wins (defensive; callers shouldn't set both).
- Neither flag set → default behavior is "clears."

### `pending_notification_ts` column

Rename `sessions.last_notification_ts` → `sessions.pending_notification_ts`
to reflect that it's state, not history. NULL means no pending
notification; non-NULL means pending. The `last_activity = last_notification_ts`
comparison is removed entirely.

### Server broadcast

Today the server broadcasts `notification_clear` on every non-Notification
event. After this change, it only broadcasts on actual state transitions:

- `NULL → set` → broadcast `notification`.
- `set → NULL` → broadcast `notification_clear`.
- no change → no broadcast.

Pleasant side effect: a huge reduction in pointless WS traffic.

### CLI agent-class dispatch

Each agent lib in `hooks/scripts/lib/agents/` exports a `buildHookEvent`
function. The hook command calls:

1. `getAgentClass(config, log, hookPayload)` — returns `'claude-code' | 'codex' | 'unknown'`.
   For now, trusts `config.agentClass` (already plumbed via env var and
   project-level overrides). The signature takes `hookPayload` so future
   detection heuristics can inspect payload shape without changing callers.
2. `agentLib.buildHookEvent(config, log, hookPayload)` — returns
   `{ envelope, hookEvent, toolName }`. `envelope` is the full POST body
   (including `isNotification` / `clearsNotification` if applicable).
   `hookEvent` and `toolName` are returned for logging only — no
   server-side behavior depends on them after this change.
3. POST the envelope to `/events`.

This moves the CLI's current ad-hoc envelope construction (in
`hooks.mjs::buildEnvelope`) into the per-class lib, where it can set
notification flags based on the agent's hook semantics.

### `unknown` agent fallback

A new `hooks/scripts/lib/agents/unknown.mjs` module exports a
`buildHookEvent` that builds the same envelope as today (plain pass-through)
and sets neither flag. Used when `agentClass` is missing or doesn't match
a known class. This keeps the CLI functional for agent classes that haven't
implemented their own lib yet — they just never produce notifications.

## CLI changes: flag assignments

Claude Code hook-event → flag mapping (proposal, to confirm during
implementation):

| Hook event         | `isNotification` | `clearsNotification` | Rationale                                          |
| ------------------ | ---------------- | -------------------- | -------------------------------------------------- |
| `Notification`     | `true`           | (unset)              | Canonical "awaiting user" signal.                  |
| `SubagentStop`     | (unset)          | `false`              | Subagent finishing shouldn't clear main-agent bell.|
| `Stop`             | (unset)          | `false`              | Terminal lifecycle, not "back at work." Defensive. |
| `UserPromptSubmit` | (unset)          | (unset)              | User responded → default clear is correct.         |
| `PreToolUse`       | (unset)          | (unset)              | Agent resumed work → default clear is correct.     |
| `PostToolUse`      | (unset)          | (unset)              | Default clear.                                     |
| `SessionEnd`       | (unset)          | (unset)              | Session ended → clear. Matches today's behavior.   |
| anything else      | (unset)          | (unset)              | Default clear.                                     |

Unknown agent class: always `(unset, unset)` — so no notifications ever fire, and
everything else behaves like it does today.

## Server changes

### Schema migration

1. Add a defensive `ALTER TABLE sessions RENAME COLUMN last_notification_ts TO pending_notification_ts`.
   SQLite ≥3.25 supports this; better-sqlite3 bundles a recent version.
   Matches the existing additive-migration pattern in `sqlite-adapter.ts`.
2. No data backfill needed: rows where `last_activity > last_notification_ts`
   (the "already cleared" state) should become NULL under the new semantics.
   Sweep: `UPDATE sessions SET pending_notification_ts = NULL WHERE pending_notification_ts IS NOT NULL AND pending_notification_ts < last_activity`
   (preserves current "not pending" rows).

### Ingest path

`recordEvent` (or wherever `events.ts` POSTs fan into the storage layer)
reads `meta.isNotification` and `meta.clearsNotification` from the envelope.
Single SQL update alongside the existing `last_activity` / counter bumps:

```ts
if (meta.isNotification === true) {
  pending_notification_ts = event.ts
} else if (meta.clearsNotification !== false) {
  pending_notification_ts = NULL
}
// else: leave as-is
```

The raw `parsed.subtype` is no longer inspected for notification purposes.
`last_activity` still bumps on every event (unchanged — it's the user-facing
"last seen" time and has nothing to do with notifications anymore).

### Broadcast

Compare the row's `pending_notification_ts` before and after the update.
Only broadcast on transitions:

- `before IS NULL && after IS NOT NULL` → `{ type: 'notification', data: { sessionId, projectId, ts: after } }`
- `before IS NOT NULL && after IS NULL` → `{ type: 'notification_clear', data: { sessionId, ts: event.ts } }`

### Pending query

```sql
WHERE pending_notification_ts IS NOT NULL
  AND pending_notification_ts > ?
```

(Keeps the `> ?` cursor parameter already used by `getSessionsWithPendingNotifications`.)

### No backward compatibility

Server and CLI ship together. The server no longer inspects `parsed.subtype`
for notification purposes — ever. An old CLI running against a new server
simply won't produce bells until it's updated. We accept this and keep the
server logic minimal.

## Client changes

Minimal. The client already reacts to `notification` / `notification_clear`
WS messages via `use-websocket.ts` → `notification-indicator.tsx`. No change
to those hooks.

What *does* change:

- Fewer `notification_clear` messages arrive (server only broadcasts on
  transitions). Existing client handlers are idempotent, so this is a pure
  reduction in noise.
- The bootstrap `GET /api/notifications` response shape is unchanged. Only
  the set of rows it returns changes (correctly, because the SQL is fixed).

## File-level change list

- `app/server/src/storage/sqlite-adapter.ts`
  - Rename column via `ALTER TABLE ... RENAME COLUMN`.
  - Update `recordEvent` write path: apply envelope flags; remove subtype-based logic.
  - Update `getSessionsWithPendingNotifications` query.
- `app/server/src/routes/events.ts`
  - Read `isNotification` / `clearsNotification` from envelope.
  - Replace "broadcast on every non-Notification event" logic with "broadcast on state transitions only" (requires before/after comparison — have the storage layer return the transition signal, or read-before-write).
  - Transitional subtype fallback for `isNotification`.
- `app/server/src/types.ts` / envelope type — add the two flag fields.
- `hooks/scripts/lib/hooks.mjs`
  - Replace inline `buildEnvelope` with the new dispatch:
    1. `getAgentClass(config, log, hookPayload)`
    2. `agentLib.buildHookEvent(config, log, hookPayload)` → `{ envelope, hookEvent, toolName }`
    3. POST envelope.
  - Affects all three commands: `hookCommand`, `hookSyncCommand`, `hookAutostartCommand`.
- `hooks/scripts/lib/agents/claude-code.mjs` — add `buildHookEvent`.
  Maps hook event name → flags per the table above.
- `hooks/scripts/lib/agents/codex.mjs` — add a passthrough `buildHookEvent`
  that sets no flags. (Claude Code is the only class with real flag logic
  this pass.)
- `hooks/scripts/lib/agents/unknown.mjs` (new) — fallback `buildHookEvent`
  that sets no flags.
- `hooks/scripts/lib/agents/index.mjs` (new) — exports `getAgentClass` and
  an agent-lib lookup table, so hook commands import from one place.
- Tests:
  - `app/server/src/storage/sqlite-adapter.test.ts` — add cases:
    Notification then SubagentStop → still pending; Notification then
    PreToolUse → cleared; non-flagged Notification via fallback still works.
  - `app/server/src/routes/notifications.test.ts` — covers the bootstrap
    query under the new rules.
  - `test/hooks/scripts/lib/agents/claude-code.test.mjs` — extend with
    `buildHookEvent` cases for each mapped event.
  - `test/hooks/scripts/lib/agents/unknown.test.mjs` (new) — fallback
    behavior.

## API contract

Envelope additions (both optional, both inside `meta`):

```ts
interface EventEnvelope {
  hook_payload: Record<string, unknown>
  meta: {
    agentClass: string
    env?: Record<string, string>
    isNotification?: boolean      // default false
    clearsNotification?: boolean  // default true
  }
}
```

No changes to WebSocket message shapes. No changes to client-facing REST
responses.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Old CLI running against new server produces no bells. | Accepted — server + CLI ship together as a coordinated release. |
| Rename migration fails on older SQLite. | better-sqlite3 bundles a modern SQLite; additionally, fall back to "add new column + copy + drop old" if `ALTER ... RENAME COLUMN` errors. |
| `buildHookEvent` refactor breaks `hook-sync`/`hook-autostart` paths that reuse the envelope for retry. | All three command flows call the same dispatcher; tests cover each. |
| Non-Claude-Code agents that don't update their lib get no bells. | Acceptable — they had none before either. Documented as the migration path for new agent classes. |
| Subtle behavior change: neutral events (flagged `clearsNotification: false`) now truly leave state alone, even for sessions that never had a pending notification. | Correct — this is a no-op in that case. |

## Open questions

1. **Is `Stop` worth flagging as `clearsNotification: false`?** You've never
   observed Stop-after-Notification in the wild for main agents, so either
   answer is defensible. Flagging is free insurance; not flagging is
   minimally surgical. Recommendation: flag it — the intent ("terminal
   lifecycle events don't clear the bell") reads better and is
   future-proof.
2. **`getAgentClass` detection source.** For now, trust `config.agentClass`
   exactly as `buildEnvelope` does today. Future iterations may sniff the
   hook payload shape (e.g. `hook_event_name` vs Codex's payload schema)
   to improve reliability when the config is wrong. Defer.
3. **Cursor column name.** The existing notifications endpoint uses a
   `since` cursor parameter compared against `last_notification_ts`.
   Rename the internal usage to `pending_notification_ts` consistently;
   the public query param (`since`) can stay the same.
