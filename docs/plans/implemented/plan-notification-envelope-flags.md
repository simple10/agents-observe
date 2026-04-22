# Implementation Plan: Notification Envelope Flags

Companion to [spec-notification-envelope-flags.md](./spec-notification-envelope-flags.md).
Read the spec first.

## Branch

`feat/notification-envelope-flags` off `main`.

## Phasing

Six phases. Server and CLI ship together (no backwards compat), but each
phase leaves the working tree type-clean and testable on its own. One PR
per phase unless two are trivially small — then combine.

---

### Phase 1 — Envelope typing + constants

Pure plumbing. Introduces the new optional fields without any logic change
so later phases have a stable type to hang behavior on.

**Files:**

- `app/server/src/types.ts` (or wherever the envelope type lives — confirm by grepping
  for `hook_payload` + `agentClass`). Add the two optional fields to the meta
  sub-object:
  ```ts
  interface EventEnvelope {
    hook_payload: Record<string, unknown>
    meta: {
      agentClass: string
      env?: Record<string, string>
      isNotification?: boolean
      clearsNotification?: boolean
    }
  }
  ```
- Any matching type on the client side if one exists (grep for `EventEnvelope`
  or similar in `app/client/src` — this is a server-internal contract, so
  likely nothing on the client).

**Done:** `tsc --noEmit` clean.

---

### Phase 2 — Storage: rename column + flag-driven write path + pending query

Self-contained server change. Single migration, clear unit-test coverage.

**Files:**

- `app/server/src/storage/sqlite-adapter.ts`:
  - Migration: rename `sessions.last_notification_ts` → `sessions.pending_notification_ts`.
    Primary path: `ALTER TABLE sessions RENAME COLUMN last_notification_ts TO pending_notification_ts`.
    Defensive fallback if the rename fails: add new column, copy values where
    `last_notification_ts IS NOT NULL AND last_activity = last_notification_ts`
    (only the currently-pending rows), then drop the old column. Matches the
    existing defensive migration pattern in this file.
  - Backfill clear sweep (runs once after rename):
    ```sql
    UPDATE sessions
    SET pending_notification_ts = NULL
    WHERE pending_notification_ts IS NOT NULL
      AND pending_notification_ts < last_activity
    ```
    Rows where `last_activity > last_notification_ts` (already-cleared today)
    become NULL. Rows where the two were equal (currently pending) stay set.
  - Update `recordEvent` (or the method that inserts events + updates session
    counters — the one around lines 387–403). Replace the current
    `isNotification ? 1 : 0` branch with a flag-driven block. Return a
    transition signal to the caller:
    ```ts
    async recordEvent(..., meta: { isNotification?: boolean; clearsNotification?: boolean }) {
      const before = SELECT pending_notification_ts FROM sessions WHERE id = ?
      let after = before
      if (meta.isNotification === true) after = event.ts
      else if (meta.clearsNotification !== false) after = null
      UPDATE sessions SET pending_notification_ts = ?, last_activity = MAX(...) WHERE id = ?
      return { notificationTransition: transitionFrom(before, after), eventTs: event.ts }
    }
    ```
    Helper: `transitionFrom(before, after)` → `'set' | 'cleared' | 'none'`.
  - Update `getSessionsWithPendingNotifications` (~lines 408–437) query to:
    ```sql
    WHERE s.pending_notification_ts IS NOT NULL
      AND s.pending_notification_ts > ?
    ORDER BY s.pending_notification_ts DESC
    ```
  - Rename any other reference to `last_notification_ts` in this file.

- `app/server/src/storage/types.ts`:
  - Update the storage interface `recordEvent` return type to include
    `notificationTransition` + `eventTs`.

**Tests — extend `app/server/src/storage/sqlite-adapter.test.ts`:**

The user's cursor is already on a `last_non_notif` test case (line 225) —
worth auditing that suite for renames while we're in there.

Cases to add:

