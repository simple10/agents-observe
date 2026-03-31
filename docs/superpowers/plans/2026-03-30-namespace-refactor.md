# Namespace & Infrastructure Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename plugin from `claude-observe` to `agents-observe`, fix data directory to use plugin data dir, add `agent_class` column, build logging system, make CLI hooks non-blocking, and set up root-level tests.

**Architecture:** Mechanical rename across ~23 files for namespace. Config becomes the single source of truth for all paths via `pluginDataDir`. New `logger.mjs` provides dual-output (file + console) logging with size-based pruning. CLI hook command becomes fire-and-forget via socket `unref()`. Root-level vitest setup covers hooks code.

**Tech Stack:** Node.js (ESM, no dependencies for hooks), SQLite (better-sqlite3), Vitest, Hono

---

### Task 1: Root-level test setup (vitest)

Set up the test infrastructure first so we can TDD the remaining tasks.

**Files:**
- Create: `vitest.config.ts`
- Create: `test/config.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Install vitest**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe && npm install --save-dev vitest
```

- [ ] **Step 2: Create vitest.config.ts**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.{mjs,ts}'],
  },
})
```

- [ ] **Step 3: Update root package.json test script**

In `package.json`, change the `test` script from:
```json
"test": "cd app/server && npm test && cd ../client && npm test"
```
to:
```json
"test": "vitest run && cd app/server && npm test && cd ../client && npm test"
```

- [ ] **Step 4: Create placeholder config test**

Create `test/config.test.mjs` with a single passing test to verify the setup works:

```javascript
// test/config.test.mjs
import { describe, it, expect } from 'vitest'

describe('test setup', () => {
  it('runs', () => {
    expect(true).toBe(true)
  })
})
```

- [ ] **Step 5: Run tests to verify setup**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe && npx vitest run
```

Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts test/config.test.mjs package.json package-lock.json
git commit -m "chore: add root-level vitest setup for hooks testing"
```

---

### Task 2: Namespace rename — env vars and config

The central config file is the source of truth. Rename it first, then update all consumers.

**Files:**
- Modify: `hooks/scripts/lib/config.mjs`
- Modify: `test/config.test.mjs`

- [ ] **Step 1: Write config tests**

Replace `test/config.test.mjs` with tests that verify the new namespace and data dir resolution:

```javascript
// test/config.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Snapshot and restore all env vars we touch
const envKeys = [
  'CLAUDE_PLUGIN_DATA',
  'AGENTS_OBSERVE_SERVER_PORT',
  'AGENTS_OBSERVE_API_BASE_URL',
  'AGENTS_OBSERVE_PROJECT_SLUG',
  'AGENTS_OBSERVE_DOCKER_CONTAINER_NAME',
  'AGENTS_OBSERVE_DOCKER_IMAGE',
  'AGENTS_OBSERVE_DATA_DIR',
  'AGENTS_OBSERVE_LOGS_DIR',
  'AGENTS_OBSERVE_LOG_LEVEL',
]

let savedEnv

