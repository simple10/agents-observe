# Simplify Agent State — Server as Dumb Store, UI Derives State

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move agent state management entirely to the UI. The server stores agent metadata only (id, name, type, parentage). The UI derives status, event counts, and timing from the events stream.

**Architecture:** Strip all agent lifecycle/status logic from the server events route. Remove `agent_update` WS broadcasts — the client only receives `event` messages for session data. The client detects new agents from event `agentId` fields, adds them to a local map, and fetches metadata from the server on demand. Agent `status`, `eventCount`, `startedAt`, and `stoppedAt` are all computed client-side from the events array. Clean up DB schema with `created_at`/`updated_at` on all tables. **Breaking change — requires `just db-reset`.**

**Tech Stack:** TypeScript, React, React Query, Zustand, SQLite (better-sqlite3), Hono, Vitest

---

### File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `app/server/src/storage/sqlite-adapter.ts` | Modify | Strip agent status/timing columns, add created_at/updated_at to agents/projects/sessions, simplify upsertAgent |
| `app/server/src/storage/types.ts` | Modify | Update EventStore interface — remove updateAgentStatus, simplify upsertAgent signature |
| `app/server/src/types.ts` | Modify | Strip status/timing from Agent type, remove agent_update from WSMessage, remove AgentRow status fields |
| `app/server/src/routes/events.ts` | Modify | Remove all agent_update broadcasts, remove agent status logic (stop/reactivate), keep agent upsert for metadata (name, parentage, type) |
| `app/server/src/routes/agents.ts` | Modify | Add GET single agent endpoint, simplify metadata response |
| `app/server/src/routes/sessions.ts` | Modify | Remove agent status correction logic, simplify agents response |
| `app/client/src/types/index.ts` | Modify | Split Agent into ServerAgent (from API) and Agent (with derived fields). Remove agent_update from WSMessage. |
| `app/client/src/hooks/use-websocket.ts` | Modify | Remove agent_update handler, remove eventCount increment. Just append events. |
| `app/client/src/hooks/use-agents.ts` | Modify | Rewrite — derive agent state from events, fetch metadata on demand for unknown agents |
| `app/client/src/lib/api-client.ts` | Modify | Add getAgent (single), update getAgents return type |
| `app/client/src/components/event-stream/event-stream.tsx` | Modify | Remove agent type patching effect, use new agent hook |
| `app/client/src/components/main-panel/agent-combobox.tsx` | Modify | Use derived agent state |
| `app/client/src/components/timeline/activity-timeline.tsx` | Modify | Use derived agent state |
| `app/client/src/lib/agent-utils.ts` | Modify | Update buildAgentColorMap for new Agent type |

---

### Task 1: Rewrite DB schema and simplify agent storage

**Files:**
- Modify: `app/server/src/storage/sqlite-adapter.ts`
- Modify: `app/server/src/storage/types.ts`

**Breaking change — requires `just db-reset` after this task.**

No migrations. Rewrite the CREATE TABLE statements cleanly. Agents table loses `status`, `started_at`, `stopped_at` and gains `created_at`, `updated_at`. Projects and sessions gain `updated_at`. All tables get clean schemas from scratch.

- [ ] **Step 1: Rewrite CREATE TABLE statements**

Replace the four CREATE TABLE blocks in the constructor with:

```typescript
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        transcript_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        slug TEXT,
        status TEXT DEFAULT 'active',
        started_at INTEGER NOT NULL,
        stopped_at INTEGER,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_agent_id TEXT,
        slug TEXT,
        name TEXT,
        agent_type TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (parent_agent_id) REFERENCES agents(id)
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        subtype TEXT,
        tool_name TEXT,
        summary TEXT,
        timestamp INTEGER NOT NULL,
        payload TEXT NOT NULL,
        tool_use_id TEXT,
        status TEXT DEFAULT 'pending',
        FOREIGN KEY (agent_id) REFERENCES agents(id),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)
```

- [ ] **Step 2: Remove all ALTER TABLE migration code**

Delete the `table_info` checks and ALTER TABLE statements for events (tool_use_id, status columns). These are now in the CREATE TABLE directly.

- [ ] **Step 3: Simplify upsertAgent — metadata only**

Replace the `upsertAgent` method:

