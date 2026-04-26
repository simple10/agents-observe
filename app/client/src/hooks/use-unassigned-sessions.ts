import { useMemo } from 'react'
import { useRecentSessions } from './use-recent-sessions'
import type { Session, RecentSession } from '@/types'

/** Coerce a `RecentSession` (the wire shape from `/sessions/recent`) into a
 *  `Session` (the shape the sidebar renderer expects). The two are nearly
 *  identical post-refactor; the only meaningful gap is `projectName /
 *  projectSlug`, both nullable on the recent response when the row has
 *  no project yet. */
function toSession(r: RecentSession): Session {
  return {
    id: r.id,
    projectId: r.projectId,
    projectSlug: r.projectSlug ?? undefined,
    projectName: r.projectName ?? undefined,
    transcriptPath: r.transcriptPath ?? null,
    slug: r.slug,
    status: r.status,
    startedAt: r.startedAt,
    stoppedAt: r.stoppedAt,
    metadata: r.metadata,
    lastActivity: r.lastActivity,
    agentClasses: r.agentClasses,
  }
}

/**
 * Returns sessions whose `project_id` is still NULL on the server —
 * these render in the sidebar's "Unassigned" bucket. The server now
 * permits sessions without a project (the auto-resolution happens only
 * when `flags.resolveProject` is set or `_meta.project.slug` is
 * supplied — see the three-layer contract spec). Until a user moves
 * one of these sessions into a project (via SessionEditModal), it
 * surfaces here.
 *
 * Backed by `/sessions/recent` because the server has no dedicated
 * "list unassigned" endpoint; we filter client-side. The default limit
 * is generous so the bucket isn't truncated for typical workloads.
 */
export function useUnassignedSessions(limit = 100): Session[] {
  const { data } = useRecentSessions(limit)
  return useMemo(() => {
    if (!data) return []
    return data.filter((r) => r.projectId == null).map(toSession)
  }, [data])
}