beforeEach(() => {
  savedEnv = {}
  for (const k of envKeys) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of envKeys) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

// Dynamic import to pick up env changes (module is stateless via getConfig())
async function loadConfig(overrides) {
  const mod = await import('../hooks/scripts/lib/config.mjs')
  return mod.getConfig(overrides)
}

describe('config', () => {
  it('uses AGENTS_OBSERVE namespace for env vars', async () => {
    process.env.AGENTS_OBSERVE_SERVER_PORT = '9999'
    const cfg = await loadConfig()
    expect(cfg.serverPort).toBe('9999')
  })

  it('defaults containerName to agents-observe', async () => {
    const cfg = await loadConfig()
    expect(cfg.containerName).toBe('agents-observe')
  })

  it('defaults API_ID to agents-observe', async () => {
    const cfg = await loadConfig()
    expect(cfg.API_ID).toBe('agents-observe')
  })

  it('derives dataDir from pluginDataDir when AGENTS_OBSERVE_DATA_DIR is unset', async () => {
    const cfg = await loadConfig()
    expect(cfg.dataDir).toBe(`${cfg.pluginDataDir}/data`)
  })

  it('prefers AGENTS_OBSERVE_DATA_DIR over pluginDataDir', async () => {
    process.env.AGENTS_OBSERVE_DATA_DIR = '/custom/data'
    const cfg = await loadConfig()
    expect(cfg.dataDir).toBe('/custom/data')
  })

  it('uses CLAUDE_PLUGIN_DATA for pluginDataDir when set', async () => {
    process.env.CLAUDE_PLUGIN_DATA = '/plugin/dir'
    const cfg = await loadConfig()
    expect(cfg.pluginDataDir).toBe('/plugin/dir')
    expect(cfg.dataDir).toBe('/plugin/dir/data')
  })

  it('falls back to $HOME/.agents-observe for pluginDataDir', async () => {
    const cfg = await loadConfig()
    expect(cfg.pluginDataDir).toBe(`${process.env.HOME}/.agents-observe`)
  })

  it('derives logsDir from pluginDataDir', async () => {
    const cfg = await loadConfig()
    expect(cfg.logsDir).toBe(`${cfg.pluginDataDir}/logs`)
  })

  it('prefers AGENTS_OBSERVE_LOGS_DIR over pluginDataDir', async () => {
    process.env.AGENTS_OBSERVE_LOGS_DIR = '/custom/logs'
    const cfg = await loadConfig()
    expect(cfg.logsDir).toBe('/custom/logs')
  })

  it('exposes logLevel from AGENTS_OBSERVE_LOG_LEVEL', async () => {
    process.env.AGENTS_OBSERVE_LOG_LEVEL = 'trace'
    const cfg = await loadConfig()
    expect(cfg.logLevel).toBe('trace')
  })

  it('defaults logLevel to empty string', async () => {
    const cfg = await loadConfig()
    expect(cfg.logLevel).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run
```

Expected: Tests fail because config.mjs still uses `CLAUDE_OBSERVE_*`.

- [ ] **Step 3: Update config.mjs**

Replace the entire file `hooks/scripts/lib/config.mjs`:

```javascript
// hooks/scripts/lib/config.mjs
// Centralized config resolution for Agents Observe CLI and MCP server.
// No dependencies - uses only Node.js built-ins.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA || `${process.env.HOME}/.agents-observe`
const mcpPortFile = `${pluginDataDir}/mcp-port`

function readMcpPort() {
  try {
    return readFileSync(mcpPortFile, 'utf8').trim() || null
  } catch {
    return null
  }
}

function readVersion() {
  // VERSION file is at repo root — 3 levels up from hooks/scripts/lib/
  const dir = dirname(fileURLToPath(import.meta.url))
  const versionFile = resolve(dir, '../../../VERSION')
  try {
    return readFileSync(versionFile, 'utf8').trim()
  } catch {
    return null
  }
}

/**
 * Returns shared config. Accepts optional CLI overrides.
 */
export function getConfig(overrides = {}) {
  const serverPort = process.env.AGENTS_OBSERVE_SERVER_PORT || '4981'
  const savedPort = readMcpPort()
  const apiBaseUrl =
    overrides.baseUrl ||
    process.env.AGENTS_OBSERVE_API_BASE_URL ||
    (savedPort ? `http://127.0.0.1:${savedPort}/api` : `http://127.0.0.1:${serverPort}/api`)
  const baseOrigin = new URL(apiBaseUrl).origin
  const version = readVersion()

  return {
    serverPort,
    apiBaseUrl,
    baseOrigin,
    pluginDataDir,
    mcpPortFile,
    logLevel: (process.env.AGENTS_OBSERVE_LOG_LEVEL || '').toLowerCase(),
    logsDir: process.env.AGENTS_OBSERVE_LOGS_DIR || `${pluginDataDir}/logs`,
    projectSlug: overrides.projectSlug || process.env.AGENTS_OBSERVE_PROJECT_SLUG || null,
    containerName: process.env.AGENTS_OBSERVE_DOCKER_CONTAINER_NAME || 'agents-observe',
    dockerImage: process.env.AGENTS_OBSERVE_DOCKER_IMAGE || `ghcr.io/simple10/agents-observe:${version ? `v${version}` : 'latest'}`,
    dataDir: process.env.AGENTS_OBSERVE_DATA_DIR || `${pluginDataDir}/data`,
    API_ID: 'agents-observe',
    expectedVersion: version,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run
```

Expected: All config tests pass.

- [ ] **Step 5: Commit**

```bash
git add hooks/scripts/lib/config.mjs test/config.test.mjs
git commit -m "refactor: rename config to AGENTS_OBSERVE namespace, fix dataDir to use pluginDataDir"
```

---

### Task 3: Namespace rename — all other files

Mechanical find-and-replace across the remaining ~22 files. No behavior changes.

**Files:**
- Modify: `hooks/scripts/lib/docker.mjs`
- Modify: `hooks/scripts/observe_cli.mjs`
- Modify: `hooks/scripts/mcp_server.mjs`
- Modify: `hooks/scripts/lib/http.mjs` (comment only — no env var refs, but update header comment if present)
- Modify: `app/server/src/index.ts`
- Modify: `app/server/src/app.ts`
- Modify: `app/server/src/websocket.ts`
- Modify: `app/server/src/storage/index.ts`
- Modify: `app/server/src/routes/health.ts`
- Modify: `app/server/src/routes/events.ts`
- Modify: `app/server/src/routes/agents.ts`
- Modify: `app/server/src/routes/sessions.ts`
- Modify: `app/client/vite.config.ts`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `justfile`
- Modify: `start.mjs`
- Modify: `package.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `.mcp.json`
- Modify: `.claude/settings.json`
- Modify: `settings.template.json`

- [ ] **Step 1: Rename in hooks scripts**

In `hooks/scripts/lib/docker.mjs`, replace all occurrences:
- `[claude-observe]` → `[agents-observe]` (log prefix, line 41)
- `CLAUDE_OBSERVE_SERVER_PORT` → `AGENTS_OBSERVE_SERVER_PORT` (lines 99, 115)
- `CLAUDE_OBSERVE_DB_PATH` → `AGENTS_OBSERVE_DB_PATH` (lines 100, 116)
- `CLAUDE_OBSERVE_CLIENT_DIST_PATH` → `AGENTS_OBSERVE_CLIENT_DIST_PATH` (lines 101, 117)
- Header comment: `Claude Observe` → `Agents Observe` (line 2)

In `hooks/scripts/observe_cli.mjs`, replace all occurrences:
- `CLAUDE_OBSERVE_ALLOW_LOCAL_CALLBACKS` → `AGENTS_OBSERVE_ALLOW_LOCAL_CALLBACKS` (line 30)
- `CLAUDE_OBSERVE_PROJECT_SLUG` → `AGENTS_OBSERVE_PROJECT_SLUG` (line 92)
- `[claude-observe]` → `[agents-observe]` (lines 65, 98)
- `Claude Observe` → `Agents Observe` (lines 114, 117, 120)
- Header comment: `Claude Observe` → `Agents Observe` (line 3)

In `hooks/scripts/mcp_server.mjs`, replace all occurrences:
- `CLAUDE_OBSERVE_SERVER_PERSIST` → `AGENTS_OBSERVE_SERVER_PERSIST` (line 11)
- `[claude-observe]` → `[agents-observe]` (lines 17, 20)
- `name: 'claude-observe'` → `name: 'agents-observe'` (line 55)
- Header comment: `Claude Observe` → `Agents Observe` (line 3)

- [ ] **Step 2: Rename in server TypeScript files**

In `app/server/src/index.ts`:
- `CLAUDE_OBSERVE_SERVER_PORT` → `AGENTS_OBSERVE_SERVER_PORT` (line 9)

In `app/server/src/app.ts`:
- `CLAUDE_OBSERVE_CLIENT_DIST_PATH` → `AGENTS_OBSERVE_CLIENT_DIST_PATH` (lines 48-49)

In `app/server/src/websocket.ts`:
- `CLAUDE_OBSERVE_LOG_LEVEL` → `AGENTS_OBSERVE_LOG_LEVEL` (line 5)

In `app/server/src/storage/index.ts`:
- `CLAUDE_OBSERVE_STORAGE_ADAPTER` → `AGENTS_OBSERVE_STORAGE_ADAPTER` (line 7)
- `CLAUDE_OBSERVE_DB_PATH` → `AGENTS_OBSERVE_DB_PATH` (line 11)

In `app/server/src/routes/health.ts`:
- `const API_ID = 'claude-observe'` → `const API_ID = 'agents-observe'` (line 11)
- `CLAUDE_OBSERVE_LOG_LEVEL` → `AGENTS_OBSERVE_LOG_LEVEL` (line 32)

In `app/server/src/routes/events.ts`:
- `CLAUDE_OBSERVE_LOG_LEVEL` → `AGENTS_OBSERVE_LOG_LEVEL` (line 18)
- `CLAUDE_OBSERVE_PROJECT_SLUG` → `AGENTS_OBSERVE_PROJECT_SLUG` (line 95)

In `app/server/src/routes/agents.ts`:
- `CLAUDE_OBSERVE_LOG_LEVEL` → `AGENTS_OBSERVE_LOG_LEVEL` (line 8)

In `app/server/src/routes/sessions.ts`:
- `CLAUDE_OBSERVE_LOG_LEVEL` → `AGENTS_OBSERVE_LOG_LEVEL` (line 14)

- [ ] **Step 3: Rename in client**

In `app/client/vite.config.ts`:
- `CLAUDE_OBSERVE_SERVER_PORT` → `AGENTS_OBSERVE_SERVER_PORT` (line 6)
- `CLAUDE_OBSERVE_CLIENT_PORT` → `AGENTS_OBSERVE_CLIENT_PORT` (line 7)

- [ ] **Step 4: Rename in Docker and config files**

In `docker-compose.yml`, replace entire file:
```yaml
services:
  agents-observe:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: agents-observe
    environment:
      AGENTS_OBSERVE_SERVER_PORT: "${AGENTS_OBSERVE_SERVER_PORT:-4981}"
      AGENTS_OBSERVE_DB_PATH: /data/observe.db
      AGENTS_OBSERVE_CLIENT_DIST_PATH: /app/client/dist
      AGENTS_OBSERVE_LOG_LEVEL: "${AGENTS_OBSERVE_LOG_LEVEL:-debug}"
    ports:
      - "${AGENTS_OBSERVE_SERVER_PORT:-4981}:${AGENTS_OBSERVE_SERVER_PORT:-4981}"
    volumes:
      - ${AGENTS_OBSERVE_DATA_DIR:-./data}:/data
```

In `.env.example`, replace entire file:
```bash
# Server
AGENTS_OBSERVE_SERVER_PORT=4981   # Port used by local dev & docker container
AGENTS_OBSERVE_LOG_LEVEL=debug    # debug | trace
AGENTS_OBSERVE_DB_PATH=../../data/observe.db # Only relevant when running the local server, not used in docker
# AGENTS_OBSERVE_DATA_DIR=./data # Local dir to bind mount into the docker container
# AGENTS_OBSERVE_STORAGE_ADAPTER=sqlite
# AGENTS_OBSERVE_CLIENT_DIST_PATH=       # Path to built client assets (production only)

# Client (Vite dev server)
AGENTS_OBSERVE_CLIENT_PORT=5174          # Only relevant for local dev

# Plugin / CLI overrides (optional)
# AGENTS_OBSERVE_API_BASE_URL=http://127.0.0.1:4981/api   # Override API base URL used by observe_cli.mjs
# AGENTS_OBSERVE_DOCKER_CONTAINER_NAME=agents-observe      # Docker container name
# AGENTS_OBSERVE_DOCKER_IMAGE=ghcr.io/simple10/agents-observe:v1.0.0  # Docker image to pull/run
# AGENTS_OBSERVE_LOGS_DIR=              # Override log directory (default: $CLAUDE_PLUGIN_DATA/logs)
```

- [ ] **Step 5: Rename in justfile**

In `justfile`, replace all `CLAUDE_OBSERVE` with `AGENTS_OBSERVE`:
- Line 13: `CLAUDE_OBSERVE_SERVER_PORT` → `AGENTS_OBSERVE_SERVER_PORT`
- Line 14: `CLAUDE_OBSERVE_CLIENT_PORT` → `AGENTS_OBSERVE_CLIENT_PORT`
- Line 27: `claude-observe:local` → `agents-observe:local` (docker build tag)

- [ ] **Step 6: Rename in start.mjs**

In `start.mjs`:
- `CLAUDE_OBSERVE_SERVER_PORT` → `AGENTS_OBSERVE_SERVER_PORT` (lines 24, 33, 35)
- `CLAUDE_OBSERVE_CLIENT_DIST_PATH` → `AGENTS_OBSERVE_CLIENT_DIST_PATH` (line 33)

- [ ] **Step 7: Rename in package.json and plugin metadata**

In `package.json`:
- `"name": "claude-observe"` → `"name": "agents-observe"`

In `.claude-plugin/plugin.json`:
- `"name": "claude-observe"` → `"name": "agents-observe"`

In `.claude-plugin/marketplace.json`:
- Both `"name": "claude-observe"` → `"name": "agents-observe"` (lines 2 and 8)

In `.mcp.json`:
- `"claude-observe"` key → `"agents-observe"`

In `.claude/settings.json`:
- `"CLAUDE_OBSERVE_PROJECT_SLUG"` → `"AGENTS_OBSERVE_PROJECT_SLUG"`

In `settings.template.json`:
- `"CLAUDE_OBSERVE_PROJECT_SLUG"` → `"AGENTS_OBSERVE_PROJECT_SLUG"`

- [ ] **Step 8: Verify no remaining references**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe && grep -r "CLAUDE_OBSERVE" --include='*.mjs' --include='*.ts' --include='*.json' --include='*.yml' --include='*.example' . | grep -v node_modules | grep -v '.git/' | grep -v 'docs/'
```

Expected: No matches (docs/ excluded since the spec references old names for context).

Also check identifier references:
```bash
grep -r "claude-observe" --include='*.mjs' --include='*.ts' --include='*.json' --include='*.yml' --include='*.example' . | grep -v node_modules | grep -v '.git/' | grep -v 'docs/' | grep -v 'package-lock.json'
```

Expected: No matches.

- [ ] **Step 9: Run server tests to ensure nothing broke**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe/app/server && npm test
```

Expected: All existing tests pass.

- [ ] **Step 10: Commit**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe
git add -A
git commit -m "refactor: rename claude-observe to agents-observe across all files"
```

---

### Task 4: Add `agent_class` column to agents table

**Files:**
- Modify: `app/server/src/storage/sqlite-adapter.ts:46-59`

- [ ] **Step 1: Add agent_class column to CREATE TABLE statement**

In `app/server/src/storage/sqlite-adapter.ts`, modify the agents table creation (around line 46). Change:

```sql
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_agent_id TEXT,
        name TEXT,
        description TEXT,
        agent_type TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (parent_agent_id) REFERENCES agents(id)
      )
```

to:

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

No other code changes needed — `agent_class` is populated by the SQL default.

- [ ] **Step 2: Run server tests**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe/app/server && npm test
```

Expected: All tests pass (they create fresh in-memory DBs).

- [ ] **Step 3: Reset the dev database**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe && just db-reset
```

Expected: "Database reset"

- [ ] **Step 4: Commit**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe
git add app/server/src/storage/sqlite-adapter.ts
git commit -m "feat: add agent_class column to agents table (default: claude-code)"
```

---

### Task 5: Logger utility

**Files:**
- Create: `hooks/scripts/lib/logger.mjs`
- Create: `test/logger.test.mjs`

- [ ] **Step 1: Write logger tests**

Create `test/logger.test.mjs`:

```javascript
// test/logger.test.mjs
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// We test createLogger by pointing it at a temp directory
let testDir
let savedLogLevel

beforeEach(() => {
  testDir = join(tmpdir(), `logger-test-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })
  savedLogLevel = process.env.AGENTS_OBSERVE_LOG_LEVEL
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  if (savedLogLevel === undefined) delete process.env.AGENTS_OBSERVE_LOG_LEVEL
  else process.env.AGENTS_OBSERVE_LOG_LEVEL = savedLogLevel
})

async function makeLogger(level) {
  // createLogger reads config, so set env before importing
  if (level) process.env.AGENTS_OBSERVE_LOG_LEVEL = level
  else delete process.env.AGENTS_OBSERVE_LOG_LEVEL
  process.env.AGENTS_OBSERVE_LOGS_DIR = testDir

  // Fresh import each time
  const mod = await import('../hooks/scripts/lib/logger.mjs?' + Date.now())
  return mod.createLogger('test.log')
}

describe('logger', () => {
  it('always writes error to log file regardless of log level', async () => {
    const log = await makeLogger('')
    log.error('bad thing')
    const content = readFileSync(join(testDir, 'test.log'), 'utf8')
    expect(content).toContain('bad thing')
    expect(content).toContain('ERROR')
  })

  it('always writes warn to log file regardless of log level', async () => {
    const log = await makeLogger('')
    log.warn('warning thing')
    const content = readFileSync(join(testDir, 'test.log'), 'utf8')
    expect(content).toContain('warning thing')
    expect(content).toContain('WARN')
  })

  it('does not write debug to log file when log level is unset', async () => {
    const log = await makeLogger('')
    log.debug('verbose thing')
    try {
      readFileSync(join(testDir, 'test.log'), 'utf8')
      // If file exists, it should not contain the debug message
      expect(true).toBe(false) // Should not reach here
    } catch {
      // File doesn't exist — correct behavior
    }
  })

  it('writes debug to log file when log level is debug', async () => {
    const log = await makeLogger('debug')
    log.debug('verbose thing')
    const content = readFileSync(join(testDir, 'test.log'), 'utf8')
    expect(content).toContain('verbose thing')
  })

  it('writes info to log file when log level is debug', async () => {
    const log = await makeLogger('debug')
    log.info('info thing')
    const content = readFileSync(join(testDir, 'test.log'), 'utf8')
    expect(content).toContain('info thing')
  })

  it('writes trace to log file when log level is trace', async () => {
    const log = await makeLogger('trace')
    log.trace('trace thing')
    const content = readFileSync(join(testDir, 'test.log'), 'utf8')
    expect(content).toContain('trace thing')
  })

  it('prunes log file when it exceeds 1MB', async () => {
    const log = await makeLogger('debug')
    const logFile = join(testDir, 'test.log')

    // Write >1MB to the file directly to simulate accumulated logs
    const bigContent = 'X'.repeat(1_100_000) + '\n'
    writeFileSync(logFile, bigContent)

    // Next write should trigger prune
    log.debug('after prune')

    const stat = statSync(logFile)
    expect(stat.size).toBeLessThan(600_000) // ~500KB after prune + new line
    const content = readFileSync(logFile, 'utf8')
    expect(content).toContain('after prune')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe && npx vitest run test/logger.test.mjs
```

Expected: Fails — `logger.mjs` doesn't exist.

- [ ] **Step 3: Implement logger.mjs**

Create `hooks/scripts/lib/logger.mjs`:

```javascript
// hooks/scripts/lib/logger.mjs
// Structured file + console logger for Agents Observe hooks.
// No dependencies - uses only Node.js built-ins.

import { appendFileSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getConfig } from './config.mjs'

const MAX_LOG_SIZE = 1_048_576 // 1MB
const PRUNE_TARGET = 524_288  // 500KB — keep the tail

/**
 * Creates a logger that writes to both a log file and console (stderr).
 *
 * File output: error/warn always; info/debug/trace only when logLevel is debug|trace.
 * Console output: error/warn/info always; debug/trace only when logLevel is debug|trace.
 */
export function createLogger(filename) {
  const config = getConfig()
  const logLevel = config.logLevel
  const verbose = logLevel === 'debug' || logLevel === 'trace'
  const logFile = join(config.logsDir, filename)
  let dirCreated = false

  function ensureDir() {
    if (!dirCreated) {
      mkdirSync(config.logsDir, { recursive: true })
      dirCreated = true
    }
  }

  function pruneIfNeeded() {
    try {
      const stat = statSync(logFile)
      if (stat.size > MAX_LOG_SIZE) {
        const content = readFileSync(logFile, 'utf8')
        const tail = content.slice(-PRUNE_TARGET)
        // Start from the first complete line
        const firstNewline = tail.indexOf('\n')
        const pruned = firstNewline >= 0 ? tail.slice(firstNewline + 1) : tail
        writeFileSync(logFile, pruned)
      }
    } catch {
      // File doesn't exist yet — nothing to prune
    }
  }

  function writeToFile(level, msg) {
    ensureDir()
    pruneIfNeeded()
    const timestamp = new Date().toISOString()
    const line = `${timestamp} [${level}] ${msg}\n`
    appendFileSync(logFile, line)
  }

  return {
    error(msg) {
      writeToFile('ERROR', msg)
      console.error(`[agents-observe] ${msg}`)
    },
    warn(msg) {
      writeToFile('WARN', msg)
      console.error(`[agents-observe] ${msg}`)
    },
    info(msg) {
      if (verbose) writeToFile('INFO', msg)
      console.error(`[agents-observe] ${msg}`)
    },
    debug(msg) {
      if (!verbose) return
      writeToFile('DEBUG', msg)
      console.error(`[agents-observe] ${msg}`)
    },
    trace(msg) {
      if (!verbose) return
      writeToFile('TRACE', msg)
      console.error(`[agents-observe] ${msg}`)
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe && npx vitest run test/logger.test.mjs
```

Expected: All logger tests pass.

- [ ] **Step 5: Commit**

```bash
git add hooks/scripts/lib/logger.mjs test/logger.test.mjs
git commit -m "feat: add logger utility with dual file/console output and size pruning"
```

---

### Task 6: Integrate logger into MCP server and CLI

Replace `console.error` / `console.warn` calls in `mcp_server.mjs` and `observe_cli.mjs` with the new logger.

**Files:**
- Modify: `hooks/scripts/mcp_server.mjs`
- Modify: `hooks/scripts/observe_cli.mjs`

- [ ] **Step 1: Integrate logger into mcp_server.mjs**

Add import at the top of `hooks/scripts/mcp_server.mjs`:

```javascript
import { createLogger } from './lib/logger.mjs'
```

Create the logger after `getConfig()`:

```javascript
const config = getConfig()
const log = createLogger('mcp.log')
```

Replace all `console.error(\`[agents-observe]` calls with logger calls:
- Line 17 (`Failed to start server`): `log.error('Failed to start server')`
- Line 20 (`Dashboard: ...`): `log.info(\`Dashboard: http://127.0.0.1:${actualPort}\`)`

- [ ] **Step 2: Integrate logger into observe_cli.mjs**

Add import at the top of `hooks/scripts/observe_cli.mjs`:

```javascript
import { createLogger } from './lib/logger.mjs'
```

Create the logger after `getConfig()`:

```javascript
const log = createLogger('cli.log')
```

Replace log calls:
- Line 65 (`Blocked callback`): `log.warn(\`Blocked callback: ${req.cmd} (not in AGENTS_OBSERVE_ALLOW_LOCAL_CALLBACKS)\`)`
- Line 98 (`Server unreachable`): `log.warn(\`Server unreachable at ${config.baseOrigin}: ${result.error}\`)`
- Line 114 (`is running`): `log.info(...)` — but this is in `healthCommand()` which outputs to the user, so keep as `console.log` (stdout for user-facing output)
- Lines 117, 120 (health errors): keep as `console.log` — user-facing output

Only replace the `[agents-observe]` prefixed `console.warn`/`console.error` calls in the hook command path. Leave `healthCommand()` console.log calls as-is since they are user-facing output, not diagnostic logging.

- [ ] **Step 3: Run all tests**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe && npx vitest run && cd app/server && npm test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe
git add hooks/scripts/mcp_server.mjs hooks/scripts/observe_cli.mjs
git commit -m "refactor: integrate logger into MCP server and CLI"
```

---

### Task 7: Non-blocking CLI hook command

Make the `hook` command fire-and-forget. Add `fireAndForget` option to `http.mjs`.

**Files:**
- Modify: `hooks/scripts/lib/http.mjs`
- Modify: `hooks/scripts/observe_cli.mjs`
- Create: `test/http.test.mjs`

- [ ] **Step 1: Write http fireAndForget test**

Create `test/http.test.mjs`:

```javascript
// test/http.test.mjs
import { describe, it, expect } from 'vitest'
import { createServer } from 'node:http'

async function loadHttp() {
  const mod = await import('../hooks/scripts/lib/http.mjs?' + Date.now())
  return mod
}

function startTestServer(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({ server, port, url: `http://127.0.0.1:${port}` })
    })
  })
}

describe('http', () => {
  it('postJson returns response when fireAndForget is false', async () => {
    const { postJson } = await loadHttp()
    const { server, url } = await startTestServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ received: true }))
      })
    })

    try {
      const result = await postJson(`${url}/test`, { foo: 'bar' })
      expect(result.status).toBe(200)
      expect(result.body.received).toBe(true)
    } finally {
      server.close()
    }
  })

  it('postJson with fireAndForget returns immediately and unrefs socket', async () => {
    const { postJson } = await loadHttp()
    let requestReceived = false
    const { server, url } = await startTestServer((req, res) => {
      requestReceived = true
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
    })

    try {
      const result = postJson(`${url}/test`, { foo: 'bar' }, { fireAndForget: true })
      // Returns a promise but we don't need to await it for the process to exit
      expect(result).toBeInstanceOf(Promise)
      // Give it a moment to actually send
      await new Promise((r) => setTimeout(r, 100))
      expect(requestReceived).toBe(true)
    } finally {
      server.close()
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe && npx vitest run test/http.test.mjs
```

Expected: Fails — `postJson` doesn't accept options parameter.

- [ ] **Step 3: Add fireAndForget support to http.mjs**

Replace `hooks/scripts/lib/http.mjs`:

```javascript
// hooks/scripts/lib/http.mjs
// HTTP helpers for Agents Observe. No dependencies - Node.js built-ins only.

import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'

export function httpRequest(url, options, body) {
  const parsed = new URL(url)
  const transport = parsed.protocol === 'https:' ? httpsRequest : request
  const fireAndForget = options.fireAndForget || false

  return new Promise((resolve) => {
    const req = transport(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 5000,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) })
          } catch {
            resolve({ status: res.statusCode, body: data })
          }
        })
      },
    )

    if (fireAndForget) {
      req.on('socket', (socket) => {
        socket.unref()
      })
    }

    req.on('error', (err) => {
      resolve({ status: 0, body: null, error: err.message })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, body: null, error: 'timeout' })
    })
    if (body) req.write(body)
    req.end()
  })
}

