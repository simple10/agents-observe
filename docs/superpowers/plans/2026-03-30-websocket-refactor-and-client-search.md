# WebSocket Refactor, Polling Removal & Client-Side Search

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate wasteful refetching by making the WebSocket subscription-based, removing polling, and moving search to client-side filtering.

**Architecture:** The WebSocket server tracks which session each client is viewing. Clients send `subscribe` messages to scope what they receive. The server sends scoped event/agent updates only to subscribers of that session, plus global project/session notifications to everyone. The client appends incoming events directly to React Query cache instead of invalidating and refetching. Polling is removed entirely. Search becomes client-side substring matching over the already-loaded event data.

**Tech Stack:** TypeScript, React, React Query, Zustand, ws (WebSocket), Hono, Vitest

---

### File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `app/server/src/websocket.ts` | Modify | Add subscription tracking, scoped send, remove broadcast-all |
| `app/server/src/routes/events.ts` | Modify | Use scoped broadcast for event/agent messages |
| `app/server/src/routes/sessions.ts` | Modify | Use scoped broadcast for session_update |
| `app/server/src/routes/projects.ts` | Modify | Use scoped broadcast for project_update |
| `app/server/src/routes/poll.ts` | Delete | Remove polling endpoint |
| `app/server/src/app.ts` | Modify | Remove poll router import/route |
| `app/server/src/index.ts` | Modify | Remove `CLAUDE_OBSERVE_WEBSOCKET` env var handling |
| `app/server/src/types.ts` | Modify | Add WS client message types |
| `app/client/src/hooks/use-websocket.ts` | Modify | Remove polling, add subscription messages, append to cache |
| `app/client/src/components/event-stream/event-stream.tsx` | Modify | Remove sessions invalidation, remove unused searchQuery, add client-side search filtering |
| `app/client/src/components/main-panel/event-filter-bar.tsx` | Modify | Keep search input (already works, drives searchQuery state) |
| `app/client/src/config/api.ts` | Modify | Remove WS_URL (WebSocket URL built in hook now) |
| `app/client/src/App.tsx` | Modify | Pass selectedSessionId to useWebSocket |
| `app/client/src/types/index.ts` | Modify | Add client-side WS message types |

---

### Task 1: Remove polling — server side

**Files:**
- Delete: `app/server/src/routes/poll.ts`
- Modify: `app/server/src/app.ts`

- [ ] **Step 1: Delete the poll route file**

```bash
rm app/server/src/routes/poll.ts
```

- [ ] **Step 2: Remove poll router from app.ts**

In `app/server/src/app.ts`, remove the import and route registration:

```typescript
// Remove this import:
import pollRouter from './routes/poll'

// Remove this route:
app.route('/api', pollRouter)
```

The file should have these remaining router imports and routes:

```typescript
import eventsRouter from './routes/events'
import projectsRouter from './routes/projects'
import sessionsRouter from './routes/sessions'
import agentsRouter from './routes/agents'
import adminRouter from './routes/admin'
import healthRouter from './routes/health'

// ... inside createApp():
app.route('/api', eventsRouter)
app.route('/api', projectsRouter)
app.route('/api', sessionsRouter)
app.route('/api', agentsRouter)
app.route('/api', adminRouter)
app.route('/api', healthRouter)
```

- [ ] **Step 3: Verify server compiles**

Run: `cd app/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add -A app/server/src/routes/poll.ts app/server/src/app.ts
git commit -m "refactor: remove polling endpoint from server"
```

---

### Task 2: Remove polling — client side

**Files:**
- Modify: `app/client/src/hooks/use-websocket.ts`

- [ ] **Step 1: Strip polling logic from use-websocket.ts**

Replace the entire file with a WebSocket-only implementation. Remove all polling state, `startPolling`, `stopPolling`, `pollIntervalRef`, `lastPollTimestampRef`, `wsFailCountRef`, and the `mode` state. Keep `invalidateAll` for now (it will be replaced in Task 5).

