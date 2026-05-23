# Event Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject duplicate `/events` POSTs within a 5-second window so that misconfigured plugin setups (e.g., plugin installed globally AND in repo) don't double-record events. Forward-only — no backfill of existing rows.

**Architecture:** Compute a `signature_hash` per envelope from `(session_id, agent_id, hook_name, cwd, payload, _meta, flags, ts_bucket)` where `ts_bucket = floor(timestamp / 5000)`. Store it as a new TEXT column on `events` with a UNIQUE index. Route handler pre-checks the hash before doing any work; if found, returns the original event id with `deduplicated: true`. UNIQUE constraint at the SQL layer is the race safety net.

**Tech Stack:** TypeScript, Hono, better-sqlite3, vitest. Server lives in `app/server/src/`.

**Spec:** `docs/specs/2026-05-23-event-deduplication-design.md`

---

## File Structure

- **Create** `app/server/src/utils/event-signature.ts` — exports `canonicalJson(value)` and `computeEventSignature(envelope, timestamp)`.
- **Create** `app/server/src/utils/event-signature.test.ts` — unit tests.
- **Modify** `app/server/src/storage/types.ts` — add `signatureHash` to `InsertEventParams`; add `DuplicateEventSignatureError` and `findEventBySignatureHash` to `EventStore`.
- **Modify** `app/server/src/storage/sqlite-adapter.ts` — schema migration (additive column + UNIQUE index), update `insertEvent` to persist hash and surface UNIQUE-violation as a typed error, implement `findEventBySignatureHash`.
- **Modify** `app/server/src/storage/sqlite-adapter.test.ts` — migration + insert tests.
- **Modify** `app/server/src/routes/events.ts` — compute signature, pre-check, race-safe insert, dedup response.
- **Modify** `app/server/src/routes/events.test.ts` — integration tests for dedup behavior.

---

### Task 1: Canonical JSON + signature helper

**Files:**
- Create: `app/server/src/utils/event-signature.ts`
- Test: `app/server/src/utils/event-signature.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// app/server/src/utils/event-signature.test.ts
import { describe, test, expect } from 'vitest'
import { canonicalJson, computeEventSignature } from './event-signature'

describe('canonicalJson', () => {
  test('sorts object keys recursively', () => {
    const a = canonicalJson({ b: 2, a: 1, c: { z: 1, y: 2 } })
    const b = canonicalJson({ a: 1, c: { y: 2, z: 1 }, b: 2 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":1,"b":2,"c":{"y":2,"z":1}}')
  })

  test('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })

  test('handles nested objects inside arrays', () => {
    const a = canonicalJson([{ b: 1, a: 2 }, { d: 3, c: 4 }])
    expect(a).toBe('[{"a":2,"b":1},{"c":4,"d":3}]')
  })

  test('handles null, undefined-as-missing, primitives', () => {
    expect(canonicalJson({ a: null, b: 1, c: 'x', d: true })).toBe(
      '{"a":null,"b":1,"c":"x","d":true}',
    )
  })
})

describe('computeEventSignature', () => {
  const baseEnvelope = {
    agentClass: 'claude-code',
    sessionId: 'sess-1',
    agentId: 'agent-1',
    hookName: 'PreToolUse',
    cwd: '/repo',
    payload: { tool_name: 'Bash', command: 'ls' },
    _meta: { project: { slug: 'demo' } },
    flags: { stopsSession: false },
  }

  test('same envelope + same bucket → same hash', () => {
    const a = computeEventSignature(baseEnvelope, 1_000_000)
    const b = computeEventSignature(baseEnvelope, 1_000_500) // same 5s bucket
    expect(a).toBe(b)
  })

  test('different bucket → different hash', () => {
    const a = computeEventSignature(baseEnvelope, 1_000_000)
    const b = computeEventSignature(baseEnvelope, 1_006_000) // 6s later, next bucket
    expect(a).not.toBe(b)
  })

  test('payload key reordering does not affect hash', () => {
    const a = computeEventSignature(baseEnvelope, 1_000_000)
    const reordered = {
      ...baseEnvelope,
      payload: { command: 'ls', tool_name: 'Bash' },
    }
    const b = computeEventSignature(reordered, 1_000_000)
    expect(a).toBe(b)
  })

  test('changing payload content changes hash', () => {
    const a = computeEventSignature(baseEnvelope, 1_000_000)
    const b = computeEventSignature(
      { ...baseEnvelope, payload: { tool_name: 'Bash', command: 'pwd' } },
      1_000_000,
    )
    expect(a).not.toBe(b)
  })

  test('changing flags changes hash', () => {
    const a = computeEventSignature(baseEnvelope, 1_000_000)
    const b = computeEventSignature(
      { ...baseEnvelope, flags: { stopsSession: true } },
      1_000_000,
    )
    expect(a).not.toBe(b)
  })

  test('missing cwd / _meta / flags normalized', () => {
    const minimal = {
      agentClass: 'claude-code',
      sessionId: 'sess-1',
      agentId: 'agent-1',
      hookName: 'PreToolUse',
      payload: { foo: 1 },
    }
    expect(() => computeEventSignature(minimal, 1_000_000)).not.toThrow()
  })

  test('returns 64-char hex sha256', () => {
    const hash = computeEventSignature(baseEnvelope, 1_000_000)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })
})
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `cd app/server && npx vitest run src/utils/event-signature.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement helper**

