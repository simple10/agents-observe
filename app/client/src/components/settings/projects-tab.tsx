import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useProjects } from '@/hooks/use-projects'
import { useRecentSessions } from '@/hooks/use-recent-sessions'
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
import { SquarePen, DatabaseZap, Folder, ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ProjectModal } from './project-modal'
import { ApiError } from '@/lib/api-client'
import type { Project } from '@/types'

type SortBy = 'name' | 'sessions' | 'events' | 'created' | 'activity'
type SortDir = 'asc' | 'desc'

// Same convention as the Sessions tab: name sorts alphabetical, dates
// oldest-first, counts biggest-first. Clicking the active column flips
// direction.
const DEFAULT_SORT_DIR: Record<SortBy, SortDir> = {
  name: 'asc',
  sessions: 'desc',
  events: 'desc',
  created: 'asc',
  activity: 'asc',
}

const DAY_MS = 24 * 60 * 60 * 1000

// Duplicated from sessions-tab.tsx / session-list.tsx rather than
// pulling in a shared helper module — one-liners, low risk of drift.
function shortenCwd(cwd: string): string {
  return cwd.replace(/^\/(?:Users|home)\/[^/]+/, '~')
}

function formatDate(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < DAY_MS) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  const days = Math.floor(diff / DAY_MS)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

interface ProjectRow {
  project: Project
  eventCount: number
  lastActivity: number
  hasActiveSession: boolean
  // The most-recently-active session's cwd stands in as the project
  // cwd for display. Projects with no sessions (or no cwd-tagged
  // sessions) render a dash.
  cwd: string | null
}

