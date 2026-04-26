import { api } from './api-client'

/**
 * Per-agent debounce + field coalescing for `PATCH /api/agents/:id`.
 *
 * Layer 3 of the three-layer contract owns "discover richer agent
 * metadata while processing events" (e.g. an Agent tool's `tool_input.
 * name` and `description` from a Claude Code PreToolUse, or an
 * `agent_type` derived from a Codex transcript event). When a field
 * stabilizes the client patches it back to the server so the canonical
 * row reflects what the UI knows.
 *
 * Without debouncing, a Pre/Post pair plus a follow-up subagent stop
 * could fire three PATCHes for the same agent in a few hundred ms. We
 * coalesce them into one network call:
 *
 *   - Calls within `windowMs` for the same `agentId` are merged into
 *     a single pending patch (later writes overwrite earlier values
 *     for the same key — last writer wins, matching server semantics).
 *   - One timer per agent — different agents fire independently.
 *   - Fire-and-forget: the underlying request's failure is swallowed
 *     so event processing never blocks on metadata sync.
 *
 * The dashboard re-reads agent rows on the next `useAgents` refetch /
 * WS broadcast, so callers don't need to await the patch.
 */
export type AgentPatch = {
  name?: string | null
  description?: string | null
  agent_type?: string | null
}

interface PendingPatch {
  patch: AgentPatch
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_WINDOW_MS = 500

class AgentPatchDebouncer {
  private pending = new Map<string, PendingPatch>()
  private windowMs: number
  // Indirection for tests — swap `patchFn` to a spy without touching
  // the api singleton.
  private patchFn: (id: string, patch: AgentPatch) => Promise<unknown>

  constructor(
    windowMs: number = DEFAULT_WINDOW_MS,
    patchFn: (id: string, patch: AgentPatch) => Promise<unknown> = (id, patch) =>
      api.patchAgent(id, patch),
  ) {
    this.windowMs = windowMs
    this.patchFn = patchFn
  }

  /**
   * Queue a patch for `agentId`. If `patch` has no truthy fields after
   * filtering, the call is a no-op. Multiple calls for the same agent
   * within `windowMs` merge — later values win for keys present in
   * both.
   */
  schedule(agentId: string, patch: AgentPatch): void {
    const filtered: AgentPatch = {}
    let hasField = false
    for (const key of ['name', 'description', 'agent_type'] as const) {
      if (key in patch) {
        filtered[key] = patch[key] ?? null
        hasField = true
      }
    }
    if (!hasField) return

    const existing = this.pending.get(agentId)
    if (existing) {
      clearTimeout(existing.timer)
      Object.assign(existing.patch, filtered)
    }
    const merged = existing ? existing.patch : filtered
    const timer = setTimeout(() => {
      this.pending.delete(agentId)
      // Fire-and-forget: failures are non-fatal. The agent row already
      // exists with id + agent_class; this PATCH only adds polish.
      this.patchFn(agentId, merged).catch(() => {})
    }, this.windowMs)
    this.pending.set(agentId, { patch: merged, timer })
  }

  /** Synchronously flush every pending patch — used by tests. */
  flushAll(): Promise<unknown[]> {
    const promises: Promise<unknown>[] = []
    for (const [agentId, { timer, patch }] of this.pending) {
      clearTimeout(timer)
      promises.push(this.patchFn(agentId, patch).catch(() => undefined))
    }
    this.pending.clear()
    return Promise.all(promises)
  }

  /** Drop every pending patch without sending — used by tests. */
  clear(): void {
    for (const { timer } of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
  }

  /** Test-only: number of agents with pending patches. */
  get size(): number {
    return this.pending.size
  }
}

/** Process-wide debouncer. Sharing one instance across registrations
 *  is intentional — coalescing only makes sense if every event-handler
 *  funnels through the same queue. */
export const agentPatchDebouncer = new AgentPatchDebouncer()

/** Test factory — always pass an explicit `patchFn` from tests so
 *  module state never leaks between cases. */
export function createAgentPatchDebouncer(
  windowMs: number,
  patchFn: (id: string, patch: AgentPatch) => Promise<unknown>,
): AgentPatchDebouncer {
  return new AgentPatchDebouncer(windowMs, patchFn)
}
