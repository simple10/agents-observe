import { useEffect } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useProjects } from '@/hooks/use-projects'
import { api } from '@/lib/api-client'

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
  const { data: projects } = useProjects()
  const selectedSessionId = useUIStore((s) => s.selectedSessionId)
  const selectedProjectId = useUIStore((s) => s.selectedProjectId)
  const selectedProjectSlug = useUIStore((s) => s.selectedProjectSlug)

  // On mount: resolve session → project if we have a sessionId but no projectId
  useEffect(() => {
    if (!selectedSessionId || selectedProjectId) return

    api.getSession(selectedSessionId).then((session) => {
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
    }).catch(() => {
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
}