export function postJson(url, data, opts = {}) {
  const body = JSON.stringify(data)
  return httpRequest(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      fireAndForget: opts.fireAndForget || false,
    },
    body,
  )
}

export function getJson(url) {
  return httpRequest(url, { method: 'GET' }, null)
}
```

- [ ] **Step 4: Run http tests to verify they pass**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe && npx vitest run test/http.test.mjs
```

Expected: All http tests pass.

- [ ] **Step 5: Update hookCommand in observe_cli.mjs to fire-and-forget**

In `hooks/scripts/observe_cli.mjs`, modify the `hookCommand` function. Change the stdin `end` handler from:

```javascript
  process.stdin.on('end', async () => {
    if (!input.trim()) process.exit(0)

    let hookPayload
    try {
      hookPayload = JSON.parse(input)
    } catch {
      process.exit(0)
    }

    const envelope = { hook_payload: hookPayload, meta: { env: {} } }
    if (config.projectSlug) {
      envelope.meta.env.AGENTS_OBSERVE_PROJECT_SLUG = config.projectSlug
    }

    const result = await postJson(`${config.apiBaseUrl}/events`, envelope)

    if (result.status === 0) {
      log.warn(`Server unreachable at ${config.baseOrigin}: ${result.error}`)
      process.exit(0)
    }

    if (result.body?.requests) {
      await handleRequests(result.body.requests)
    }

    process.exit(0)
  })
```