- Notification → pending query returns the session.
- Notification then event with `clearsNotification: false` → still pending.
- Notification then event with defaults → cleared.
- Notification then `isNotification: true` (second one) → pending, ts advanced.
- Migration backfill: seed a row with `last_notification_ts = X, last_activity = Y > X`
  before the schema runs; after migration, `pending_notification_ts` is NULL.
- Migration backfill: seed `last_notification_ts = last_activity = X`; after
  migration, `pending_notification_ts = X`.

**Done:** sqlite-adapter tests green, type-clean.

---

### Phase 3 — Server broadcast: transitions-only

Uses the transition signal from Phase 2 to drive WS broadcasts. Removes the
existing "broadcast on every non-Notification event" behavior.

**Files:**

- `app/server/src/routes/events.ts` (~lines 329–350):
  - Replace:
    ```ts
    if (parsed.subtype === 'Notification') broadcast('notification', ...)
    else broadcast('notification_clear', ...)
    ```
  - With (pseudo):
    ```ts
    const { notificationTransition, eventTs } = await store.recordEvent(..., meta)
    if (notificationTransition === 'set') {
      broadcastToAll({ type: 'notification', data: { sessionId, projectId, ts: eventTs } })
    } else if (notificationTransition === 'cleared') {
      broadcastToAll({ type: 'notification_clear', data: { sessionId, ts: eventTs } })
    }
    // 'none' → no broadcast
    ```
  - Remove any remaining `parsed.subtype === 'Notification'` checks in the
    notification path (`parsed.subtype` stays for other, unrelated concerns
    like `SessionStart` handling).

- `app/server/src/routes/notifications.ts`:
  - Verify `GET /notifications` returns rows using the new column name. Likely
    already flows through `getSessionsWithPendingNotifications`, so no change.

**Tests — extend `app/server/src/routes/notifications.test.ts`:**

- Existing tests need column renames — let them fail then fix.
- Add: the bootstrap endpoint returns only sessions currently pending under
  the new rules (stale rows with `last_activity > pending_notification_ts`
  do NOT appear — but they should never exist post-migration, so this is
  really a "sanity-after-migration" assertion).

**Tests — new for broadcast behavior:**

If there isn't already a WS test harness, extend `app/server/src/app.test.ts`
or `routes/sessions.test.ts` style patterns:

- Ingest Notification event → WS gets `notification` once.
- Ingest event with `clearsNotification: false` → WS gets nothing.
- Ingest defaults event → WS gets `notification_clear` once (if there was
  pending state); nothing if there wasn't.

If extending WS tests isn't tractable in this repo's test setup, fall back
to asserting against a broadcast mock injected into the route — the
existing `broadcastToAll` is already a plain function.

**Done:** notifications route tests green, new broadcast cases pass,
manual WS smoke shows no more spammy `notification_clear` messages on
ordinary events.

---

### Phase 4 — CLI agent lib: `buildHookEvent` + `getAgentClass` + `unknown` fallback

Pure CLI refactor; no behavior change server-side. Introduces the agent-lib
dispatch pattern the spec describes.

**Files:**

- `hooks/scripts/lib/agents/index.mjs` (new):
  - Re-exports `claudeCode`, `codex`, `unknown` libs.
  - Exports `getAgentClass(config, _log, _hookPayload)` — returns a known
    class string or `'unknown'`. For now, trusts `config.agentClass`;
    treats unrecognized strings as `'unknown'`. Function takes `hookPayload`
    for future-proofing without breaking callers.
  - Exports `getAgentLib(agentClass)` — returns the matching lib module,
    falling back to `unknown`.
