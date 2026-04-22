# Design Spec: Configurable Notification Events

## Problem

The CLI currently hardcodes which hook events set notification-pending
state. Claude Code only flags `Notification` → `isNotification: true`;
every other event falls through to the default "clears" behavior (or to
an agent-class-specific non-clearing list for `Stop` / `SubagentStop`).

Users have two kinds of reasons to want more control:

1. **Agents that rarely or never emit `Notification`.** For Claude Code
   sessions that mostly complete on their own, a bell on `Stop` ("I'm
   done, come look") is more useful than never lighting up at all.
2. **Opting out entirely.** Some users run long Claude Code sessions
   where they don't want bells at all and would rather rely on the
   dashboard being visible.

Today both cases require code changes. We want a single env var.

## Goal

Add `AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS` — a comma-separated list of
hook-event names that should stamp `meta.isNotification: true` on the
outgoing envelope. Value is read by the CLI, consulted by each agent
lib's `buildHookEvent`. Server is unaffected; it continues applying
whatever flags the CLI stamps.

## Non-goals

- **Making the "non-clearing" list configurable.** `SubagentStop` and
  `Stop` stay hardcoded as non-clearing for Claude Code. Different
  concern; different user ask.
- **Per-session or per-project config.** Global env var only. A future
  spec can layer project-level overrides if needed.
- **Server changes.** The server stays agent-class-neutral; it applies
  whatever the CLI sends.
- **Changing the "one bell per session" model.** This adds new triggers
  for pending, not a new notion of multi-bell or per-agent bells.

## Concepts

### The env var

`AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS` — optional, comma-separated list
of hook-event names (e.g. `Notification`, `Stop`).

Three distinct states:

| Env var                              | Parsed value         | Meaning                     |
| ------------------------------------ | -------------------- | --------------------------- |
| *unset*                              | `['Notification']`   | Default — today's behavior. |
| `""` (set, empty)                    | `[]`                 | Opt-out — no bells, ever.   |
| `"Notification,Stop"`                | `['Notification','Stop']` | Opt-in — bell on both. |

Notably, **unset ≠ empty string.** Unset means "the user hasn't
configured this"; empty means "the user explicitly wants no
notifications." Parsing must distinguish these.

Names are matched **case-sensitively** against `hook_event_name`. Hook
event names are PascalCase (`Notification`, `Stop`, etc.); lowercase or
misspelled values silently do nothing. See Open Questions for whether
to validate at config load.

### Shared helper

```js
// hooks/scripts/lib/agents/index.mjs
export const DEFAULT_NOTIFICATION_EVENTS = ['Notification']

/**
 * True when the given hook event should mark the session as
 * awaiting-user. Agent libs call this from their buildHookEvent when
 * deciding whether to stamp meta.isNotification on the envelope.
 *
 * Consults config.notificationOnEvents, which is:
 *   - undefined        → fall back to DEFAULT_NOTIFICATION_EVENTS
 *   - []               → no events ever set pending (explicit opt-out)
 *   - [names...]       → any matching name triggers pending
 */
export function isNotificationEvent(config, hookEvent, _hookPayload) {
  const events = config?.notificationOnEvents ?? DEFAULT_NOTIFICATION_EVENTS
  return events.includes(hookEvent)
}
```

The `_hookPayload` argument is unused today but included in the
signature so future payload-sniffing heuristics don't require a
call-site migration.

### Agent-lib usage

Claude Code's `buildHookEvent` becomes:

```js
const NON_CLEARING_EVENTS = new Set(['SubagentStop', 'Stop'])

export function buildHookEvent(config, log, hookPayload) {
  const hookEvent = hookPayload?.hook_event_name || 'unknown'
  const toolName = hookPayload?.tool_name || hookPayload?.tool?.name || ''

  const flags = {}
  if (isNotificationEvent(config, hookEvent, hookPayload)) {
    flags.isNotification = true
  } else if (NON_CLEARING_EVENTS.has(hookEvent)) {
    flags.clearsNotification = false
  }

  const envelope = {
    hook_payload: hookPayload,
    meta: { agentClass: 'claude-code', env: buildEnv(config), ...flags },
  }
  return { envelope, hookEvent, toolName }
}
```

Order matters: **`isNotificationEvent` check runs first.** If a user
opts into `Stop`, the `Stop` event sets `isNotification: true` and the
default non-clearing behavior is bypassed (Stop now *sets* pending
instead of *not clearing* it — the right behavior for that user).
`SubagentStop` stays non-clearing regardless (it's not configurable).

Codex and `unknown` libs currently stamp no flags. Codex can adopt the
helper when its flag mapping is filled in; `unknown` has no hook-event
semantics so stays as-is.

## Config parsing

`hooks/scripts/lib/config.mjs` adds:

```js
const rawNotif = process.env.AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS
const notificationOnEvents =
  rawNotif === undefined
    ? undefined // let the agent-lib default apply
    : rawNotif.split(',').map((s) => s.trim()).filter(Boolean)
```

Stored on `config` as `config.notificationOnEvents: string[] | undefined`.

The `undefined` vs `[]` distinction is load-bearing: the helper
falls back to `DEFAULT_NOTIFICATION_EVENTS` only when the user hasn't
configured anything. An explicitly-empty env var produces `[]` and
genuinely disables all bells.

A `" , , "` input (only whitespace and separators) yields `[]` after
filter — that's the same as empty-string, treated as explicit opt-out.
Acceptable since the user's intent was "nothing here."

## File-level change list

- `hooks/scripts/lib/config.mjs` — parse the new env var, store on config.
- `hooks/scripts/lib/agents/index.mjs` — export `DEFAULT_NOTIFICATION_EVENTS` and `isNotificationEvent`.
- `hooks/scripts/lib/agents/claude-code.mjs` — `buildHookEvent` calls `isNotificationEvent`; `NON_CLEARING_EVENTS` stays hardcoded.
- `hooks/scripts/lib/agents/codex.mjs` — no functional change this pass; stays a pass-through. (Worth noting the helper is available if Codex grows flags.)
- `hooks/scripts/lib/agents/unknown.mjs` — unchanged.
- `README.md` — short section under "Customization" or similar documenting the env var, the three states, and a concrete `Notification,Stop` example.
- Tests:
  - `test/hooks/scripts/lib/config.test.mjs` — unset / empty / `"Notification"` / `"Notification,Stop"` / whitespace-only cases.
  - `test/hooks/scripts/lib/agents/index.test.mjs` — `isNotificationEvent` against each of those config states.
  - `test/hooks/scripts/lib/agents/claude-code.test.mjs` — existing cases still pass with default config; new case for `Stop` being flagged as notification when opted in; new case for `Stop` falling back to default-clear when the env var is explicitly empty.

## Behavior walkthroughs

### Default (env var unset)

Claude Code session, turn happens: `UserPromptSubmit` → work → `Stop` → (maybe) `Notification`.

- `UserPromptSubmit` → default clear.
- Tool events → default clear.
- `Stop` → `clearsNotification: false` (non-clearing). Pending state unchanged.
- `Notification` → `isNotification: true`. Bell lights.

Exactly today's behavior. No regression.

### Opt-in `Stop`

`AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS=Notification,Stop`. Same turn.

- `UserPromptSubmit` → default clear. (If bell was lit from previous turn, drops here.)
- Tool events → default clear.
- `Stop` → `isNotificationEvent` returns true → `isNotification: true`. Bell lights 🔔.
- Subsequent `Notification` → re-stamps the timestamp. Bell stays lit.
- Subagent emits `SubagentStop` → `NON_CLEARING_EVENTS` hit → `clearsNotification: false`. Bell unchanged.

Bell now fires on every turn end, which is what the user asked for.

### Opt-out (env var explicitly empty)

`AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS=`

- Every event routes through the default-or-non-clearing fallback; nothing
  sets `isNotification: true`. Server's `pending_notification_ts` stays NULL
  forever. Bells never light.
- `SubagentStop` still stamps `clearsNotification: false`, but it's
  harmless — the session was never pending to begin with.

## Risks

| Risk | Mitigation |
|------|------------|
| Users inadvertently disable bells by setting the var to empty. | Document the three states prominently. The empty behavior is intentional, not a bug, but needs clear docs. |
| Users opt into a high-frequency event (`PreToolUse`) and the bell fires constantly. | Document that the list is applied verbatim — choose carefully. Not something to guard against in code. |
| Case / spelling mismatches silently no-op (`"notification"` vs `"Notification"`). | Document PascalCase. See Open Question #1 for optional validation. |
| User opts into `Stop`, but also relies on `SubagentStop` NOT clearing — works today but feels coupled. | Covered by `NON_CLEARING_EVENTS`; noted in the walkthrough. If this ever needs to diverge, make the non-clearing list configurable in a follow-up spec. |
| Existing users on default behavior should see no change. | Default is `['Notification']`, identical to today's behavior. All existing tests should continue to pass without modification. |

## Open questions

1. **Should the CLI validate hook-event names at config load?** A warning log on unknown values would catch typos (`"Notificaton"`) but requires maintaining a known-event set per agent class, which couples config validation to agent-class knowledge. Recommend: defer; document PascalCase, accept the silent no-op for unknown names.
2. **Documentation placement.** README is the user-facing spot. DEVELOPMENT.md is fine for the implementation note. Do we want an entry under a dedicated "Environment variables" table too?
3. **Future: per-project overrides.** The project row already has a `metadata` JSON blob. A future spec could let users override the list per project without a new env var. Out of scope here.
