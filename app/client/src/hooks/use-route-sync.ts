import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore, parseView, buildHash, PROJECT_PLACEHOLDER } from '@/stores/ui-store'
import { useProjects } from '@/hooks/use-projects'
import { api } from '@/lib/api-client'
import type { Session } from '@/types'

const SESSION_VIEW_TABS = new Set(['details', 'stats', 'labels'])

// Upper bound on the legacy-link dedup set so it can't grow without limit over
// a long-lived page. Cleared (not LRU-evicted) on overflow — re-resolving a
// previously-seen dead slug after a clear costs one extra fetch, which is fine.
const MAX_FALLBACK_ATTEMPTS = 50

// Rewrite the CURRENT history entry's hash without adding a stack entry. Used
// to canonicalize the (advisory) project segment from the resolved session —
// replaceState, never pushState, so back/forward isn't polluted.
function canonicalizeHash(
  projectSlug: string | null,
  sessionId: string | null,
  view: string | null,
) {
  const target = buildHash(projectSlug, sessionId, view)
  if (window.location.hash !== target) window.history.replaceState(null, '', target)
}

/**
 * Keeps the URL, the resolved project, and the selected session in sync.
 *
 * The project segment is advisory: the session id (unique) is the source of
 * truth, so the project shown in the URL is always DERIVED from the resolved
 * session — never trusted from the URL or carried over from a previous
 * selection. This is what fixes navigating between sessions in different
 * projects (or to an unassigned session) leaving a stale project segment.
 */
