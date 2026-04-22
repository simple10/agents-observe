# Implementation Plan: Configurable Notification Events

Companion to [spec-configurable-notification-events.md](./spec-configurable-notification-events.md).
Read the spec first.

## Branch

`feat/configurable-notification-events` off `main`.

## Phasing

Four phases, each leaves the tree type-clean and testable on its own.
Ships together as one coordinated release (CLI + docs; no server change).

---

### Phase 1 — Config parsing + shared helper

Type-pure plumbing. No behavior change by itself (the helper isn't wired
into any agent lib yet).

**Files:**

- `hooks/scripts/lib/config.mjs`
  - Parse the env var, preserving the unset vs empty distinction:
    ```js
    const rawNotif = process.env.AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS
    const notificationOnEvents =
      rawNotif === undefined
        ? undefined
        : rawNotif.split(',').map((s) => s.trim()).filter(Boolean)
    ```
  - Expose on the returned config as `notificationOnEvents: string[] | undefined`.

- `hooks/scripts/lib/agents/index.mjs`
  - Add:
    ```js
    export const DEFAULT_NOTIFICATION_EVENTS = ['Notification']

    export function isNotificationEvent(config, hookEvent, _hookPayload) {
      const events = config?.notificationOnEvents ?? DEFAULT_NOTIFICATION_EVENTS
      return events.includes(hookEvent)
    }
    ```

**Tests:**

- `test/hooks/scripts/lib/config.test.mjs` — five cases:
  1. env var unset → `notificationOnEvents === undefined`.
  2. env var `""` → `[]`.
  3. env var `"Notification"` → `['Notification']`.
  4. env var `"Notification,Stop"` → `['Notification', 'Stop']`.
  5. env var `" , ,  "` → `[]` (whitespace/separator-only).
- `test/hooks/scripts/lib/agents/index.test.mjs` — extend:
  - `isNotificationEvent` with `config.notificationOnEvents === undefined`
    returns true for `'Notification'`, false for `'Stop'`.
  - With `[]` returns false for everything.
  - With `['Notification', 'Stop']` returns true for both, false for others.
  - Accepts a `null`/`undefined` config (defensive).

**Done:** `just check` passes; no user-visible behavior change yet.

---

### Phase 2 — Claude Code lib adoption

**Files:**

- `hooks/scripts/lib/agents/claude-code.mjs`:
  - Replace the existing `NOTIFICATION_FLAGS` map with:
    ```js
    import { isNotificationEvent } from './index.mjs'

    const NON_CLEARING_EVENTS = new Set(['SubagentStop', 'Stop'])
    ```
  - `buildHookEvent` picks flags in this order:
    1. `isNotificationEvent(config, hookEvent, hookPayload)` → `{ isNotification: true }`
    2. `NON_CLEARING_EVENTS.has(hookEvent)` → `{ clearsNotification: false }`
    3. neither → no flags
  - Keep the `_log` param; keep the return shape `{ envelope, hookEvent, toolName }`.
- No change to `codex.mjs` or `unknown.mjs` this phase — they stay
  pass-through. Codex can adopt the helper in a follow-up when it gains
  real flag semantics.

**Tests — extend `test/hooks/scripts/lib/agents/claude-code.test.mjs`:**

- Existing cases (default config, Notification → `isNotification:true`,
  SubagentStop/Stop → `clearsNotification:false`, ordinary events
  unflagged) should pass without modification — verifying the default
  path is preserved.
- New cases:
  - `config.notificationOnEvents = ['Notification', 'Stop']`:
    - `Stop` event → envelope has `meta.isNotification === true` (NOT `clearsNotification: false`).
    - `Notification` event → still `isNotification: true`.
    - `SubagentStop` event → still `clearsNotification: false` (not configurable).
  - `config.notificationOnEvents = []`:
    - `Notification` event → no flags (explicit opt-out).
    - `Stop` event → `clearsNotification: false` (non-clearing default still applies).
    - `PreToolUse` event → no flags.

**Done:** `just check` passes; manual smoke tested via setting the env var.

---

### Phase 3 — Documentation

Two goals:

1. Make `docs/ENVIRONMENT.md` the single source of truth for every env var the project reads.
2. Update README + DEVELOPMENT to point at it instead of duplicating the list.

**Files:**

