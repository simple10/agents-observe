# Namespace & Infrastructure Refactor

**Date:** 2026-03-30
**Status:** Draft
**Breaking:** Yes (DB schema change requires `just db-reset`)

## Motivation

- `claude-observe` won't be accepted in the official Claude plugin marketplace due to "claude" being in the name
- The data directory defaults to `$HOME/.claude-observe` instead of using the plugin data dir env var (`CLAUDE_PLUGIN_DATA`), which means data doesn't get cleaned up on plugin uninstall
- No logging infrastructure for debugging hooks in production
- No test coverage for hooks code
- CLI hooks can block agents when the server is slow or down

## 1. Namespace Rename

Rename all occurrences of `claude-observe` to `agents-observe` and `CLAUDE_OBSERVE_*` env vars to `AGENTS_OBSERVE_*`.

### Identifiers

| Location | Old | New |
|----------|-----|-----|
| `package.json` name | `claude-observe` | `agents-observe` |
| `.claude-plugin/plugin.json` name | `claude-observe` | `agents-observe` |
| `.claude-plugin/marketplace.json` name | `claude-observe` | `agents-observe` |
| `docker-compose.yml` service + container_name | `claude-observe` | `agents-observe` |
| `.mcp.json` server key | `claude-observe` | `agents-observe` |
| `mcp_server.mjs` serverInfo.name | `claude-observe` | `agents-observe` |
| `health.ts` API_ID | `claude-observe` | `agents-observe` |
| `docker.mjs` log prefix | `[claude-observe]` | `[agents-observe]` |
| `observe_cli.mjs` log prefix | `[claude-observe]` | `[agents-observe]` |
| `config.mjs` containerName default | `claude-observe` | `agents-observe` |
| `config.mjs` dockerImage | `ghcr.io/simple10/claude-observe` | `ghcr.io/simple10/agents-observe` |
| `config.mjs` API_ID | `claude-observe` | `agents-observe` |

### Environment Variables

All `CLAUDE_OBSERVE_*` env vars renamed to `AGENTS_OBSERVE_*`:

- `AGENTS_OBSERVE_SERVER_PORT` (default: 4981)
- `AGENTS_OBSERVE_LOG_LEVEL` (default: unset)
- `AGENTS_OBSERVE_DB_PATH` (default: `../../data/observe.db` in dev, `/data/observe.db` in Docker)
- `AGENTS_OBSERVE_DATA_DIR`
- `AGENTS_OBSERVE_STORAGE_ADAPTER`
- `AGENTS_OBSERVE_CLIENT_DIST_PATH`
- `AGENTS_OBSERVE_CLIENT_PORT` (dev only, default: 5174)
- `AGENTS_OBSERVE_API_BASE_URL`
- `AGENTS_OBSERVE_PROJECT_SLUG`
- `AGENTS_OBSERVE_DOCKER_CONTAINER_NAME`
- `AGENTS_OBSERVE_DOCKER_IMAGE`
- `AGENTS_OBSERVE_ALLOW_LOCAL_CALLBACKS`
- `AGENTS_OBSERVE_SERVER_PERSIST`
- `AGENTS_OBSERVE_LOGS_DIR` (new)

### Fallback Path

`$HOME/.claude-observe` becomes `$HOME/.agents-observe` in all fallback paths.

### Files Affected