export function useRouteSync() {
  const queryClient = useQueryClient()
  const { data: projects } = useProjects()
  const selectedSessionId = useUIStore((s) => s.selectedSessionId)
  const selectedProjectId = useUIStore((s) => s.selectedProjectId)
  const selectedProjectSlug = useUIStore((s) => s.selectedProjectSlug)
  const currentView = useUIStore((s) => s.currentView)

  // Resolve a session through the canonical ['session', id] cache so
  // SessionBreadcrumb + the permission-mode backfill reuse it instead of
  // each firing their own /api/sessions/:id. The staleTime matters: this
  // reconciler re-runs whenever `projects` changes (frequent on a live
  // dashboard), so without it every projects update would refetch the
  // session. 30s mirrors SessionBreadcrumb's query so they share fresh cache.
  const fetchSession = (id: string) =>
    queryClient.fetchQuery<Session>({
      queryKey: ['session', id],
      queryFn: () => api.getSession(id),
      staleTime: 30_000,
    })

  // ── Session → project reconciler ────────────────────────────────
  // Runs on every session change (NO selectedProjectId gate — that gate is the
  // old bug). Resolves the session's real project and rewrites the project
  // segment to match. The loop-breaker is that our own setState only touches
  // project id/slug, which are NOT in this effect's dependency array.
  useEffect(() => {
    if (!selectedSessionId) return
    let cancelled = false

    fetchSession(selectedSessionId)
      .then((session) => {
        if (cancelled) return
        if (!session) {
          useUIStore.getState().setRouteError(selectedSessionId)
          return
        }
        const resolvedId = session.projectId ?? null
        const project = resolvedId != null ? projects?.find((p) => p.id === resolvedId) : undefined

        // Project id known but its slug isn't resolvable yet (projects still
        // loading) — set the id and wait; this effect re-runs when `projects`
        // arrives. Avoids briefly canonicalizing a real project down to `_`.
        if (resolvedId != null && !project) {
          if (useUIStore.getState().selectedProjectId !== resolvedId) {
            useUIStore.setState({ selectedProjectId: resolvedId })
          }
          return
        }

        // Fully resolved: a real project, or genuinely unassigned (null/null).
        const resolvedSlug = project?.slug ?? null
        const st = useUIStore.getState()
        st.clearRouteError()
        if (st.selectedProjectId !== resolvedId || st.selectedProjectSlug !== resolvedSlug) {
          useUIStore.setState({ selectedProjectId: resolvedId, selectedProjectSlug: resolvedSlug })
        }
        canonicalizeHash(resolvedSlug, selectedSessionId, useUIStore.getState().currentView)
      })
      .catch(() => {
        if (!cancelled) useUIStore.getState().setRouteError(selectedSessionId)
      })

    return () => {
      cancelled = true
    }
  }, [selectedSessionId, projects])

  // ── Bare project slug resolver + legacy single-segment fallback ──
  // For project-only URLs (`#/<slug>`), resolve slug → id and correct stale
  // slugs. If the slug matches no project, it may be a legacy `#/<sessionId>`
  // deep link from before the project segment was required — resolve it AS a
  // session (a data lookup against real rows, not a format heuristic) and
  // switch to the canonical `#/_/<id>`.
  const attemptedSessionFallback = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!projects) return
    if (selectedSessionId) return // the session reconciler owns project resolution
    if (!selectedProjectSlug || selectedProjectSlug === PROJECT_PLACEHOLDER) return

    // Already have the id — just keep the slug fresh.
    if (selectedProjectId) {
      const project = projects.find((p) => p.id === selectedProjectId)
      if (project && project.slug !== selectedProjectSlug) {
        useUIStore.getState().updateProjectSlug(project.slug)
      }
      return
    }

    const project = projects.find((p) => p.slug === selectedProjectSlug)
    if (project) {
      useUIStore.setState({ selectedProjectId: project.id })
      return
    }

    // Not a known project — try it as a session id (once per candidate).
    const candidate = selectedProjectSlug
    if (attemptedSessionFallback.current.has(candidate)) {
      useUIStore.getState().setRouteError(candidate)
      return
    }
    // Bound the dedup set — it only grows on slugs that match no project
    // (legacy links / typos), but it lives for the page's lifetime, so cap it.
    if (attemptedSessionFallback.current.size >= MAX_FALLBACK_ATTEMPTS) {
      attemptedSessionFallback.current.clear()
    }
    attemptedSessionFallback.current.add(candidate)
    fetchSession(candidate)
      .then((session) => {
        if (!session) {
          useUIStore.getState().setRouteError(candidate)
          return
        }
        useUIStore.getState().clearRouteError()
        // Hand off to the session reconciler, which fills in the real project.
        useUIStore.setState({
          selectedSessionId: candidate,
          selectedProjectSlug: null,
          selectedProjectId: null,
        })
        canonicalizeHash(null, candidate, useUIStore.getState().currentView)
      })
      .catch(() => useUIStore.getState().setRouteError(candidate))
  }, [projects, selectedProjectSlug, selectedProjectId, selectedSessionId])

  // URL deep-link view → modal state. Runs whenever currentView changes
  // (e.g. direct URL load, browser back/forward) and waits for the
  // session selection to resolve before opening a session-scoped modal.
  // Bypasses setEditingSessionId to avoid re-pushing the same URL.
  useEffect(() => {
    if (!currentView) return
    const parsed = parseView(currentView)

    if (parsed.scope === 'session') {
      const targetId = parsed.target ?? selectedSessionId
      if (!targetId) {
        // Session-scoped view without a target — invalid per convention.
        // The session id is known synchronously from parseHash on mount, so
        // a race here is not real: if there's no session id by the time
        // this effect fires, the URL was malformed.
        console.warn(
          `[route-sync] Deep link :${currentView} requires a session id (none in URL, none in @target) — stripping.`,
        )
        useUIStore.getState().setCurrentView(null)
        return
      }
      if (!SESSION_VIEW_TABS.has(parsed.name)) {
        console.warn(
          `[route-sync] Deep link :${currentView} — unknown session view "${parsed.name}". Valid: details, stats, labels.`,
        )
        useUIStore.getState().setCurrentView(null)
        return
      }
      const tab = parsed.name as 'details' | 'stats' | 'labels'
      const state = useUIStore.getState()
      if (state.editingSessionId !== targetId || state.editingSessionTab !== tab) {
        useUIStore.setState({ editingSessionId: targetId, editingSessionTab: tab })
      }
      return
    }

    // Future: parsed.scope === 'project' and parsed.scope === 'global'.
    // For now, unknown scope/view is logged so it doesn't silently rot.
    console.warn(
      `[route-sync] Deep link :${currentView} (${parsed.scope}.${parsed.name}) not wired up yet — stripping.`,
    )
    useUIStore.getState().setCurrentView(null)
  }, [currentView, selectedSessionId])
}
