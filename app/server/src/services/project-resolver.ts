// app/server/src/services/project-resolver.ts
//
// PHASE 2 STUB. The full algorithm specified in the three-layer contract
// design ships in Phase 3. For now, only the explicit-slug branch is
// honored — every other path returns null, which the caller treats as
// "leave session unassigned" (project_id = NULL).
//
// This keeps the schema migration atomic: Phase 2 drops projects.cwd /
// projects.transcript_path so the old algorithm cannot run, and Phase 3
// rewrites resolveProject + the events.ts caller against the new
// adapter methods (findOrCreateProjectBySlug,
// findSiblingSessionWithProject) at the same time.

import type { EventStore } from '../storage/types'

export interface ResolveProjectInput {
  sessionId: string
  slug: string | null
  /** @deprecated Phase 3 reads from sessions.transcript_path instead. */
  transcriptPath?: string | null
  /** @deprecated Phase 3 reads from sessions.start_cwd instead. */
  cwd?: string | null
}

export interface ResolveProjectResult {
  projectId: number | null
  projectSlug: string
  created: boolean
}

export async function resolveProject(
  store: EventStore,
  input: ResolveProjectInput,
): Promise<ResolveProjectResult> {
  const { slug } = input

  if (slug) {
    const existing = await store.getProjectBySlug(slug)
    if (existing) {
      return { projectId: existing.id, projectSlug: existing.slug, created: false }
    }
    const id = await store.createProject(slug, slug)
    return { projectId: id, projectSlug: slug, created: true }
  }

  // No slug — Phase 2 leaves the session unassigned. Phase 3 brings back
  // sibling-session matching + transcript-basedir + cwd-derived slugs.
  return { projectId: null, projectSlug: '', created: false }
}