- `hooks/scripts/lib/agents/claude-code.mjs`:
  - Add `buildHookEvent(config, log, hookPayload)` → `{ envelope, hookEvent, toolName }`.
  - Extract the envelope construction currently inlined in
    `hooks.mjs::buildEnvelope`. Layer on flag assignment:
    ```js
    const hookEvent = hookPayload.hook_event_name || 'unknown'
    const flags = {}
    if (hookEvent === 'Notification') flags.isNotification = true
    else if (hookEvent === 'SubagentStop' || hookEvent === 'Stop') flags.clearsNotification = false
    const envelope = {
      hook_payload: hookPayload,
      meta: { agentClass: 'claude-code', env: buildEnv(config), ...flags },
    }
    return { envelope, hookEvent, toolName: hookPayload.tool_name || hookPayload.tool?.name || '' }
    ```
- `hooks/scripts/lib/agents/codex.mjs`:
  - Add `buildHookEvent(config, log, hookPayload)` that builds a plain
    envelope with `agentClass: 'codex'` and no notification flags.
- `hooks/scripts/lib/agents/unknown.mjs` (new):
  - `buildHookEvent` mirroring Codex's — plain envelope, no flags.
  - Also exports a no-op `getSessionInfo` returning `null` so the
    callbacks dispatcher never blows up.

**Tests:**

- `test/hooks/scripts/lib/agents/claude-code.test.mjs` — extend:
  - `buildHookEvent` for `Notification` → `meta.isNotification === true`.
  - `buildHookEvent` for `SubagentStop` → `meta.clearsNotification === false`.
  - `buildHookEvent` for `Stop` → `meta.clearsNotification === false`.
  - `buildHookEvent` for `UserPromptSubmit` → neither flag set.
  - Returned `hookEvent`/`toolName` match the payload.
- `test/hooks/scripts/lib/agents/codex.test.mjs` — extend:
  - `buildHookEvent` always returns neither flag.
- `test/hooks/scripts/lib/agents/unknown.test.mjs` (new):
  - `buildHookEvent` always returns neither flag.
  - `getSessionInfo` returns null.
- `test/hooks/scripts/lib/agents/index.test.mjs` (new):
  - `getAgentClass` for known/unknown values.
  - `getAgentLib` returns the `unknown` module on miss.

**Done:** all CLI lib tests green.

---

### Phase 5 — CLI hook commands use agent-lib dispatch

Plugs Phase 4 into `hooks.mjs`. Retires `buildEnvelope` in that file.

**Files:**

- `hooks/scripts/lib/hooks.mjs`:
  - Remove local `buildEnvelope` (moved to `claude-code.mjs`) and
    `getHookEventName` (moves into the agent lib too — each lib can derive
    it from the payload as it sees fit).
  - Update `sendHookSync` body to:
    ```js
    const agentClass = getAgentClass(config, log, hookPayload)
    const lib = getAgentLib(agentClass)
    const { envelope, hookEvent, toolName } = lib.buildHookEvent(config, log, hookPayload)
    log.debug(`Hook event: ${hookEvent}${toolName ? ` tool=${toolName}` : ''}`)
    const result = await postJson(`${config.apiBaseUrl}/events`, envelope, { log })
    return { result, envelope }
    ```
  - Apply the same refactor to `hookCommand` (the fire-and-forget path) so
    both paths share dispatch logic — or extract a shared helper.
- `hooks/scripts/lib/callbacks.mjs`:
  - Extend `AGENT_LIBS` table (or use `getAgentLib` from the new index
    module) so `getSessionInfo` dispatch and `getAgentLib` stay consistent.
    Prefer having one registry imported from `agents/index.mjs` and reuse
    it here.

**Tests — extend `test/hooks/scripts/observe_cli.test.mjs`:**

- Existing "adds project slug metadata without mutating hook payload" case
  already validates envelope shape — assert it now sees `meta.agentClass`
  and, for a `Notification` payload, `meta.isNotification === true`.
- Add: `SubagentStop` payload → envelope carries `meta.clearsNotification === false`.
- Add: unknown agent class → envelope carries no flags.

**Done:** all hook tests green. `observe_cli.test.mjs` covers the flag
table end-to-end.