```typescript
import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { WS_URL } from '@/config/api'
import type { WSMessage } from '@/types'

export function useWebSocket() {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['events'] })
    queryClient.invalidateQueries({ queryKey: ['agents'] })
    queryClient.invalidateQueries({ queryKey: ['sessions'] })
    queryClient.invalidateQueries({ queryKey: ['projects'] })
  }, [queryClient])

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
      return
    }

    function connectWs() {
      try {
        const ws = new WebSocket(WS_URL)
        wsRef.current = ws

        ws.onopen = () => {
          setConnected(true)
          console.log('[WS] Connected')
        }

        ws.onmessage = (event) => {
          try {
            const msg: WSMessage = JSON.parse(event.data)
            if (
              msg.type === 'event' ||
              msg.type === 'agent_update' ||
              msg.type === 'session_update'
            ) {
              invalidateAll()
            }
          } catch {}
        }

        ws.onclose = () => {
          setConnected(false)
          wsRef.current = null
          console.log('[WS] Disconnected, retrying in 3s...')
          reconnectTimeoutRef.current = setTimeout(connectWs, 3000)
        }

        ws.onerror = () => {
          ws.close()
        }
      } catch {
        // WebSocket constructor can throw if URL is invalid
        reconnectTimeoutRef.current = setTimeout(connectWs, 5000)
      }
    }

    connectWs()

    return () => {
      clearTimeout(reconnectTimeoutRef.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [invalidateAll])

  return { connected }
}
```

- [ ] **Step 2: Update App.tsx — remove `mode` destructuring**

The `useWebSocket` hook no longer returns `mode`. In `app/client/src/App.tsx`, the existing destructuring is `const { connected } = useWebSocket()` — verify this already matches. No change should be needed since `mode` was never destructured in App.tsx.

- [ ] **Step 3: Verify client compiles**

Run: `cd app/client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add app/client/src/hooks/use-websocket.ts
git commit -m "refactor: remove polling fallback from client WebSocket hook"
```

---

### Task 3: Remove `CLAUDE_OBSERVE_WEBSOCKET` env var

**Files:**
- Modify: `app/server/src/index.ts`
- Modify: `app/server/src/websocket.ts`

- [ ] **Step 1: Remove the env var and always-enable flag from index.ts**

In `app/server/src/index.ts`, remove the `WS_ENABLED` variable and pass no `enabled` flag. The `attachWebSocket` function will always attach.

Replace the full file:

```typescript
// app/server/src/index.ts
import type { Server } from 'http'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createStore } from './storage'
import { attachWebSocket, broadcast } from './websocket'

const store = createStore()
const PORT = parseInt(process.env.CLAUDE_OBSERVE_SERVER_PORT || '4981', 10)

const app = createApp(store, broadcast)

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`POST events: http://localhost:${PORT}/api/events`)
})

attachWebSocket(server as unknown as Server)
```

- [ ] **Step 2: Remove `enabled` parameter from attachWebSocket**

In `app/server/src/websocket.ts`, remove the `enabled` parameter and the early-return guard:

```typescript
import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'

const clients = new Set<WebSocket>()

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/api/events/stream' })

  wss.on('connection', (ws) => {
    clients.add(ws)
    console.log('[WS] Client connected')

    ws.on('close', () => {
      clients.delete(ws)
      console.log('[WS] Client disconnected')
    })

    ws.on('error', () => {
      clients.delete(ws)
    })
  })

  console.log('[WS] WebSocket enabled on /api/events/stream')
}

export function broadcast(message: object): void {
  const json = JSON.stringify(message)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(json)
      } catch {
        clients.delete(client)
      }
    }
  }
}

export function getClientCount(): number {
  return clients.size
}
```

- [ ] **Step 3: Verify server compiles**

Run: `cd app/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add app/server/src/index.ts app/server/src/websocket.ts
git commit -m "refactor: remove CLAUDE_OBSERVE_WEBSOCKET env var, always enable WebSocket"
```

---

### Task 4: Add subscription-based WebSocket server

**Files:**
- Modify: `app/server/src/websocket.ts`
- Modify: `app/server/src/types.ts`

- [ ] **Step 1: Add client message types to server types**

In `app/server/src/types.ts`, add the client-to-server message type after the existing `WSMessage` type:

```typescript
// Messages FROM clients
export type WSClientMessage =
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe' }
```

- [ ] **Step 2: Rewrite websocket.ts with subscription tracking**

Replace `app/server/src/websocket.ts` with scoped messaging. Each client can subscribe to one session at a time. The module exports `broadcastToSession` (sends to clients watching a specific session) and `broadcastToAll` (sends to every client, for global updates like new projects/sessions).

```typescript
import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import type { WSClientMessage } from './types'

