# Three-Layer Contract Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development) — phases are sequential, but tasks within each phase use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three-layer contract refactor specified in `docs/specs/2026-04-25-three-layer-contract-design.md`. Server becomes agent-class-agnostic and acts only on explicit envelope signals; hook libs do all payload normalization; client owns all display, status derivation, and hierarchy reconstruction.

**Architecture:** Refactor in nine phases, ordered to keep `main` (well, `refactor/three-layer-contract` until merge) green at each step. Schema changes precede route changes precede hook changes precede client changes. Each phase ends with `just check` passing and a commit.

**Tech Stack:** SQLite + Hono server, Vite + React 19 client, Node hook scripts. No new dependencies.

**Spec reference:** `docs/specs/2026-04-25-three-layer-contract-design.md` is authoritative for behavior. This plan covers HOW.

---

## Phase 0: Worktree warm-up

Quick verification that the isolated worktree environment functions before starting destructive work.

**Files:** none modified.

- [ ] **Step 1: Confirm `.env` is loaded by `just`**

```bash
cat .env
just --evaluate AGENTS_OBSERVE_SERVER_PORT  # if just supports it; otherwise:
just --list | head
```

Expected: `.env` shows port 4982 + 5175 + DATA_DIR=./data.

- [ ] **Step 2: Install deps**

```bash
just install
```

- [ ] **Step 3: Run baseline tests**

```bash
just check
```

Expected: all 780 tests pass before any changes. This is the green-baseline commit reference.

- [ ] **Step 4: No commit** — phase 0 makes no changes.

---

## Phase 1: Pure deletions (no behavior change)

Drop dead endpoints, dead API methods, and unused DB columns. Audit confirmed no callers, so removal is safe.

**Files:**
- Delete handlers in: `app/server/src/routes/events.ts`, `app/server/src/routes/agents.ts`, `app/server/src/storage/sqlite-adapter.ts`
- Delete callers in: `app/client/src/lib/api-client.ts`
- Migration: `app/server/src/storage/sqlite-adapter.ts` (drop columns)

### Task 1.1: Drop dead endpoints

- [ ] **Step 1: Delete `GET /api/events/:id/thread` handler.** In `app/server/src/routes/events.ts`, find and remove the `router.get('/events/:id/thread', …)` block. Also delete `getThreadForEvent` from `app/server/src/storage/sqlite-adapter.ts` (~lines 670-720).

- [ ] **Step 2: Delete `GET /api/agents/:id/events` handler.** In `app/server/src/routes/agents.ts`, remove `router.get('/agents/:id/events', …)` (line 21).

- [ ] **Step 3: Delete `PATCH /api/agents/:id` handler.** In `app/server/src/routes/agents.ts`, remove `router.patch('/agents/:id', …)` (line 59). Phase 3 brings it back as the canonical Layer 3 patch path; for Phase 1 we just want it gone.

- [ ] **Step 4: Run tests.** `just check`. Tests for removed endpoints fail — delete those tests:
  - `app/server/src/routes/agents.test.ts` — any `describe('PATCH /agents/:id')` or events-list blocks
  - Any client tests calling `getThread` or `updateAgentMetadata`

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "refactor: delete dead endpoints (thread, agents events list, agents PATCH)"
```

### Task 1.2: Drop dead API client methods

- [ ] **Step 1: Remove from `app/client/src/lib/api-client.ts`:**
  - `getThread`
  - `updateAgentMetadata`

(Keep `getAgent` — it's actually used by `use-agents.ts`.)

- [ ] **Step 2: Run tests.** `just check`. Should pass.

- [ ] **Step 3: Commit.**

```bash
git commit -am "refactor: delete dead API client methods (getThread, updateAgentMetadata)"
```

### Task 1.3: Drop unused DB columns (agents.metadata, projects.metadata, agents.transcript_path)

- [ ] **Step 1: Open `app/server/src/storage/sqlite-adapter.ts`.** Find the `runMigrations()` method.

- [ ] **Step 2: Add a new migration step that rebuilds the affected tables without the dead columns.**

SQLite-style table rebuild:

```ts
// Migration: drop unused columns from agents and projects
const agentsCols = this.db.prepare('PRAGMA table_info(agents)').all() as Array<{ name: string }>
const agentsHasMetadata = agentsCols.some((c) => c.name === 'metadata')
const agentsHasTranscriptPath = agentsCols.some((c) => c.name === 'transcript_path')

if (agentsHasMetadata || agentsHasTranscriptPath) {
  this.db.exec(`
    CREATE TABLE agents_new (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      parent_agent_id TEXT,
      name TEXT,
      description TEXT,
      agent_type TEXT,
      agent_class TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    INSERT INTO agents_new (id, session_id, parent_agent_id, name, description, agent_type, agent_class, created_at, updated_at)
    SELECT id, session_id, parent_agent_id, name, description, agent_type, agent_class, created_at, updated_at FROM agents;
    DROP TABLE agents;
    ALTER TABLE agents_new RENAME TO agents;
    CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id);
  `)
}

const projectsCols = this.db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>
const projectsHasMetadata = projectsCols.some((c) => c.name === 'metadata')