- `hooks/scripts/lib/config.mjs`
- `hooks/scripts/lib/docker.mjs`
- `hooks/scripts/observe_cli.mjs`
- `hooks/scripts/mcp_server.mjs`
- `app/server/src/index.ts`
- `app/server/src/app.ts`
- `app/server/src/websocket.ts`
- `app/server/src/storage/index.ts`
- `app/server/src/routes/health.ts`
- `app/server/src/routes/events.ts`
- `app/server/src/routes/agents.ts`
- `app/server/src/routes/sessions.ts`
- `app/client/vite.config.ts`
- `docker-compose.yml`
- `.env.example`
- `justfile`
- `start.mjs`
- `package.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `.mcp.json`
- `.claude/settings.json`
- `settings.template.json`

## 2. Data Directory Fix

### Current (broken)

```javascript
// config.mjs
const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA || `${process.env.HOME}/.claude-observe`
// ...
dataDir: process.env.CLAUDE_OBSERVE_DATA_DIR || `${process.env.HOME}/.claude-observe/data`
```

`dataDir` ignores `pluginDataDir` and hardcodes the fallback, so when `CLAUDE_PLUGIN_DATA` is set by Claude, `dataDir` still writes to `$HOME/.claude-observe/data`.

### Fixed

```javascript
const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA || `${process.env.HOME}/.agents-observe`
// ...
dataDir: process.env.AGENTS_OBSERVE_DATA_DIR || `${pluginDataDir}/data`
```

Fallback chain: `AGENTS_OBSERVE_DATA_DIR` > `$CLAUDE_PLUGIN_DATA/data` > `$HOME/.agents-observe/data`

## 3. `agent_class` Column

Add `agent_class TEXT DEFAULT 'claude-code'` to the `agents` table in `sqlite-adapter.ts`.

```sql
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_agent_id TEXT,
  name TEXT,
  description TEXT,
  agent_type TEXT,
  agent_class TEXT DEFAULT 'claude-code',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (parent_agent_id) REFERENCES agents(id)
)
```

This is a breaking schema change. No ALTER migration needed — users run `just db-reset`. No API, hooks, or UI changes for now. The `upsertAgent` method signature does not change; `agent_class` is populated by the SQL default.

## 4. Logging System

### New file: `hooks/scripts/lib/logger.mjs`

Exports `createLogger(filename)` which returns `{ error(), warn(), info(), debug(), trace() }`.

**Dual output — file + console:**

| Level | Log file | Console (stderr) |
|-------|----------|-------------------|
| `error` | Always | Always |
| `warn` | Always | Always |
| `info` | When level is `debug` or `trace` | Always |
| `debug` | When level is `debug` or `trace` | When level is `debug` or `trace` |
| `trace` | When level is `debug` or `trace` | When level is `debug` or `trace` |

**File management:**
- Writes to `${logsDir}/${filename}` (e.g., `logs/mcp.log`, `logs/cli.log`)
- Uses `appendFileSync` — no dependencies
- On each write, checks file size via `statSync` — if > 1MB, truncates to the last ~500KB
- Creates `logsDir` via `mkdirSync({ recursive: true })` on first write

### Config additions

```javascript
logsDir: process.env.AGENTS_OBSERVE_LOGS_DIR || `${pluginDataDir}/logs`
logLevel: (process.env.AGENTS_OBSERVE_LOG_LEVEL || '').toLowerCase()
```

Fallback chain for `logsDir`: `AGENTS_OBSERVE_LOGS_DIR` > `$CLAUDE_PLUGIN_DATA/logs` > `$HOME/.agents-observe/logs`

### Integration

- `mcp_server.mjs`: use `createLogger('mcp.log')`, replace `console.error` calls with logger
- `observe_cli.mjs`: use `createLogger('cli.log')`, replace `console.warn`/`console.error` calls with logger

## 5. Non-blocking CLI Hooks

The `hook` command in `observe_cli.mjs` must not block agents. The `health` command (and any future commands that return data) continues to await normally.

### Current (blocking)

```javascript
// hookCommand()
const result = await postJson(...)   // blocks up to 5s
await handleRequests(result.body?.requests)  // blocks again
process.exit(0)
```

### Fixed (fire-and-forget for hook command)

```javascript
// hookCommand()
const promise = postJson(...)
promise.then((result) => {
  if (result.body?.requests) handleRequests(result.body.requests)
})
// Don't await — let process exit naturally
```

Changes to `http.mjs`:
- Add an optional `fireAndForget` parameter to `httpRequest` / `postJson`
- When `fireAndForget` is true: call `unref()` on the underlying socket so Node's event loop doesn't keep the process alive waiting for the response
- When `fireAndForget` is false (default): existing blocking behavior, used by `health` and other commands that need responses

The CLI reads stdin, fires the POST, writes to the log file, and exits almost immediately. The HTTP request continues in flight — if the response arrives before the process exits, callbacks run. If not, the event is dropped. This is acceptable for telemetry.

Remove explicit `process.exit(0)` calls from the hook command path — let the process exit naturally when stdin closes and no refs remain.

## 6. Root-level Test Setup

### Structure

```
test/
  config.test.mjs       # Tests config resolution (env var precedence, fallbacks)
vitest.config.ts         # Root vitest config targeting hooks/ and test/
```

### Setup

- Add `vitest` as a devDependency in root `package.json`
- Create `vitest.config.ts` at project root, targeting `test/` and `hooks/`
- Update root `package.json` test script to run root tests in addition to server/client tests
- Initial test: `config.test.mjs` — verifies env var precedence for `dataDir`, `logsDir`, `pluginDataDir`, and namespace correctness

## Out of Scope

- API changes for `agent_class` (future version)
- UI changes for `agent_class` (future version)
- Hooks changes to pass `agent_class` (future version)
- Migration support for existing databases (breaking change, use `just db-reset`)
