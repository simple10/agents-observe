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
import { Trash2, DatabaseZap } from 'lucide-react'

export function ProjectsTab() {
  const { data: projects, isLoading } = useProjects()
  const queryClient = useQueryClient()
  const { selectedProjectId, setSelectedProjectId } = useUIStore()

  const [confirmDelete, setConfirmDelete] = useState<{ type: 'project'; id: string; name: string } | { type: 'all' } | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function handleDeleteProject(projectId: string) {
    setDeleting(true)
    try {
      await api.deleteProject(projectId)
      // If the deleted project was selected, clear selection
      if (selectedProjectId === projectId) {
        setSelectedProjectId(null)
      }
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      await queryClient.invalidateQueries({ queryKey: ['recentSessions'] })
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }

  async function handleDeleteAll() {
    setDeleting(true)
    try {
      await api.deleteAllData()
      // Clear all selection state
      setSelectedProjectId(null)
      await queryClient.invalidateQueries()
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
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
            <div
              key={project.id}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{project.name}</div>
                <div className="text-xs text-muted-foreground">
                  {project.sessionCount ?? 0} session{project.sessionCount !== 1 ? 's' : ''}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDelete({ type: 'project', id: project.id, name: project.name })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
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
          onClick={() => setConfirmDelete({ type: 'all' })}
        >
          <DatabaseZap className="h-3.5 w-3.5" />
          Delete All Logs
        </Button>
        <p className="text-xs text-muted-foreground mt-1.5">
          Permanently removes all projects, sessions, agents, and events.
        </p>
      </div>

      {/* Confirmation dialogs */}
      <AlertDialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDelete?.type === 'all' ? 'Delete all logs?' : `Delete project "${confirmDelete?.type === 'project' ? confirmDelete.name : ''}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.type === 'all'
                ? 'This will permanently delete all projects, sessions, agents, and events. This action cannot be undone.'
                : 'This will permanently delete this project and all its sessions, agents, and events. This action cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                if (confirmDelete?.type === 'project') {
                  handleDeleteProject(confirmDelete.id)
                } else if (confirmDelete?.type === 'all') {
                  handleDeleteAll()
                }
              }}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