if (projectsHasMetadata) {
  this.db.exec(`
    CREATE TABLE projects_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      transcript_path TEXT,
      cwd TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO projects_new (id, slug, name, transcript_path, cwd, created_at, updated_at)
    SELECT id, slug, name, transcript_path, cwd, created_at, updated_at FROM projects;
    DROP TABLE projects;
    ALTER TABLE projects_new RENAME TO projects;
  `)
}
```

(`projects.cwd` and `projects.transcript_path` are dropped in Phase 2; keeping them here so this migration is safe to land independently.)

- [ ] **Step 3: Update the adapter's INSERT statements** to no longer reference the removed columns. Search for `metadata` and `transcript_path` in agents-related INSERT/UPDATE statements; remove from the column list.

- [ ] **Step 4: Run tests.** `just check`. Update any test fixtures that referenced the removed columns.

- [ ] **Step 5: Commit.**

```bash
git commit -am "refactor: drop unused DB columns (agents.metadata, agents.transcript_path, projects.metadata)"
```

---

## Phase 2: Schema migration — events / sessions / agents / projects

Apply the full target schema from the spec. This is the riskiest migration — it touches every table.

**Files:**
- `app/server/src/storage/sqlite-adapter.ts` (migrations + queries + adapter methods)
- `app/server/src/storage/types.ts` (StoredEvent, InsertEventParams, etc.)
- `app/server/src/types.ts` (ParsedEvent, EventEnvelopeMeta)

### Task 2.1: Sessions table — add start_cwd, drop status / event_count / agent_count

- [ ] **Step 1: Write a failing test.** In `app/server/src/storage/sqlite-adapter.test.ts`, add:

```ts
describe('sessions schema', () => {
  it('has start_cwd, no status/event_count/agent_count', () => {
    const cols = (db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>)
      .map((c) => c.name)
    expect(cols).toContain('start_cwd')
    expect(cols).not.toContain('status')
    expect(cols).not.toContain('event_count')
    expect(cols).not.toContain('agent_count')
  })
})
```

- [ ] **Step 2: Run the test, expect failure.** `npx vitest run src/storage/sqlite-adapter.test.ts`.

- [ ] **Step 3: Add the migration.** In `runMigrations()`, table-rebuild sessions with the new schema. Drop status, event_count, agent_count. Add start_cwd.

- [ ] **Step 4: Update `upsertSession` in the adapter.** New signature: drop the `status`, `event_count`, `agent_count` parameters. Add `startCwd` parameter (used only on insert). On UPDATE, preserve existing slug / transcript_path / start_cwd / metadata if they're already set.

- [ ] **Step 5: Update `last_activity` write path.** The increment-on-insert that touched event_count / agent_count just stops touching them. `last_activity` itself is computed inline.

- [ ] **Step 6: Update `getSessionById`, `getSessions`, `getRecentSessions` row-mapping** — drop the dead columns from the returned shape.

- [ ] **Step 7: Update Session / RecentSession types** in `app/server/src/types.ts` to match. Status is now a derived field on the API response (computed from `stopped_at`).

- [ ] **Step 8: Update API responses.** In `routes/sessions.ts`, derive `status: stopped_at ? 'ended' : 'active'`. Same for `routes/agents.ts` if it returns sessions.

- [ ] **Step 9: Run tests.** `just check`. Update any client tests that read `event_count` / `agent_count` directly.

- [ ] **Step 10: Commit.**

```bash
git commit -am "refactor: sessions schema — add start_cwd, drop status/event_count/agent_count"
```

### Task 2.2: Agents table — drop session_id, parent_agent_id

- [ ] **Step 1: Write a failing test** asserting the agents table lacks `session_id` and `parent_agent_id`.

- [ ] **Step 2: Migration.** Table-rebuild `agents` per the spec schema:

```sql
CREATE TABLE agents_new (
  id TEXT PRIMARY KEY,
  agent_class TEXT NOT NULL,
  name TEXT,
  description TEXT,
  agent_type TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO agents_new (id, agent_class, name, description, agent_type, created_at, updated_at)
  SELECT id, COALESCE(agent_class, 'unknown'), name, description, agent_type, created_at, updated_at FROM agents;
DROP TABLE agents;
ALTER TABLE agents_new RENAME TO agents;
```

- [ ] **Step 3: Update `upsertAgent` signature** — remove session_id, parent_agent_id from params. The function's responsibility narrows: insert if new, no-op on existing row's class field.

- [ ] **Step 4: Drop the `idx_agents_session` index** since the column is gone.

- [ ] **Step 5: Update `getAgentsForSession`** to derive via events:

```sql
SELECT DISTINCT a.* FROM agents a
JOIN events e ON e.agent_id = a.id
WHERE e.session_id = ?
ORDER BY a.created_at ASC
```

- [ ] **Step 6: Update API responses** — `Agent` type drops `session_id`, `parent_agent_id`. Client types track in step 5.5.

- [ ] **Step 7: Run tests.** Update fixtures.

- [ ] **Step 8: Commit.**

```bash
git commit -am "refactor: agents schema — drop session_id and parent_agent_id (Layer 3 derives)"
```

### Task 2.3: Projects table — drop cwd, transcript_path

- [ ] **Step 1: Migration.** Table-rebuild projects per spec.

- [ ] **Step 2: Update project-resolver.ts** — drop `getProjectByCwd` / `getProjectByTranscriptPath` calls; replace with sibling-session matching (full rewrite happens in Phase 3, but the storage methods can go now).

Wait: the resolver is fully rewritten in Phase 3. To keep this phase atomic, leave the (now-unreachable) old calls in place for now and just drop the columns. The resolver will fail at runtime if it tries to use them, so Phase 2's runtime sanity test must skip resolver-touching paths until Phase 3.

Better approach: in Phase 2, gut the project resolver to a stub that always returns the existing assignment or NULL, and accept that project resolution doesn't function between Phase 2 and Phase 3. Tests for the resolver get marked `.skip` here and re-enabled in Phase 3.

- [ ] **Step 3: Stub the project resolver.** In `app/server/src/services/project-resolver.ts`:

```ts
export async function resolveProject(
  store: EventStore,
  input: ResolveProjectInput,
): Promise<ResolveProjectResult> {
  // PHASE 2 STUB: real algorithm lands in Phase 3.
  // For now, only respect explicit slug; fall through to NULL otherwise.
  if (input.slug) {
    const existing = await store.getProjectBySlug(input.slug)
    if (existing) return { projectId: existing.id, projectSlug: existing.slug, created: false }
    const id = await store.createProject(input.slug, input.slug)  // 2-arg signature; see step 4
    return { projectId: id, projectSlug: input.slug, created: true }
  }
  return { projectId: null as unknown as number, projectSlug: '', created: false }  // signals "no project"
}
```

(Caller in events.ts handles the null case in Phase 3; here, accept that new sessions without an explicit slug end up unassigned. This is the ultimate target behavior.)

- [ ] **Step 4: Trim `createProject` signature.** Currently takes `(slug, name, transcriptPath, cwd)`. Now `(slug, name)`. Update all callers + tests.

- [ ] **Step 5: Drop `getProjectByCwd`, `getProjectByTranscriptPath`, `updateProjectCwd`** from the adapter and `EventStore` interface.

- [ ] **Step 6: Run tests.** Update fixtures. Skip the deeper project-resolver tests with a TODO referring to Phase 3.

- [ ] **Step 7: Commit.**

```bash
git commit -am "refactor: projects schema — drop cwd/transcript_path; resolver stubbed for Phase 3"
```

### Task 2.4: Events table — drop type/subtype/tool_name; add _meta column

- [ ] **Step 1: Write failing tests** — events table has `_meta` column; lacks `type`, `subtype`, `tool_name`; the `idx_events_type` composite index is gone.

- [ ] **Step 2: Migration.** Table-rebuild events per spec:

```sql
CREATE TABLE events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  hook_name TEXT NOT NULL,
  payload TEXT NOT NULL,        -- json
  timestamp INTEGER NOT NULL,
  cwd TEXT,
  _meta TEXT,                   -- json
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
INSERT INTO events_new (id, session_id, agent_id, hook_name, payload, timestamp, cwd, _meta, created_at)
  SELECT id, session_id, agent_id,
         COALESCE(hook_name, subtype, type, 'unknown'),  -- best-effort fallback for legacy rows
         payload,
         timestamp,
         NULL,                                            -- cwd: NULL for legacy
         NULL,                                            -- _meta: NULL for legacy
         created_at
  FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_agent_ts ON events(agent_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_session_hook ON events(session_id, hook_name);
```

- [ ] **Step 3: Update `InsertEventParams`** in `app/server/src/storage/types.ts`:

```ts
export interface InsertEventParams {
  agentId: string
  sessionId: string
  hookName: string
  timestamp: number
  payload: Record<string, unknown>
  cwd?: string | null
  _meta?: Record<string, unknown> | null
  // Deprecated; removed in Phase 3:
  isNotification?: boolean
  clearsNotification?: boolean
}
```

The `isNotification` / `clearsNotification` plumbing stays as adapter params for one more phase (Phase 3 will rewire to use `flags.*`).

- [ ] **Step 4: Update `insertEvent`** to write the new columns and stop writing the old ones. Drop `type`, `subtype`, `toolName` from the INSERT.

- [ ] **Step 5: Update `StoredEvent` and the row-to-event mappers** in adapter and routes to drop the old fields and add `cwd`, `_meta`.

- [ ] **Step 6: Update `ParsedEvent`** in `app/server/src/types.ts` — drop `type`, `subtype`, `toolName`, `status`. Add `cwd`, `_meta`.

- [ ] **Step 7: Update routes/events.ts and routes/sessions.ts and routes/agents.ts** to drop references to the removed fields in their response shapes. Build response from `StoredEvent` directly. `status` derived field already removed by deriveEventStatus deletion (see Phase 3 task 3.4) — but for now Phase 2 leaves a status-always-`null` field on the response so the client doesn't crash. Phase 5 removes the field entirely.

Wait — that's a layering violation. Let me revise: Phase 2 keeps `status` as a derivable response field (computed from absence of any "Post" / "Stop" subtype, which we can't compute anymore). Simpler: Phase 2 just stops returning `status` from the API; Phase 5 will update the client to derive its own status. Between Phase 2 and Phase 5 the client is broken on status indicators — acceptable since this is one branch.

- [ ] **Step 8: Run tests.** Heavy client-test breakage expected; mark client tests `.skip` if they assert on `event.subtype` / `event.type` / `event.tool_name` — Phase 5 fixes them.

- [ ] **Step 9: Commit.**

```bash
git commit -am "refactor: events schema — drop type/subtype/tool_name, add cwd and _meta columns"
```

### Task 2.5: Schema-touch sanity — server starts, accepts events

- [ ] **Step 1: Start server in worktree** (background): `just start &` (or `just dev` and ignore vite client breakage).

- [ ] **Step 2: Send a test event.** `just test-event` if available, else `curl` a fixture.

- [ ] **Step 3: Verify in DB:**

```bash
sqlite3 data/observe.db "SELECT id, session_id, agent_id, hook_name FROM events ORDER BY id DESC LIMIT 1;"
```

Should return the test event with hook_name populated.

- [ ] **Step 4: Stop server. Commit if any fixture/script changed.**

---

## Phase 3: Server route + envelope contract

Rewrite the server's behavior surface to match the spec.

**Files:**
- `app/server/src/parser.ts` — full rewrite, much smaller
- `app/server/src/routes/events.ts` — full rewrite
- `app/server/src/services/project-resolver.ts` — full rewrite per spec algorithm
- `app/server/src/types.ts` — finalize `EventEnvelope` + `EventEnvelopeMeta`
- `app/server/src/routes/agents.ts` — bring back PATCH; drop `/:id/events` (already done in Phase 1)
- `app/server/src/app.ts` — register PATCH agents (callbacks router stays)

### Task 3.1: Lock the envelope type definitions

- [ ] **Step 1: Replace `EventEnvelope` and `EventEnvelopeMeta`** in `app/server/src/types.ts` with:

```ts
export interface EventEnvelopeFlags {
  startsNotification?: boolean
  clearsNotification?: boolean
  stopsSession?: boolean
  resolveProject?: boolean
}

export interface EventEnvelopeCreationHints {
  session?: {
    slug?: string | null
    transcriptPath?: string | null
    startCwd?: string | null
    metadata?: Record<string, unknown> | null
  }
  project?: {
    id?: number
    slug?: string
  }
  agent?: {
    name?: string | null
    description?: string | null
    type?: string | null
  }
}

export interface EventEnvelope {
  agentClass: string
  sessionId: string
  agentId: string
  hookName: string
  cwd?: string | null
  timestamp?: number
  payload: Record<string, unknown>
  _meta?: EventEnvelopeCreationHints
  flags?: EventEnvelopeFlags
}
```

Drop the old `EventEnvelopeMeta` shape entirely.

- [ ] **Step 2: Run tsc.** `npx tsc --noEmit -p app/server`. Many errors expected — they'll be fixed by route rewrites.

### Task 3.2: Rewrite `parser.ts` to validation + identity extraction only

- [ ] **Step 1: Replace `parseRawEvent`** with `validateEnvelope`:

```ts
import type { EventEnvelope } from './types'

export interface ValidatedEnvelope {
  envelope: EventEnvelope
  timestamp: number
}

export function validateEnvelope(raw: unknown): ValidatedEnvelope {
  if (!raw || typeof raw !== 'object') {
    throw new EnvelopeValidationError('envelope must be an object', [])
  }
  const e = raw as Partial<EventEnvelope>
  const missing: string[] = []
  if (!e.agentClass) missing.push('agentClass')
  if (!e.sessionId) missing.push('sessionId')
  if (!e.agentId) missing.push('agentId')
  if (!e.hookName) missing.push('hookName')
  if (e.payload === undefined || e.payload === null) missing.push('payload')
  if (missing.length > 0) {
    throw new EnvelopeValidationError(
      `envelope missing required fields: ${missing.join(', ')}`,
      missing,
    )
  }
  const timestamp = typeof e.timestamp === 'number' ? clampTimestamp(e.timestamp) : Date.now()
  return { envelope: e as EventEnvelope, timestamp }
}

export class EnvelopeValidationError extends Error {
  missingFields: string[]
  constructor(message: string, missingFields: string[]) {
    super(message)
    this.missingFields = missingFields
  }
}
```

- [ ] **Step 2: Keep `clampTimestamp`** (formerly `parseTimestamp`) — guards against bogus future timestamps. Same logic, narrower scope.

- [ ] **Step 3: Delete every other code path** in parser.ts (transcript-format parsing, subagent extraction, type/subtype derivation). The file shrinks to maybe 60 lines.

- [ ] **Step 4: Update parser.test.ts** — delete the transcript-format and subagent-extraction tests. Add envelope validation tests:

```ts
describe('validateEnvelope', () => {
  it('rejects missing fields with structured error', () => {
    const err = catchError(() => validateEnvelope({}))
    expect(err).toBeInstanceOf(EnvelopeValidationError)
    expect((err as EnvelopeValidationError).missingFields).toEqual([
      'agentClass', 'sessionId', 'agentId', 'hookName', 'payload',
    ])
  })

  it('accepts a minimally valid envelope', () => {
    const result = validateEnvelope({
      agentClass: 'claude-code',
      sessionId: 's1',
      agentId: 'a1',
      hookName: 'PreToolUse',
      payload: {},
    })
    expect(result.envelope.sessionId).toBe('s1')
    expect(result.timestamp).toBeGreaterThan(0)
  })

  it('clamps absurd future timestamps to now', () => {
    const result = validateEnvelope({
      agentClass: 'x', sessionId: 's', agentId: 'a', hookName: 'h',
      payload: {}, timestamp: Number.MAX_SAFE_INTEGER,
    })
    expect(result.timestamp).toBeLessThan(Date.now() + 1000)
  })
})
```

- [ ] **Step 5: Commit.**

### Task 3.3: Rewrite `project-resolver.ts` per spec algorithm

- [ ] **Step 1: Add adapter methods needed by the new resolver:**

```ts
// EventStore interface
findSiblingSessionWithProject(input: {
  startCwd: string | null
  transcriptBasedir: string | null
  excludeSessionId: string
}): Promise<{ projectId: number } | null>

findOrCreateProjectBySlug(slug: string, name?: string): Promise<{
  id: number
  slug: string
  created: boolean
}>
```

In sqlite-adapter.ts:

```ts
async findSiblingSessionWithProject({ startCwd, transcriptBasedir, excludeSessionId }) {
  const row = this.db.prepare(`
    SELECT project_id FROM sessions
    WHERE id != ? AND project_id IS NOT NULL
      AND (
        (start_cwd = ? AND ? IS NOT NULL) OR
        (substr(transcript_path, 1, length(?) ) = ? AND ? IS NOT NULL)
      )
    ORDER BY last_activity DESC LIMIT 1
  `).get(excludeSessionId, startCwd, startCwd, transcriptBasedir, transcriptBasedir, transcriptBasedir) as { project_id: number } | undefined
  return row ? { projectId: row.project_id } : null
}

async findOrCreateProjectBySlug(slug, name) {
  const now = Date.now()
  this.db.prepare(`
    INSERT INTO projects (slug, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(slug) DO NOTHING
  `).run(slug, name ?? slug, now, now)
  const row = this.db.prepare('SELECT id, slug FROM projects WHERE slug = ?').get(slug) as
    | { id: number; slug: string }
    | undefined
  if (!row) {
    // Race: SQLite serializes writes; this should be unreachable.
    // Retry once.
    const retry = this.db.prepare('SELECT id, slug FROM projects WHERE slug = ?').get(slug) as
      | { id: number; slug: string }
      | undefined
    if (!retry) throw new Error(`findOrCreateProjectBySlug: slug ${slug} disappeared`)
    return { ...retry, created: false }
  }
  return { ...row, created: false } // not strictly accurate; close enough — caller doesn't read .created in new flow
}
```

- [ ] **Step 2: Replace `resolveProject`** per spec:

```ts
import { basename, dirname } from 'path'
import { deriveSlugFromPath } from '../utils/slug'

export interface ResolveProjectInput {
  sessionId: string
  meta: EventEnvelopeCreationHints['project']
  flags: EventEnvelopeFlags
  startCwd: string | null
  transcriptPath: string | null
  // The current session's project_id, NULL if not yet assigned
  currentProjectId: number | null
}

export async function resolveProject(
  store: EventStore,
  input: ResolveProjectInput,
): Promise<number | null> {
  if (input.currentProjectId !== null) return input.currentProjectId

  // Explicit project.id wins
  if (input.meta?.id !== undefined) {
    const exists = await store.getProjectById(input.meta.id)
    if (exists) return exists.id
    // fall through if id is invalid
  }

  // Explicit project.slug
  if (input.meta?.slug) {
    const result = await store.findOrCreateProjectBySlug(input.meta.slug)
    return result.id
  }

  // Sibling matching only when explicitly requested
  if (input.flags?.resolveProject) {
    const transcriptBasedir = input.transcriptPath ? dirname(input.transcriptPath) : null
    const sibling = await store.findSiblingSessionWithProject({
      startCwd: input.startCwd,
      transcriptBasedir,
      excludeSessionId: input.sessionId,
    })
    if (sibling) return sibling.projectId

    // Create a new project from whichever signal we have
    const slugSource = input.startCwd ?? transcriptBasedir
    if (slugSource) {
      const slug = deriveSlugFromPath(slugSource)
      const result = await store.findOrCreateProjectBySlug(slug)
      return result.id
    }
  }

  return null  // session stays unassigned
}

function deriveSlugFromPath(p: string): string {
  // Pure: take the basename, lowercase, replace non-alnum with hyphens.
  const base = basename(p) || 'unnamed'
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unnamed'
}
```

- [ ] **Step 3: Drop `extractProjectDir`, `deriveSlugCandidates`, `deriveSlugCandidatesFromCwd`, `pickAvailableSlug`, `normalizeCwd`** from `utils/slug.ts`. Replace with the simple `deriveSlugFromPath` helper. Keep `slug.test.ts` parts that test the helper, delete the rest.

- [ ] **Step 4: Update tests.** `services/project-resolver.test.ts` rewrites against the new behavior:

```ts
describe('resolveProject', () => {
  it('returns existing project id when session already assigned', async () => { /* ... */ })
  it('respects explicit meta.project.id', async () => { /* ... */ })
  it('explicit meta.project.slug — creates if missing', async () => { /* ... */ })
  it('explicit meta.project.slug — finds existing', async () => { /* ... */ })
  it('flags.resolveProject — sibling match by start_cwd', async () => { /* ... */ })
  it('flags.resolveProject — sibling match by transcript basedir', async () => { /* ... */ })
  it('flags.resolveProject — most recent sibling wins', async () => { /* ... */ })
  it('flags.resolveProject — no siblings → creates new project from cwd basename', async () => { /* ... */ })
  it('flags.resolveProject — no signal → returns null', async () => { /* ... */ })
  it('no flag and no slug → returns null', async () => { /* ... */ })
  it('UNIQUE collision on slug recovers via re-select', async () => { /* ... */ })
})
```

- [ ] **Step 5: Commit.**

### Task 3.4: Rewrite `routes/events.ts` per spec

- [ ] **Step 1: New event ingest flow:**

```ts
router.post('/events', async (c) => {
  const store = c.get('store')
  const broadcastToSession = c.get('broadcastToSession')
  const broadcastToAll = c.get('broadcastToAll')
  const broadcastActivity = c.get('broadcastActivity')

  const raw = await c.req.json()
  let env: EventEnvelope, timestamp: number
  try {
    const result = validateEnvelope(raw)
    env = result.envelope
    timestamp = result.timestamp
  } catch (err) {
    if (err instanceof EnvelopeValidationError) {
      return c.json({ error: { message: err.message, missingFields: err.missingFields } }, 400)
    }
    throw err
  }

  // Step 2: upsert session row
  await store.upsertSession({
    id: env.sessionId,
    timestamp,
    creationHints: env._meta?.session,
  })

  // Step 3: resolve project if not yet assigned
  const session = await store.getSessionById(env.sessionId)
  const projectId = await resolveProject(store, {
    sessionId: env.sessionId,
    meta: env._meta?.project,
    flags: env.flags ?? {},
    startCwd: session?.start_cwd ?? null,
    transcriptPath: session?.transcript_path ?? null,
    currentProjectId: session?.project_id ?? null,
  })
  if (projectId !== null && projectId !== session?.project_id) {
    await store.updateSessionProject(env.sessionId, projectId)
  }

  // Step 4: upsert agent row
  await store.upsertAgent({
    id: env.agentId,
    agentClass: env.agentClass,
    creationHints: env._meta?.agent,
  })

  // Step 5: insert event
  const eventId = await store.insertEvent({
    sessionId: env.sessionId,
    agentId: env.agentId,
    hookName: env.hookName,
    timestamp,
    payload: env.payload,
    cwd: env.cwd ?? null,
    _meta: env._meta ?? null,
  })

  // Step 6: apply flags in spec order
  const flags = env.flags ?? {}
  if (flags.clearsNotification) await store.clearSessionNotification(env.sessionId)
  if (flags.startsNotification) await store.startSessionNotification(env.sessionId, timestamp)
  if (flags.stopsSession) await store.stopSession(env.sessionId, timestamp)

  // Step 7: broadcast
  broadcastToSession(env.sessionId, {
    type: 'event',
    data: {
      id: eventId,
      timestamp,
      agent_id: env.agentId,
      hook_name: env.hookName,
      payload: env.payload,
    },
  })
  broadcastActivity(env.sessionId, eventId)

  return c.json({ id: eventId })
})
```

- [ ] **Step 2: Update adapter signatures** to match the new shapes (`upsertSession({id, timestamp, creationHints})`, `upsertAgent({id, agentClass, creationHints})`, `insertEvent({…})`, `clearSessionNotification`, `startSessionNotification`, `stopSession`).

- [ ] **Step 3: Delete the old subagent pairing maps** (`pendingAgentMeta`, `pendingAgentMetaQueue`, `pendingAgentTypes`).

- [ ] **Step 4: Delete `deriveEventStatus` everywhere** (events.ts, sessions.ts, agents.ts).

- [ ] **Step 5: Update GET /sessions/:id/events** — return full event including `cwd`, `_meta`, `created_at`. Drop `type`/`subtype`/`tool_name`/`status` from response.

- [ ] **Step 6: Run tests.** Update events.test.ts heavily.

- [ ] **Step 7: Commit.**

### Task 3.5: Bring back `PATCH /api/agents/:id`

- [ ] **Step 1: Add to routes/agents.ts:**

```ts
router.patch('/agents/:id', async (c) => {
  const store = c.get('store')
  const id = c.req.param('id')
  const body = await c.req.json() as Record<string, unknown>

  const allowed = ['name', 'description', 'agent_type'] as const
  const patch: Record<string, string | null> = {}
  for (const key of allowed) {
    if (key in body) {
      const v = body[key]
      patch[key] = v == null ? null : String(v)
    }
  }
  // Silently ignore non-allowed keys

  const updated = await store.patchAgent(id, patch)
  if (!updated) return c.json({ error: 'agent not found' }, 404)
  return c.json(updated)
})
```

- [ ] **Step 2: Add `patchAgent` to adapter.**

- [ ] **Step 3: Test cases:**
  - Patches name only
  - Patches multiple fields atomically
  - Silently ignores `id` and `agent_class` in body
  - Silently ignores unrecognized fields
  - 404 on missing agent

- [ ] **Step 4: Commit.**

### Task 3.6: Keep + tighten callback infrastructure

The callbacks mechanism (server response includes a `requests` array; CLI dispatches to named hook-lib functions; results POST back to a callback endpoint) stays. It's the bridge that lets Layer 2 stay agent-class-agnostic while still getting agent-class-specific metadata when it's needed (e.g. slug from a Claude transcript). Spec section "Server-initiated callbacks" is the contract.

This task verifies the callback flow still works after the events.ts rewrite in 3.4 and tightens the response shape if needed.

- [ ] **Step 1:** Confirm `app/server/src/routes/callbacks.ts` and the `POST /api/callbacks/session-info/:sessionId` handler still exist and aren't broken by the parser/route rewrites.

- [ ] **Step 2:** In the rewritten events.ts (Task 3.4), after the upsert+resolve+insert flow, build the `requests` array. Trigger condition: session row was just created (or has been around but still has `slug IS NULL`) AND the envelope provided `_meta.session.transcriptPath`. The request entry:

```ts
const requests: Array<{ name: string; callback: string; args: Record<string, unknown> }> = []
if (session && !session.slug && env._meta?.session?.transcriptPath) {
  requests.push({
    name: 'getSessionInfo',
    callback: `/api/callbacks/session-info/${env.sessionId}`,
    args: {
      transcriptPath: env._meta.session.transcriptPath,
      agentClass: env.agentClass,
    },
  })
}
return c.json({ id: eventId, ...(requests.length > 0 ? { requests } : {}) })
```

- [ ] **Step 3:** Confirm the existing CLI dispatcher in `hooks/scripts/observe_cli.mjs` reads the `requests` array, looks up `lib[name]`, calls it, and POSTs to `callback`. No changes needed unless rewrites broke it.

- [ ] **Step 4:** Confirm `app/server/src/routes/callbacks.ts` accepts `{ slug, gitBranch }` and patches the session row. The handler stays narrow — it's the storage-write side of the named callback.

- [ ] **Step 5:** Run tests. `callbacks.test.ts` should still pass. `events.test.ts` gains a case asserting the `requests` array fires only when expected.

- [ ] **Step 6:** Commit.

---

## Phase 4: Hook libs — rename + envelope normalization

Move all payload-shape knowledge into hook libs. Server is now agent-class-agnostic.

**Files:**
- `hooks/scripts/lib/agents/unknown.mjs` → `hooks/scripts/lib/agents/default.mjs`
- `hooks/scripts/lib/agents/claude-code.mjs`
- `hooks/scripts/lib/agents/codex.mjs`
- `hooks/scripts/lib/hooks.mjs` (dispatcher)
- `hooks/scripts/observe_cli.mjs` (registration map)

### Task 4.1: Rename `unknown.mjs` → `default.mjs`

- [ ] **Step 1: `git mv hooks/scripts/lib/agents/unknown.mjs hooks/scripts/lib/agents/default.mjs`.**

- [ ] **Step 2: Update `observe_cli.mjs`** registration map:

```js
import * as defaultLib from './lib/agents/default.mjs'
import * as claudeCode from './lib/agents/claude-code.mjs'
import * as codex from './lib/agents/codex.mjs'

const AGENT_LIBS = {
  'claude-code': claudeCode,
  'codex': codex,
  'default': defaultLib,
}

function libForClass(agentClass) {
  return AGENT_LIBS[agentClass] ?? AGENT_LIBS.default
}
```

- [ ] **Step 3: Run hook tests.** `cd test && npx vitest run`.

- [ ] **Step 4: Commit.**

### Task 4.2: Rewrite `default.mjs` as the canonical hook lib

- [ ] **Step 1: Replace `default.mjs` content:**

```js
// Default hook lib. Other agent classes compose this and override as
// needed. Assumes the standard hook-event payload shape:
//   - payload.session_id     (required for the envelope's sessionId)
//   - payload.agent_id       (optional; defaults to sessionId)
//   - payload.hook_event_name (required for the envelope's hookName)
//   - payload.cwd            (optional, per-event)
//   - payload.transcript_path (optional, lifted to _meta.session)
//   - payload.timestamp      (optional, falls back to ingest time)

const NOTIFICATION_HOOKS_DEFAULT = ['Notification']

function notificationHooks(config) {
  if (config?.notificationOnEvents !== undefined) return config.notificationOnEvents
  return NOTIFICATION_HOOKS_DEFAULT
}

export function buildEnv(config) {
  const env = {}
  if (config?.projectSlug) env.AGENTS_OBSERVE_PROJECT_SLUG = config.projectSlug
  return env
}

export function isNotificationEvent(config, hookName) {
  return notificationHooks(config).includes(hookName)
}

/**
 * Build the envelope for a hook payload. Normalizes identity fields
 * out of the payload into the envelope; never mutates the payload.
 */
export function buildHookEvent(config, _log, payload) {
  const sessionId = payload?.session_id || payload?.sessionId
  const agentId = payload?.agent_id || payload?.agentId || sessionId
  const hookName = payload?.hook_event_name || payload?.hookName
  const cwd = payload?.cwd ?? null
  const transcriptPath = payload?.transcript_path ?? null
  const timestamp = typeof payload?.timestamp === 'number' ? payload.timestamp : undefined

  const flags = {}
  if (hookName && isNotificationEvent(config, hookName)) flags.startsNotification = true
  // Default lib is conservative: it never sets clearsNotification, stopsSession,
  // or resolveProject. Per-class libs decide.

  const _meta = {}
  if (transcriptPath) {
    _meta.session = { transcriptPath }
  }
  if (cwd) {
    _meta.session = _meta.session || {}
    _meta.session.startCwd = cwd  // server uses only on first event
  }
  // env vars (slug override) live on _meta.project for hook libs that opt in:
  if (config?.projectSlug) {
    _meta.project = { slug: config.projectSlug }
  }

  return {
    envelope: {
      agentClass: 'default',
      sessionId,
      agentId,
      hookName,
      cwd,
      ...(timestamp !== undefined ? { timestamp } : {}),
      payload,
      ...(Object.keys(_meta).length > 0 ? { _meta } : {}),
      ...(Object.keys(flags).length > 0 ? { flags } : {}),
    },
    hookEvent: hookName,
    toolName: payload?.tool_name || '',
  }
}

// Re-export for composing libs.
export const defaultLib = { buildHookEvent, buildEnv, isNotificationEvent }
```

- [ ] **Step 2: Add tests** in `test/hooks/scripts/lib/agents/default.test.mjs`:

```js
describe('default.buildHookEvent', () => {
  it('extracts identity fields from a standard hook payload', () => { /* ... */ })
  it('defaults agentId to sessionId when payload has no agent_id', () => { /* ... */ })
  it('lifts transcript_path and cwd to _meta.session', () => { /* ... */ })
  it('sets flags.startsNotification on Notification hook by default', () => { /* ... */ })
  it('honors AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS override', () => { /* ... */ })
  it('does not mutate the input payload', () => { /* ... */ })
  it('omits _meta and flags from envelope when empty', () => { /* ... */ })
})
```

- [ ] **Step 3: Commit.**

### Task 4.3: Rewrite `claude-code.mjs` as a thin override layer

- [ ] **Step 1: Replace claude-code.mjs:**

```js
import { defaultLib } from './default.mjs'
import { readFileSync } from 'fs'

// Hooks that should explicitly clear pending notifications (Claude-Code-specific naming):
const CLEARS_NOTIFICATION = new Set(['UserPromptSubmit'])
const STOPS_SESSION = new Set(['SessionEnd'])

export function buildEnv(config) { return defaultLib.buildEnv(config) }

export function buildHookEvent(config, log, payload) {
  const result = defaultLib.buildHookEvent(config, log, payload)
  result.envelope.agentClass = 'claude-code'

  const flags = result.envelope.flags ?? {}
  const hookName = result.envelope.hookName
  if (CLEARS_NOTIFICATION.has(hookName)) flags.clearsNotification = true
  if (STOPS_SESSION.has(hookName)) flags.stopsSession = true
  // SessionStart re-resolves project lazily (cwd may newly be available):
  if (hookName === 'SessionStart') flags.resolveProject = true

  if (Object.keys(flags).length > 0) result.envelope.flags = flags
  return result
}

// getSessionInfo unchanged — still used by the hook lib for prefetch
export function getSessionInfo(args, ctx) { /* existing transcript-scan logic stays */ }
```

(Existing `getSessionInfo` body is preserved.)

- [ ] **Step 2: Drop `deriveTypeSubtype` from claude-code.mjs entirely.**

- [ ] **Step 3: Update tests** for the new flag-setting behavior.

- [ ] **Step 4: Commit.**

### Task 4.4: Rewrite `codex.mjs` similarly

```js
import { defaultLib } from './default.mjs'

export function buildEnv(config) { return defaultLib.buildEnv(config) }

export function buildHookEvent(config, log, payload) {
  const result = defaultLib.buildHookEvent(config, log, payload)
  result.envelope.agentClass = 'codex'
  // Codex hook payloads: identity fields are the same shape as Claude
  // (session_id, agent_id, hook_event_name, cwd, transcript_path), so the
  // default lib's extraction works without overrides. Notification opt-in
  // is via AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS env var (handled by
  // default lib).
  //
  // Codex does NOT have Claude's UserPromptSubmit/SessionEnd hooks. If
  // future versions add equivalent semantic events, set
  // flags.clearsNotification / flags.stopsSession here.
  return result
}

export function getSessionInfo(args, ctx) { /* existing transcript-scan logic stays */ }
```

- [ ] **Step 1: Rewrite per the pattern above.**
- [ ] **Step 2: Drop `deriveTypeSubtype` if present (Codex currently leaves it null — easy delete).**
- [ ] **Step 3: Tests + commit.**

### Task 4.5: Verify the callback flow still functions

Per the revised spec, hook libs do NOT prefetch into the envelope on every event. Instead, each lib continues to expose `getSessionInfo` as a callback handler, and the CLI dispatches it only when the server's response carries a matching `requests` entry. This task is a verification pass — no new code unless the route rewrites broke the existing dispatch path.

- [ ] **Step 1:** Confirm each agent lib (default, claude-code, codex) still exports a `getSessionInfo(args, ctx)` function with the `{ slug, git: { branch } }` return contract. (Default lib's version can be a no-op stub returning `null`.)

- [ ] **Step 2:** Confirm `hooks/scripts/observe_cli.mjs` still dispatches the `requests` array from the events response: looks up each `request.name` on the lib, calls it with `request.args`, and POSTs the result to `request.callback`.

- [ ] **Step 3:** Add a test fixture covering the round-trip: POST event with `_meta.session.transcriptPath`, observe `requests` in response, dispatch `getSessionInfo`, POST callback, verify session row's slug populated.

- [ ] **Step 4:** Commit.

---

## Phase 5: Client core types + processing

Update the client's data model and event-processing runtime to derive everything from `hook_name` + `payload` per agent class.

**Files:**
- `app/client/src/types/index.ts` (ParsedEvent, WSMessage, etc.)
- `app/client/src/agents/types.ts` (AgentClassRegistration interface additions)
- `app/client/src/agents/event-processing-context.tsx`
- `app/client/src/agents/event-store.ts`
- `app/client/src/agents/claude-code/process-event.ts` (significant rewrite)
- `app/client/src/agents/claude-code/runtime.ts`

### Task 5.1: Trim `ParsedEvent` and add `cwd` / `_meta`

- [ ] **Step 1: Update `ParsedEvent`** in `types/index.ts`:

```ts
export interface ParsedEvent {
  id: number
  agentId: string
  sessionId: string
  hookName: string
  timestamp: number
  createdAt: number
  payload: Record<string, unknown>
  cwd?: string | null
  _meta?: Record<string, unknown> | null
  // Removed: type, subtype, toolName, status
}
```

(`hookName` becomes required since the server now requires and returns it for every event.)

- [ ] **Step 2: Update `WSMessage`** event variant:

```ts
| { type: 'event'; data: {
    id: number
    timestamp: number
    agent_id: string
    hook_name: string
    payload: Record<string, unknown>
  } }
```

- [ ] **Step 3: Update `Session`, `RecentSession`** to drop `event_count`, `agent_count`, `status` — `status` derived client-side via `stoppedAt ? 'ended' : 'active'`.

- [ ] **Step 4: tsc.** Errors propagate everywhere. Don't fix yet — let Phase 5 + 6 handle.

### Task 5.2: Extend `AgentClassRegistration` for derivation

The client needs per-class hooks to derive what was previously server-side. Add to `agents/types.ts`:

```ts
export interface AgentClassRegistration {
  agentClass: string
  displayName: string
  Icon: ComponentType<{ className?: string }>

  processEvent(raw: RawEvent, ctx: ProcessingContext): ProcessEventResult

  // New per-class derivation hooks:
  /** Map a hookName + payload to a display "subtype" used by row summaries
   *  and filter pills. Returns null if the event has no canonical subtype. */
  deriveSubtype(event: ParsedEvent): string | null

  /** Map a hookName + payload to a tool name (for tool-related events). */
  deriveToolName(event: ParsedEvent): string | null

  /** Compute display status: 'running' | 'completed' | 'failed' | 'pending' | null. */
  deriveStatus(event: ParsedEvent, groupedEvents: ParsedEvent[]): EventStatus | null

  // Existing render-time hooks:
  getEventIcon(event: EnrichedEvent): ComponentType<{ className?: string }>
  getEventColor(event: EnrichedEvent): EventColor
  RowSummary: ComponentType<EventProps>
  EventDetail: ComponentType<EventProps>
  DotTooltip: ComponentType<{ event: EnrichedEvent }>
}
```

- [ ] **Step 1: Add the new fields to the type.**

- [ ] **Step 2: Update `EnrichedEvent`** to keep `type` / `subtype` / `toolName` / `status` as derived fields populated by the runtime, NOT as wire fields. Mark with a comment.

- [ ] **Step 3: tsc errors** will surface in claude-code/process-event.ts and codex/process-event.ts — Phase 6 fixes those.

### Task 5.3: Rewrite client event processing to use derived fields

- [ ] **Step 1: In `process-event.ts` for each agent class, replace `parsed.subtype` / `parsed.type` / `parsed.toolName` reads** with calls to `registration.deriveSubtype(event)` etc.

- [ ] **Step 2: Move subagent-pairing logic from server (in events.ts) to claude-code/process-event.ts.** The Pre/PostToolUse Agent pairing that was in the server now runs in the client when processing events:

```ts
// Inside claude-code/process-event.ts
if (subtype === 'PreToolUse' && toolName === 'Agent') {
  const toolUseId = (raw.payload?.tool_use_id as string) ?? null
  if (toolUseId) {
    ctx.setPendingGroup(`agent-spawn:${toolUseId}`, raw.id)
    const inputName = (raw.payload?.tool_input?.name as string) ?? null
    const inputDesc = (raw.payload?.tool_input?.description as string) ?? null
    if (inputName || inputDesc) {
      ctx.stashPendingAgentMeta(toolUseId, { name: inputName, description: inputDesc })
    }
  }
}
if (subtype === 'PostToolUse' && toolName === 'Agent') {
  const toolUseId = (raw.payload?.tool_use_id as string) ?? null
  const spawnedAgentId = (raw.payload?.tool_response?.agentId as string) ?? null
  if (toolUseId && spawnedAgentId) {
    const meta = ctx.consumePendingAgentMeta(toolUseId)
    // PATCH the spawned agent record with the discovered name/description:
    if (meta?.name || meta?.description) {
      api.patchAgent(spawnedAgentId, { name: meta.name, description: meta.description }).catch(() => {})
    }
  }
}
```

- [ ] **Step 3: Add `stashPendingAgentMeta` / `consumePendingAgentMeta` to ProcessingContext.** Backed by a Map that lives for the lifetime of the session-events processing pass.

- [ ] **Step 4: Add `api.patchAgent`** to api-client.ts: `PATCH /api/agents/:id`.

- [ ] **Step 5: Run client tests.** Heavy churn expected; fix as we go.

- [ ] **Step 6: Commit.**

---

## Phase 6: Client per-agent-class refactor (Claude Code + Codex)

Wire the new `deriveSubtype` / `deriveToolName` / `deriveStatus` hooks; update all consumers in display code.

**Files:**
- `app/client/src/agents/claude-code/*`
- `app/client/src/agents/codex/*`
- `app/client/src/agents/unknown/*`
- `app/client/src/components/event-stream/*`
- `app/client/src/components/timeline/*`
- `app/client/src/agents/claude-code/event-detail.tsx`
- `app/client/src/agents/claude-code/row-summary.tsx`
- `app/client/src/agents/claude-code/helpers.ts`

### Task 6.1: Claude Code derivers

- [ ] **Step 1:** In `agents/claude-code/index.ts` (or wherever the registration lives), add:

```ts
deriveSubtype: (event) => {
  const hookName = event.hookName
  // Most Claude Code hooks are 1:1 with subtype:
  return hookName ?? null
},

deriveToolName: (event) => {
  const p = event.payload as Record<string, unknown>
  return (p?.tool_name as string) ?? null
},

deriveStatus: (event, grouped) => {
  if (event.hookName === 'PreToolUse') {
    const post = grouped.find(
      (e) => e.hookName === 'PostToolUse' || e.hookName === 'PostToolUseFailure'
    )
    if (!post) return 'running'
    return post.hookName === 'PostToolUseFailure' ? 'failed' : 'completed'
  }
  return null
},
```

- [ ] **Step 2: Update every site that reads `event.subtype` / `event.type` / `event.toolName` / `event.status`** to read from `EnrichedEvent` instead, where the runtime has populated derived fields.

Files to grep:
- `agents/claude-code/event-detail.tsx`
- `agents/claude-code/row-summary.tsx`
- `agents/claude-code/helpers.ts`
- `agents/claude-code/icons.ts`
- `agents/claude-code/dot-tooltip.tsx`
- `agents/claude-code/runtime.ts`
- `components/event-stream/event-row.tsx`
- `components/event-stream/event-stream.tsx`
- `components/timeline/agent-lane.tsx`
- `components/timeline/activity-timeline.tsx`
- Any test files

- [ ] **Step 3: Update event-row to read from EnrichedEvent's derived fields:**

```tsx
// Before:
{event.toolName && <span>{event.toolName}</span>}
// After (event is EnrichedEvent post-processing):
{event.toolName && <span>{event.toolName}</span>}  // unchanged — runtime populates
```

The shape is the same after processing; only the WIRE is different. As long as the runtime writes derived fields onto the EnrichedEvent, render code is stable.

- [ ] **Step 4: Run client tests + tsc.**

- [ ] **Step 5: Commit.**

### Task 6.2: Codex derivers

The Codex client registration historically depended on the server's parser to translate transcript-format JSONL events (e.g. `data.type === 'agent_progress'`) into a unified shape. With server parsing gone, that logic moves here.

- [ ] **Step 1:** Port the transcript-format branch of the deleted `parser.ts` into a new helper `app/client/src/agents/codex/parse-transcript.ts`. Function signature: `parseTranscriptEvent(payload): { subtype, toolName, subAgentId? }`.

- [ ] **Step 2:** Codex's `deriveSubtype` calls `parseTranscriptEvent(event.payload).subtype ?? event.hookName`.

- [ ] **Step 3:** `deriveToolName` calls the same helper for `toolName`.

- [ ] **Step 4:** `deriveStatus` mirrors Claude Code's logic — Pre/Post pairing — but using Codex's hook names. Keep the registration's behavior identical to current; only the data source (envelope-derived vs server-derived) changes.

- [ ] **Step 5:** Tests: bring over the existing parser tests for the transcript-format branch into `parse-transcript.test.ts`.

- [ ] **Step 6:** Commit.

### Task 6.3: Default agent class registration

A bare-bones registration for `agentClass` values without an explicit lib.

- [ ] **Step 1:** Create `app/client/src/agents/default/index.ts`:

```ts
export const defaultRegistration: AgentClassRegistration = {
  agentClass: 'default',
  displayName: 'Generic',
  Icon: GenericIcon,
  processEvent: (raw, ctx) => ({ event: { ...raw, groupId: null, turnId: null /* etc */ } }),
  deriveSubtype: (event) => event.hookName,
  deriveToolName: (event) => (event.payload?.tool_name as string) ?? null,
  deriveStatus: () => null,
  getEventIcon: () => GenericIcon,
  getEventColor: () => ({ iconColor: 'text-muted-foreground', dotColor: 'bg-muted-foreground' }),
  RowSummary: ({ event }) => <span>{event.hookName}</span>,
  EventDetail: ({ event }) => <pre>{JSON.stringify(event.payload, null, 2)}</pre>,
  DotTooltip: ({ event }) => <span>{event.hookName}</span>,
}
```

- [ ] **Step 2:** Register in the `AgentRegistry` as the fallback when `get(agentClass)` finds no match.

- [ ] **Step 3:** Tests + commit.

---

## Phase 7: Frontend polish — Unassigned bucket + Layer 3 patches

### Task 7.1: "Unassigned" sidebar bucket for NULL-project sessions

- [ ] **Step 1:** In `components/sidebar/project-list.tsx`, group sessions with `project_id === null` into a synthetic "Unassigned" entry rendered above (or below) the real projects.
- [ ] **Step 2:** Drag-or-edit affordances on the Unassigned section call `PATCH /api/sessions/:id` with a chosen `project_id`.
- [ ] **Step 3:** Tests + commit.

### Task 7.2: Layer 3 → server agent metadata patches

The PATCH /api/agents/:id call from Phase 5 covers the spawn case. Phase 7 adds general-purpose Layer 3 → server sync:

- [ ] **Step 1:** In the per-agent-class processEvent code, when richer metadata becomes available (e.g. agent_type from PostToolUse Agent), call `api.patchAgent(agentId, {...})` with debounced debouncing per agent.
- [ ] **Step 2:** Update `useAgents` hook to consume the patched fields back via WS / polling.

### Task 7.3: Status indicator derivation in UI

- [ ] **Step 1:** Sidebar SessionItem reads `session.stoppedAt` instead of `session.status` to color the status dot.
- [ ] **Step 2:** Update tests.

---

## Phase 8: Cleanup + verification

### Task 8.1: Remove all dead code paths

- [ ] **Step 1:** Grep for `event.type`, `event.subtype`, `event.toolName`, `deriveTypeSubtype`, `getThreadForEvent`, `extractProjectDir`, `parseRawEvent`, `EventEnvelopeMeta` (old name) — confirm zero hits in src/.
- [ ] **Step 2:** Update DEVELOPMENT.md if any architecture references are stale.

### Task 8.2: Full smoke test

- [ ] **Step 1: Reset worktree DB:** `rm -rf data/`
- [ ] **Step 2: Start server:** `just start`
- [ ] **Step 3: Send a fixture event** via curl; verify it lands.
- [ ] **Step 4: Open dashboard:** http://localhost:4982 — should render the event row.
- [ ] **Step 5: Trigger SessionEnd via fixture:** session shows as ended.
- [ ] **Step 6: Trigger a notification flag:** bell appears.
- [ ] **Step 7: Trigger clearsNotification:** bell disappears.

### Task 8.3: `just check` + final commit

- [ ] **Step 1:** `just check` from repo root.
- [ ] **Step 2:** Update CHANGELOG entry sketch (full release happens later).
- [ ] **Step 3:** Final commit.

---

## Phase 9: Spec → implemented

Per the DEVELOPMENT.md convention:

- [ ] **Step 1:** Move `docs/specs/2026-04-25-three-layer-contract-design.md` → `docs/plans/implemented/`.
- [ ] **Step 2:** Move `docs/plans/2026-04-25-three-layer-contract-impl.md` → `docs/plans/implemented/`.
- [ ] **Step 3:** Commit (`docs:` prefix).

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Schema migration loses data on existing rows | Worktree uses fresh DB (`./data/`); main's DB is untouched. |
| Phase 2 leaves project resolver stubbed (broken) | Phase 3 immediately follows; resolver tests skipped between. |
| Client UI breaks between Phase 2 (server schema) and Phase 6 (client refactor) | All work is on `refactor/three-layer-contract` branch; main stays green. |
| `_meta` JSON storage grows DB size | Acceptable; per-event `_meta` is ~200 bytes. Can prune with a debug-only flag later. |
| Subagent reconstruction in Layer 3 misses edge cases | Existing claude-code tests assert this behavior; port them to the new code path. |

## Out of scope for this branch

- Activity-ping protocol changes beyond what's already shipped
- WS subscription protocol redesign
- Multi-user race-condition stress testing
- Performance benchmarking on large sessions

These are tracked separately if they prove necessary post-merge.
