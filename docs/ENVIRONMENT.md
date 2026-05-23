# Environment Variables

This is the authoritative list of every environment variable the project
reads. README and `docs/DEVELOPMENT.md` link here so the tables below
stay the single source of truth.

All variables are prefixed `AGENTS_OBSERVE_*` except a few set by
external systems.

---

## Hook CLI

Read at CLI invocation by `hooks/scripts/lib/config.mjs`. Set these in
your shell profile or the Claude Code plugin config to customize
per-user behavior.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENTS_OBSERVE_AGENT_CLASS` | `claude-code` | Which agent class the CLI dispatches through: `claude-code`, `codex`, or anything else (falls back to the `unknown` lib). |
| `AGENTS_OBSERVE_PROJECT_SLUG` | *(unset)* | Override the project slug the CLI reports on each event. |
| `AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS` | *(unset — defaults to `Notification`)* | Comma-separated hook events that trigger the notification bell. Empty string (`""`) disables bells entirely. Claude Code's `Notification` hook fires by default; Codex has no equivalent, so Codex users must opt in (e.g. set to `Stop` to fire on turn end). See [spec-configurable-notification-events.md](./plans/spec-configurable-notification-events.md). |
| `AGENTS_OBSERVE_ALLOW_LOCAL_CALLBACKS` | `all` | Comma-separated allowlist of server-initiated callbacks the CLI will execute. `all` permits every known handler. |
| `AGENTS_OBSERVE_API_BASE_URL` | *(derived from `AGENTS_OBSERVE_SERVER_PORT`)* | Full URL of the server API (e.g. `http://remote:4981/api`). Overrides the auto-started local Docker server. |
| `AGENTS_OBSERVE_LOG_LEVEL` | `warn` | CLI log level: `error`, `warn`, `info`, `debug`, `trace`. |
| `AGENTS_OBSERVE_LOGS_DIR` | `<data root>/logs` | Directory where the CLI writes logs. |
| `AGENTS_OBSERVE_HOOK_STARTUP_TIMEOUT` | `30000` | Ms the `hook-autostart` command waits for the server to become healthy after starting it. |
| `AGENTS_OBSERVE_LOCAL_DATA_ROOT` | *(plugin-specific fallback)* | Root directory for data + logs when not running as a plugin. |
| `AGENTS_OBSERVE_DATA_DIR` | `<data root>/data` | Directory for the SQLite DB and related files. |

---

## Server runtime

Read by the API server in `app/server/src/config.ts`. When you start
the server via the CLI (the normal path), these are populated
automatically from the CLI config. Override them only when running the
server directly.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENTS_OBSERVE_SERVER_PORT` | `4981` | HTTP + WebSocket port the server listens on. |
| `AGENTS_OBSERVE_DB_PATH` | derived | Absolute path to the SQLite DB file. In Docker: `/data/observe.db`. Locally: computed from `AGENTS_OBSERVE_DATA_DIR`. |
| `AGENTS_OBSERVE_STORAGE_ADAPTER` | `sqlite` | Storage backend. Only `sqlite` is supported today. |
| `AGENTS_OBSERVE_CLIENT_DIST_PATH` | derived | Path to the built React client (`app/client/dist`). Empty in dev runtime (Vite serves the client). |
| `AGENTS_OBSERVE_ALLOW_DB_RESET` | `backup` | Admin reset policy: `allow` (wipe without backup), `backup` (snapshot the DB then wipe), `deny` (refuse). |
| `AGENTS_OBSERVE_SHUTDOWN_DELAY_MS` | `30000` | Ms with no connected clients before the server auto-shuts down. Set to `0` or negative to disable auto-shutdown. |
| `AGENTS_OBSERVE_LOG_LEVEL` | `debug` | Server log level. Same values as the CLI variable. |

---

## Transcript stats

Parses the source-of-truth jsonl transcripts on demand to surface
per-prompt / per-agent token usage, model info, and cost estimates in
the Session Stats tab. Pricing is fetched from `models.dev` and cached
on disk at `<data dir>/models-dev.json` (24h TTL). Enabled by default;
set the flag below to `0` to disable.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENTS_OBSERVE_TRANSCRIPT_STATS` | `1` | Enables the `/api/sessions/:id/transcript-stats` route and (in docker mode) bind-mounts each agent class's session dir read-only. Set to `0` to disable. Surfaced on `/api/health` as `transcriptStatsEnabled` so the client can skip the round-trip when off. |
| `AGENTS_OBSERVE_TRANSCRIPT_CLAUDE_HOST_BASE` | `~/.claude/projects` | Host path to Claude Code's session jsonls. Override when Claude is installed in a non-standard location. |
| `AGENTS_OBSERVE_TRANSCRIPT_CLAUDE_CONTAINER_BASE` | `/host/.claude/projects` | Fixed container-side mount point for the Claude bind mount. Rarely needs overriding — the server's path resolver looks for exactly this prefix. |
| `AGENTS_OBSERVE_TRANSCRIPT_CODEX_HOST_BASE` | `~/.codex/sessions` | Host path to Codex's rollout jsonls. Override when Codex is installed in a non-standard location. |
| `AGENTS_OBSERVE_TRANSCRIPT_CODEX_CONTAINER_BASE` | `/host/.codex/sessions` | Fixed container-side mount point for the Codex bind mount. |

In `docker` runtime the CLI populates these from the resolved host paths and mounts each directory read-only. In `local` / `dev` runtime the server reads transcripts directly from the host paths, so the `_CONTAINER_BASE` pair is left empty. Missing host directories are silently skipped — a user without Codex installed doesn't need to clear the codex env vars.

---

## Docker / runtime selection

Controls where and how the server runs.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENTS_OBSERVE_RUNTIME` | `docker` | How to run the server: `docker` (container), `local` (node subprocess), `dev` (vite dev server + local node). |
| `AGENTS_OBSERVE_RUNTIME_DEV` | *(set by CLI)* | Internal flag (`1` or empty) so the server knows it's running under `dev`. Don't set this manually. |
| `AGENTS_OBSERVE_DEV_CLIENT_PORT` | `5174` | Port the Vite dev server listens on in `dev` runtime. |
| `AGENTS_OBSERVE_DOCKER_IMAGE` | `ghcr.io/simple10/agents-observe:v<version>` | Override the Docker image tag. Useful for testing local builds. |
| `AGENTS_OBSERVE_DOCKER_CONTAINER_NAME` | `agents-observe` | Name of the managed Docker container. |

---

## Test harness / external

Rarely user-set.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENTS_OBSERVE_TEST_SKIP_PULL` | *(unset)* | When `1`, skips `docker pull` in the fresh-install test harness. Not for normal use. |
| `CLAUDE_PLUGIN_DATA` | *(set by Claude Code)* | The plugin data directory path; set by the Claude Code plugin loader. The CLI checks for its presence to detect plugin mode. |

---

## Where to set env vars

- **Local development**: `.env` in the repo root (loaded by `just dev`).
- **Plugin installs**: your shell profile (`.zshrc`, `.bashrc`) or the
  Claude Code plugin config.
- **Remote / standalone server**: wherever you launch the server
  process — shell, systemd unit, Docker compose, etc.

Add new variables to both this doc and the relevant config module:
`hooks/scripts/lib/config.mjs` for CLI-read vars, `app/server/src/config.ts`
for server-read vars.
