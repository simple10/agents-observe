import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useUIStore } from '@/stores/ui-store'
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Pencil,
  Trash2,
  Check,
  X,
  Clock,
  CalendarDays,
  ArrowRightLeft,
  Folder,
  Copy,
} from 'lucide-react'
import { useProjects } from '@/hooks/use-projects'
import type { Project, Session } from '@/types'

interface ProjectModalProps {
  project: Project | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function shortenCwd(cwd: string): string {
  return cwd.replace(/^\/(?:Users|home)\/[^/]+/, '~')
}

export function ProjectModal({ project, open, onOpenChange }: ProjectModalProps) {
  const queryClient = useQueryClient()
  const { selectedProjectId, setSelectedProject } = useUIStore()

  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())
  const [confirmAction, setConfirmAction] = useState<'delete-project' | 'delete-sessions' | null>(
    null,
  )
  const [deleting, setDeleting] = useState(false)
  const [sortOrder, setSortOrder] = useState<'activity' | 'created'>('activity')
  const [moveSessionIds, setMoveSessionIds] = useState<Set<string> | null>(null)
  const [confirmMoveTarget, setConfirmMoveTarget] = useState<Project | null>(null)
  const [moving, setMoving] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const { data: sessions } = useQuery({
    queryKey: ['sessions', project?.id],
    queryFn: () => api.getSessions(project!.id),
    enabled: open && !!project,
  })

  const sortedSessions = sessions
    ? [...sessions].sort((a, b) => {
        if (sortOrder === 'activity') {
          const aTime = a.lastActivity || a.startedAt
          const bTime = b.lastActivity || b.startedAt
          return bTime - aTime
        }
        return b.startedAt - a.startedAt
      })
    : []

  // Reset state when modal opens/closes or project changes
  useEffect(() => {
    setIsRenaming(false)
    setRenameValue('')
    setSelectedSessionIds(new Set())
    setConfirmAction(null)
    setMoveSessionIds(null)
    setConfirmMoveTarget(null)
  }, [open, project?.id])

  useEffect(() => {
    if (isRenaming) renameInputRef.current?.focus()
  }, [isRenaming])

  const cwdSummary = useMemo(() => {
    if (!sessions?.length) return null
    const counts = new Map<string, number>()
    for (const s of sessions) {
      const cwd = typeof s.metadata?.cwd === 'string' ? s.metadata.cwd : null
      if (cwd) counts.set(cwd, (counts.get(cwd) || 0) + 1)
    }
    if (counts.size === 0) return null
    let topCwd = ''
    let topCount = 0
    for (const [cwd, count] of counts) {
      if (count > topCount) {
        topCwd = cwd
        topCount = count
      }
    }
    const otherCount = counts.size - 1
    return { cwd: shortenCwd(topCwd), otherCount }
  }, [sessions])

  if (!project) return null

  function startRenaming() {
    setRenameValue(project!.name)
    setIsRenaming(true)
  }