to:

```javascript
  process.stdin.on('end', () => {
    if (!input.trim()) return

    let hookPayload
    try {
      hookPayload = JSON.parse(input)
    } catch {
      return
    }

    const envelope = { hook_payload: hookPayload, meta: { env: {} } }
    if (config.projectSlug) {
      envelope.meta.env.AGENTS_OBSERVE_PROJECT_SLUG = config.projectSlug
    }

    postJson(`${config.apiBaseUrl}/events`, envelope, { fireAndForget: true })
      .then((result) => {
        if (result.status === 0) {
          log.warn(`Server unreachable at ${config.baseOrigin}: ${result.error}`)
          return
        }
        if (result.body?.requests) {
          handleRequests(result.body.requests)
        }
      })
      .catch(() => {})
  })
```

Key changes:
- Remove `async` from the callback — no longer awaiting
- Remove all `process.exit(0)` calls — process exits naturally when stdin closes and the unreffed socket doesn't hold the event loop
- Use `postJson(..., { fireAndForget: true })` with `.then()` for optional callback handling
- `handleRequests` doesn't need to be awaited since callbacks are also fire-and-forget at this point

- [ ] **Step 6: Run all tests**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe && npx vitest run && cd app/server && npm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe
git add hooks/scripts/lib/http.mjs hooks/scripts/observe_cli.mjs test/http.test.mjs
git commit -m "feat: make CLI hook command non-blocking with fire-and-forget HTTP"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe && npm test
```

Expected: All root, server, and client tests pass.

- [ ] **Step 2: Verify no old namespace references remain**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe
grep -r "CLAUDE_OBSERVE" --include='*.mjs' --include='*.ts' --include='*.json' --include='*.yml' --include='*.example' . | grep -v node_modules | grep -v '.git/' | grep -v 'docs/' | grep -v 'package-lock.json'
```

Expected: No matches.

```bash
grep -r "claude-observe" --include='*.mjs' --include='*.ts' --include='*.json' --include='*.yml' --include='*.example' . | grep -v node_modules | grep -v '.git/' | grep -v 'docs/' | grep -v 'package-lock.json'
```

Expected: No matches.

- [ ] **Step 3: Verify dev server starts**

```bash
cd /Users/joe/Development/opik/agent-super-spy/claude-observe && just dev-server &
sleep 3
curl -s http://localhost:4981/api/health | python3 -m json.tool
kill %1
```

Expected: Health response shows `"id": "agents-observe"`.

- [ ] **Step 4: Send a test event**

```bash
just test-event
```

Expected: "Event sent" — no errors.