export function ProjectsTab() {
  const { data: projects, isLoading } = useProjects()
  const { data: sessions } = useRecentSessions(10000)
  const queryClient = useQueryClient()
  const { setSelectedProject } = useUIStore()

  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [modalProject, setModalProject] = useState<Project | null>(null)
  const [sortBy, setSortBy] = useState<SortBy>('name')
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR.name)
  // Confirmation + busy state for single-project deletion.
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<Project | null>(null)
  const [deletingProject, setDeletingProject] = useState(false)
  // New-project dialog state.
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Aggregate session stats per project. We intentionally do this on
  // the client instead of extending GET /api/projects — the sessions
  // endpoint already returns every field we need, and both tabs share
  // the query cache so there's no extra network cost.
  const rows: ProjectRow[] = useMemo(() => {
    if (!projects) return []
    const byId = new Map<number, Omit<ProjectRow, 'project'>>()
    for (const s of sessions ?? []) {
      const la = s.lastActivity || s.startedAt
      const prev = byId.get(s.projectId) ?? {
        eventCount: 0,
        lastActivity: 0,
        hasActiveSession: false,
        cwd: null,
      }
      prev.eventCount += s.eventCount ?? 0
      if (la > prev.lastActivity) {
        prev.lastActivity = la
        const cwd = typeof s.metadata?.cwd === 'string' ? s.metadata.cwd : null
        if (cwd) prev.cwd = cwd
      }
      if (s.status === 'active') prev.hasActiveSession = true
      byId.set(s.projectId, prev)
    }
    return projects.map((p) => {
      const agg = byId.get(p.id)
      return {
        project: p,
        eventCount: agg?.eventCount ?? 0,
        lastActivity: agg?.lastActivity ?? 0,
        hasActiveSession: agg?.hasActiveSession ?? false,
        cwd: agg?.cwd ?? null,
      }
    })
  }, [projects, sessions])

  const sortedRows = useMemo(() => {
    const dirMul = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      let diff = 0
      if (sortBy === 'name') {
        diff = a.project.name.localeCompare(b.project.name)
      } else if (sortBy === 'sessions') {
        diff = (a.project.sessionCount ?? 0) - (b.project.sessionCount ?? 0)
      } else if (sortBy === 'events') {
        diff = a.eventCount - b.eventCount
      } else if (sortBy === 'created') {
        diff = a.project.createdAt - b.project.createdAt
      } else {
        diff = a.lastActivity - b.lastActivity
      }
      return diff * dirMul
    })
  }, [rows, sortBy, sortDir])

  function toggleSort(col: SortBy) {
    if (col === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir(DEFAULT_SORT_DIR[col])
    }
  }

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

  async function handleDeleteProject() {
    if (!confirmDeleteProject) return
    setDeletingProject(true)
    try {
      await api.deleteProject(confirmDeleteProject.id)
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await queryClient.invalidateQueries({ queryKey: ['recent-sessions'] })
    } finally {
      setDeletingProject(false)
      setConfirmDeleteProject(null)
    }
  }

  async function handleCreateProject() {
    const name = newProjectName.trim()
    if (!name) return
    setCreating(true)
    setCreateError(null)
    try {
      await api.createProject({ name })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      setNewProjectName('')
      setNewProjectOpen(false)
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Failed to create project')
    } finally {
      setCreating(false)
    }
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading projects...</div>
  }

  return (
    <div className="space-y-4">
      {/* New Project button — sits above the table so creation is
          discoverable without scrolling. */}
      <div className="flex items-center">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setNewProjectName('')
            setCreateError(null)
            setNewProjectOpen(true)
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          New Project
        </Button>
      </div>

      {/* Project table — columns: name | created | last activity |
          sessions | events | open | delete. CWD lives on a second row
          within each body row (same pattern as Sessions tab). */}
      {projects && projects.length > 0 ? (
        <div className="rounded-md border">
          <div className="grid grid-cols-[1fr_85px_95px_60px_55px_72px] items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/30">
            <SortHeader
              label={`Project (${sortedRows.length})`}
              active={sortBy === 'name'}
              dir={sortDir}
              onClick={() => toggleSort('name')}
            />
            <SortHeader
              label="Created"
              active={sortBy === 'created'}
              dir={sortDir}
              onClick={() => toggleSort('created')}
            />
            <SortHeader
              label="Last activity"
              active={sortBy === 'activity'}
              dir={sortDir}
              onClick={() => toggleSort('activity')}
            />
            <SortHeader
              label="Sessions"
              align="right"
              active={sortBy === 'sessions'}
              dir={sortDir}
              onClick={() => toggleSort('sessions')}
            />
            <SortHeader
              label="Events"
              align="right"
              active={sortBy === 'events'}
              dir={sortDir}
              onClick={() => toggleSort('events')}
            />
            <span />
          </div>

          <div className="max-h-[50vh] overflow-y-auto">
            {sortedRows.map((row) => (
              <ProjectRowView
                key={row.project.id}
                row={row}
                onOpen={() => setModalProject(row.project)}
                onDelete={() => setConfirmDeleteProject(row.project)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No projects found.</div>
      )}

      {/* Nuclear delete-all — de-emphasized by default (outline only).
          The destructive styling only kicks in on hover so the button
          doesn't draw attention away from the per-project actions.
          Extra top padding separates it visually from the table since
          we dropped the previous border-t divider. */}
      <div className="pt-4">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
          onClick={() => setConfirmDeleteAll(true)}
        >
          <DatabaseZap className="h-3.5 w-3.5" />
          Delete All Projects &amp; Logs
        </Button>
        <p className="text-xs text-muted-foreground mt-1.5">
          Permanently removes all projects, sessions, agents, and events.
        </p>
      </div>

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

      <ProjectModal
        project={modalProject}
        open={modalProject !== null}
        onOpenChange={(open) => !open && setModalProject(null)}
      />

      {/* Per-project delete confirmation */}
      <AlertDialog
        open={confirmDeleteProject !== null}
        onOpenChange={(o) => !o && setConfirmDeleteProject(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete project &ldquo;{confirmDeleteProject?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the project and all of its sessions, agents, and events from
              the Observe database. Your original Claude session files are not modified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingProject}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingProject}
              onClick={(e) => {
                e.preventDefault()
                handleDeleteProject()
              }}
            >
              {deletingProject ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New-project dialog */}
      <Dialog
        open={newProjectOpen}
        onOpenChange={(o) => {
          if (!o && !creating) {
            setNewProjectOpen(false)
            setCreateError(null)
          }
        }}
      >
        <DialogContent className="w-[420px] max-w-[90vw] p-6">
          <DialogTitle>New Project</DialogTitle>
          <div className="space-y-2">
            <Input
              autoFocus
              placeholder="Project name"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !creating && newProjectName.trim()) {
                  e.preventDefault()
                  handleCreateProject()
                }
              }}
            />
            {createError && <p className="text-xs text-destructive">{createError}</p>}
            <p className="text-xs text-muted-foreground">
              Sessions get routed to a project by cwd or transcript path. You can pre-create an
              empty project here and move existing sessions into it from the project modal.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={creating}
              onClick={() => setNewProjectOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={creating || !newProjectName.trim()}
              onClick={handleCreateProject}
            >
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ProjectRowView({
  row,
  onOpen,
  onDelete,
}: {
  row: ProjectRow
  onOpen: () => void
  onDelete: () => void
}) {
  const { project, eventCount, lastActivity, hasActiveSession, cwd } = row
  return (
    // Two grid rows: row 1 holds name + columns + open + delete icons;
    // row 2 holds the cwd, spanning the date/count columns (not the
    // two icon columns which are row-spanned). Mirrors Sessions tab.
    <button
      type="button"
      onClick={onOpen}
      className="group grid w-full grid-cols-[1fr_85px_95px_60px_55px_72px] gap-x-2 gap-y-0.5 px-3 py-2 border-b last:border-b-0 text-sm hover:bg-muted/30 cursor-pointer text-left"
      title={`Open ${project.name}`}
    >
      <div className="flex items-center gap-2 min-w-0 self-center">
        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        <span
          className={
            'h-2 w-2 shrink-0 rounded-full ' +
            (hasActiveSession
              ? 'bg-green-500'
              : 'bg-muted-foreground/60 dark:bg-muted-foreground/40')
          }
          title={hasActiveSession ? 'Has active session' : 'No active sessions'}
        />
        <span className="truncate font-medium">{project.name}</span>
      </div>
      <span className="text-xs text-muted-foreground tabular-nums self-center">
        {formatDate(project.createdAt)}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums self-center">
        {formatDate(lastActivity || null)}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums text-right self-center">
        {(project.sessionCount ?? 0).toLocaleString()}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums text-right self-center">
        {eventCount.toLocaleString()}
      </span>
      {/* Open + delete icons share a single grid cell with a tight
          internal gap so the two icons sit closer together than the
          inter-column gap. row-span-2 keeps them vertically centered
          across the two-line row. */}
      <div className="row-span-2 self-center flex items-center justify-end gap-0.5">
        <span
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 group-hover:text-foreground group-hover:bg-muted transition-colors"
          aria-hidden="true"
        >
          <SquarePen className="h-3.5 w-3.5" />
        </span>
        {/* Per-row delete — opens an AlertDialog at the tab level so we
            reuse a single confirmation flow. stopPropagation keeps the
            row's main click (open modal) from firing. */}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onDelete()
            }
          }}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 hover:bg-destructive/10 hover:text-destructive transition-colors"
          title={`Delete ${project.name}`}
          aria-label={`Delete ${project.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </span>
      </div>

      {/* Second row: cwd spans cols 1-5 (not under the icons column). */}
      <div
        className="col-start-1 col-span-5 min-w-0 truncate text-xs text-muted-foreground/80"
        dir="rtl"
        title={cwd ?? ''}
      >
        <span dir="ltr">{cwd ? shortenCwd(cwd) : '—'}</span>
      </div>
    </button>
  )
}

function SortHeader({
  label,
  active,
  dir,
  align = 'left',
  onClick,
}: {
  label: string
  active: boolean
  dir: SortDir
  align?: 'left' | 'right'
  onClick: () => void
}) {
  const Chevron = dir === 'asc' ? ChevronUp : ChevronDown
  // Only render the chevron when the column is the active sort — that
  // lets us pack the right-aligned numeric headers (Sessions, Events)
  // into tighter columns whose labels wouldn't fit alongside a
  // permanently-reserved chevron slot. When the active column changes,
  // the activated header nudges horizontally by ~16px, but the body
  // cells below are unaffected.
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors ' +
        (align === 'right' ? 'justify-end' : 'justify-start') +
        (active ? ' text-foreground' : '')
      }
      title={`Sort by ${label.toLowerCase()}`}
    >
      {active && align === 'right' && <Chevron className="h-3 w-3" />}
      <span>{label}</span>
      {active && align !== 'right' && <Chevron className="h-3 w-3" />}
    </button>
  )
}