---

### Phase 6 — Integration, polish, `just check`

**Steps:**

1. Run `just check` from a clean tree. Fix any residuals (renames missed
   in test files, JSdoc comments referencing `last_notification_ts`, etc.).
2. Hand-smoke test via `just dev`:
   - Spawn a Claude Code session, emit a Notification (e.g., ask for user
     approval on something). Confirm the bell lights.
   - While Notification is pending, trigger a subagent (via `Agent` tool).
     Watch for `SubagentStop` event — confirm the bell *does not* clear.
   - Dismiss the bell, then trigger another Notification → bell re-lights
     (dismissed state correctly cleared per existing client logic).
3. Grep for leftover references:
   - `last_notification_ts` (should be zero in source, ok to keep in
     migration code and tests if needed).
   - `parsed.subtype === 'Notification'` in notification-related code paths
     (should be zero; the string may appear in parser/icon code which is
     unrelated).
4. Decide on the spec's **open question #1** based on smoke testing —
   if `Stop` never appears post-Notification in practice, the `Stop`
   flag is pure defense and we keep it. If it does come up, it's
   correctly flagged. Either way: leave the flag in place.

**Done criteria:**

- `just check` passes.
- Notification → SubagentStop → bell stays lit (primary bug fix).
- Notification → PreToolUse/UserPromptSubmit → bell clears (existing
  behavior preserved).
- No spammy `notification_clear` messages on ordinary events (WS trace in
  devtools shows a clean signal).
- Single `ALTER TABLE` migration; `sessions.pending_notification_ts`
  present, `last_notification_ts` absent.
- CLI dispatch uses `getAgentClass` → `buildHookEvent`; `unknown` fallback
  works when `AGENTS_OBSERVE_AGENT_CLASS` is set to something unrecognized.

---

## Out of scope for this plan

- Per-agent notification tracking (future CLI concern; see spec non-goals).
- Codex flag assignments (stubbed passthrough; Codex hook semantics
  require separate testing and land in a follow-up PR).
- Multi-pending notifications per session (one slot stays).
- UI redesign. One bell per session; visual unchanged.
- Any refactor to `parsed.subtype` usage outside notification code paths.

## Risks

| Risk | Mitigation |
|----- | ---------- |
| `ALTER ... RENAME COLUMN` unsupported by bundled SQLite. | Defensive fallback (add/copy/drop) in the migration code — same pattern used elsewhere in `sqlite-adapter.ts`. |
| `recordEvent` return-shape change ripples into callers I missed. | TypeScript catches it; grep for call sites before merging Phase 2. |
| CLI dispatch refactor breaks `hook-sync` / `hook-autostart` retry path (they reuse `envelope`). | All three command flows go through the same dispatcher; existing `observe_cli.test.mjs` covers retry-after-autostart. |
| `agents/index.mjs` and `callbacks.mjs` get out of sync if one isn't updated to use the shared registry. | Single `AGENT_LIBS` export from `agents/index.mjs`; `callbacks.mjs` imports it. |

## Notes on the CLI dispatch shape

The user's proposed flow was:

```
1. getAgentClass(config, log, hookPayload) → 'claude-code' | 'codex' | 'unknown'
2. agentLib.buildHookEvent(config, log, hookPayload) → { envelope, hookEvent, toolName }
3. POST envelope to server
```

The plan honors that. Two practical notes:

- `buildHookEvent` returning `hookEvent` + `toolName` alongside the envelope
  lets hooks.mjs log them without re-parsing the payload. These are derived
  values, so it's cleaner than having each caller dig into
  `hookPayload.hook_event_name` again.
- `getAgentClass` takes `hookPayload` in its signature even though the
  initial implementation only reads `config.agentClass`. Keeping the
  payload argument means future detection heuristics (e.g. sniff codex's
  payload shape when `config.agentClass` is wrong) won't require a
  call-site migration.
