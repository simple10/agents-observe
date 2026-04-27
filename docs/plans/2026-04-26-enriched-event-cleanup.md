# EnrichedEvent + /events API Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip dead/legacy fields from the wire `ParsedEvent` and framework `EnrichedEvent`, push agent-specific fields into a per-class extension type, introduce a "summary slot" rendering pattern that eliminates per-hookName switching in row components, and add a `fields=` allow-list to the `/events` API so it returns minimal payload by default.

**Architecture:** The `/sessions/:id/events` endpoint default response shrinks to `id + agentId + hookName + timestamp + payload`; clients opt in to `sessionId / cwd / createdAt / _meta` via `?fields=`. The framework `EnrichedEvent` keeps only what every agent class needs; claude-code-specific fields (`subtype`, `toolUseId`, `cwd`, slot fields) move to a `ClaudeCodeEnrichedEvent` extension. `subtype` is removed entirely — every read becomes `hookName` since claude's `deriveSubtype` was identity. Row-summary components become slot renderers (`summaryTool` colored / `summaryCmd` gray / `summary` plain) so all per-event branching lives in `processEvent`. `AgentClassRegistration` becomes generic over the per-class event type so `processEvent` and the per-class render components are fully type-checked end-to-end. `default` and `codex` agents return base `EnrichedEvent` directly — only claude-code needs an extension today.

**Tech Stack:** TypeScript, React 19, Hono (server), Vitest, react-query, SQLite (better-sqlite3).

---

## File Structure

### Server