- `docs/ENVIRONMENT.md` (new) — content specified below.
- `README.md` — replace any env-var mentions with a short "commonly used" subset and a link: *"See `docs/ENVIRONMENT.md` for the full list."*
- `docs/DEVELOPMENT.md` — wherever it mentions env vars today, replace with a one-line pointer: *"All env vars are centralized; see `docs/ENVIRONMENT.md`."*

#### `docs/ENVIRONMENT.md` content

Header explaining the doc is the authoritative source and that README / DEVELOPMENT link here. Then four tables.

##### Table 1 — Hook CLI (read at CLI invocation)

| Variable | Default | Purpose |
|---|---|---|
| `AGENTS_OBSERVE_AGENT_CLASS` | `claude-code` | Which agent class the CLI dispatches through (`claude-code`, `codex`, anything else → `unknown` fallback). |
| `AGENTS_OBSERVE_PROJECT_SLUG` | *(unset)* | Override the project slug the CLI reports on each event. |
| `AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS` | *(unset — defaults to `Notification`)* | Comma-separated list of hook events that trigger a notification bell. Empty string disables all bells. See [spec-configurable-notification-events.md](./plans/spec-configurable-notification-events.md). |
| `AGENTS_OBSERVE_ALLOW_LOCAL_CALLBACKS` | `all` | Comma-separated allowlist of server-initiated callbacks the CLI will execute. `all` permits every known handler. |
| `AGENTS_OBSERVE_API_BASE_URL` | *(unset — derived from `AGENTS_OBSERVE_SERVER_PORT`)* | Full URL of the server API (e.g. `http://remote:4981/api`). Overrides the auto-started local Docker server. |
| `AGENTS_OBSERVE_LOG_LEVEL` | `warn` | CLI log level: `error`, `warn`, `info`, `debug`, `trace`. |
| `AGENTS_OBSERVE_LOGS_DIR` | `<data root>/logs` | Directory where the CLI writes logs. |
| `AGENTS_OBSERVE_HOOK_STARTUP_TIMEOUT` | `30000` | Ms the `hook-autostart` command waits for the server to become healthy after starting it. |
| `AGENTS_OBSERVE_LOCAL_DATA_ROOT` | *(plugin-specific fallback)* | Root directory for data + logs when not running as a plugin. |
| `AGENTS_OBSERVE_DATA_DIR` | `<data root>/data` | Directory for the SQLite DB and related files. |

##### Table 2 — Server runtime (read by the API server)

| Variable | Default | Purpose |
|---|---|---|
| `AGENTS_OBSERVE_SERVER_PORT` | `4981` | HTTP + WebSocket port the server listens on. |
| `AGENTS_OBSERVE_DB_PATH` | derived | Absolute path to the SQLite DB file. In Docker this is `/data/observe.db`; locally it's computed from `AGENTS_OBSERVE_DATA_DIR`. |
| `AGENTS_OBSERVE_STORAGE_ADAPTER` | `sqlite` | Storage backend. Only `sqlite` is supported today. |
| `AGENTS_OBSERVE_CLIENT_DIST_PATH` | derived | Path to the built React client (`app/client/dist`). Unused in dev runtime (Vite serves the client). |
| `AGENTS_OBSERVE_ALLOW_DB_RESET` | `backup` | Admin reset policy: `allow` (wipe without backup), `backup` (snapshot the DB then wipe), `deny` (refuse). |
| `AGENTS_OBSERVE_SHUTDOWN_DELAY_MS` | `30000` | Ms with no connected clients before the server auto-shuts down. Set to `0` or negative to disable auto-shutdown. |
| `AGENTS_OBSERVE_LOG_LEVEL` | `debug` | Server log level. Same values as the CLI variable. |

##### Table 3 — Docker / runtime selection

| Variable | Default | Purpose |
|---|---|---|
| `AGENTS_OBSERVE_RUNTIME` | `docker` | How to run the server: `docker` (container), `local` (node subprocess), `dev` (vite dev server + local node). |
| `AGENTS_OBSERVE_RUNTIME_DEV` | *(set by CLI)* | Internal flag (`1` or empty) so the server knows it's running under `dev`. Don't set this manually. |
| `AGENTS_OBSERVE_DEV_CLIENT_PORT` | `5174` | Port the Vite dev server listens on in `dev` runtime. |
| `AGENTS_OBSERVE_DOCKER_IMAGE` | `ghcr.io/simple10/agents-observe:v<version>` | Override the Docker image tag. Useful for testing local builds. |
| `AGENTS_OBSERVE_DOCKER_CONTAINER_NAME` | `agents-observe` | Name of the managed Docker container. |