```ts
// app/server/src/utils/event-signature.ts
import { createHash } from 'node:crypto'
import type { EventEnvelope } from '../types'

const BUCKET_MS = 5000

/**
 * Serialize a value as JSON with object keys sorted recursively, so two
 * structurally-equivalent objects (different key order) produce the same
 * string. Used as the input to the event signature hash.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key])
    }
    return out
  }
  return value
}

/**
 * Compute a stable signature for an envelope. Identical events that arrive
 * within the same 5-second bucket produce the same hash; events with the
 * same content >5s apart get different hashes (treated as distinct).
 */
export function computeEventSignature(
  envelope: Pick<
    EventEnvelope,
    'sessionId' | 'agentId' | 'hookName' | 'cwd' | 'payload' | '_meta' | 'flags'
  >,
  timestamp: number,
): string {
  const material = {
    session_id: envelope.sessionId,
    agent_id: envelope.agentId,
    hook_name: envelope.hookName,
    cwd: envelope.cwd ?? null,
    payload: envelope.payload,
    _meta: envelope._meta ?? null,
    flags: envelope.flags ?? null,
    ts_bucket: Math.floor(timestamp / BUCKET_MS),
  }
  return createHash('sha256').update(canonicalJson(material)).digest('hex')
}
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `cd app/server && npx vitest run src/utils/event-signature.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add app/server/src/utils/event-signature.ts app/server/src/utils/event-signature.test.ts
git commit -m "feat: add canonical-json + event signature helper"
```

---

### Task 2: Storage layer — schema migration + signature_hash column

**Files:**
- Modify: `app/server/src/storage/types.ts`
- Modify: `app/server/src/storage/sqlite-adapter.ts` (schema bootstrap ~line 273, `insertEvent` ~line 727)
- Test: `app/server/src/storage/sqlite-adapter.test.ts`

- [ ] **Step 1: Write failing migration test**

```ts
// add to app/server/src/storage/sqlite-adapter.test.ts
import Database from 'better-sqlite3'

