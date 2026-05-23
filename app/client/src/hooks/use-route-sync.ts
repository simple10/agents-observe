import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore, parseView } from '@/stores/ui-store'
import { useProjects } from '@/hooks/use-projects'
import { api } from '@/lib/api-client'
import type { Session } from '@/types'

const SESSION_VIEW_TABS = new Set(['details', 'stats', 'labels'])

/**
 * Syncs the URL hash with the UI state on load and when project slugs change.
 *
 * On mount with a sessionId in the URL:
 *   - Fetches the session to get its projectId
 *   - Looks up the project slug from loaded projects
 *   - Sets selectedProjectId and corrects the URL slug if needed
 *
 * On project data change:
 *   - If the URL slug doesn't match the selected project's actual slug, updates the URL
 */
export function useRouteSync() {
  const queryClient = useQueryClient()
  const { data: projects } = useProjects()
  const selectedSessionId = useUIStore((s) => s.selectedSessionId)
  const selectedProjectId = useUIStore((s) => s.selectedProjectId)
  const selectedProjectSlug = useUIStore((s) => s.selectedProjectSlug)
  const currentView = useUIStore((s) => s.currentView)

  // On mount: resolve session → project if we have a sessionId but no projectId.
  // Use queryClient.fetchQuery so the result lands in the canonical
  // `['session', sessionId]` cache — SessionBreadcrumb + the permission-mode
  // backfill consumer both read from that key and skip their own fetches.
  // Without this, three separate paths each fetched /api/sessions/:id.
  useEffect(() => {
    if (!selectedSessionId || selectedProjectId) return

    queryClient
      .fetchQuery<Session>({
        queryKey: ['session', selectedSessionId],
        queryFn: () => api.getSession(selectedSessionId),
      })
      .then((session) => {
        if (!session) return
        const projectId = session.projectId
        // Find the project slug from loaded projects, or fetch it
        const project = projects?.find((p) => p.id === projectId)
        if (project) {
          useUIStore.getState().setSelectedProject(projectId, project.slug)
          // Re-set the session since setSelectedProject clears it
          useUIStore.getState().setSelectedSessionId(selectedSessionId)
        } else {
          // Projects not loaded yet — just set the ID, slug will be corrected later
          useUIStore.setState({ selectedProjectId: projectId })
        }
      })
      .catch(() => {
        // Session not found — clear the URL
        useUIStore.getState().setSelectedProject(null)
      })
  }, [selectedSessionId, selectedProjectId, projects])

  // When projects load: resolve slug → project ID, or correct a stale slug
  useEffect(() => {
    if (!projects) return

    // Have a slug from the URL but no project ID yet — resolve it
    if (!selectedProjectId && selectedProjectSlug) {
      const project = projects.find((p) => p.slug === selectedProjectSlug)
      if (project) {
        useUIStore.getState().setSelectedProject(project.id, project.slug)
      }
      return
    }

    // Have a project ID — make sure the URL slug matches
    if (selectedProjectId) {
      const project = projects.find((p) => p.id === selectedProjectId)
      if (project && project.slug !== selectedProjectSlug) {
        useUIStore.getState().updateProjectSlug(project.slug)
      }
    }
  }, [projects, selectedProjectId, selectedProjectSlug])

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