// Track which session each client is subscribed to
const clientSessions = new Map<WebSocket, string>()
const allClients = new Set<WebSocket>()

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/api/events/stream' })

  wss.on('connection', (ws) => {
    allClients.add(ws)
    console.log('[WS] Client connected')

    ws.on('message', (raw) => {
      try {
        const msg: WSClientMessage = JSON.parse(raw.toString())
        if (msg.type === 'subscribe' && msg.sessionId) {
          clientSessions.set(ws, msg.sessionId)
        } else if (msg.type === 'unsubscribe') {
          clientSessions.delete(ws)
        }
      } catch {}
    })

    ws.on('close', () => {
      allClients.delete(ws)
      clientSessions.delete(ws)
      console.log('[WS] Client disconnected')
    })

    ws.on('error', () => {
      allClients.delete(ws)
      clientSessions.delete(ws)
    })
  })

  console.log('[WS] WebSocket enabled on /api/events/stream')
}

/** Send a message only to clients subscribed to a specific session */
export function broadcastToSession(sessionId: string, message: object): void {
  const json = JSON.stringify(message)
  for (const [client, subSessionId] of clientSessions) {
    if (subSessionId === sessionId && client.readyState === WebSocket.OPEN) {
      try {
        client.send(json)
      } catch {
        allClients.delete(client)
        clientSessions.delete(client)
      }
    }
  }
}

/** Send a message to ALL connected clients (for global updates) */
export function broadcastToAll(message: object): void {
  const json = JSON.stringify(message)
  for (const client of allClients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(json)
      } catch {
        allClients.delete(client)
        clientSessions.delete(client)
      }
    }
  }
}

export function getClientCount(): number {
  return allClients.size
}
```

- [ ] **Step 3: Verify server compiles**

Run: `cd app/server && npx tsc --noEmit`
Expected: Errors in files that still import `broadcast` — that's expected, we fix those next.

- [ ] **Step 4: Commit**

```bash
git add app/server/src/websocket.ts app/server/src/types.ts
git commit -m "feat: add subscription-based WebSocket with scoped messaging"
```

---

### Task 5: Wire up scoped broadcasting in server routes

**Files:**
- Modify: `app/server/src/app.ts`
- Modify: `app/server/src/index.ts`
- Modify: `app/server/src/routes/events.ts`
- Modify: `app/server/src/routes/sessions.ts`
- Modify: `app/server/src/routes/projects.ts`

- [ ] **Step 1: Update app.ts to inject both broadcast functions**

Change the `Env` type and `createApp` signature to accept both `broadcastToSession` and `broadcastToAll`:

```typescript
type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

export function createApp(
  store: EventStore,
  broadcastToSession: (sessionId: string, msg: object) => void,
  broadcastToAll: (msg: object) => void,
) {
  const app = new Hono<Env>()

  app.use('*', cors())

  // Inject store and broadcast into all routes
  app.use('*', async (c, next) => {
    c.set('store', store)
    c.set('broadcastToSession', broadcastToSession)
    c.set('broadcastToAll', broadcastToAll)
    await next()
  })

  // ... rest unchanged
```

- [ ] **Step 2: Update index.ts to pass both functions**

```typescript
import { attachWebSocket, broadcastToSession, broadcastToAll } from './websocket'

// ...
const app = createApp(store, broadcastToSession, broadcastToAll)
```

- [ ] **Step 3: Update events.ts route Env type and broadcast calls**

Update the `Env` type at the top of `app/server/src/routes/events.ts`:

```typescript
type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}
```

In the POST `/events` handler, replace `const broadcast = c.get('broadcast')` with:

```typescript
  const broadcastToSession = c.get('broadcastToSession')
  const broadcastToAll = c.get('broadcastToAll')