```typescript
  async upsertAgent(
    id: string,
    sessionId: string,
    parentAgentId: string | null,
    slug: string | null,
    name: string | null,
    agentType?: string | null,
  ): Promise<void> {
    const now = Date.now()
    this.db
      .prepare(
        `
      INSERT INTO agents (id, session_id, parent_agent_id, slug, name, agent_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        slug = COALESCE(excluded.slug, agents.slug),
        name = COALESCE(excluded.name, agents.name),
        agent_type = COALESCE(excluded.agent_type, agents.agent_type),
        updated_at = ?
    `,
      )
      .run(id, sessionId, parentAgentId, slug, name, agentType ?? null, now, now, now)
  }
```

- [ ] **Step 4: Remove updateAgentStatus entirely**

Delete the `updateAgentStatus` method.

- [ ] **Step 5: Simplify getAgentsForSession — no event count JOIN**

```typescript
  async getAgentsForSession(sessionId: string): Promise<any[]> {
    return this.db
      .prepare('SELECT * FROM agents WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId)
  }
```

- [ ] **Step 6: Update updateAgentSlug and updateAgentType to set updated_at**

```typescript
  async updateAgentSlug(agentId: string, slug: string): Promise<void> {
    this.db.prepare('UPDATE agents SET slug = ?, updated_at = ? WHERE id = ?').run(slug, Date.now(), agentId)
  }

  async updateAgentType(id: string, agentType: string): Promise<void> {
    this.db.prepare('UPDATE agents SET agent_type = ?, updated_at = ? WHERE id = ?').run(agentType, Date.now(), id)
  }
```

- [ ] **Step 7: Update upsertSession to set created_at/updated_at**

```typescript
  async upsertSession(
    id: string,
    projectId: number,
    slug: string | null,
    metadata: Record<string, unknown> | null,
    timestamp: number,
  ): Promise<void> {
    const now = Date.now()
    this.db
      .prepare(
        `
      INSERT INTO sessions (id, project_id, slug, status, started_at, metadata, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        slug = COALESCE(excluded.slug, sessions.slug),
        metadata = COALESCE(excluded.metadata, sessions.metadata),
        updated_at = ?
    `,
      )
      .run(id, projectId, slug, timestamp, metadata ? JSON.stringify(metadata) : null, now, now, now)
  }
```

- [ ] **Step 8: Update createProject and updateProjectName to set updated_at**

```typescript
  async createProject(slug: string, name: string, transcriptPath: string | null): Promise<number> {
    const now = Date.now()
    const result = this.db
      .prepare('INSERT INTO projects (slug, name, transcript_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(slug, name, transcriptPath, now, now)
    return result.lastInsertRowid as number
  }

  async updateProjectName(projectId: number, name: string): Promise<void> {
    this.db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), projectId)
  }
```

- [ ] **Step 9: Update EventStore interface in types.ts**

Remove `updateAgentStatus` from the interface. Update `upsertAgent` signature:

```typescript
  upsertAgent(
    id: string,
    sessionId: string,
    parentAgentId: string | null,
    slug: string | null,
    name: string | null,
    agentType?: string | null,
  ): Promise<void>
```

- [ ] **Step 10: Verify server compiles**

Run: `cd app/server && npx tsc --noEmit`
Expected: Errors in events.ts, sessions.ts (they still call updateAgentStatus and pass timestamp to upsertAgent) — fixed in next task.

- [ ] **Step 11: Commit**

```bash
git add app/server/src/storage/sqlite-adapter.ts app/server/src/storage/types.ts
git commit -m "refactor: clean DB schema — agents metadata only, add created_at/updated_at to all tables

BREAKING CHANGE: requires db-reset (just db-reset)"
```

---

### Task 2: Strip agent lifecycle logic from server events route

**Files:**
- Modify: `app/server/src/routes/events.ts`
- Modify: `app/server/src/types.ts`

Remove all agent_update broadcasts, all updateAgentStatus calls, the getAgentForBroadcast helper, and the stop/reactivate logic for agents. Keep session status logic and the agent upsert for metadata.

- [ ] **Step 1: Update WSMessage in types.ts — remove agent_update**

```typescript
export type WSMessage =
  | { type: 'event'; data: ParsedEvent }
  | { type: 'session_update'; data: Session }
  | { type: 'project_update'; data: { id: number; name: string } }
```

Simplify the `Agent` interface to metadata only:

```typescript
export interface Agent {
  id: string
  sessionId: string
  parentAgentId: string | null
  slug: string | null
  name: string | null
  agentType?: string | null
}
```

- [ ] **Step 2: Remove getAgentForBroadcast from events.ts**

Delete the entire `getAgentForBroadcast` function.

- [ ] **Step 3: Simplify ensureRootAgent — remove timestamp param**

```typescript
async function ensureRootAgent(
  store: EventStore,
  sessionId: string,
  slug: string | null,
): Promise<string> {
  let rootId = sessionRootAgents.get(sessionId)
  if (!rootId) {
    rootId = sessionId
    await store.upsertAgent(rootId, sessionId, null, slug, null)
    sessionRootAgents.set(sessionId, rootId)
  }
  return rootId
}
```

Update call site:
```typescript
    const rootAgentId = await ensureRootAgent(store, parsed.sessionId, parsed.slug)
```

Remove the `rootAgentCreated` broadcast block.

- [ ] **Step 4: Update ownerAgentId upsert — remove timestamp and broadcast**

```typescript
      await store.upsertAgent(
        parsed.ownerAgentId,
        parsed.sessionId,
        rootAgentId,
        null,
        pendingName,
      )
```

Remove the `getAgentForBroadcast` + `broadcastToSession` lines after it.

- [ ] **Step 5: Update subAgentId upsert — remove timestamp, keep agentType, remove broadcast**

```typescript
      await store.upsertAgent(
        parsed.subAgentId,
        parsed.sessionId,
        rootAgentId,
        null,
        subAgentName,
        subAgentType,
      )
```

Remove the `getAgentForBroadcast` + `broadcastToSession` lines after it.

- [ ] **Step 6: Replace Stop/SessionEnd/reactivate block with session-only logic**

Replace the entire block (from "Handle stop events" through "reactivate session") with:

```typescript
    // Session lifecycle: SessionEnd stops the session, any other event reactivates a stopped session.
    if (parsed.subtype === 'SessionEnd') {
      await store.updateSessionStatus(parsed.sessionId, 'stopped')
      broadcastToAll({
        type: 'session_update',
        data: { id: parsed.sessionId, status: 'stopped' },
      })
    } else {
      const session = await store.getSessionById(parsed.sessionId)
      if (session && session.status === 'stopped') {
        await store.updateSessionStatus(parsed.sessionId, 'active')
        broadcastToAll({
          type: 'session_update',
          data: { id: parsed.sessionId, status: 'active' },
        })
      }
    }
```

- [ ] **Step 7: Remove SubagentStop and PostToolUse:Agent status blocks**

Delete the "SubagentStop: mark the subagent as stopped" block and the "PostToolUse:Agent completion also marks the subagent as stopped" block entirely. These events are still stored, but the server doesn't act on them for agent status.

- [ ] **Step 8: Verify server compiles**

Run: `cd app/server && npx tsc --noEmit`

- [ ] **Step 9: Fix sessions.ts — remove agent status correction**

In `app/server/src/routes/sessions.ts`, find and remove any code that calls `updateAgentStatus` or corrects agent status on the GET events endpoint.

- [ ] **Step 10: Run server tests and fix**

Run: `cd app/server && npx vitest run`
Fix any tests that reference `updateAgentStatus` or the old `upsertAgent` signature.

- [ ] **Step 11: Commit**

```bash
git add app/server/src/routes/events.ts app/server/src/types.ts app/server/src/routes/sessions.ts
git commit -m "refactor: strip agent lifecycle from server — events only, no status tracking"
```

---

### Task 3: Simplify server agents API

**Files:**
- Modify: `app/server/src/routes/agents.ts`
- Modify: `app/server/src/routes/sessions.ts`

- [ ] **Step 1: Add GET single agent endpoint**

In `app/server/src/routes/agents.ts`, add before the existing GET route:

```typescript
// GET /agents/:id
router.get('/agents/:id', async (c) => {
  const store = c.get('store')
  const agentId = decodeURIComponent(c.req.param('id'))
  const row = await store.getAgentById(agentId)
  if (!row) return c.json({ error: 'Agent not found' }, 404)
  return c.json({
    id: row.id,
    sessionId: row.session_id,
    parentAgentId: row.parent_agent_id,
    slug: row.slug,
    name: row.name,
    agentType: row.agent_type || null,
  })
})
```

Note: this must be placed BEFORE the `/agents/:id/events` route so the path matching works correctly. Actually, Hono matches routes in order, and `/agents/:id` would match before `/agents/:id/events` which is wrong. Place it AFTER `/agents/:id/events` instead, or use a more specific path. Actually, Hono's router is smart about this — `/agents/:id/events` is more specific than `/agents/:id` so it will match first. But to be safe, place `/agents/:id` AFTER `/agents/:id/events`.

- [ ] **Step 2: Simplify GET /sessions/:id/agents response**

In `app/server/src/routes/sessions.ts`, update the agents endpoint:

```typescript
router.get('/sessions/:id/agents', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const rows = await store.getAgentsForSession(sessionId)
  const agents = rows.map((r: any) => ({
    id: r.id,
    sessionId: r.session_id,
    parentAgentId: r.parent_agent_id,
    slug: r.slug,
    name: r.name,
    agentType: r.agent_type || null,
  }))
  return c.json(agents)
})
```

- [ ] **Step 3: Verify server compiles and tests pass**

Run: `cd app/server && npx tsc --noEmit && npx vitest run`

- [ ] **Step 4: Commit**

```bash
git add app/server/src/routes/agents.ts app/server/src/routes/sessions.ts
git commit -m "refactor: simplify agents API — metadata only, add single-agent GET"
```

---

### Task 4: Update client types — ServerAgent + derived Agent

**Files:**
- Modify: `app/client/src/types/index.ts`

- [ ] **Step 1: Replace Agent type and update WSMessage**

```typescript
/** Agent metadata from the server — no derived state */
export interface ServerAgent {
  id: string
  sessionId: string
  parentAgentId: string | null
  slug: string | null
  name: string | null
  agentType?: string | null
}

/** Agent with UI-derived state (computed from events) */
export interface Agent extends ServerAgent {
  status: 'active' | 'stopped'
  eventCount: number
  firstEventAt: number | null
  lastEventAt: number | null
}
```

Update WSMessage — remove agent_update:

```typescript
export type WSMessage =
  | { type: 'event'; data: ParsedEvent }
  | { type: 'session_update'; data: Session }
  | { type: 'project_update'; data: { id: number; name: string } }
```

- [ ] **Step 2: Verify client compiles**

Run: `cd app/client && npx tsc --noEmit`
Expected: Errors in consumers — fixed in later tasks.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/types/index.ts
git commit -m "refactor: split Agent type — ServerAgent (metadata) + Agent (derived state)"
```

---

### Task 5: Rewrite use-agents hook — derive state from events

**Files:**
- Modify: `app/client/src/hooks/use-agents.ts`
- Modify: `app/client/src/lib/api-client.ts`
- Modify: `app/server/src/routes/agents.ts` (if not done in Task 4)

- [ ] **Step 1: Update api-client**

Add `getAgent` for single agent fetch and update return types:

```typescript
import type { Project, Session, RecentSession, ServerAgent, ParsedEvent } from '@/types';

// In the api object:
  getAgents: (sessionId: string) =>
    fetchJson<ServerAgent[]>(`/sessions/${encodeURIComponent(sessionId)}/agents`),
  getAgent: (agentId: string) =>
    fetchJson<ServerAgent>(`/agents/${encodeURIComponent(agentId)}`),
```

- [ ] **Step 2: Rewrite use-agents.ts**

Replace the entire file:

```typescript
import { useMemo, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { Agent, ServerAgent, ParsedEvent } from '@/types'

/**
 * Derives full Agent objects from server metadata + events.
 * Status, eventCount, and timing are computed from events.
 * Detects unknown agents and fetches their metadata on demand.
 */
export function useAgents(sessionId: string | null, events: ParsedEvent[] | undefined): Agent[] {
  const queryClient = useQueryClient()
  const fetchedAgentIds = useRef(new Set<string>())

  const { data: serverAgents } = useQuery({
    queryKey: ['agents', sessionId],
    queryFn: () => api.getAgents(sessionId!),
    enabled: !!sessionId,
  })

  const fetchAgentMetadata = useCallback((agentId: string) => {
    if (fetchedAgentIds.current.has(agentId)) return
    fetchedAgentIds.current.add(agentId)
    api.getAgent(agentId).then((agent) => {
      queryClient.setQueryData<ServerAgent[]>(
        ['agents', sessionId],
        (old) => {
          if (!old) return [agent]
          if (old.some((a) => a.id === agent.id)) {
            return old.map((a) => a.id === agent.id ? agent : a)
          }
          return [...old, agent]
        },
      )
    }).catch(() => {})
  }, [sessionId, queryClient])

  // Reset fetched set when session changes
  const prevSessionId = useRef(sessionId)
  if (sessionId !== prevSessionId.current) {
    fetchedAgentIds.current = new Set<string>()
    prevSessionId.current = sessionId
  }

  return useMemo(() => {
    if (!events) return []

    // Build per-agent stats from events
    const agentStats = new Map<string, {
      eventCount: number
      firstEventAt: number
      lastEventAt: number
      hasStopped: boolean
    }>()

    for (const e of events) {
      let stats = agentStats.get(e.agentId)
      if (!stats) {
        stats = { eventCount: 0, firstEventAt: e.timestamp, lastEventAt: e.timestamp, hasStopped: false }
        agentStats.set(e.agentId, stats)
      }
      stats.eventCount++
      if (e.timestamp < stats.firstEventAt) stats.firstEventAt = e.timestamp
      if (e.timestamp > stats.lastEventAt) stats.lastEventAt = e.timestamp

      // Stop signals for this agent's own events
      if (e.subtype === 'Stop' || e.subtype === 'SessionEnd' || e.subtype === 'stop_hook_summary') {
        stats.hasStopped = true
      }

      // SubagentStop targets the agent ID in the payload, not the event's agentId
      if (e.subtype === 'SubagentStop') {
        const targetId = (e.payload as any)?.agent_id
        if (targetId) {
          const targetStats = agentStats.get(targetId)
          if (targetStats) targetStats.hasStopped = true
        }
      }
    }

    // Server metadata lookup
    const serverMap = new Map<string, ServerAgent>()
    serverAgents?.forEach((a) => serverMap.set(a.id, a))

    // Merge: for every agent seen in events, create a full Agent
    const result: Agent[] = []
    for (const [agentId, stats] of agentStats) {
      const server = serverMap.get(agentId)
      if (!server) fetchAgentMetadata(agentId)

      result.push({
        id: agentId,
        sessionId: sessionId || '',
        parentAgentId: server?.parentAgentId ?? null,
        slug: server?.slug ?? null,
        name: server?.name ?? null,
        agentType: server?.agentType ?? null,
        status: stats.hasStopped ? 'stopped' : 'active',
        eventCount: stats.eventCount,
        firstEventAt: stats.firstEventAt,
        lastEventAt: stats.lastEventAt,
      })
    }

    return result
  }, [events, serverAgents, sessionId, fetchAgentMetadata])
}
```

- [ ] **Step 3: Verify client compiles**

Run: `cd app/client && npx tsc --noEmit`
Expected: Errors in consumers — they still pass old args to useAgents.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/hooks/use-agents.ts app/client/src/lib/api-client.ts
git commit -m "feat: rewrite useAgents — derive state from events, fetch metadata on demand"
```

---

### Task 6: Simplify use-websocket — events only

**Files:**
- Modify: `app/client/src/hooks/use-websocket.ts`

- [ ] **Step 1: Strip all agent logic**

Update `handleMessage` — only handle event, session_update, project_update:

```typescript
  const handleMessage = useCallback((msg: WSMessage) => {
    if (msg.type === 'event') {
      const event = msg.data as ParsedEvent
      const currentSessionId = sessionIdRef.current
      if (currentSessionId && event.sessionId === currentSessionId) {
        queryClient.setQueryData<ParsedEvent[]>(
          ['events', currentSessionId],
          (old) => old ? [...old, event] : [event],
        )
        if (logLevel === 'trace') {
          console.debug(`[WS] Event appended: ${event.type}/${event.subtype}${event.toolName ? ` tool:${event.toolName}` : ''}`)
        }
      }
    } else if (msg.type === 'session_update') {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      if (logLevel === 'trace') {
        console.debug('[WS] Session update → invalidating sessions cache')
      }
    } else if (msg.type === 'project_update') {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      if (logLevel === 'trace') {
        console.debug('[WS] Project update → invalidating projects cache')
      }
    }
  }, [queryClient])
```

Update import — remove Agent:
```typescript
import type { WSMessage, WSClientMessage, ParsedEvent } from '@/types'
```

- [ ] **Step 2: Verify client compiles**

Run: `cd app/client && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/client/src/hooks/use-websocket.ts
git commit -m "refactor: simplify WS hook — events only, no agent logic"
```

---

### Task 7: Update consumer components

**Files:**
- Modify: `app/client/src/components/event-stream/event-stream.tsx`
- Modify: `app/client/src/components/main-panel/agent-combobox.tsx`
- Modify: `app/client/src/components/timeline/activity-timeline.tsx`
- Modify: `app/client/src/components/main-panel/event-filter-bar.tsx`
- Modify: `app/client/src/components/main-panel/logs-modal.tsx`
- Modify: `app/client/src/lib/agent-utils.ts`

All components that use `useAgents` now need to pass `events` to it.

- [ ] **Step 1: Update event-stream.tsx**

Change `useAgents` call to pass events:
```typescript
  const { data: events } = useEvents(selectedSessionId)
  const agents = useAgents(selectedSessionId, events)
```

Note: `useAgents` now returns `Agent[]` directly, not `{ data: Agent[] }`.

Update `agentMap`:
```typescript
  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>()
    agents.forEach((a) => map.set(a.id, a))
    return map
  }, [agents])
```

Update `agentColorMap`:
```typescript
  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])
```

**Remove the agent type patching effect entirely** — the block that detects `agentType` from event payloads and calls `api.updateAgentMetadata`. Remove the associated refs (`patchedAgentTypes`).

Update `showAgentLabel`:
```typescript
  const showAgentLabel = agents.length > 1
```

- [ ] **Step 2: Update agent-combobox.tsx**

Add events import and pass to useAgents:
```typescript
import { useEvents } from '@/hooks/use-events'
import { useAgents } from '@/hooks/use-agents'

// Inside component:
  const { data: events } = useEvents(selectedSessionId)
  const agents = useAgents(selectedSessionId, events)
```

Remove the `allAgents` memo — `useAgents` already only returns agents with events. Use `agents` directly everywhere `allAgents` was used.

Update `activeCount`, `selectedAgents`:
```typescript
  const activeCount = agents.filter((a) => a.status === 'active').length
  const selectedAgents = agents.filter((a) => selectedAgentIds.includes(a.id))
```

Update `sortedAgents` to use `agents` instead of `allAgents`:
```typescript
  const sortedAgents = useMemo(() => {
    if (!open) return snapshotRef.current
    const main = agents.filter((a) => !a.parentAgentId)
    const subs = agents
      .filter((a) => a.parentAgentId)
      .sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1
        if (a.status !== 'active' && b.status === 'active') return 1
        return (b.firstEventAt ?? 0) - (a.firstEventAt ?? 0)
      })
    const sorted = [...main, ...subs]
    snapshotRef.current = sorted
    return sorted
  }, [open, agents])
```

Update `agentColorMap`:
```typescript
  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])
```

Replace `agent.startedAt` with `agent.firstEventAt` in display code.

- [ ] **Step 3: Update activity-timeline.tsx**

```typescript
  const { data: events } = useEvents(effectiveSessionId)
  const agents = useAgents(effectiveSessionId, events)
```

Update `flatAgents` and `agentColorMap` to use `agents` directly.

- [ ] **Step 4: Update event-filter-bar.tsx and logs-modal.tsx**

Check if they import `useAgents`. If so, update to pass events. If they only use `useEvents`, no changes needed.

- [ ] **Step 5: Update agent-utils.ts if needed**

Ensure `buildAgentColorMap` works with the new `Agent` type. It should — the type still has `parentAgentId` and `id`.

- [ ] **Step 6: Verify client compiles and tests pass**

Run: `cd app/client && npx tsc --noEmit && npx vitest run`

- [ ] **Step 7: Commit**

```bash
git add app/client/src/components/ app/client/src/lib/agent-utils.ts
git commit -m "refactor: update all components to use event-derived agent state"
```

---

### Task 8: Clean up and verify

- [ ] **Step 1: Full compilation check**

```bash
cd app/server && npx tsc --noEmit
cd app/client && npx tsc --noEmit
```

Fix any remaining errors.

- [ ] **Step 2: Run all tests**

```bash
cd app/server && npx vitest run
cd app/client && npx vitest run
```

Fix any failing tests — server storage tests may need updating for the new `upsertAgent` signature and removed `updateAgentStatus`.

- [ ] **Step 3: Build client**

```bash
cd app/client && npx vite build
```

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve remaining issues from agent state simplification"
```

---

### Task 9: End-to-end verification

- [ ] **Step 1: Start the app**

```bash
just dev
```

- [ ] **Step 2: Verify no agent_update in WS messages**

Open Chrome DevTools → Network → WS tab. Verify only `event`, `session_update`, `project_update` messages.

- [ ] **Step 3: Verify agent combobox updates from events**

Trigger events. Verify subagents appear as their events arrive, active count is correct, status indicators work.

- [ ] **Step 4: Verify agent metadata fetch**

Check Network tab — when a new agent appears, a single GET `/api/agents/:id` should fetch its metadata.

- [ ] **Step 5: Verify session navigation**

Navigate between sessions. Verify agents list resets, WS subscription changes, no stale state.

- [ ] **Step 6: Verify search still works**

Type in search box. Verify client-side filtering.
