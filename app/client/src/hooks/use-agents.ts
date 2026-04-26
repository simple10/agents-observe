import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { Agent, ServerAgent, ParsedEvent } from '@/types'

// Module-level dedup — shared across all useAgents instances so multiple
// components (event-stream, combobox, timeline) don't each fire a fetch
// for the same unknown agent.
const pendingFetches = new Set<string>()

/**
 * Derives full Agent objects from server metadata + events.
 * Status, eventCount, and timing are computed from events.
 * Detects unknown agents and fetches their metadata on demand — that
 * fetch is a side effect and lives in a useEffect, not the render-time
 * useMemo that builds the Agent[] (React's rules: pure renders, side
 * effects in useEffect).
 */
export function useAgents(sessionId: string | null, events: ParsedEvent[] | undefined): Agent[] {
  const queryClient = useQueryClient()

  const { data: serverAgents } = useQuery({
    queryKey: ['agents', sessionId],
    queryFn: () => api.getAgents(sessionId!),
    enabled: !!sessionId,
  })

  // Pure render: compute per-agent stats + parent map from events. No side effects.
  // Parent derivation: PostToolUse with toolName=Agent declares
  // tool_response.agentId as a child of event.agentId. Server no longer
  // tracks this; per spec Layer 3 derives hierarchy from events.
  const { agentStats, parentMap } = useMemo(() => {
    const stats = new Map<
      string,
      {
        eventCount: number
        firstEventAt: number
        lastEventAt: number
        lastStoppedAt: number // timestamp of last stop signal, 0 if never
        cwd: string | null
      }
    >()
    const parents = new Map<string, string>() // childAgentId -> parentAgentId
    if (!events) return { agentStats: stats, parentMap: parents }
    const stopSubtypes = new Set(['Stop', 'SessionEnd', 'stop_hook_summary'])
    for (const e of events) {
      let s = stats.get(e.agentId)
      if (!s) {
        s = {
          eventCount: 0,
          firstEventAt: e.timestamp,
          lastEventAt: e.timestamp,
          lastStoppedAt: 0,
          cwd: null,
        }
        stats.set(e.agentId, s)
      }
      const p = e.payload as Record<string, unknown> | null | undefined
      if (!s.cwd && typeof (p as any)?.cwd === 'string') {
        s.cwd = (p as any).cwd
      }
      s.eventCount++
      if (e.timestamp < s.firstEventAt) s.firstEventAt = e.timestamp
      if (e.timestamp > s.lastEventAt) s.lastEventAt = e.timestamp
      if (stopSubtypes.has(e.hookName ?? '')) {
        s.lastStoppedAt = Math.max(s.lastStoppedAt, e.timestamp)
      }
      // SubagentStop targets the agent ID in the payload, not the event's agentId
      if (e.hookName === 'SubagentStop') {
        const targetId = (p as any)?.agent_id
        if (targetId) {
          const target = stats.get(targetId)
          if (target) target.lastStoppedAt = Math.max(target.lastStoppedAt, e.timestamp)
        }
      }
      // Layer 3 hierarchy: PostToolUse:Agent declares tool_response.agentId
      // as a child of event.agentId. First-write wins (a child shouldn't
      // be re-parented mid-session under Claude Code semantics).
      if (e.hookName === 'PostToolUse') {
        const toolName = (p as any)?.tool_name
        if (toolName === 'Agent') {
          const childId = (p as any)?.tool_response?.agentId
          if (typeof childId === 'string' && childId !== e.agentId && !parents.has(childId)) {
            parents.set(childId, e.agentId)
          }
        }
      }
    }
    return { agentStats: stats, parentMap: parents }
  }, [events])

  // Side effect: for every agentId seen in events but not present in
  // serverAgents, fetch the metadata and patch it into the ['agents',
  // sessionId] cache. Previously this lived inside the useMemo above,
  // which violated React's "pure render" contract (and could double-
  // fire in StrictMode). Moving it to useEffect keeps the pattern
  // honest without changing behavior.
  useEffect(() => {
    if (!sessionId || agentStats.size === 0) return
    const serverIds = new Set<string>()
    if (serverAgents) for (const a of serverAgents) serverIds.add(a.id)
    for (const agentId of agentStats.keys()) {
      if (serverIds.has(agentId)) continue
      if (pendingFetches.has(agentId)) continue
      pendingFetches.add(agentId)
      api
        .getAgent(agentId)
        .then((agent) => {
          queryClient.setQueryData<ServerAgent[]>(['agents', sessionId], (old) => {
            if (!old) return [agent]
            if (old.some((a) => a.id === agent.id)) {
              return old.map((a) => (a.id === agent.id ? agent : a))
            }
            return [...old, agent]
          })
        })
        .catch(() => {})
    }
  }, [agentStats, serverAgents, sessionId, queryClient])

  // Pure render: merge event-derived stats with server metadata.
  // parentAgentId is purely Layer 3 derivation (from PostToolUse:Agent
  // events), NOT a server field — the agents table dropped that column
  // per spec.
  //
  // Parent derivation precedence:
  // 1. Explicit: PostToolUse:Agent declared this agent as a child of
  //    event.agentId.
  // 2. Default: any non-root agent (id !== sessionId) falls back to the
  //    session root. Covers subagents that only emit SubagentStop with
  //    no upstream PostToolUse:Agent (the common case for older sessions
  //    or subagents spawned via paths the Agent tool doesn't cover).
  // 3. Root: id === sessionId → null (no parent).
  return useMemo(() => {
    const serverMap = new Map<string, ServerAgent>()
    if (serverAgents) for (const a of serverAgents) serverMap.set(a.id, a)
    const result: Agent[] = []
    for (const [agentId, s] of agentStats) {
      const server = serverMap.get(agentId)
      let parentAgentId: string | null = parentMap.get(agentId) ?? null
      if (!parentAgentId && sessionId && agentId !== sessionId) {
        parentAgentId = sessionId
      }
      result.push({
        id: agentId,
        sessionId: sessionId || '',
        parentAgentId,
        description: server?.description ?? null,
        name: server?.name ?? null,
        agentType: server?.agentType ?? null,
        agentClass: server?.agentClass ?? null,
        // Agent is stopped if the last stop signal came after or at the last activity
        status: s.lastStoppedAt >= s.lastEventAt ? 'stopped' : 'active',
        eventCount: s.eventCount,
        firstEventAt: s.firstEventAt,
        lastEventAt: s.lastEventAt,
        cwd: s.cwd,
      })
    }
    return result
  }, [agentStats, parentMap, serverAgents, sessionId])
}
