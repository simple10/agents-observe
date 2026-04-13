import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { ParsedEvent, Session, Agent } from '@/types'

/**
 * When a session's events are loaded and permission_mode is missing from
 * session metadata, scans events to find it and PATCHes it to the server.
 *
 * Looks for the most recent SessionStart event from the main agent (no parent).
 * Falls back to walking backwards through main-agent events for any with
 * permission_mode in the payload.
 */
export function usePermissionModeBackfill(
  session: Session | undefined,
  events: ParsedEvent[] | undefined,
  agents: Agent[],
) {
  const queryClient = useQueryClient()
  // Track which sessions we've already backfilled to avoid repeated writes
  const backfilledRef = useRef(new Set<string>())

  useEffect(() => {
    if (!session || !events || events.length === 0) return

    // Already has permission_mode in metadata
    const meta = session.metadata
    if (meta?.permission_mode || meta?.permissionMode) return

    // Already backfilled this session in this browser session
    if (backfilledRef.current.has(session.id)) return

    // Find main agent IDs (no parent)
    const mainAgentIds = new Set(agents.filter((a) => !a.parentAgentId).map((a) => a.id))
    if (mainAgentIds.size === 0) return

    // Strategy 1: most recent SessionStart from main agent
    let permissionMode: string | null = null
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.subtype === 'SessionStart' && mainAgentIds.has(e.agentId)) {
        const mode = (e.payload as any)?.permission_mode ?? (e.payload as any)?.permissionMode
        if (typeof mode === 'string') {
          permissionMode = mode
          break
        }
      }
    }

    // Strategy 2: walk backwards through main-agent events for any with permission_mode
    if (!permissionMode) {
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]
        if (!mainAgentIds.has(e.agentId)) continue
        const mode = (e.payload as any)?.permission_mode ?? (e.payload as any)?.permissionMode
        if (typeof mode === 'string') {
          permissionMode = mode
          break
        }
      }
    }

    // Mark as checked even if not found, to avoid re-scanning on every event update
    backfilledRef.current.add(session.id)

    if (!permissionMode) return

    // Persist to server and refresh session cache
    api
      .patchSessionMetadata(session.id, { permission_mode: permissionMode })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['session', session.id] })
        queryClient.invalidateQueries({ queryKey: ['sessions'] })
      })
      .catch(() => {})
  }, [session, events, agents, queryClient])
}