- **Modify:** `app/server/src/routes/sessions.ts` (lines 108–162) — add `fields=` allow-list parsing to the `GET /sessions/:id/events` handler. Default response omits `sessionId, cwd, createdAt, _meta`.
- **Modify:** `app/server/src/routes/sessions.test.ts` — add tests for the new `fields=` behavior.
- **Modify:** `app/server/src/types.ts` (the server's own `ParsedEvent` at lines 80–90) — drop `createdAt`; make `sessionId, cwd, _meta` optional. The server's `ParsedEvent` is the WS-broadcast shape (used by `routes/events.ts:172-182`).
- **Modify:** `app/server/src/routes/events.ts` (lines 172–182) — drop `createdAt: Date.now()` from the WS broadcast construction so the wire shape matches the new client `WSEventBroadcast`.

### Client wire types

- **Modify:** `app/client/src/types/index.ts` — make `ParsedEvent.sessionId / cwd / createdAt / _meta` all optional. Drop `createdAt` from `WSEventBroadcast`.
- **Modify:** `app/client/src/hooks/use-websocket.ts` (line 122) — drop the `createdAt` field on the WS-built `ParsedEvent`.

### Framework types

- **Modify:** `app/client/src/agents/types.ts` — strip `EnrichedEvent` base; add `labelTooltip`; remove `createdAt`, `type`, `subtype`, `toolUseId`, `sessionId`, the `[key: string]: unknown` index signature; add `summary: string`. Make `AgentClassRegistration<TEvent extends EnrichedEvent = EnrichedEvent>` generic. Update `EventProps`, `ProcessingContext.updateEvent`, `ProcessEventResult`, `FrameworkDataApi` to be generic where applicable.
- **Create:** `app/client/src/agents/claude-code/types.ts` — `ClaudeCodeEnrichedEvent extends EnrichedEvent` with `toolUseId?`, `cwd?`, `summaryTool?`, `summaryCmd?` (all optional — not every event sets them). **No `subtype` field** — Task 7 mechanically swaps every `event.subtype` read to `event.hookName` since claude's `deriveSubtype` was identity.

### Per-class processEvent + helpers

- **Modify:** `app/client/src/agents/claude-code/process-event.ts` — return `ClaudeCodeEnrichedEvent`; drop `type` / `subtype` / `createdAt` writes; populate `summaryTool` and `summaryCmd` slots; swap internal `event.subtype` reads for `event.hookName`; remove `deriveDisplayType` helper.
- **Modify:** `app/client/src/agents/claude-code/derivers.ts` — delete `deriveSubtype` (caller switches to `event.hookName`). Keep `deriveToolName` and `deriveStatus`.
- **Modify:** `app/client/src/agents/claude-code/icons.ts` — `getEventColor(hookName, toolName)` and `getEventIcon(hookName, toolName)`. Internal `subtype` references rename.
- **Modify:** `app/client/src/agents/claude-code/runtime.ts` — replace `event.subtype` reads with `event.hookName`.
- **Modify:** `app/client/src/agents/claude-code/dot-tooltip.tsx` — replace `event.subtype` reads with `event.hookName`.
- **Modify:** `app/client/src/agents/claude-code/event-detail.tsx` — replace ~50 `event.subtype` and `e.subtype` reads with `event.hookName` / `e.hookName`. Drop `event.subtype || event.type` fallback at line 1100.
- **Modify:** `app/client/src/agents/claude-code/helpers.ts` — change `buildSearchText` signature: drop the `subtype` and `type` parameters (callers now pass `hookName` via the event arg).
- **Modify:** `app/client/src/agents/claude-code/row-summary.tsx` — gut the per-hookName switch logic; render slots: `event.summaryTool` (colored), `event.summaryCmd` (gray), `event.summary` (default). Stop computing color via `getEventColor(subtype, toolName)` inside the row.
- **Modify:** `app/client/src/agents/claude-code/index.ts` — update registration: drop `deriveSubtype`, fix `getEventIcon` / `getEventColor` lambdas to use `event.hookName`. Type the registration as `AgentClassRegistration<ClaudeCodeEnrichedEvent>`.

### Default + codex

- **Modify:** `app/client/src/agents/default/index.tsx` — drop `deriveSubtype` from registration; `processEvent` returns base `EnrichedEvent` (drop `type/subtype/createdAt` writes; `label` becomes `hookName`).
- **Modify:** `app/client/src/agents/codex/index.tsx` — drop `deriveSubtype` (caller logic stays in `parse-transcript.ts` if it needs the transcript shape internally); `processEvent` returns base `EnrichedEvent`.

### Generic dispatch

- **Modify:** `app/client/src/agents/registry.ts` — type-erased registration storage; the `get(...)` lookup returns `AgentClassRegistration<EnrichedEvent>` so dispatchers can call components without knowing the per-class shape. Single cast site.
- **Modify:** `app/client/src/agents/event-store.ts` — minor type updates to use the generic registration; `process()` still returns `EnrichedEvent[]` (heterogeneous).

### Generic row + components

- **Modify:** `app/client/src/components/event-stream/event-row.tsx` (lines 118, 126) — replace `event.subtype || event.type` with `event.labelTooltip ?? event.hookName`.

### Wrappers + tests

- **Modify:** `app/client/src/lib/event-summary.ts` — drop `deriveSubtype` import; pass `null` for the subtype param (or simplify the helper signature).
- **Modify:** `app/client/src/lib/event-summary.test.ts` — adjust test fixtures if they passed `subtype`.
- **Modify:** `app/client/src/agents/claude-code/runtime.test.ts` — adjust fixtures: build events with `hookName` instead of `subtype`.

---

## Sequencing

The plan splits into 5 phases. Each phase is independently committable and leaves the codebase in a green state.

- **Phase 1 — Wire layer:** server `/events` `fields=` + tests + client `ParsedEvent` optional fields + WS broadcast strip `createdAt`. Behavior-preserving.
- **Phase 2 — Framework types:** base `EnrichedEvent` slim-down + `labelTooltip` + per-class type file. Generic `AgentClassRegistration`.
- **Phase 3 — Processing:** per-class `processEvent` rewrites; `subtype → hookName` mechanical replacement across claude-code internals; default + codex updates.
- **Phase 4 — Rendering:** slot-based `row-summary.tsx`; `event-row.tsx` `labelTooltip` switch; one cast site at the dispatcher.
- **Phase 5 — Cleanup:** stale comments, dead helpers (`deriveDisplayType`), `event-summary.ts` simplification.

---

## Phase 1: Wire layer

### Task 1: Make `ParsedEvent` fields optional + drop `createdAt` from WS broadcast

**Files:**
- Modify: `app/client/src/types/index.ts:75-85`
- Modify: `app/client/src/types/index.ts:128-142`
- Modify: `app/client/src/hooks/use-websocket.ts:118-129`

- [ ] **Step 1: Update `ParsedEvent` to make derived/optional fields optional**

In `app/client/src/types/index.ts`, replace the `ParsedEvent` interface (lines 75–85) with:

```typescript
/**
 * Wire-shape event from the server. Identity + raw payload only — Layer
 * 3 derives display fields (toolName, status, etc.) per agent class.
 *
 * The default `/sessions/:id/events` response includes only the
 * REQUIRED fields below. Clients can opt into the optional fields via
 * `?fields=sessionId,cwd,createdAt,_meta`.
 */
export interface ParsedEvent {
  // Required — always returned
  id: number
  agentId: string
  hookName: string
  timestamp: number
  payload: Record<string, unknown>

  // Optional — opt-in via `fields=` or carried by WS broadcast
  sessionId?: string
  createdAt?: number
  cwd?: string | null
  _meta?: Record<string, unknown> | null
}
```

- [ ] **Step 2: Drop `createdAt` from `WSEventBroadcast`**

In the same file (lines 128–142), update the `WSEventBroadcast` interface:

```typescript
export interface WSEventBroadcast {
  id: number
  timestamp: number
  agentId?: string
  agent_id?: string
  hookName?: string
  hook_name?: string
  sessionId?: string
  session_id?: string
  cwd?: string | null
  _meta?: Record<string, unknown> | null
  payload: Record<string, unknown>
}
```

- [ ] **Step 3: Update WS handler to drop `createdAt` mapping**

In `app/client/src/hooks/use-websocket.ts`, replace the `event` construction at lines 119–129 with:

```typescript
const event: ParsedEvent = {
  id: wire.id,
  timestamp: wire.timestamp,
  agentId: (wire.agentId ?? wire.agent_id ?? '') as string,
  sessionId,
  hookName: (wire.hookName ?? wire.hook_name ?? '') as string,
  payload: wire.payload,
  cwd: wire.cwd ?? null,
  _meta: wire._meta ?? null,
}
```

- [ ] **Step 4: Run typecheck**

Run: `just typecheck` (or `pnpm --filter client typecheck` if `just` not available).
Expected: PASS. Compiler may flag unused `createdAt` references inside agent classes — those are addressed in Phase 3.

- [ ] **Step 5: Update server `ParsedEvent` to match the new wire shape**

In `app/server/src/types.ts`, replace the `ParsedEvent` interface (lines 80–90) with:

```typescript
export interface ParsedEvent {
  // Required
  id: number
  agentId: string
  hookName: string
  timestamp: number
  payload: Record<string, unknown>

  // Optional — only present on WS broadcasts that carry them or `fields=`
  // GET /events responses that opt in.
  sessionId?: string
  cwd?: string | null
  _meta?: Record<string, unknown> | null
}
```

`createdAt` is removed entirely — the client never read it and the server doesn't store it as a wire field anymore.

- [ ] **Step 6: Drop `createdAt` from the WS broadcast construction**

In `app/server/src/routes/events.ts`, find the broadcast construction at lines 172–182 (the `const event: ParsedEvent = { ... }` block) and remove the `createdAt: Date.now(),` line. The resulting block:

```typescript
const event: ParsedEvent = {
  id: eventId,
  agentId: envelope.agentId,
  sessionId: envelope.sessionId,
  hookName: envelope.hookName,
  timestamp,
  cwd: envelope.cwd ?? null,
  _meta: (envelope._meta as Record<string, unknown> | undefined) ?? null,
  payload: envelope.payload,
}
broadcastToSession(envelope.sessionId, { type: 'event', data: event })
```

- [ ] **Step 7: Run server tests**

Run: `pnpm --filter server vitest run`
Expected: PASS — the existing `events.test.ts` doesn't assert on `createdAt` in the broadcast (it inspects DB state).

- [ ] **Step 8: Commit**

```bash
git add app/client/src/types/index.ts \
        app/client/src/hooks/use-websocket.ts \
        app/server/src/types.ts \
        app/server/src/routes/events.ts
git commit -m "refactor(types): drop createdAt from wire; make sessionId/cwd/_meta optional"
```

---

### Task 2: Add `fields=` allow-list to `GET /sessions/:id/events`

**Files:**
- Modify: `app/server/src/routes/sessions.ts:108-162`
- Test: `app/server/src/routes/sessions.test.ts` (new tests)

- [ ] **Step 1: Write failing test for default response (omits opt-in fields)**

Append to `app/server/src/routes/sessions.test.ts`:

```typescript
describe('GET /api/sessions/:id/events — fields= allow-list', () => {
  let app: Hono<Env>
  const mockStore = {
    getEventsForSession: vi.fn(),
    getEventsSince: vi.fn(),
    getSessionById: vi.fn(),
  }

  beforeEach(async () => {
    vi.resetModules()
    Object.values(mockStore).forEach((fn) => fn.mockReset())
    vi.doMock('../config', () => ({ config: { logLevel: 'error' } }))
    const { default: sessionsRouter } = await import('./sessions')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', mockStore as unknown as EventStore)
      c.set('broadcastToSession', () => {})
      c.set('broadcastToAll', () => {})
      await next()
    })
    app.route('/api', sessionsRouter)
  })

  test('default response omits sessionId, cwd, createdAt, _meta', async () => {
    mockStore.getEventsForSession.mockResolvedValue([
      {
        id: 1,
        agent_id: 'agent-1',
        session_id: 'sess-1',
        hook_name: 'PreToolUse',
        timestamp: 1000,
        created_at: 2000,
        cwd: '/tmp',
        _meta: '{"foo":"bar"}',
        payload: '{"x":1}',
      },
    ])
    mockStore.getSessionById.mockResolvedValue({ stopped_at: null })

    const res = await app.request('/api/sessions/sess-1/events')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([
      { id: 1, agentId: 'agent-1', hookName: 'PreToolUse', timestamp: 1000, payload: { x: 1 } },
    ])
    // Explicitly assert opt-in fields are absent
    expect(body[0]).not.toHaveProperty('sessionId')
    expect(body[0]).not.toHaveProperty('cwd')
    expect(body[0]).not.toHaveProperty('createdAt')
    expect(body[0]).not.toHaveProperty('_meta')
  })

  test('fields=sessionId,cwd,createdAt,_meta returns the opt-in fields', async () => {
    mockStore.getEventsForSession.mockResolvedValue([
      {
        id: 1,
        agent_id: 'agent-1',
        session_id: 'sess-1',
        hook_name: 'PreToolUse',
        timestamp: 1000,
        created_at: 2000,
        cwd: '/tmp',
        _meta: '{"foo":"bar"}',
        payload: '{"x":1}',
      },
    ])
    mockStore.getSessionById.mockResolvedValue({ stopped_at: null })

    const res = await app.request(
      '/api/sessions/sess-1/events?fields=sessionId,cwd,createdAt,_meta',
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([
      {
        id: 1,
        agentId: 'agent-1',
        hookName: 'PreToolUse',
        timestamp: 1000,
        payload: { x: 1 },
        sessionId: 'sess-1',
        cwd: '/tmp',
        createdAt: 2000,
        _meta: { foo: 'bar' },
      },
    ])
  })

  test('unknown fields in fields= are ignored', async () => {
    mockStore.getEventsForSession.mockResolvedValue([
      {
        id: 1,
        agent_id: 'agent-1',
        session_id: 'sess-1',
        hook_name: 'PreToolUse',
        timestamp: 1000,
        created_at: 2000,
        cwd: '/tmp',
        _meta: null,
        payload: '{}',
      },
    ])
    mockStore.getSessionById.mockResolvedValue({ stopped_at: null })

    const res = await app.request(
      '/api/sessions/sess-1/events?fields=cwd,bogus,createdAt',
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body[0]).toHaveProperty('cwd', '/tmp')
    expect(body[0]).toHaveProperty('createdAt', 2000)
    expect(body[0]).not.toHaveProperty('sessionId')
    expect(body[0]).not.toHaveProperty('_meta')
    expect(body[0]).not.toHaveProperty('bogus')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter server vitest run src/routes/sessions.test.ts`
Expected: FAIL — current handler always returns all fields, so the "default omits" test fails.

- [ ] **Step 3: Implement `fields=` allow-list in the handler**

In `app/server/src/routes/sessions.ts`, replace the existing GET events handler (lines 108–162) with:

```typescript
// Allow-list of opt-in `fields=` values. Default response omits all of
// these; clients pass `?fields=sessionId,cwd,createdAt,_meta` to opt in.
const OPT_IN_FIELDS = new Set(['sessionId', 'cwd', 'createdAt', '_meta'])

// GET /sessions/:id/events
router.get('/sessions/:id/events', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const sinceParam = c.req.query('since')
  const agentIdParam = c.req.query('agentId')
  const fieldsParam = c.req.query('fields')

  const requested = new Set(
    (fieldsParam ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter((f) => OPT_IN_FIELDS.has(f)),
  )

  const rows = sinceParam
    ? await store.getEventsSince(sessionId, parseInt(sinceParam))
    : await store.getEventsForSession(sessionId, {
        agentIds: agentIdParam ? agentIdParam.split(',') : undefined,
        hookName: c.req.query('hookName') || undefined,
        search: c.req.query('search') || undefined,
        limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
        offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
      })

  const events = rows.map((r) => {
    const base: Record<string, unknown> = {
      id: r.id,
      agentId: r.agent_id,
      hookName: r.hook_name,
      timestamp: r.timestamp,
      payload: JSON.parse(r.payload),
    }
    if (requested.has('sessionId')) base.sessionId = r.session_id
    if (requested.has('cwd')) base.cwd = r.cwd ?? null
    if (requested.has('createdAt')) base.createdAt = r.created_at || r.timestamp
    if (requested.has('_meta')) base._meta = r._meta ? JSON.parse(r._meta) : null
    return base
  })

  // Lazy session status correction based on event history.
  if (events.length > 0) {
    let lastSessionEndIdx = -1
    for (let i = events.length - 1; i >= 0; i--) {
      if ((events[i] as { hookName: string }).hookName === 'SessionEnd') {
        lastSessionEndIdx = i
        break
      }
    }
    const session = await store.getSessionById(sessionId)
    if (session) {
      const isStopped = !!session.stopped_at
      if (lastSessionEndIdx >= 0 && lastSessionEndIdx === events.length - 1 && !isStopped) {
        await store.updateSessionStatus(sessionId, 'stopped')
      } else if (lastSessionEndIdx >= 0 && lastSessionEndIdx < events.length - 1 && isStopped) {
        await store.updateSessionStatus(sessionId, 'active')
      } else if (lastSessionEndIdx < 0 && isStopped) {
        await store.updateSessionStatus(sessionId, 'active')
      }
    }
  }

  return c.json(events)
})
```

Also remove the `import type { ParsedEvent }` reference at the top of the file — the response is now a plain `Record<string, unknown>` shape per row. (If the import is shared with another handler in the same file, leave it; just don't reference `ParsedEvent` in the new code.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter server vitest run src/routes/sessions.test.ts`
Expected: PASS — all three new tests + existing tests.

- [ ] **Step 5: Commit**

```bash
git add app/server/src/routes/sessions.ts app/server/src/routes/sessions.test.ts
git commit -m "feat(server): add fields= allow-list to GET /sessions/:id/events"
```

---

### Task 3: Update client `useEvents` callers to opt in to `cwd` if needed

**Background:** Claude-code's `processEvent` reads `event.cwd` (line 386 of `process-event.ts`). After Task 2 ships, the default GET response omits `cwd`. Phase 3 moves cwd-derivation to read `payload.cwd` only, so this task is just a safety check — no caller currently needs the wire-level `cwd`.

**Files:**
- Read-only verification: `app/client/src/lib/api-client.ts:103-126` (`getEvents`)

- [ ] **Step 1: Confirm `getEvents` does not request `fields=cwd`**

Run: `grep -n "fields=" app/client/src/lib/api-client.ts`
Expected: no matches. The default minimal response is what the client wants. No code change. Phase 3's claude-code refactor reads cwd from `payload.cwd` directly.

---

## Phase 2: Framework types

### Task 4: Strip `EnrichedEvent` base type and add `labelTooltip`

**Files:**
- Modify: `app/client/src/agents/types.ts`

- [ ] **Step 1: Replace the `EnrichedEvent` interface**

In `app/client/src/agents/types.ts`, replace the entire `EnrichedEvent` interface (lines 16–59) with:

```typescript
export interface EnrichedEvent {
  // Identity (from raw server event)
  id: number
  agentId: string
  hookName: string
  timestamp: number

  // Per-class enrichment (every agent class populates these)
  toolName: string | null
  status: EventStatus
  groupId: string | null
  turnId: string | null
  displayEventStream: boolean
  displayTimeline: boolean
  /** Short label shown on the row (e.g. "Tool", "Prompt"). */
  label: string
  /** Tooltip for the label / icon. Defaults to `hookName` when null. */
  labelTooltip: string | null
  icon: ComponentType | null
  iconColor: string | null
  dotColor: string | null
  iconColorHex: string | null
  filterTags: {
    static: string | null // category: 'Prompts', 'Tools', 'Agents', etc. (null if hidden)
    dynamic: string[] // specific filters: ['Bash'], ['Read'], etc.
  }
  searchText: string

  // Whether this event was processed with dedup enabled
  dedupMode: boolean

  /** One-line summary text shown in the row. Universal across agent classes. */
  summary: string

  // Original payload (same reference, no copy)
  payload: Record<string, unknown>
}
```

**What was removed:**
- `sessionId` — agent-class-specific or fetched on demand from the cache
- `createdAt` — wire field never read
- `type` — legacy display string, callers switched to `hookName`
- `subtype` — legacy classification, callers switched to `hookName`
- `toolUseId` — claude-specific
- `[key: string]: unknown` — gone; per-class types extend instead

**What was added:**
- `labelTooltip: string | null`
- `summary: string` (was previously stashed via the index signature in agent code)

- [ ] **Step 2: Make `AgentClassRegistration` generic over the per-class event type**

In the same file, replace the `AgentClassRegistration` interface (lines 144–181) with:

```typescript
export interface AgentClassRegistration<TEvent extends EnrichedEvent = EnrichedEvent> {
  agentClass: string
  displayName: string
  Icon: ComponentType<{ className?: string }>

  processEvent(raw: RawEvent, ctx: ProcessingContext): { event: TEvent }

  // ---- Per-class derivation hooks --------------------------------------
  // These map a wire event (hookName + payload) to display fields.

  /** Map a hookName + payload to a tool name (for tool-related events).
   *  Returns null when the event doesn't reference a tool. */
  deriveToolName(event: RawEvent): string | null

  /** Compute display status from the event and any already-grouped
   *  sibling events (e.g. PreToolUse + matching PostToolUse). Returns
   *  null when status doesn't apply for this hook. */
  deriveStatus(event: RawEvent, groupedEvents: RawEvent[]): EventStatus | null

  // Render-time icon/color resolvers — called per-row so live icon
  // customization propagates without a full reprocess.
  getEventIcon(event: TEvent): ComponentType<{ className?: string }>
  getEventColor(event: TEvent): EventColor

  // Rendering components
  RowSummary: ComponentType<{ event: TEvent; dataApi: FrameworkDataApi }>
  EventDetail: ComponentType<{ event: TEvent; dataApi: FrameworkDataApi }>
  DotTooltip: ComponentType<{ event: TEvent }>
}
```

**What was removed:**
- `deriveSubtype` — claude's was identity (`return event.hookName`); default's was identity; codex's transcript-shape parsing folds into `deriveToolName` (codex-specific). All callers switch to `event.hookName`.
- `EventProps` (the old shared component prop type) — replaced inline because each component is now typed against its per-class event.

- [ ] **Step 3: Remove `EventProps`**

In the same file, delete the `EventProps` interface (lines 130–133) entirely. Anyone importing it switches to inline `{ event: TEvent; dataApi: FrameworkDataApi }`.

- [ ] **Step 4: Fix the stale comment**

The comment block above `deriveSubtype` (now removed) at lines 152–157 referenced "legacy `type` / `subtype` filters (see `api.getEvents`)" — that legacy is gone. The comment was deleted along with `deriveSubtype` in step 2.

- [ ] **Step 5: Run typecheck**

Run: `just typecheck`
Expected: FAIL with many errors — every reference to `EnrichedEvent.type / subtype / createdAt / toolUseId / sessionId` and every `EventProps` import. Those are all addressed in subsequent tasks. **Do not commit yet.**

- [ ] **Step 6: Commit (with broken-tree marker)**

The next several tasks fix the cascading errors. Commit the type strip as a deliberate broken-tree checkpoint so reviewers see the surface change cleanly:

```bash
git add app/client/src/agents/types.ts
git commit -m "refactor(types): strip EnrichedEvent to framework essentials [WIP]"
```

> **Note for the implementer:** Subsequent tasks must land before the branch is mergeable. Do not push this commit alone.

---

### Task 5: Create `ClaudeCodeEnrichedEvent` extension

**Files:**
- Create: `app/client/src/agents/claude-code/types.ts`

- [ ] **Step 1: Write the per-class type**

Create `app/client/src/agents/claude-code/types.ts`:

```typescript
import type { EnrichedEvent } from '../types'

/**
 * Claude Code's per-class enrichment. Extends the framework's
 * `EnrichedEvent` with fields that only make sense for Claude Code
 * events.
 *
 * Slot fields (`summaryTool`, `summaryCmd`) follow the recommended
 * row-summary pattern: `processEvent` decides what goes in each slot,
 * and `RowSummary` is a dumb renderer that just reads them. New agent
 * classes can adopt the same pattern by adding optional `summaryTool` /
 * `summaryCmd` to their own extension type.
 */
export interface ClaudeCodeEnrichedEvent extends EnrichedEvent {
  /** Claude Code's `tool_use_id` from `payload.tool_use_id`. Set on
   *  PreToolUse / PostToolUse / PostToolUseFailure events; absent on
   *  others. Used to pair Pre with the matching Post. */
  toolUseId?: string

  /** Working directory associated with this event, derived from
   *  `payload.cwd`. Set when the payload carries it; absent otherwise.
   *  Independent of the server `events.cwd` column, which is hooks-lib
   *  metadata reserved for future per-cwd auditing. */
  cwd?: string

  // ---- Summary row "slots" ---------------------------------------------
  // The row-summary component renders, in order: summaryTool (colored
  // with iconColor) → summaryCmd (gray) → summary (default text). All
  // three are optional. processEvent owns the decision of what to put
  // in each.

  /** Primary colored slot — typically the tool name (e.g. "Bash") or
   *  expansion type. Rendered with `iconColor`. */
  summaryTool?: string

  /** Secondary gray slot — typically the parsed command name (e.g. the
   *  binary from a Bash tool input) or command source. Rendered gray. */
  summaryCmd?: string
}
```

- [ ] **Step 2: Commit**

```bash
git add app/client/src/agents/claude-code/types.ts
git commit -m "feat(types): add ClaudeCodeEnrichedEvent with summary slots"
```

---

### Task 6: Update `event-store.ts` and `registry.ts` for the generic registration

**Files:**
- Modify: `app/client/src/agents/registry.ts`
- Modify: `app/client/src/agents/event-store.ts`

- [ ] **Step 1: Update the registry to store the erased generic**

In `app/client/src/agents/registry.ts`, replace the entire file with:

```typescript
import type { AgentClassRegistration, EnrichedEvent } from './types'

// Storage uses the base-typed registration. Per-class generic parameters
// are erased at the storage boundary so a single map can hold all
// classes. The cast is safe because `processEvent` for class X always
// produces events that class X's components expect — by construction.
type AnyRegistration = AgentClassRegistration<EnrichedEvent>

const registrations = new Map<string, AnyRegistration>()
let defaultRegistration: AnyRegistration | null = null

export const AgentRegistry = {
  register<TEvent extends EnrichedEvent>(registration: AgentClassRegistration<TEvent>) {
    registrations.set(registration.agentClass, registration as AnyRegistration)
  },

  registerDefault<TEvent extends EnrichedEvent>(registration: AgentClassRegistration<TEvent>) {
    defaultRegistration = registration as AnyRegistration
  },

  get(agentClass: string | null | undefined): AnyRegistration {
    const reg = registrations.get(agentClass ?? '') ?? defaultRegistration
    if (!reg) {
      throw new Error(`No agent class registered for "${agentClass}" and no default registered`)
    }
    return reg
  },

  getAll(): AnyRegistration[] {
    return [...registrations.values()]
  },

  has(agentClass: string): boolean {
    return registrations.has(agentClass)
  },
}
```

- [ ] **Step 2: Confirm `event-store.ts` compiles unchanged**

`event-store.ts` references `EnrichedEvent` for the heterogeneous list and calls `registration.processEvent(raw, ctx)`. Because the registry returns `AgentClassRegistration<EnrichedEvent>`, `result.event` is typed as `EnrichedEvent` — exactly what the store stores. No code changes needed here, but verify:

Run: `just typecheck 2>&1 | grep "event-store.ts"`
Expected: zero errors from `event-store.ts`. (Errors elsewhere are still expected — Phase 3 fixes them.)

- [ ] **Step 3: Commit**

```bash
git add app/client/src/agents/registry.ts
git commit -m "refactor(registry): make AgentClassRegistration generic over event type"
```

---

## Phase 3: Processing

### Task 7: Replace `subtype` reads with `hookName` in claude-code internals

This is a wide mechanical change across 6 files. Since claude's `deriveSubtype` was identity (`return event.hookName`), every internal `event.subtype` becomes `event.hookName`. The fields they read are typed as `string | null`, so we may need a `?? null` in places where the new value is the always-present `hookName: string`.

**Files:**
- Modify: `app/client/src/agents/claude-code/process-event.ts`
- Modify: `app/client/src/agents/claude-code/runtime.ts`
- Modify: `app/client/src/agents/claude-code/dot-tooltip.tsx`
- Modify: `app/client/src/agents/claude-code/event-detail.tsx`
- Modify: `app/client/src/agents/claude-code/icons.ts`
- Modify: `app/client/src/agents/claude-code/helpers.ts`

- [ ] **Step 1: Rename `subtype` parameter to `hookName` in `icons.ts`**

In `app/client/src/agents/claude-code/icons.ts`, the `getEventColor` (line 166) and `getEventIcon` (line 189) functions take `subtype: string | null`. Rename that parameter to `hookName: string | null` throughout the file (including any internal helpers like `resolveEventKey` and `toolFallbackKey` if they also take `subtype`). Use grep to find all references:

Run: `grep -n "subtype" app/client/src/agents/claude-code/icons.ts`

For each match, rename the parameter or local variable from `subtype` to `hookName`. Behavior is unchanged.

- [ ] **Step 2: Replace `e.subtype` and `event.subtype` with `e.hookName` / `event.hookName` in claude-code source files**

In each of the following files, replace every `.subtype` access on a claude-code event with `.hookName`:

- `app/client/src/agents/claude-code/runtime.ts` — 7 occurrences (lines 18, 19, 22, 23, 26, 27, 30, 31)
- `app/client/src/agents/claude-code/dot-tooltip.tsx` — 3 occurrences (lines 12, 36, 37)
- `app/client/src/agents/claude-code/event-detail.tsx` — ~50 occurrences (find with `grep -n "\.subtype" app/client/src/agents/claude-code/event-detail.tsx`)
- `app/client/src/agents/claude-code/process-event.ts` — internal reads only (lines 261, 282, 300, 331). Note: the `subtype` *local variable* set at line 167 will be renamed in Task 8 — leave it for now, but its callers in this file (e.g., line 351 `deriveDisplayType(subtype)`) read the local, not the event field, so they are unaffected by this step.

For each match, change `e.subtype` → `e.hookName` and `event.subtype` → `event.hookName`.

**One special case:** in `event-detail.tsx`, line 1100:

```typescript
const rawLabel = event.subtype || event.type
```

becomes:

```typescript
const rawLabel = event.hookName
```

(`hookName` is always present, so the fallback chain collapses.)

- [ ] **Step 3: Update `event-detail.tsx` line 1097 icon resolver**

```typescript
const Icon = event.icon || getEventIcon(event.subtype, event.toolName)
```

becomes:

```typescript
const Icon = event.icon || getEventIcon(event.hookName, event.toolName)
```

- [ ] **Step 4: Update `event-detail.tsx` line 1105**

```typescript
(event.summary as string) || getEventSummary(event as any, event.subtype, event.toolName)
```

becomes:

```typescript
event.summary || getEventSummary(event as any, event.hookName, event.toolName)
```

(`event.summary` is now typed as `string` on the base — no cast needed.)

- [ ] **Step 5: Update `event-detail.tsx` line 206 "Hook" detail row**

```typescript
{!event.dedupMode && event.subtype && <DetailRow label="Hook" value={event.subtype} />}
```

becomes:

```typescript
{!event.dedupMode && <DetailRow label="Hook" value={event.hookName} />}
```

- [ ] **Step 6: Update `dot-tooltip.tsx` line 36–37**

```typescript
{event.subtype && event.subtype !== label && (
  <div className="opacity-40 text-[9px]">{event.subtype}</div>
)}
```

becomes:

```typescript
{event.hookName !== label && (
  <div className="opacity-40 text-[9px]">{event.hookName}</div>
)}
```

- [ ] **Step 7: Update `event-detail.tsx` imports + helper signatures to use `ClaudeCodeEnrichedEvent`**

`event-detail.tsx` imports `EventProps` (which Task 4 deleted) and types its helpers against base `EnrichedEvent`, but it reads claude-specific fields (`event.toolUseId` at lines 155, 158). Switch the file to the per-class type.

In `app/client/src/agents/claude-code/event-detail.tsx`:

Replace the type import at line 25:

```typescript
import type { EventProps, EnrichedEvent, FrameworkDataApi } from '../types'
```

with:

```typescript
import type { FrameworkDataApi } from '../types'
import type { ClaudeCodeEnrichedEvent } from './types'
```

Replace every `EnrichedEvent` in the file (lines 150, 151, 352, 355, 358, 1096 and any local helper signatures the grep finds) with `ClaudeCodeEnrichedEvent`:

Run: `grep -n "EnrichedEvent" app/client/src/agents/claude-code/event-detail.tsx`

For each match, change `EnrichedEvent` → `ClaudeCodeEnrichedEvent`.

Replace the main component signature at line 187:

```typescript
export function ClaudeCodeEventDetail({ event, dataApi }: EventProps) {
```

with:

```typescript
export function ClaudeCodeEventDetail({
  event,
  dataApi,
}: {
  event: ClaudeCodeEnrichedEvent
  dataApi: FrameworkDataApi
}) {
```

Also delete the stale comment at line 1102 (`// EnrichedEvent already has subtype/toolName from runtime derivation;`) and the file-header comment at line 4 referencing `EventProps / EnrichedEvent`.

- [ ] **Step 8: Run typecheck**

Run: `just typecheck`
Expected: substantially fewer errors. Remaining errors will mostly be in `process-event.ts` (Task 8), `row-summary.tsx` (Task 11), `event-row.tsx` (Task 12), and the agent-class registrations (Tasks 9–10).

- [ ] **Step 9: Commit**

```bash
git add app/client/src/agents/claude-code/icons.ts \
        app/client/src/agents/claude-code/runtime.ts \
        app/client/src/agents/claude-code/dot-tooltip.tsx \
        app/client/src/agents/claude-code/event-detail.tsx
git commit -m "refactor(claude-code): replace event.subtype reads with event.hookName"
```

---

### Task 8: Rewrite claude-code `processEvent` to return `ClaudeCodeEnrichedEvent`

**Files:**
- Modify: `app/client/src/agents/claude-code/process-event.ts`
- Modify: `app/client/src/agents/claude-code/derivers.ts`
- Modify: `app/client/src/agents/claude-code/helpers.ts`

- [ ] **Step 1: Update `helpers.ts` `buildSearchText` signature**

In `app/client/src/agents/claude-code/helpers.ts` (lines 195–224), simplify:

```typescript
/** Build pre-computed searchText from an event and its summary.
 *  toolName is passed since it's derived per agent class. */
export function buildSearchText(
  event: RawEvent,
  summary: string,
  toolName: string | null,
): string {
  const parts: string[] = [summary]
  if (toolName) parts.push(toolName)
  if (event.hookName) parts.push(event.hookName)

  const p = event.payload as Record<string, any>
  if (p.tool_input?.command) parts.push(p.tool_input.command)
  if (p.tool_input?.file_path) parts.push(p.tool_input.file_path)
  if (p.tool_input?.pattern) parts.push(p.tool_input.pattern)
  if (p.tool_input?.description) parts.push(p.tool_input.description)
  if (p.prompt) parts.push(p.prompt)
  if (p.error) parts.push(p.error)

  return parts.filter(Boolean).join(' ').toLowerCase()
}
```

- [ ] **Step 2: Delete `deriveSubtype` from `derivers.ts`**

In `app/client/src/agents/claude-code/derivers.ts`, remove the `deriveSubtype` function (lines 7–10) entirely along with its export. Also remove the `Claude Code:` comment that mentioned it. Keep `deriveToolName` and `deriveStatus`.

- [ ] **Step 3: Rewrite claude-code `processEvent`**

Replace `app/client/src/agents/claude-code/process-event.ts` entirely with:

```typescript
import type { RawEvent, ProcessingContext } from '../types'
import type { ClaudeCodeEnrichedEvent } from './types'
import { getEventIcon, getEventColor } from './icons'
import { getEventSummary, buildSearchText } from './helpers'
import { deriveToolName } from './derivers'
import { agentPatchDebouncer } from '@/lib/agent-patch-debouncer'

// Label mapping for the framework's left-side chrome. Keyed by hookName.
const LABELS: Record<string, string> = {
  PreToolUse: 'Tool',
  PostToolUse: 'Tool',
  PostToolUseFailure: 'Tool',
  UserPromptSubmit: 'Prompt',
  UserPromptExpansion: 'PromptExp',
  Stop: 'Stop',
  StopFailure: 'Stop',
  SessionStart: 'Session',
  SessionEnd: 'Session',
  SubagentStart: 'SubStart',
  SubagentStop: 'SubStop',
  PermissionRequest: 'Permission',
  PermissionDenied: 'Permission',
  Notification: 'Notice',
  TaskCreated: 'Task',
  TaskCompleted: 'Task',
  TeammateIdle: 'Idle',
  InstructionsLoaded: 'Config',
  ConfigChange: 'Config',
  CwdChanged: 'Config',
  FileChanged: 'File',
  PreCompact: 'Compact',
  PostCompact: 'Compact',
  Elicitation: 'MCP',
  ElicitationResult: 'MCP',
  WorktreeCreate: 'Worktree',
  WorktreeRemove: 'Worktree',
  stop_hook_summary: 'Stop',
}

/** Map event to filter categories. Returns null for hidden events. */
function getFilterTags(
  hookName: string,
  toolName: string | null,
  display: boolean,
): ClaudeCodeEnrichedEvent['filterTags'] {
  if (!display) return { static: null, dynamic: [] }

  const isTool =
    hookName === 'PreToolUse' || hookName === 'PostToolUse' || hookName === 'PostToolUseFailure'

  if (isTool) {
    const dynamic: string[] = []
    if (toolName) {
      // Normalize MCP tool names: mcp__chrome-devtools__click → mcp__chrome-devtools
      if (toolName.startsWith('mcp__')) {
        const match = toolName.match(/^(mcp__[^_]+(?:_[^_]+)*?)__/)
        dynamic.push(match ? match[1] : toolName)
      } else {
        dynamic.push(toolName)
      }
    }
    if (toolName?.startsWith('mcp__')) return { static: 'MCP', dynamic }
    if (toolName === 'Agent') return { static: 'Agents', dynamic }
    if (toolName === 'TaskCreate' || toolName === 'TaskUpdate') return { static: 'Tasks', dynamic }
    return { static: 'Tools', dynamic }
  }

  if (hookName === 'UserPromptSubmit' || hookName === 'UserPromptExpansion')
    return { static: 'Prompts', dynamic: [] }
  if (hookName === 'SubagentStart' || hookName === 'TeammateIdle')
    return { static: 'Agents', dynamic: [] }
  if (hookName === 'TaskCreated' || hookName === 'TaskCompleted')
    return { static: 'Tasks', dynamic: [] }
  if (hookName === 'SessionStart' || hookName === 'SessionEnd')
    return { static: 'Session', dynamic: [] }
  if (
    hookName === 'Stop' ||
    hookName === 'StopFailure' ||
    hookName === 'SubagentStop' ||
    hookName === 'stop_hook_summary'
  )
    return { static: 'Stop', dynamic: [] }
  if (hookName === 'PermissionRequest') return { static: 'Permissions', dynamic: [] }
  if (hookName === 'Notification') return { static: 'Notifications', dynamic: [] }
  if (hookName === 'Elicitation' || hookName === 'ElicitationResult')
    return { static: 'MCP', dynamic: [] }
  if (hookName === 'PreCompact' || hookName === 'PostCompact')
    return { static: 'Compaction', dynamic: [] }
  if (
    hookName === 'InstructionsLoaded' ||
    hookName === 'ConfigChange' ||
    hookName === 'CwdChanged' ||
    hookName === 'FileChanged'
  )
    return { static: 'Config', dynamic: [hookName] }

  return { static: null, dynamic: hookName ? [hookName] : [] }
}

/**
 * Build the minimal `AgentPatch` that would actually change the canonical
 * agent row, given the values discovered in an event. Returns `null` when
 * every proposed field already matches the current row.
 */
function diffAgentPatch(
  current:
    | { name?: string | null; description?: string | null; agentType?: string | null }
    | undefined,
  proposed: { name?: string | null; description?: string | null; agent_type?: string | null },
): { name?: string | null; description?: string | null; agent_type?: string | null } | null {
  const patch: { name?: string | null; description?: string | null; agent_type?: string | null } =
    {}
  if ('name' in proposed && proposed.name != null && proposed.name !== current?.name) {
    patch.name = proposed.name
  }
  if (
    'description' in proposed &&
    proposed.description != null &&
    proposed.description !== current?.description
  ) {
    patch.description = proposed.description
  }
  if (
    'agent_type' in proposed &&
    proposed.agent_type != null &&
    proposed.agent_type !== current?.agentType
  ) {
    patch.agent_type = proposed.agent_type
  }
  return Object.keys(patch).length === 0 ? null : patch
}

/** Local fallback for the inline status decision inside processEvent. */
function deriveLocalStatus(hookName: string): ClaudeCodeEnrichedEvent['status'] {
  if (hookName === 'PreToolUse') return 'running'
  if (hookName === 'PostToolUse') return 'completed'
  if (hookName === 'PostToolUseFailure') return 'failed'
  if (hookName === 'PreCompact') return 'running'
  if (hookName === 'PostCompact') return 'completed'
  return 'completed'
}

// ---- Slot computation (the slotted-row pattern) ----------------------------
// processEvent decides what (if anything) goes in each summary slot. The
// row-summary component just renders whatever it finds — no per-hookName
// switching at render time.

/** Extract the "[binary]" prefix from a summary, if present. */
function parseBinaryPrefix(summary: string): { binary: string | null; rest: string } {
  const match = summary.match(/^\[([^\]]+)\]\s*(.*)$/)
  if (match) return { binary: match[1], rest: match[2] }
  return { binary: null, rest: summary }
}

/** Compute the (summaryTool, summaryCmd, summary) tuple for a Claude Code event. */
function computeSlots(
  hookName: string,
  toolName: string | null,
  rawSummary: string,
  payload: Record<string, unknown>,
): { summaryTool?: string; summaryCmd?: string; summary: string } {
  const isTool =
    hookName === 'PreToolUse' || hookName === 'PostToolUse' || hookName === 'PostToolUseFailure'

  if (isTool && toolName) {
    const { binary, rest } = parseBinaryPrefix(rawSummary)
    const displayTool = toolName.startsWith('mcp__') ? 'MCP' : toolName
    return {
      summaryTool: displayTool,
      // For MCP tools, the full tool name shows in the gray slot. For
      // shell tools, the parsed binary (e.g. "git", "npm") shows there.
      summaryCmd: toolName.startsWith('mcp__') ? toolName : (binary ?? undefined),
      summary: rest,
    }
  }

  if (hookName === 'UserPromptExpansion') {
    const expansionType = (payload as Record<string, unknown>).expansion_type
    if (typeof expansionType === 'string' && expansionType) {
      return { summaryTool: expansionType, summary: rawSummary }
    }
  }

  return { summary: rawSummary }
}

/**
 * Claude Code processEvent implementation.
 */
export function processEvent(
  raw: RawEvent,
  ctx: ProcessingContext,
): { event: ClaudeCodeEnrichedEvent } {
  const p = raw.payload as Record<string, any>
  const hookName = raw.hookName
  const toolName = deriveToolName(raw)
  const toolUseId: string | null = typeof p.tool_use_id === 'string' ? p.tool_use_id : null

  // ---- Subagent-pairing (PreToolUse:Agent → PostToolUse:Agent) ---------
  if (hookName === 'PreToolUse' && toolName === 'Agent' && toolUseId) {
    const inputName = typeof p.tool_input?.name === 'string' ? (p.tool_input.name as string) : null
    const inputDesc =
      typeof p.tool_input?.description === 'string' ? (p.tool_input.description as string) : null
    if (inputName !== null || inputDesc !== null) {
      ctx.stashPendingAgentMeta(toolUseId, { name: inputName, description: inputDesc })
    }
  }
  if (hookName === 'SubagentStart') {
    const agentType = typeof p.agent_type === 'string' ? (p.agent_type as string) : null
    const agentName = typeof p.name === 'string' ? (p.name as string) : null
    const patch = diffAgentPatch(ctx.getAgent(raw.agentId), {
      name: agentName,
      agent_type: agentType,
    })
    if (patch) agentPatchDebouncer.schedule(raw.agentId, patch)
  }
  if (hookName === 'PostToolUse' && toolName === 'Agent' && toolUseId) {
    const spawnedAgentId =
      typeof p.tool_response?.agentId === 'string' ? (p.tool_response.agentId as string) : null
    if (spawnedAgentId) {
      const meta = ctx.consumePendingAgentMeta(toolUseId)
      if (meta && (meta.name || meta.description)) {
        const patch = diffAgentPatch(ctx.getAgent(spawnedAgentId), {
          name: meta.name,
          description: meta.description,
        })
        if (patch) agentPatchDebouncer.schedule(spawnedAgentId, patch)
      }
    }
  }

  // Resolve icon and color
  const icon = getEventIcon(hookName, toolName)
  const { iconColor, dotColor, customHex } = getEventColor(hookName, toolName)
  const dedup = ctx.dedupEnabled

  // Turn tracking (only when dedup is on)
  let turnId: string | null = null
  if (dedup) {
    turnId = ctx.getCurrentTurn(raw.agentId)
    if (hookName === 'UserPromptSubmit' || hookName === 'SubagentStart') {
      turnId = `turn-${raw.id}`
      ctx.setCurrentTurn(raw.agentId, turnId)
    } else if (
      hookName === 'Stop' ||
      hookName === 'SessionEnd' ||
      hookName === 'SubagentStop' ||
      hookName === 'stop_hook_summary'
    ) {
      ctx.clearCurrentTurn(raw.agentId)
    }
  }

  // Group ID, display flags, status override (only when dedup is on)
  let groupId: string | null = null
  let displayEventStream = true
  let displayTimeline = true
  let statusOverride: ClaudeCodeEnrichedEvent['status'] | null = null

  if (dedup) {
    // Task grouping
    const taskId = (p.task_id ?? p.tool_input?.taskId ?? p.tool_response?.taskId) as
      | string
      | undefined
    if (taskId) {
      groupId = `task-${taskId}`
    }

    if (hookName === 'TaskCreated') {
      statusOverride = 'pending'
    } else if (hookName === 'TaskCompleted') {
      const grouped = groupId ? ctx.getGroupedEvents(groupId) : []
      const createdEvent = grouped.find((e) => e.hookName === 'TaskCreated')
      if (createdEvent) {
        displayEventStream = false
        displayTimeline = false
        ctx.updateEvent(createdEvent.id, { status: 'completed' })
      }
    }

    if (toolName === 'TaskCreate') {
      displayEventStream = false
      displayTimeline = false
    }

    if (toolName === 'TaskUpdate') {
      const updateTaskId = p.tool_input?.taskId as string | undefined
      if (updateTaskId) {
        groupId = `task-${updateTaskId}`
        displayEventStream = false
        displayTimeline = false

        const grouped = ctx.getGroupedEvents(groupId)
        const createdEvent = grouped.find((e) => e.hookName === 'TaskCreated')
        if (createdEvent) {
          const newStatus = p.tool_input?.status as string | undefined
          if (newStatus === 'completed') {
            ctx.updateEvent(createdEvent.id, { status: 'completed' })
          } else if (newStatus === 'in_progress') {
            ctx.updateEvent(createdEvent.id, { status: 'running' })
          }
        }
      }
    }

    if (hookName === 'PreToolUse' && toolUseId) {
      if (!groupId) groupId = toolUseId
    } else if ((hookName === 'PostToolUse' || hookName === 'PostToolUseFailure') && toolUseId) {
      if (!groupId) groupId = toolUseId

      const grouped = ctx.getGroupedEvents(groupId)
      const preEvent = grouped.find((e) => e.hookName === 'PreToolUse')
      if (preEvent) {
        displayEventStream = false
        displayTimeline = false

        const newStatus = hookName === 'PostToolUseFailure' ? 'failed' : 'completed'
        const resultText = extractResultText(p.tool_response)
        ctx.updateEvent(preEvent.id, {
          status: newStatus,
          searchText: preEvent.searchText + ' ' + (resultText?.toLowerCase() ?? ''),
        })
      }
    }

    // Compact pairing
    if (hookName === 'PreCompact') {
      groupId = `compact-${raw.id}`
      ctx.setPendingGroup(`compact:${raw.agentId}`, groupId)
    } else if (hookName === 'PostCompact') {
      const pending = ctx.getPendingGroup(`compact:${raw.agentId}`)
      if (pending) {
        groupId = pending
        ctx.clearPendingGroup(`compact:${raw.agentId}`)

        const grouped = ctx.getGroupedEvents(groupId)
        const preEvent = grouped.find((e) => e.hookName === 'PreCompact')
        if (preEvent) {
          displayEventStream = false
          displayTimeline = false

          const summaryText =
            typeof p.compact_summary === 'string' ? p.compact_summary.toLowerCase() : ''
          ctx.updateEvent(preEvent.id, {
            status: 'completed',
            payload: { ...preEvent.payload, ...p },
            summary: 'Compacted context',
            searchText: preEvent.searchText + (summaryText ? ' ' + summaryText : ''),
          })
        }
      }
    }
  }

  // Build the enriched event
  const rawSummary = getEventSummary(raw, hookName, toolName)
  const slots = computeSlots(hookName, toolName, rawSummary, raw.payload)

  const enriched: ClaudeCodeEnrichedEvent = {
    // Identity
    id: raw.id,
    agentId: raw.agentId,
    hookName,
    timestamp: raw.timestamp,

    // Per-class enrichment
    toolName,
    groupId,
    turnId,
    displayEventStream,
    displayTimeline,
    label: LABELS[hookName] || hookName || 'Event',
    labelTooltip: hookName,
    icon,
    iconColor,
    dotColor,
    iconColorHex: customHex ?? null,
    dedupMode: dedup,
    status: statusOverride ?? deriveLocalStatus(hookName),
    filterTags: getFilterTags(hookName, toolName, displayEventStream),
    searchText: buildSearchText(raw, slots.summary, toolName),
    summary: slots.summary,

    // Original payload
    payload: raw.payload,

    // Claude-specific fields (optional — only set when payload carries them)
    ...(toolUseId !== null ? { toolUseId } : {}),
    ...(typeof p.cwd === 'string' ? { cwd: p.cwd as string } : {}),

    // Summary slots (optional — set by computeSlots when applicable)
    ...(slots.summaryTool !== undefined ? { summaryTool: slots.summaryTool } : {}),
    ...(slots.summaryCmd !== undefined ? { summaryCmd: slots.summaryCmd } : {}),
  }

  return { event: enriched }
}

/** Extract display text from a tool_response for search indexing */
function extractResultText(toolResponse: any): string | null {
  if (!toolResponse) return null
  if (typeof toolResponse === 'string') return toolResponse
  if (toolResponse.stdout) return toolResponse.stdout
  if (Array.isArray(toolResponse.content)) {
    return toolResponse.content
      .map((r: any) => (r?.type === 'text' && r?.text ? r.text : ''))
      .filter(Boolean)
      .join(' ')
  }
  if (typeof toolResponse.content === 'string') return toolResponse.content
  return null
}
```

**Key changes:**
- Imports `ClaudeCodeEnrichedEvent` from the new `./types` file.
- Drops `deriveSubtype` import; uses `raw.hookName` directly.
- `cwd` is read from `payload.cwd` only (no longer falls back to `raw.cwd`, which is now a typed-as-optional wire field reserved for future server-side auditing per the user's note).
- Drops `type`, `subtype`, `createdAt`, `sessionId` writes.
- `labelTooltip` set to `hookName` so the row-row tooltip shows the canonical hook name.
- Adds `computeSlots` helper that produces `summaryTool` / `summaryCmd` / `summary` from the raw summary string + payload. The row-summary component just renders these.
- `buildSearchText` no longer takes the `subtype` / `type` args.

- [ ] **Step 4: Update `event-detail.tsx` line 1105 again**

The earlier Task 7 step changed line 1105 to call `getEventSummary(event as any, event.hookName, event.toolName)`. Since `getEventSummary` is the unchanged claude-code helper that takes `(event, hookName, toolName)`, no further change needed. Verify by re-reading line 1105 after Task 7.

If a subagent is implementing in linear order: this step is informational. Re-read the file and confirm the call site compiles.

- [ ] **Step 5: Run typecheck**

Run: `just typecheck`
Expected: errors only in (a) `claude-code/index.ts` (registration still references `deriveSubtype`), (b) `claude-code/row-summary.tsx` (still reads `subtype`), (c) `default/index.tsx`, (d) `codex/index.tsx`, (e) `event-row.tsx`. Those are the next tasks.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/agents/claude-code/process-event.ts \
        app/client/src/agents/claude-code/derivers.ts \
        app/client/src/agents/claude-code/helpers.ts
git commit -m "refactor(claude-code): processEvent returns ClaudeCodeEnrichedEvent with summary slots"
```

---

### Task 9: Update claude-code registration

**Files:**
- Modify: `app/client/src/agents/claude-code/index.ts`

- [ ] **Step 1: Drop `deriveSubtype`, type the registration generic, switch icon/color resolvers**

Replace `app/client/src/agents/claude-code/index.ts` with:

```typescript
// Claude Code agent class registration.
// Registers processEvent, rendering components, and metadata with the AgentRegistry.

import { Bot } from 'lucide-react'
import { AgentRegistry } from '../registry'
import type { AgentClassRegistration } from '../types'
import type { ClaudeCodeEnrichedEvent } from './types'
import { processEvent } from './process-event'
import { getEventIcon, getEventColor } from './icons'
import { ClaudeCodeRowSummary } from './row-summary'
import { ClaudeCodeEventDetail } from './event-detail'
import { ClaudeCodeDotTooltip } from './dot-tooltip'
import { deriveToolName, deriveStatus } from './derivers'

const registration: AgentClassRegistration<ClaudeCodeEnrichedEvent> = {
  agentClass: 'claude-code',
  displayName: 'claude',
  Icon: Bot,
  processEvent,
  deriveToolName,
  deriveStatus,
  getEventIcon: (event) => getEventIcon(event.hookName, event.toolName),
  getEventColor: (event) => getEventColor(event.hookName, event.toolName),
  RowSummary: ClaudeCodeRowSummary,
  EventDetail: ClaudeCodeEventDetail,
  DotTooltip: ClaudeCodeDotTooltip,
}

AgentRegistry.register(registration)
```

- [ ] **Step 2: Commit**

```bash
git add app/client/src/agents/claude-code/index.ts
git commit -m "refactor(claude-code): type registration as AgentClassRegistration<ClaudeCodeEnrichedEvent>"
```

---

### Task 10: Update default + codex agents

**Files:**
- Modify: `app/client/src/agents/default/index.tsx`
- Modify: `app/client/src/agents/codex/index.tsx`

- [ ] **Step 1: Rewrite `default/index.tsx`**

Replace the entire file with:

```typescript
// Default agent class — fallback for unknown agent types.
// Shows raw JSON payload and uses generic icons.

import { CircleDot } from 'lucide-react'
import { AgentRegistry } from '../registry'
import type {
  RawEvent,
  EnrichedEvent,
  EventStatus,
  ProcessingContext,
  FrameworkDataApi,
} from '../types'

/** Default tool-name derivation: read `payload.tool_name` if present. */
function deriveToolName(event: RawEvent): string | null {
  const p = event.payload as Record<string, unknown> | undefined
  const tn = p?.tool_name
  return typeof tn === 'string' ? tn : null
}

/** Default status: no per-class derivation. */
function deriveStatus(_event: RawEvent, _grouped: RawEvent[]): EventStatus | null {
  return null
}

export function processEvent(raw: RawEvent, ctx: ProcessingContext): { event: EnrichedEvent } {
  const turnId = ctx.getCurrentTurn(raw.agentId)
  const payloadToolUseId = (raw.payload as Record<string, unknown>).tool_use_id
  const toolUseId = typeof payloadToolUseId === 'string' ? payloadToolUseId : null

  const toolName = deriveToolName(raw)
  const hookName = raw.hookName

  const enriched: EnrichedEvent = {
    id: raw.id,
    agentId: raw.agentId,
    hookName,
    timestamp: raw.timestamp,
    toolName,
    groupId: toolUseId,
    turnId,
    displayEventStream: true,
    displayTimeline: true,
    label: hookName || 'Event',
    labelTooltip: hookName,
    icon: null,
    iconColor: 'text-muted-foreground',
    dedupMode: ctx.dedupEnabled,
    dotColor: 'bg-muted-foreground',
    iconColorHex: null,
    status: 'completed',
    filterTags: { static: null, dynamic: toolName ? [toolName] : [] },
    searchText: [hookName, toolName, JSON.stringify(raw.payload)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .slice(0, 500),
    payload: raw.payload,
    summary: hookName || '',
  }

  return { event: enriched }
}

export function DefaultRowSummary({ event }: { event: EnrichedEvent; dataApi: FrameworkDataApi }) {
  return (
    <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{event.summary}</span>
  )
}

export function DefaultEventDetail({ event }: { event: EnrichedEvent; dataApi: FrameworkDataApi }) {
  return (
    <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed max-h-60 overflow-y-auto">
      {JSON.stringify(event.payload, null, 2)}
    </pre>
  )
}

export function DefaultDotTooltip({ event }: { event: EnrichedEvent }) {
  return (
    <div>
      <div className="font-medium">{event.label}</div>
      {event.toolName && <div className="opacity-70">{event.toolName}</div>}
    </div>
  )
}

AgentRegistry.registerDefault({
  agentClass: 'default',
  displayName: 'unknown',
  Icon: CircleDot,
  processEvent,
  deriveToolName,
  deriveStatus,
  getEventIcon: () => CircleDot,
  getEventColor: () => ({
    iconColor: 'text-muted-foreground',
    dotColor: 'bg-muted-foreground',
  }),
  RowSummary: DefaultRowSummary,
  EventDetail: DefaultEventDetail,
  DotTooltip: DefaultDotTooltip,
})
```

**Changes:** drops `deriveSubtype`, drops `type / subtype / createdAt / sessionId / toolUseId / iconColorHex` (the latter two were already absent or null), reads `hookName` directly.

- [ ] **Step 2: Rewrite `codex/index.tsx`**

Replace the entire file with:

```typescript
// Codex agent class registration. Reuses the default renderer (generic JSON
// payload) but surfaces a Codex-branded icon + display name for UI hints.

import { Terminal } from 'lucide-react'
import { AgentRegistry } from '../registry'
import {
  processEvent,
  DefaultRowSummary,
  DefaultEventDetail,
  DefaultDotTooltip,
} from '../default/index'
import type { RawEvent, EventStatus } from '../types'
import { parseTranscriptEvent } from './parse-transcript'

/** Codex tool-name derivation: prefer the transcript-format parser; if
 *  the payload carries a Claude-Code-style `tool_name`, surface that. */
function deriveToolName(event: RawEvent): string | null {
  const fromTranscript = parseTranscriptEvent(event.payload).toolName
  if (fromTranscript) return fromTranscript
  const p = event.payload as Record<string, unknown> | undefined
  const tn = p?.tool_name
  return typeof tn === 'string' ? tn : null
}

/** Codex status derivation. Mirrors Claude's Pre/Post pattern when the
 *  payload uses hook-shaped events; transcript-only events have no
 *  inherent pre/post pairing so we return null (callers default to
 *  'completed'). */
function deriveStatus(event: RawEvent, grouped: RawEvent[]): EventStatus | null {
  if (event.hookName === 'PreToolUse') {
    const post = grouped.find(
      (e) => e.hookName === 'PostToolUse' || e.hookName === 'PostToolUseFailure',
    )
    if (!post) return 'running'
    return post.hookName === 'PostToolUseFailure' ? 'failed' : 'completed'
  }
  return null
}

AgentRegistry.register({
  agentClass: 'codex',
  displayName: 'codex',
  Icon: Terminal,
  processEvent,
  deriveToolName,
  deriveStatus,
  getEventIcon: () => Terminal,
  getEventColor: () => ({
    iconColor: 'text-muted-foreground',
    dotColor: 'bg-muted-foreground',
  }),
  RowSummary: DefaultRowSummary,
  EventDetail: DefaultEventDetail,
  DotTooltip: DefaultDotTooltip,
})
```

**Changes:** drops `deriveSubtype`. The transcript-format `subtype` parsing still happens inside `parseTranscriptEvent` for codex's own internal use (e.g., `parse-transcript.ts` may reference it), but it's no longer surfaced as a framework field.

- [ ] **Step 3: Run typecheck**

Run: `just typecheck`
Expected: errors only in `row-summary.tsx` (next task) and `event-row.tsx` (after that).

- [ ] **Step 4: Commit**

```bash
git add app/client/src/agents/default/index.tsx app/client/src/agents/codex/index.tsx
git commit -m "refactor(default+codex): drop deriveSubtype + legacy event fields"
```

---

## Phase 4: Rendering

### Task 11: Refactor `claude-code/row-summary.tsx` to slot rendering

**Files:**
- Modify: `app/client/src/agents/claude-code/row-summary.tsx`

- [ ] **Step 1: Replace the file**

Replace `app/client/src/agents/claude-code/row-summary.tsx` with:

```typescript
// Claude Code agent class — row summary component.
// Renders the agent-owned section of the row. All per-hookName decisions
// (what goes in each slot, status pills, etc.) live in `processEvent`.
// This component is a dumb renderer for the slot fields.

import { computeRuntimeMs, formatRuntime } from './runtime'
import type { FrameworkDataApi } from '../types'
import type { ClaudeCodeEnrichedEvent } from './types'

interface Props {
  event: ClaudeCodeEnrichedEvent
  dataApi: FrameworkDataApi
}

const STOP_HOOKS = new Set(['Stop', 'stop_hook_summary', 'SubagentStop'])

export function ClaudeCodeRowSummary({ event, dataApi }: Props) {
  // For Stop / SubagentStop events, compute runtime from the matching
  // start in the same turn and render it as a trailing muted pill.
  let runtimeLabel: string | null = null
  if (STOP_HOOKS.has(event.hookName) && event.turnId) {
    const turnEvents = dataApi.getTurnEvents(event.turnId)
    const ms = computeRuntimeMs(event, null, turnEvents)
    if (ms != null) runtimeLabel = formatRuntime(ms)
  }

  const summary = event.summary
  const summaryHasNewline = summary.includes('\n')

  return (
    <>
      {/* Show hook name when dedup is off so you know exactly what this event is */}
      {!event.dedupMode && (
        <span className="text-[10px] text-muted-foreground/40 shrink-0">{event.hookName}</span>
      )}
      {/* Slot 1: colored "tool" slot — uses iconColor from the enriched event */}
      {event.summaryTool && (
        <span
          className={`text-xs font-medium shrink-0 ${event.iconColor || 'text-blue-700 dark:text-blue-400'}`}
        >
          {event.summaryTool}
        </span>
      )}
      {/* Slot 2: gray "cmd" slot */}
      {event.summaryCmd && (
        <span className="text-[10px] text-muted-foreground/50 shrink-0">{event.summaryCmd}</span>
      )}
      {/* Summary text */}
      {summaryHasNewline ? (
        <div className="text-xs text-muted-foreground flex-1 min-w-0">
          {summary.split('\n').map((line, i) => (
            <div key={i} className="truncate">
              {line}
            </div>
          ))}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{summary}</span>
      )}
      {runtimeLabel && (
        <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">
          {runtimeLabel}
        </span>
      )}
    </>
  )
}
```

**What's gone:**
- `parseBinaryPrefix` helper (moved into `processEvent`'s `computeSlots`)
- The `isTool` switch
- The `UserPromptExpansion` switch
- The MCP-prefix logic for the second slot
- The `getEventColor(...)` call at render time — `event.iconColor` is already populated by `processEvent`

**What this proves about the pattern:** the row component now contains zero `if (event.hookName === ...)` branches. Every per-event-type decision is in `processEvent`'s `computeSlots`.

- [ ] **Step 2: Run typecheck**

Run: `just typecheck`
Expected: zero errors in `row-summary.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/agents/claude-code/row-summary.tsx
git commit -m "refactor(claude-code): row-summary becomes a slot renderer"
```

---

### Task 12: Update `event-row.tsx` to use `labelTooltip`

**Files:**
- Modify: `app/client/src/components/event-stream/event-row.tsx`

- [ ] **Step 1: Replace the two `event.subtype || event.type` references with `event.labelTooltip ?? event.hookName`**

In `app/client/src/components/event-stream/event-row.tsx`, line 118:

```typescript
title={event.subtype || event.type}
```

becomes:

```typescript
title={event.labelTooltip ?? event.hookName}
```

Same change at line 126.

- [ ] **Step 2: Run typecheck**

Run: `just typecheck`
Expected: PASS — no remaining errors. The whole tree compiles.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/event-stream/event-row.tsx
git commit -m "refactor(event-row): use labelTooltip + hookName for icon/label tooltip"
```

---

## Phase 5: Cleanup

### Task 13: Simplify `event-summary.ts` wrapper

**Files:**
- Modify: `app/client/src/lib/event-summary.ts`

- [ ] **Step 1: Drop the `deriveSubtype` import (it no longer exists) and pass `hookName` directly**

Replace the file with:

```typescript
// Convenience wrapper around the claude-code summary builder. Used by
// the timeline dot tooltip and tests where the caller has only a bare
// `ParsedEvent`. Derives toolName itself; subtype is no longer a thing
// — claude-code reads hookName directly.

import type { ParsedEvent } from '@/types'
import { getEventSummary as buildSummary } from '@/agents/claude-code/helpers'
import { deriveToolName } from '@/agents/claude-code/derivers'

export function getEventSummary(event: ParsedEvent): string {
  return buildSummary(event, event.hookName, deriveToolName(event))
}
```

- [ ] **Step 2: Verify `helpers.ts` `getEventSummary` accepts `(event, hookName, toolName)`**

The existing signature in `app/client/src/agents/claude-code/helpers.ts:69` takes `(event, subtype, toolName)`. The behavior is identical regardless of name — the function uses the second argument as a string key. Rename the parameter from `subtype` to `hookName` for clarity:

Run: `grep -n "subtype" app/client/src/agents/claude-code/helpers.ts`

For each `subtype` parameter in `getEventSummary`, rename to `hookName`. Update internal references the same way.

- [ ] **Step 3: Run unit tests**

Run: `pnpm --filter client vitest run src/lib/event-summary.test.ts`
Expected: PASS (the test fixtures pass `ParsedEvent` instances; the wrapper handles derivation).

- [ ] **Step 4: Commit**

```bash
git add app/client/src/lib/event-summary.ts app/client/src/agents/claude-code/helpers.ts
git commit -m "refactor(claude-code): rename subtype param to hookName in helpers"
```

---

### Task 14: Update `runtime.test.ts` fixtures if needed

**Files:**
- Modify: `app/client/src/agents/claude-code/runtime.test.ts`

- [ ] **Step 1: Audit the test fixtures**

Run: `grep -n "subtype\|createdAt" app/client/src/agents/claude-code/runtime.test.ts`

For each match: if a fixture builds a fake `EnrichedEvent` with a `subtype` field, replace `subtype` with `hookName` (and remove `createdAt` if present). The runtime functions read `event.hookName` after Task 7.

If the file builds events using a helper that already constructs an enriched event, audit that helper instead.

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter client vitest run src/agents/claude-code/runtime.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit (if changes were made)**

```bash
git add app/client/src/agents/claude-code/runtime.test.ts
git commit -m "test(claude-code): update runtime fixtures to use hookName"
```

If no changes were needed (fixtures were already hookName-shaped), skip the commit.

---

### Task 15: Final verification — `just check`

- [ ] **Step 1: Run the full check**

Run: `just check`
Expected: PASS — all tests, lint, formatting, typecheck.

- [ ] **Step 2: Visual smoke test in dev mode**

Start the dev server:

```bash
just dev
```

Open the dashboard (default `http://localhost:5175` for this worktree per `.env`).

Verify:
- Sessions render with events.
- Tool events show the tool name in color + parsed binary in gray.
- UserPromptExpansion events show the expansion type in the colored slot.
- Hover the icon and label — tooltip shows the canonical `hookName`.
- Filter pills (Errors, Config, Tools, etc.) still work.
- Timeline dots render with their tooltips.
- Expand an event — the detail pane renders correctly for at least one of each: PreToolUse, UserPromptSubmit, Stop, SessionStart, ConfigChange.

Stop the dev server.

- [ ] **Step 3: Final commit (cleanup of any leftover stale comments)**

Search the codebase for stale references to the old fields:

Run: `grep -rn "subtype" app/client/src/agents/types.ts app/client/src/agents/claude-code/`
Expected: only references in `event-detail.tsx` thread-event helpers (if those still exist), `parse-transcript.ts` (codex transcript shape — internal, fine), and possibly internal local variables. No `EnrichedEvent.subtype` references.

Run: `grep -rn "createdAt" app/client/src/agents/`
Expected: zero matches.

Run: `grep -rn "EnrichedEvent\['subtype'\]\|EnrichedEvent\['type'\]\|EnrichedEvent\['createdAt'\]" app/client/src/`
Expected: zero matches.

If any lingering stale comments mention "type/subtype are legacy" or "kept for filters", remove them.

```bash
git add -A
git commit -m "chore: drop stale subtype/type/createdAt references"
```

---

## Self-Review Checklist (run before merging)

- [ ] Server `/events` default response is the 5-key minimum (`id, agentId, hookName, timestamp, payload`).
- [ ] `?fields=sessionId,cwd,createdAt,_meta` returns the opt-in fields.
- [ ] `EnrichedEvent` base type has no `subtype`, `type`, `createdAt`, `sessionId`, `toolUseId`, or index signature.
- [ ] `EnrichedEvent` base has `labelTooltip: string | null` and `summary: string`.
- [ ] `ClaudeCodeEnrichedEvent` adds exactly four fields: `toolUseId`, `cwd`, `summaryTool?`, `summaryCmd?`. No `subtype` field.
- [ ] `default/index.tsx` and `codex/index.tsx` return base `EnrichedEvent` (no per-class extension).
- [ ] No `event.subtype` reads remain in `event-stream/event-row.tsx`, `claude-code/row-summary.tsx`, `claude-code/dot-tooltip.tsx`, `claude-code/runtime.ts`.
- [ ] `claude-code/event-detail.tsx` uses `event.hookName` everywhere it used `event.subtype`.
- [ ] `claude-code/row-summary.tsx` is a slot renderer — no `if (event.hookName === ...)` branches.
- [ ] `AgentClassRegistration<TEvent>` is generic; claude-code's registration is typed against `ClaudeCodeEnrichedEvent`.
- [ ] `AgentRegistry.get(...)` returns the erased `AgentClassRegistration<EnrichedEvent>`; the cast lives in the registry.
- [ ] `just check` passes.
- [ ] Visual smoke test passes (rows render, tooltips show hookName, filters work).