describe('signature_hash migration', () => {
  test('adds column and unique index to an existing events table without one', () => {
    // Build a legacy DB file shape — events table without signature_hash.
    const path = `${require('os').tmpdir()}/dedup-mig-${Date.now()}.db`
    const raw = new Database(path)
    raw.exec(`
      CREATE TABLE projects (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, created_at INTEGER);
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, project_id INTEGER, slug TEXT, started_at INTEGER, last_activity INTEGER,
        stopped_at INTEGER, pending_notification_ts INTEGER, notification_count INTEGER DEFAULT 0,
        last_notification_at INTEGER, metadata TEXT, transcript_path TEXT, start_cwd TEXT
      );
      CREATE TABLE agents (
        id TEXT PRIMARY KEY, name TEXT, description TEXT, agent_type TEXT, agent_class TEXT, updated_at INTEGER
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL, session_id TEXT NOT NULL, hook_name TEXT NOT NULL,
        timestamp INTEGER NOT NULL, created_at INTEGER NOT NULL,
        cwd TEXT, _meta TEXT, payload TEXT NOT NULL
      );
      INSERT INTO sessions (id) VALUES ('s1');
      INSERT INTO agents (id) VALUES ('a1');
      INSERT INTO events (agent_id, session_id, hook_name, timestamp, created_at, payload)
        VALUES ('a1', 's1', 'PreToolUse', 1000, 1001, '{}');
    `)
    raw.close()

    // Open via adapter — migration should run.
    const store = new SqliteAdapter(path)

    const cols = (store as any).db.prepare("PRAGMA table_info('events')").all()
    expect(cols.some((c: any) => c.name === 'signature_hash')).toBe(true)

    const indexes = (store as any).db
      .prepare("PRAGMA index_list('events')")
      .all()
    expect(
      indexes.some((i: any) => i.name === 'idx_events_signature_hash' && i.unique === 1),
    ).toBe(true)

    // Existing row keeps NULL signature_hash.
    const row = (store as any).db
      .prepare('SELECT signature_hash FROM events WHERE id = 1')
      .get()
    expect(row.signature_hash).toBeNull()

    require('node:fs').unlinkSync(path)
  })

  test('insertEvent stores signature_hash when provided', async () => {
    const store = new SqliteAdapter(':memory:')
    await store.upsertSession('s1', null, null, null, 1000, null, null)
    await store.upsertAgent('a1', 's1', null, null, null, null, 'claude-code')
    const { eventId } = await store.insertEvent({
      agentId: 'a1',
      sessionId: 's1',
      hookName: 'PreToolUse',
      timestamp: 1000,
      payload: {},
      signatureHash: 'abc123',
    })
    const row = (store as any).db
      .prepare('SELECT signature_hash FROM events WHERE id = ?')
      .get(eventId)
    expect(row.signature_hash).toBe('abc123')
  })

  test('insertEvent throws DuplicateEventSignatureError on UNIQUE conflict', async () => {
    const { DuplicateEventSignatureError } = await import('./types')
    const store = new SqliteAdapter(':memory:')
    await store.upsertSession('s1', null, null, null, 1000, null, null)
    await store.upsertAgent('a1', 's1', null, null, null, null, 'claude-code')
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 's1',
      hookName: 'PreToolUse',
      timestamp: 1000,
      payload: {},
      signatureHash: 'dup-hash',
    })
    await expect(
      store.insertEvent({
        agentId: 'a1',
        sessionId: 's1',
        hookName: 'PreToolUse',
        timestamp: 1001,
        payload: {},
        signatureHash: 'dup-hash',
      }),
    ).rejects.toBeInstanceOf(DuplicateEventSignatureError)
  })

  test('findEventBySignatureHash returns existing event id or null', async () => {
    const store = new SqliteAdapter(':memory:')
    await store.upsertSession('s1', null, null, null, 1000, null, null)
    await store.upsertAgent('a1', 's1', null, null, null, null, 'claude-code')
    const { eventId } = await store.insertEvent({
      agentId: 'a1', sessionId: 's1', hookName: 'PreToolUse',
      timestamp: 1000, payload: {}, signatureHash: 'lookup-me',
    })
    expect(await store.findEventBySignatureHash('lookup-me')).toEqual({ id: eventId })
    expect(await store.findEventBySignatureHash('not-here')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `cd app/server && npx vitest run src/storage/sqlite-adapter.test.ts -t "signature_hash"`
Expected: FAIL — column doesn't exist / `DuplicateEventSignatureError` not exported / `findEventBySignatureHash` not a function.

- [ ] **Step 3: Update `storage/types.ts`**

Add the error class and update `InsertEventParams` + `EventStore`:

```ts
// at top of app/server/src/storage/types.ts (after imports)
export class DuplicateEventSignatureError extends Error {
  constructor(public readonly signatureHash: string) {
    super(`Duplicate event signature: ${signatureHash}`)
    this.name = 'DuplicateEventSignatureError'
  }
}
```

```ts
export interface InsertEventParams {
  agentId: string
  sessionId: string
  hookName: string
  timestamp: number
  payload: Record<string, unknown>
  cwd?: string | null
  _meta?: Record<string, unknown> | null
  /** Stable signature for dedup. When set, a UNIQUE constraint is enforced. */
  signatureHash?: string | null
}
```

In `EventStore` interface, add:

```ts
findEventBySignatureHash(hash: string): Promise<{ id: number } | null>
```

- [ ] **Step 4: Add migration to `sqlite-adapter.ts`**

Locate the existing migration block in the events-table bootstrap. After the rebuild migration (the block ending with `PRAGMA foreign_keys=ON;`), re-read `PRAGMA table_info('events')` and add the new column + index:

```ts
// Add to events bootstrap, AFTER the existing rebuild migration block.
// Re-read columns because the rebuild may have just replaced the table.
const postRebuildCols = this.db
  .prepare("PRAGMA table_info('events')")
  .all() as { name: string }[]
if (!postRebuildCols.some((c) => c.name === 'signature_hash')) {
  this.db.exec('ALTER TABLE events ADD COLUMN signature_hash TEXT')
}
this.db.exec(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_events_signature_hash ON events(signature_hash)',
)
```

- [ ] **Step 5: Update `insertEvent`**

Modify the existing `insertEvent` method to (a) include `signature_hash` in the INSERT, and (b) translate SQLite's UNIQUE constraint error into `DuplicateEventSignatureError`:

```ts
import { DuplicateEventSignatureError } from './types'
// (at the top of sqlite-adapter.ts alongside other imports from ./types)

async insertEvent(params: InsertEventParams): Promise<InsertEventResult> {
  const now = Date.now()
  let result
  try {
    result = this.db
      .prepare(
        `INSERT INTO events
          (agent_id, session_id, hook_name, timestamp, created_at, cwd, _meta, payload, signature_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.agentId,
        params.sessionId,
        params.hookName ?? 'unknown',
        params.timestamp,
        now,
        params.cwd ?? null,
        params._meta != null ? JSON.stringify(params._meta) : null,
        JSON.stringify(params.payload),
        params.signatureHash ?? null,
      )
  } catch (err: any) {
    if (
      params.signatureHash &&
      err?.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
      String(err?.message ?? '').includes('events.signature_hash')
    ) {
      throw new DuplicateEventSignatureError(params.signatureHash)
    }
    throw err
  }

  this.db
    .prepare(
      `UPDATE sessions SET
        last_activity = MAX(COALESCE(last_activity, 0), ?)
      WHERE id = ?`,
    )
    .run(params.timestamp, params.sessionId)

  return { eventId: Number(result.lastInsertRowid) }
}
```

- [ ] **Step 6: Implement `findEventBySignatureHash`**

Add to `SqliteAdapter` (near `insertEvent`):

```ts
async findEventBySignatureHash(hash: string): Promise<{ id: number } | null> {
  const row = this.db
    .prepare('SELECT id FROM events WHERE signature_hash = ? LIMIT 1')
    .get(hash) as { id: number } | undefined
  return row ? { id: Number(row.id) } : null
}
```

- [ ] **Step 7: Run storage tests, confirm they pass**

Run: `cd app/server && npx vitest run src/storage/sqlite-adapter.test.ts`
Expected: PASS — all new tests green; existing tests unaffected.

- [ ] **Step 8: Commit**

```bash
git add app/server/src/storage/types.ts app/server/src/storage/sqlite-adapter.ts app/server/src/storage/sqlite-adapter.test.ts
git commit -m "feat: add signature_hash column with UNIQUE index for event dedup"
```

---

### Task 3: Route handler — dedup pre-check + race-safe insert

**Files:**
- Modify: `app/server/src/routes/events.ts`
- Test: `app/server/src/routes/events.test.ts`

- [ ] **Step 1: Write failing integration tests**

Append to `app/server/src/routes/events.test.ts`:

```ts
describe('POST /api/events — dedup', () => {
  const baseEnv = {
    agentClass: 'claude-code',
    sessionId: 'sess-dedup',
    agentId: 'sess-dedup',
    hookName: 'PreToolUse',
    timestamp: 2_000_000,
    payload: { tool_name: 'Bash', command: 'ls' },
    cwd: '/repo',
    _meta: { project: { slug: 'x' } },
  }

  test('same envelope twice returns same id + deduplicated:true', async () => {
    const a = await postEvent(baseEnv)
    expect(a.status).toBe(201)
    const aBody = (await a.json()) as { id: number; deduplicated?: boolean }
    expect(aBody.deduplicated).toBeUndefined()

    const b = await postEvent({ ...baseEnv, timestamp: baseEnv.timestamp + 50 })
    expect(b.status).toBe(201)
    const bBody = (await b.json()) as { id: number; deduplicated?: boolean }
    expect(bBody.deduplicated).toBe(true)
    expect(bBody.id).toBe(aBody.id)

    const events = await store.getEventsForSession('sess-dedup')
    expect(events).toHaveLength(1)
  })

  test('payload key reordering still dedupes', async () => {
    const a = await postEvent(baseEnv)
    const aBody = (await a.json()) as { id: number }
    const b = await postEvent({
      ...baseEnv,
      timestamp: baseEnv.timestamp + 50,
      payload: { command: 'ls', tool_name: 'Bash' },
    })
    const bBody = (await b.json()) as { id: number; deduplicated?: boolean }
    expect(bBody.deduplicated).toBe(true)
    expect(bBody.id).toBe(aBody.id)
  })

  test('identical content >5s apart inserts both', async () => {
    const a = await postEvent(baseEnv)
    const aBody = (await a.json()) as { id: number }
    const b = await postEvent({ ...baseEnv, timestamp: baseEnv.timestamp + 6000 })
    expect(b.status).toBe(201)
    const bBody = (await b.json()) as { id: number; deduplicated?: boolean }
    expect(bBody.deduplicated).toBeUndefined()
    expect(bBody.id).not.toBe(aBody.id)
  })

  test('dedup hit does NOT re-broadcast', async () => {
    await postEvent(baseEnv)
    sessionBroadcasts.length = 0
    activityPings.length = 0
    allBroadcasts.length = 0
    await postEvent({ ...baseEnv, timestamp: baseEnv.timestamp + 50 })
    expect(sessionBroadcasts).toHaveLength(0)
    expect(activityPings).toHaveLength(0)
    expect(allBroadcasts).toHaveLength(0)
  })

  test('dedup hit does NOT re-apply stopsSession flag', async () => {
    const env = { ...baseEnv, flags: { stopsSession: true } }
    await postEvent(env)
    const sessionAfterFirst = await store.getSessionById('sess-dedup')
    const firstStoppedAt = sessionAfterFirst.stopped_at

    // Modify session row to detect a second stop call.
    ;(store as any).db
      .prepare('UPDATE sessions SET stopped_at = NULL WHERE id = ?')
      .run('sess-dedup')

    await postEvent({ ...env, timestamp: env.timestamp + 50 })
    const sessionAfterDup = await store.getSessionById('sess-dedup')
    expect(sessionAfterDup.stopped_at).toBeNull() // dedup short-circuited; flag not re-applied
    expect(firstStoppedAt).not.toBeNull()
  })

  test('concurrent identical posts: exactly one row, both return same id', async () => {
    const [a, b] = await Promise.all([
      postEvent(baseEnv),
      postEvent({ ...baseEnv, timestamp: baseEnv.timestamp + 1 }),
    ])
    const aBody = (await a.json()) as { id: number; deduplicated?: boolean }
    const bBody = (await b.json()) as { id: number; deduplicated?: boolean }
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(aBody.id).toBe(bBody.id)
    expect(Boolean(aBody.deduplicated) !== Boolean(bBody.deduplicated)).toBe(true)
    const events = await store.getEventsForSession('sess-dedup')
    expect(events).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `cd app/server && npx vitest run src/routes/events.test.ts -t "dedup"`
Expected: FAIL — dedup path not implemented yet.

- [ ] **Step 3: Update `routes/events.ts`**

Add imports at top:

```ts
import { computeEventSignature } from '../utils/event-signature'
import { DuplicateEventSignatureError } from '../storage/types'
```

In the `router.post('/events', …)` handler, after the existing envelope validation block (just after the debug log, before "Step 2: upsert session"), insert:

```ts
// ---- Step 1.5: dedup pre-check --------------------------------------
const signatureHash = computeEventSignature(envelope, timestamp)
const existing = await store.findEventBySignatureHash(signatureHash)
if (existing) {
  if (LOG_LEVEL !== 'silent') {
    console.log(
      `[dedup] hook=${envelope.hookName} session=${envelope.sessionId} orig_event_id=${existing.id}`,
    )
  }
  return c.json({ id: existing.id, deduplicated: true }, 201)
}
```

Wrap the existing `insertEvent` call so a UNIQUE race surfaces the same response shape. Replace the `await store.insertEvent({...})` block with:

```ts
let eventId: number
let dedupedRace = false
try {
  const inserted = await store.insertEvent({
    agentId: envelope.agentId,
    sessionId: envelope.sessionId,
    hookName: envelope.hookName,
    timestamp,
    payload: envelope.payload,
    cwd: envelope.cwd ?? null,
    _meta: eventStoreMeta,
    signatureHash,
  })
  eventId = inserted.eventId
} catch (err) {
  if (err instanceof DuplicateEventSignatureError) {
    const winner = await store.findEventBySignatureHash(signatureHash)
    if (!winner) throw err // shouldn't happen — index says it's there
    if (LOG_LEVEL !== 'silent') {
      console.log(
        `[dedup:race] hook=${envelope.hookName} session=${envelope.sessionId} orig_event_id=${winner.id}`,
      )
    }
    return c.json({ id: winner.id, deduplicated: true }, 201)
  }
  throw err
}
```

(The remainder of the handler — flags, broadcast — continues using `eventId` exactly as before.)

- [ ] **Step 4: Run route tests, confirm they pass**

Run: `cd app/server && npx vitest run src/routes/events.test.ts`
Expected: PASS — all old + new tests green.

- [ ] **Step 5: Run full server test suite**

Run: `cd app/server && npx vitest run`
Expected: PASS — no regressions.

- [ ] **Step 6: Commit**

```bash
git add app/server/src/routes/events.ts app/server/src/routes/events.test.ts
git commit -m "feat: dedup duplicate events at /events ingestion"
```

---

### Task 4: Verify migration on a real existing DB

The migration must safely add the column to a real existing database without backfilling rows.

- [ ] **Step 1: Snapshot an existing DB**

```bash
cp /Users/joe/Development/ai-tools/observe/agents-observe/data/data/observe.db /tmp/observe-pre-dedup.db
sqlite3 /tmp/observe-pre-dedup.db "PRAGMA table_info('events');" | grep signature_hash || echo "PRE: no signature_hash"
sqlite3 /tmp/observe-pre-dedup.db "SELECT COUNT(*) FROM events;"
```

Expected: `PRE: no signature_hash`, plus a positive row count.

- [ ] **Step 2: Run migration against the snapshot via the adapter**

Run a one-shot script via Node:

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe/app/server && node --input-type=module -e "
import('./src/storage/sqlite-adapter.ts').then(async ({ SqliteAdapter }) => {
  const s = new SqliteAdapter('/tmp/observe-pre-dedup.db')
  await s.healthCheck()
  console.log('OK')
})" 2>&1 | tail -5
```

Note: this requires the TS to be loadable. If it isn't (TS-only entrypoint), use the build output or invoke a test variant. Alternative: write a temporary test that opens the path.

If easier: write a one-off `app/server/src/storage/migration-real-db.test.ts` that opens `/tmp/observe-pre-dedup.db` and asserts the column appears, then delete it.

- [ ] **Step 3: Verify column added, no rows touched**

```bash
sqlite3 /tmp/observe-pre-dedup.db "PRAGMA table_info('events');" | grep signature_hash
sqlite3 /tmp/observe-pre-dedup.db "SELECT COUNT(*) FROM events WHERE signature_hash IS NOT NULL;"
sqlite3 /tmp/observe-pre-dedup.db "SELECT COUNT(*) FROM events;"
```

Expected: column present; zero rows with non-null signature_hash; total row count unchanged from Step 1.

- [ ] **Step 4: Clean up snapshot**

```bash
rm /tmp/observe-pre-dedup.db
```

---

### Task 5: Pre-commit gate + final commit

- [ ] **Step 1: Run `just check`**

```bash
cd /Users/joe/Development/ai-tools/observe/agents-observe && just check
```

Expected: all tests pass, format clean, client build green.

- [ ] **Step 2: If formatting changed anything, commit**

```bash
git status
git add -A
git commit -m "chore: apply formatter"   # only if files changed
```

- [ ] **Step 3: Confirm branch state**

```bash
git log --oneline feat/transcript-token-stats..HEAD
```

Expected: 4 commits — spec, helper, storage, route handler (+ optional fmt).

---

## Self-Review

- **Spec coverage:**
  - Signature definition → Task 1 ✓
  - Schema (column + UNIQUE index, no backfill) → Task 2 ✓
  - Request flow (pre-check, race safety, dedup response) → Task 3 ✓
  - Logging at `info` → Task 3 (uses `console.log`, gated by `LOG_LEVEL !== 'silent'` — matches existing pattern in this file)
  - Storage adapter signature additions → Task 2 ✓
  - Replay note → spec only, no code today ✓
  - Testing → Tasks 1 / 2 / 3 ✓
  - Migration safety on existing DB → Task 4 ✓
- **Placeholder scan:** No `TBD` / `add appropriate X` / "similar to" references. Code blocks present in every code step.
- **Type consistency:** `signatureHash` field name consistent across types.ts, sqlite-adapter.ts, route handler. `DuplicateEventSignatureError` exported from `storage/types.ts` and imported in both adapter and route. `findEventBySignatureHash` signature matches in interface and implementation.