##### Table 4 — Test harness + integration (rarely user-set)

| Variable | Default | Purpose |
|---|---|---|
| `AGENTS_OBSERVE_TEST_SKIP_PULL` | *(unset)* | When `1`, skips `docker pull` in the fresh-install test harness. Not for normal use. |
| `CLAUDE_PLUGIN_DATA` | *(set by Claude Code)* | The plugin data directory path; set by the Claude Code plugin loader, not the user. The CLI checks for its presence to detect plugin mode. |

Close with a short "**How to set env vars**" section pointing at `.env`
in the repo for local dev, and the user's shell profile (`.zshrc`,
`.bashrc`) or Claude Code plugin config for plugin installs.

#### README changes

Replace the scattered env-var mentions with a single "Configuration"
subsection:

> ### Configuration
>
> A few commonly used env vars:
>
> - `AGENTS_OBSERVE_SERVER_PORT` — server port (default `4981`).
> - `AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS` — comma-separated hook events that trigger the notification bell (default `Notification`). Set empty to disable bells.
> - `AGENTS_OBSERVE_LOG_LEVEL` — log level (default `warn`).
>
> See [`docs/ENVIRONMENT.md`](./docs/ENVIRONMENT.md) for the full list.

Grep for every other `AGENTS_OBSERVE_*` mention in README and delete
it (those are in ENVIRONMENT.md now).

#### DEVELOPMENT.md changes

Find the existing line "All env vars are read in `hooks/scripts/lib/config.mjs`
(centralized — never read `process.env` elsewhere)." Replace with:

> All CLI env vars are read in `hooks/scripts/lib/config.mjs`; server env
> vars in `app/server/src/config.ts`. For the authoritative list of every
> env var the project reads, see [`docs/ENVIRONMENT.md`](./ENVIRONMENT.md).

**Done:** no duplicate env-var documentation in README / DEVELOPMENT;
ENVIRONMENT.md covers every var grep finds in source.

---

### Phase 4 — Integration + `just check`

**Steps:**

1. `just check` from a clean tree.
2. Manual smoke test via `just dev`:
   - Unset the env var → Claude Code session emits `Notification` →
     bell lights. Baseline behavior preserved.
   - Set `AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS=Notification,Stop` in
     the shell, restart Claude Code → trigger a session that emits
     `Stop` without a `Notification` → bell lights.
   - Set `AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS=` (empty) → no bells
     ever light, regardless of events.
3. Grep for remaining stray env-var references in README /
   DEVELOPMENT that didn't move to ENVIRONMENT.md.

**Done criteria:**

- `just check` passes (3 suites green).
- Existing Claude Code sessions behave identically with env var unset.
- Setting `Stop` in the list lights the bell on Stop events.
- Setting empty disables all bells.
- `ENVIRONMENT.md` documents every `AGENTS_OBSERVE_*` var found in the
  codebase (verified via grep).

---

## Risks

| Risk | Mitigation |
|------|------------|
| Missed env vars when building ENVIRONMENT.md → docs drift again. | Grep `process.env.` under `hooks/scripts/` and `app/server/src/` before finalizing the tables; compare against Phase 3 content. |
| README / DEVELOPMENT still mention some env var that's now in ENVIRONMENT.md → duplicate truth. | Phase 4 grep. |
| Users who set a stray `AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS` with a misspelled event name (`"Notificaton"`) get silent no-op. | Documented as Open Question in the spec; deferred. ENVIRONMENT.md links to the spec. |
| `config.test.mjs` uses stubbed `process.env`; order of test cases matters. | Use `beforeEach` / `afterEach` to snapshot + restore `process.env.AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS`. |

## Out of scope

- Per-project or per-session override of `notificationOnEvents` (future spec).
- Validating event names at config load (open question in the spec).
- Migrating Codex lib to use the helper (follow-up when Codex flags are defined).
- Making `SubagentStop` configurable.