```

Then update each broadcast call. Events and agent updates are session-scoped. Session updates go to both the session subscribers AND all clients (for sidebar). Replace each call:

**Agent status broadcasts** (lines ~216-239, ~244) — these are session-scoped:
```typescript
// Replace: broadcast({ type: 'agent_update', data: ... })
// With:    broadcastToSession(parsed.sessionId, { type: 'agent_update', data: ... })
```

All four `agent_update` broadcasts become:
```typescript
broadcastToSession(parsed.sessionId, {
  type: 'agent_update',
  data: { id: rootAgentId, status: 'stopped', sessionId: parsed.sessionId },
})
```
(Same pattern for the 'active' status one.)

**Session status broadcasts** (lines ~227-229, ~244-248) — these go to ALL clients (sidebar needs to update):
```typescript
// Replace: broadcast({ type: 'session_update', data: ... })
// With:    broadcastToAll({ type: 'session_update', data: ... })
```

**Event broadcast** (line ~294) — session-scoped:
```typescript
// Replace: broadcast({ type: 'event', data: event })
// With:    broadcastToSession(parsed.sessionId, { type: 'event', data: event })
```

- [ ] **Step 4: Update sessions.ts route**

In `app/server/src/routes/sessions.ts`, update the Env type:

```typescript
type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}
```

Find the `session_update` broadcast (in the session metadata update endpoint) and change it:

```typescript
// Replace: broadcast({ type: 'session_update', ... })
// With:    broadcastToAll({ type: 'session_update', ... })
```

Update the variable from `const broadcast = c.get('broadcast')` to `const broadcastToAll = c.get('broadcastToAll')`.

- [ ] **Step 5: Update projects.ts route**

In `app/server/src/routes/projects.ts`, same Env type update. The `project_update` broadcast goes to all clients:

```typescript
// Replace: broadcast({ type: 'project_update', ... })
// With:    broadcastToAll({ type: 'project_update', ... })
```

Update the variable from `const broadcast = c.get('broadcast')` to `const broadcastToAll = c.get('broadcastToAll')`.

- [ ] **Step 6: Verify server compiles**

Run: `cd app/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add app/server/src/app.ts app/server/src/index.ts app/server/src/routes/events.ts app/server/src/routes/sessions.ts app/server/src/routes/projects.ts
git commit -m "feat: use scoped WebSocket broadcasting — events to session subscribers, updates to all"
```

---

### Task 6: Client WebSocket — subscription and cache-append

**Files:**
- Modify: `app/client/src/hooks/use-websocket.ts`
- Modify: `app/client/src/App.tsx`
- Modify: `app/client/src/types/index.ts`

- [ ] **Step 1: Add client WS message type**

In `app/client/src/types/index.ts`, add after the existing `WSMessage` type:

```typescript
export type WSClientMessage =
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe' }
```

- [ ] **Step 2: Rewrite use-websocket.ts with subscription and cache-append**

Replace `app/client/src/hooks/use-websocket.ts` entirely. The hook now:
- Accepts `sessionId` parameter
- Sends `subscribe`/`unsubscribe` when sessionId changes
- Appends `event` messages directly to the React Query events cache
- Invalidates `agents` on `agent_update` messages (agent tree structure may change)
- Invalidates `sessions` on `session_update` messages (status change for sidebar)
- Invalidates `projects` on `project_update` messages

```typescript
import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { WSMessage, WSClientMessage, ParsedEvent } from '@/types'

const WS_URL = `ws://${window.location.host}/api/events/stream`

