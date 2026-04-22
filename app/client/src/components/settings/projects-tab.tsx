import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useProjects } from '@/hooks/use-projects'
import { useUIStore } from '@/stores/ui-store'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { SquarePen, DatabaseZap } from 'lucide-react'
import { ProjectModal } from './project-modal'
import type { Project } from '@/types'

export function ProjectsTab() {
  const { data: projects, isLoading } = useProjects()
  const queryClient = useQueryClient()
  const { setSelectedProject } = useUIStore()

  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [modalProject, setModalProject] = useState<Project | null>(null)

  async function handleDeleteAll() {
    setDeleting(true)
    try {
      await api.deleteAllData()
      setSelectedProject(null)
      await queryClient.invalidateQueries()
    } finally {
      setDeleting(false)
      setConfirmDeleteAll(false)
    }
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading projects...</div>
  }

  return (
    <div className="space-y-4">
      {/* Project list */}
      {projects && projects.length > 0 ? (
        <div className="space-y-1">
          {projects.map((project) => (
            <button
              key={project.id}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 w-full text-left hover:bg-muted/50 cursor-pointer"
              onClick={() => setModalProject(project)}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{project.name}</div>
                <div className="text-xs text-muted-foreground">
                  {project.sessionCount ?? 0} session{project.sessionCount !== 1 ? 's' : ''}
                </div>
              </div>
              <SquarePen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No projects found.</div>
      )}

      {/* Delete All Logs */}
      <div className="border-t pt-4">
        <Button
          variant="destructive"
          size="sm"
          className="gap-1.5"
          onClick={() => setConfirmDeleteAll(true)}
        >
          <DatabaseZap className="h-3.5 w-3.5" />
          Delete All Logs
        </Button>
        <p className="text-xs text-muted-foreground mt-1.5">
          Permanently removes all projects, sessions, agents, and events.
        </p>
      </div>

      {/* Delete All confirmation */}
      <AlertDialog open={confirmDeleteAll} onOpenChange={setConfirmDeleteAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all logs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all Observe logs (projects, sessions, agents, and
              events). Your original Claude session files are not modified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleting} onClick={handleDeleteAll}>
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Project detail modal */}
      <ProjectModal
        project={modalProject}
        open={modalProject !== null}
        onOpenChange={(open) => !open && setModalProject(null)}
      />
    </div>
  )
}