  async function saveRename() {
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === project!.name) {
      setIsRenaming(false)
      return
    }
    await api.renameProject(project!.id, trimmed)
    await queryClient.invalidateQueries({ queryKey: ['projects'] })
    setIsRenaming(false)
  }

  async function handleDeleteProject() {
    setDeleting(true)
    try {
      await api.deleteProject(project!.id)
      if (selectedProjectId === project!.id) setSelectedProject(null)
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      await queryClient.invalidateQueries({ queryKey: ['recentSessions'] })
      onOpenChange(false)
    } finally {
      setDeleting(false)
      setConfirmAction(null)
    }
  }

  async function handleDeleteSelectedSessions() {
    setDeleting(true)
    try {
      await Promise.all([...selectedSessionIds].map((id) => api.deleteSession(id)))
      setSelectedSessionIds(new Set())
      await queryClient.invalidateQueries({ queryKey: ['sessions', project!.id] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await queryClient.invalidateQueries({ queryKey: ['recentSessions'] })
    } finally {
      setDeleting(false)
      setConfirmAction(null)
    }
  }

  async function handleMoveSessions(targetProjectId: number) {
    if (!moveSessionIds) return
    setMoving(true)
    try {
      await Promise.all([...moveSessionIds].map((id) => api.moveSession(id, targetProjectId)))
      setSelectedSessionIds(new Set())
      setMoveSessionIds(null)
      setConfirmMoveTarget(null)
      await queryClient.invalidateQueries({ queryKey: ['sessions', project!.id] })
      await queryClient.invalidateQueries({ queryKey: ['sessions', targetProjectId] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await queryClient.invalidateQueries({ queryKey: ['recentSessions'] })
    } finally {
      setMoving(false)
    }
  }

  function toggleSession(id: string) {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedSessionIds.size === sortedSessions.length) {
      setSelectedSessionIds(new Set())
    } else {
      setSelectedSessionIds(new Set(sortedSessions.map((s) => s.id)))
    }
  }

  const allSelected = sortedSessions.length > 0 && selectedSessionIds.size === sortedSessions.length

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          className="w-[700px] max-w-[90vw] max-h-[80vh] flex flex-col p-0"
        >
          {/* Header: project name + actions */}
          <div className="flex items-center gap-3 px-5 pt-5 pb-1">
            {isRenaming ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename()
                    if (e.key === 'Escape') setIsRenaming(false)
                  }}
                  className="h-8 text-sm"
                />
                <Button variant="ghost" size="icon-xs" onClick={saveRename}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon-xs" onClick={() => setIsRenaming(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <>
                <DialogTitle
                  className="flex-1 min-w-0 truncate cursor-pointer hover:underline"
                  onClick={startRenaming}
                >
                  {project.name}
                </DialogTitle>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0"
                  onClick={startRenaming}
                  title="Rename project"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmAction('delete-project')}
                  title="Delete project"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <DialogClose asChild>
                  <Button variant="ghost" size="icon-xs" className="shrink-0" title="Close">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </DialogClose>
              </>
            )}
          </div>

          {cwdSummary && (
            <div className="px-5 pb-5 text-xs text-muted-foreground truncate">
              {cwdSummary.cwd}
              {cwdSummary.otherCount > 0 && (
                <span className="ml-1">
                  (+{cwdSummary.otherCount} other dir{cwdSummary.otherCount !== 1 ? 's' : ''})
                </span>
              )}
            </div>
          )}

          {/* Session list */}
          <div className="flex-1 min-h-0 overflow-y-auto border-t">
            {sortedSessions.length > 0 ? (
              <div className="divide-y divide-border/50">
                {/* Select all header */}
                <div className="flex items-center gap-3 px-5 py-2 min-h-12 bg-background sticky top-0 z-10 border-b border-border/50">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  <span className="text-xs text-muted-foreground">
                    {sortedSessions.length} session{sortedSessions.length !== 1 ? 's' : ''}
                    {selectedSessionIds.size > 0 && (
                      <span className="ml-1">({selectedSessionIds.size} selected)</span>
                    )}
                  </span>
                  {selectedSessionIds.size > 0 ? (
                    <div className="flex items-center gap-1 ml-auto">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setMoveSessionIds(new Set(selectedSessionIds))}
                      >
                        <ArrowRightLeft className="h-3 w-3 mr-1" />
                        Move selected
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setConfirmAction('delete-sessions')}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Delete selected
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="flex items-center gap-1 ml-auto text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                      onClick={() =>
                        setSortOrder(sortOrder === 'activity' ? 'created' : 'activity')
                      }
                    >
                      {sortOrder === 'activity' ? (
                        <>
                          <Clock className="h-3 w-3" /> Recent
                        </>
                      ) : (
                        <>
                          <CalendarDays className="h-3 w-3" /> Created
                        </>
                      )}
                    </button>
                  )}
                </div>
                {sortedSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    selected={selectedSessionIds.has(session.id)}
                    onToggle={() => toggleSession(session.id)}
                    onDelete={() => {
                      setSelectedSessionIds(new Set([session.id]))
                      setConfirmAction('delete-sessions')
                    }}
                    onRename={async (id, name) => {
                      await api.updateSessionSlug(id, name)
                      await queryClient.invalidateQueries({ queryKey: ['sessions', project!.id] })
                    }}
                    onMove={() => setMoveSessionIds(new Set([session.id]))}
                  />
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                No sessions
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === 'delete-project'
                ? `Delete project "${project.name}"?`
                : `Delete ${selectedSessionIds.size} session${selectedSessionIds.size !== 1 ? 's' : ''}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'delete-project'
                ? 'This will permanently delete this project and all its Observe logs. Your original Claude session files are not modified.'
                : 'This will permanently delete the selected session logs. Your original Claude session files are not modified.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                if (confirmAction === 'delete-project') handleDeleteProject()
                else if (confirmAction === 'delete-sessions') handleDeleteSelectedSessions()
              }}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Move session picker */}
      <MoveSessionModal
        open={moveSessionIds !== null}
        currentProjectId={project.id}
        sessionCount={moveSessionIds?.size ?? 0}
        onSelect={async (targetProject) => {
          if (!moveSessionIds) return
          if (moveSessionIds.size > 1) {
            setConfirmMoveTarget(targetProject)
          } else {
            await handleMoveSessions(targetProject.id)
          }
        }}
        onClose={() => setMoveSessionIds(null)}
      />

      {/* Move confirmation for multi-select */}
      <AlertDialog
        open={confirmMoveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmMoveTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Move {moveSessionIds?.size} session{(moveSessionIds?.size ?? 0) !== 1 ? 's' : ''} to
              &ldquo;{confirmMoveTarget?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The selected sessions will be moved from &ldquo;{project.name}&rdquo; to &ldquo;
              {confirmMoveTarget?.name}&rdquo;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={moving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={moving}
              onClick={() => {
                if (confirmMoveTarget) handleMoveSessions(confirmMoveTarget.id)
              }}
            >
              {moving ? 'Moving...' : 'Move'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function SessionRow({
  session,
  selected,
  onToggle,
  onDelete,
  onRename,
  onMove,
}: {
  session: Session
  selected: boolean
  onToggle: () => void
  onDelete: () => void
  onRename: (id: string, name: string) => Promise<void>
  onMove: () => void
}) {
  const label = session.slug || session.id.slice(0, 8)
  const activityTime = formatRelativeTime(session.lastActivity || session.startedAt)
  const createdTime = formatRelativeTime(session.startedAt)
  const cwd = typeof session.metadata?.cwd === 'string' ? shortenCwd(session.metadata.cwd) : null

  const jsonlPath = session.transcriptPath || null
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) inputRef.current?.focus()
  }, [isEditing])

  function startEditing(e: React.MouseEvent) {
    e.stopPropagation()
    setEditValue(label)
    setIsEditing(true)
  }

  async function saveEdit() {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== label) {
      await onRename(session.id, trimmed)
    }
    setIsEditing(false)
  }

  return (
    <div
      className="group flex items-center gap-3 px-5 py-2 hover:bg-muted/20 cursor-pointer"
      onClick={() => !isEditing && onToggle()}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={onToggle}
        onClick={(e) => e.stopPropagation()}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          {isEditing ? (
            <div
              className="flex items-center gap-1 flex-1 min-w-0"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                ref={inputRef}
                className="truncate bg-transparent border border-border rounded px-1 text-sm outline-none flex-1 min-w-0"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    saveEdit()
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setIsEditing(false)
                  }
                }}
              />
              <Button variant="ghost" size="icon-xs" onClick={saveEdit}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon-xs" onClick={() => setIsEditing(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <span className="truncate">{label}</span>
          )}
          {!isEditing && (
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
              Created {createdTime}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0">
          <span
            className={`h-1.5 w-1.5 rounded-full shrink-0 ${
              session.status === 'active'
                ? 'bg-green-500'
                : 'bg-muted-foreground/60 dark:bg-muted-foreground/40'
            }`}
          />
          <span className="shrink-0">{activityTime}</span>
          {session.eventCount != null && (
            <span className="shrink-0">{session.eventCount} events</span>
          )}
          {cwd && <span className="ml-auto truncate">{cwd}</span>}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon-xs" title="Rename" onClick={startEditing}>
          <Pencil className="h-3 w-3 text-muted-foreground/40 group-hover:text-yellow-500 transition-colors" />
        </Button>
        {jsonlPath && (
          <Button
            variant="ghost"
            size="icon-xs"
            title={copied ? 'Copied!' : 'Copy JSONL path'}
            onClick={() => {
              navigator.clipboard.writeText(jsonlPath)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
            )}
          </Button>
        )}
        <Button variant="ghost" size="icon-xs" title="Move to project" onClick={onMove}>
          <ArrowRightLeft className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title="Delete"
          className="group-hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
        </Button>
      </div>
    </div>
  )
}

export function MoveSessionModal({
  open,
  currentProjectId,
  sessionCount,
  onSelect,
  onClose,
}: {
  open: boolean
  currentProjectId: number
  sessionCount: number
  onSelect: (project: Project) => void
  onClose: () => void
}) {
  const { data: projects } = useProjects()
  const otherProjects = projects?.filter((p) => p.id !== currentProjectId) ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="w-[400px] max-w-[90vw] max-h-[60vh] flex flex-col p-0"
      >
        <div className="px-5 pt-5 pb-3">
          <DialogTitle>
            Move {sessionCount} session{sessionCount !== 1 ? 's' : ''} to...
          </DialogTitle>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto border-t">
          {otherProjects.length > 0 ? (
            <div className="divide-y divide-border/50">
              {otherProjects.map((p) => (
                <button
                  key={p.id}
                  className="flex items-center gap-3 w-full px-5 py-3 text-sm hover:bg-accent/50 transition-colors cursor-pointer text-left"
                  onClick={() => onSelect(p)}
                >
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{p.name}</span>
                  {p.sessionCount != null && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {p.sessionCount} sessions
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              No other projects
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