export function useWebSocket(sessionId: string | null) {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  const sendMessage = useCallback((msg: WSClientMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }, [])

  // Send subscribe/unsubscribe when sessionId changes
  useEffect(() => {
    if (!connected) return
    if (sessionId) {
      sendMessage({ type: 'subscribe', sessionId })
    } else {
      sendMessage({ type: 'unsubscribe' })
    }
  }, [sessionId, connected, sendMessage])

  const handleMessage = useCallback((msg: WSMessage) => {
    if (msg.type === 'event') {
      // Append directly to the events cache for the current session
      const event = msg.data as ParsedEvent
      const currentSessionId = sessionIdRef.current
      if (currentSessionId && event.sessionId === currentSessionId) {
        queryClient.setQueryData<ParsedEvent[]>(
          ['events', currentSessionId],
          (old) => old ? [...old, event] : [event],
        )
      }
      // Also invalidate agents — new events may introduce new subagents
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    } else if (msg.type === 'agent_update') {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    } else if (msg.type === 'session_update') {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    } else if (msg.type === 'project_update') {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  }, [queryClient])

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
      return
    }

    function connectWs() {
      try {
        const ws = new WebSocket(WS_URL)
        wsRef.current = ws

        ws.onopen = () => {
          setConnected(true)
          console.log('[WS] Connected')
          // Subscribe to current session on reconnect
          const sid = sessionIdRef.current
          if (sid) {
            ws.send(JSON.stringify({ type: 'subscribe', sessionId: sid }))
          }
        }

        ws.onmessage = (wsEvent) => {
          try {
            const msg: WSMessage = JSON.parse(wsEvent.data)
            handleMessage(msg)
          } catch {}
        }

        ws.onclose = () => {
          setConnected(false)
          wsRef.current = null
          console.log('[WS] Disconnected, retrying in 3s...')
          reconnectTimeoutRef.current = setTimeout(connectWs, 3000)
        }

        ws.onerror = () => {
          ws.close()
        }
      } catch {
        reconnectTimeoutRef.current = setTimeout(connectWs, 5000)
      }
    }

    connectWs()

    return () => {
      clearTimeout(reconnectTimeoutRef.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [handleMessage])

  return { connected }
}
```

- [ ] **Step 3: Update App.tsx to pass sessionId**

```typescript
import { ThemeProvider } from '@/components/theme-provider'
import { Sidebar } from '@/components/sidebar/sidebar'
import { MainPanel } from '@/components/main-panel/main-panel'
import { useWebSocket } from '@/hooks/use-websocket'
import { useRouteSync } from '@/hooks/use-route-sync'
import { useUIStore } from '@/stores/ui-store'

export function App() {
  const selectedSessionId = useUIStore((s) => s.selectedSessionId)
  const { connected } = useWebSocket(selectedSessionId)
  useRouteSync()

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar connected={connected} />
        <MainPanel />
      </div>
    </ThemeProvider>
  )
}
```

- [ ] **Step 4: Remove WS_URL from config/api.ts**

In `app/client/src/config/api.ts`, remove the `WS_URL` export (it's now defined inline in the hook):

```typescript
export const API_BASE = '/api'
```

Search for any other imports of `WS_URL` and remove them. There should be none remaining after the `use-websocket.ts` rewrite.

- [ ] **Step 5: Verify client compiles**

Run: `cd app/client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add app/client/src/hooks/use-websocket.ts app/client/src/App.tsx app/client/src/types/index.ts app/client/src/config/api.ts
git commit -m "feat: subscription-based WebSocket with cache-append for events"
```

---

### Task 7: Clean up event-stream — remove sessions invalidation and unused imports

**Files:**
- Modify: `app/client/src/components/event-stream/event-stream.tsx`

- [ ] **Step 1: Remove the sessions invalidation effect and unused searchQuery**

In `app/client/src/components/event-stream/event-stream.tsx`:

1. Remove `searchQuery` from the useUIStore destructuring (it was unused after the earlier change in this session).

2. Remove `useQueryClient` import and `queryClient` variable if they're only used for the sessions invalidation. Check first — `queryClient` is also used in the agent type patching effect (~line 158). If still used there, keep the import but remove the sessions invalidation effect.

Remove this block (the sessions invalidation after events load):

```typescript
  // After events load, refetch sessions so the server's lazy status
  // correction (in GET /sessions/:id/events) is reflected in the sidebar
  const eventsLength = events?.length ?? 0
  useEffect(() => {
    if (eventsLength > 0) {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    }
  }, [selectedSessionId, eventsLength, queryClient])
```

This is no longer needed because `session_update` WebSocket messages now handle status changes directly.

- [ ] **Step 2: Verify client compiles**

Run: `cd app/client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run existing tests**

Run: `cd app/client && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add app/client/src/components/event-stream/event-stream.tsx
git commit -m "refactor: remove redundant sessions invalidation from event-stream"
```

---

### Task 8: Client-side search filtering

**Files:**
- Modify: `app/client/src/components/event-stream/event-stream.tsx`

- [ ] **Step 1: Add search filtering to the existing client-side filter pipeline**

In `app/client/src/components/event-stream/event-stream.tsx`, add `searchQuery` back to the useUIStore destructuring, then add search filtering into the `filteredEvents` useMemo.

Add `searchQuery` to the store destructuring at the top:

```typescript
  const {
    selectedSessionId,
    selectedAgentIds,
    activeStaticFilters,
    activeToolFilters,
    searchQuery,
    autoFollow,
    expandAllCounter,
    expandAllEvents,
    selectedEventId,
  } = useUIStore()
```

Update the `filteredEvents` useMemo to include search filtering. The search should match against the stringified payload and the event's summary/toolName/subtype fields. Add it as the last filter step:

```typescript
  const filteredEvents = useMemo(() => {
    let filtered = deduped

    // Agent chip filtering (client-side, includes spawning Tool:Agent calls)
    if (selectedAgentIds.length > 0) {
      const spawnIds = new Set<string>()
      for (const agentId of selectedAgentIds) {
        const toolUseId = spawnToolUseIds.get(agentId)
        if (toolUseId) spawnIds.add(toolUseId)
      }
      filtered = filtered.filter((e) =>
        selectedAgentIds.includes(e.agentId) ||
        (e.toolUseId != null && spawnIds.has(e.toolUseId))
      )
    }

    // Static + dynamic tool filters
    if (deferredStaticFilters.length > 0 || deferredToolFilters.length > 0) {
      filtered = filtered.filter((e) => eventMatchesFilters(e, deferredStaticFilters, deferredToolFilters))
    }

    // Text search — case-insensitive substring match across key fields and payload
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter((e) => {
        if (e.toolName?.toLowerCase().includes(q)) return true
        if (e.subtype?.toLowerCase().includes(q)) return true
        if (e.type?.toLowerCase().includes(q)) return true
        // Search stringified payload
        if (JSON.stringify(e.payload).toLowerCase().includes(q)) return true
        return false
      })
    }

    return filtered
  }, [deduped, selectedAgentIds, spawnToolUseIds, deferredStaticFilters, deferredToolFilters, searchQuery])
```

- [ ] **Step 2: Defer the search query for responsiveness**

Add `searchQuery` to the deferred values near the top of the component, alongside the existing deferred filters:

```typescript
  const deferredStaticFilters = useDeferredValue(activeStaticFilters)
  const deferredToolFilters = useDeferredValue(activeToolFilters)
  const deferredSearchQuery = useDeferredValue(searchQuery)
```

Then use `deferredSearchQuery` instead of `searchQuery` in the `filteredEvents` useMemo:

```typescript
    // Text search
    if (deferredSearchQuery) {
      const q = deferredSearchQuery.toLowerCase()
      // ... same filter logic
    }

    return filtered
  }, [deduped, selectedAgentIds, spawnToolUseIds, deferredStaticFilters, deferredToolFilters, deferredSearchQuery])
```

- [ ] **Step 3: Verify client compiles and tests pass**

Run: `cd app/client && npx tsc --noEmit && npx vitest run`
Expected: No errors, all tests pass

- [ ] **Step 4: Commit**

```bash
git add app/client/src/components/event-stream/event-stream.tsx
git commit -m "feat: client-side search filtering over event payload, toolName, subtype"
```

---

### Task 9: End-to-end verification

- [ ] **Step 1: Build and run the full app**

```bash
just start
```

- [ ] **Step 2: Verify network behavior**

Open Chrome DevTools → Network tab. Navigate to a session. Verify:
- Only ONE request for `events`, `agents`, `sessions`
- No `/poll` requests
- WebSocket connection established on `/api/events/stream`

- [ ] **Step 3: Verify WebSocket scoping**

Open two browser tabs to different sessions. Trigger an event in one session. Verify:
- Only the tab viewing that session receives the event update
- The other tab's network shows no new requests

- [ ] **Step 4: Verify search**

Type a search query in the filter bar. Verify:
- Events filter immediately (no network request)
- Search matches against tool names, subtypes, and payload content
- Clearing search restores all events

- [ ] **Step 5: Verify sidebar updates**

While viewing a session, trigger session status changes (session start/stop). Verify:
- Sidebar status indicators update without full page refetch
- New sessions appearing are reflected in sidebar

- [ ] **Step 6: Commit any fixes**

If any issues were found and fixed during verification, commit them.
