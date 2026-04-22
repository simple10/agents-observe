import { useMemo, useState, useEffect, useRef } from 'react'
import { useRecentSessions } from '@/hooks/use-recent-sessions'
import { useUIStore } from '@/stores/ui-store'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Search,
  X,
  Tag,
  Folder,
  Clock,
  Pencil,
  Trash2,
  Check,
  Tags,
  FolderTree,
  Plus,
  SquarePen,
} from 'lucide-react'
// LabelsModalBody is now rendered inside the Settings modal as the
// "Labels" tab. The standalone modal wrapper is gone.
import type { Label, RecentSession } from '@/types'

const RECENT_LIMIT = 1000

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

function sessionCwd(session: RecentSession): string | null {
  const cwd = session.metadata?.cwd
  return typeof cwd === 'string' ? cwd : null
}

function sessionLabel(session: RecentSession): string {
  return session.slug || session.id.slice(0, 8)
}

function matchesSearch(session: RecentSession, sessionLabels: Label[], query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  if (sessionLabel(session).toLowerCase().includes(q)) return true
  const cwd = sessionCwd(session)
  if (cwd && cwd.toLowerCase().includes(q)) return true
  if (session.transcriptPath && session.transcriptPath.toLowerCase().includes(q)) return true
  if (sessionLabels.some((l) => l.name.toLowerCase().includes(q))) return true
  return false
}

type ViewMode = 'label' | 'cwd'

export function LabelsModalBody() {
  const labels = useUIStore((s) => s.labels)
  const labelMemberships = useUIStore((s) => s.labelMemberships)
  const setSelectedProject = useUIStore((s) => s.setSelectedProject)
  const setSelectedSessionId = useUIStore((s) => s.setSelectedSessionId)
  const closeLabelsModal = useUIStore((s) => s.closeLabelsModal)
  const createLabel = useUIStore((s) => s.createLabel)
  const setEditingSessionId = useUIStore((s) => s.setEditingSessionId)
  const scrollToLabelId = useUIStore((s) => s.labelsModalScrollToId)
  const clearScrollTarget = useUIStore((s) => s.clearLabelsModalScrollTarget)

  const { data: sessions } = useRecentSessions(RECENT_LIMIT)
  const [viewMode, setViewMode] = useState<ViewMode>('label')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelError, setNewLabelError] = useState<string | null>(null)
  const [highlightLabelId, setHighlightLabelId] = useState<string | null>(null)
  const labelRefs = useRef(new Map<string, HTMLDivElement | null>())
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  // If we opened with a scroll target, switch to By-label and scroll to it.
  useEffect(() => {
    if (!scrollToLabelId) return
    setViewMode('label')
    setSearch('')
    setDebouncedSearch('')
    const id = scrollToLabelId
    // Wait a frame so the target group has rendered.
    const handle = requestAnimationFrame(() => {
      const el = labelRefs.current.get(id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        setHighlightLabelId(id)
        setTimeout(() => setHighlightLabelId((cur) => (cur === id ? null : cur)), 1400)
      }
      clearScrollTarget()
    })
    return () => cancelAnimationFrame(handle)
  }, [scrollToLabelId, clearScrollTarget])

  const labeledSessionIds = useMemo(() => {
    const set = new Set<string>()
    for (const ids of labelMemberships.values()) {
      for (const id of ids) set.add(id)
    }
    return set
  }, [labelMemberships])

  const sessionsById = useMemo(() => {
    const map = new Map<string, RecentSession>()
    if (!sessions) return map
    for (const s of sessions) map.set(s.id, s)
    return map
  }, [sessions])

  const labelsBySession = useMemo(() => {
    const map = new Map<string, Label[]>()
    for (const label of labels) {
      const ids = labelMemberships.get(label.id) ?? new Set()
      for (const id of ids) {
        const list = map.get(id) ?? []
        list.push(label)
        map.set(id, list)
      }
    }
    return map
  }, [labels, labelMemberships])

  const handleOpenSession = (session: RecentSession) => {
    setSelectedProject(session.projectId, session.projectSlug || null)
    setSelectedSessionId(session.id)
    closeLabelsModal()
  }

  const handleOpenDetails = (sessionId: string) => {
    closeLabelsModal()
    setEditingSessionId(sessionId, 'details')
  }

  const submitNewLabel = () => {
    const trimmed = newLabelName.trim()
    if (!trimmed) {
      setCreating(false)
      return
    }
    const lower = trimmed.toLowerCase()
    if (labels.some((l) => l.name.toLowerCase() === lower)) {
      setNewLabelError('A label with that name already exists')
      return
    }
    const created = createLabel(trimmed)
    if (!created) {
      setNewLabelError('Could not create label')
      return
    }
    setNewLabelName('')
    setNewLabelError(null)
    setCreating(false)
    setViewMode('label')
    // Scroll-and-highlight the new label group — even though it has no
    // sessions yet, we make the group visible so the user sees it landed.
    setHighlightLabelId(created.id)
    requestAnimationFrame(() => {
      const el = labelRefs.current.get(created.id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setTimeout(() => setHighlightLabelId((cur) => (cur === created.id ? null : cur)), 1400)
    })
  }

  const registerLabelRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) labelRefs.current.set(id, el)
    else labelRefs.current.delete(id)
  }

  const labelCount = labels.length
  const labeledTotal = labeledSessionIds.size

  return (
    <>
      {/* Stats line — title + close are provided by the Settings modal
          chrome, so we just show counts here. */}
      <div className="px-5 pt-3 pb-2 text-xs text-muted-foreground">
        {labelCount} {labelCount === 1 ? 'label' : 'labels'} · {labeledTotal}{' '}
        {labeledTotal === 1 ? 'session' : 'sessions'}
      </div>

      <div className="px-5 pb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search labels, sessions, cwd, or transcript path..."
            className="h-8 text-xs pl-7 pr-7"
          />
          {search && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            type="button"
            className={`px-2 py-1 text-[11px] flex items-center gap-1 cursor-pointer transition-colors ${
              viewMode === 'label'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setViewMode('label')}
            aria-pressed={viewMode === 'label'}
          >
            <Tags className="h-3 w-3" /> By label
          </button>
          <button
            type="button"
            className={`px-2 py-1 text-[11px] flex items-center gap-1 cursor-pointer transition-colors ${
              viewMode === 'cwd'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setViewMode('cwd')}
            aria-pressed={viewMode === 'cwd'}
          >
            <FolderTree className="h-3 w-3" /> By cwd
          </button>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            setCreating(true)
            setNewLabelError(null)
          }}
        >
          <Plus className="h-3 w-3 mr-1" />
          New label
        </Button>
      </div>

      {creating && (
        <div className="px-5 pb-3">
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={newLabelName}
              onChange={(e) => {
                setNewLabelName(e.target.value)
                if (newLabelError) setNewLabelError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitNewLabel()
                }
                if (e.key === 'Escape') {
                  setCreating(false)
                  setNewLabelName('')
                  setNewLabelError(null)
                }
              }}
              placeholder="New label name..."
              className="h-8 text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={submitNewLabel}
              disabled={!newLabelName.trim()}
            >
              Add
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => {
                setCreating(false)
                setNewLabelName('')
                setNewLabelError(null)
              }}
            >
              Cancel
            </Button>
          </div>
          {newLabelError && <p className="text-[10px] text-destructive mt-1">{newLabelError}</p>}
        </div>
      )}

      <div ref={scrollContainerRef} className="border-t flex-1 overflow-y-auto">
        {labelCount === 0 ? (
          <EmptyState title="No labels yet">
            Create your first label with the <strong>New label</strong> button above, or open any
            session's <strong>Labels</strong> tab to bookmark it.
          </EmptyState>
        ) : viewMode === 'label' ? (
          <ByLabelView
            labels={labels}
            labelMemberships={labelMemberships}
            labelsBySession={labelsBySession}
            sessionsById={sessionsById}
            search={debouncedSearch}
            highlightLabelId={highlightLabelId}
            registerLabelRef={registerLabelRef}
            onOpenSession={handleOpenSession}
            onOpenDetails={handleOpenDetails}
          />
        ) : labeledTotal === 0 ? (
          <EmptyState title="No sessions labeled yet">
            You have labels, but none of them have sessions yet. Visit a session and toggle a label
            on.
          </EmptyState>
        ) : (
          <ByCwdView
            labelsBySession={labelsBySession}
            labeledSessionIds={labeledSessionIds}
            sessionsById={sessionsById}
            search={debouncedSearch}
            onOpenSession={handleOpenSession}
            onOpenDetails={handleOpenDetails}
          />
        )}
      </div>

      <div className="border-t px-5 py-2 text-[10px] text-muted-foreground/70">
        Labels are saved in this browser only.
      </div>
    </>
  )
}

function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-10 text-center text-xs text-muted-foreground">
      <div className="mb-1 font-medium text-foreground/80">{title}</div>
      <div>{children}</div>
    </div>
  )
}

function ByLabelView({
  labels,
  labelMemberships,
  labelsBySession,
  sessionsById,
  search,
  highlightLabelId,
  registerLabelRef,
  onOpenSession,
  onOpenDetails,
}: {
  labels: Label[]
  labelMemberships: Map<string, Set<string>>
  labelsBySession: Map<string, Label[]>
  sessionsById: Map<string, RecentSession>
  search: string
  highlightLabelId: string | null
  registerLabelRef: (id: string) => (el: HTMLDivElement | null) => void
  onOpenSession: (session: RecentSession) => void
  onOpenDetails: (sessionId: string) => void
}) {
  const sortedLabels = useMemo(
    () => [...labels].sort((a, b) => a.name.localeCompare(b.name)),
    [labels],
  )

  const groups = useMemo(() => {
    return sortedLabels.map((label) => {
      const sessionIds = labelMemberships.get(label.id) ?? new Set<string>()
      const sessions: RecentSession[] = []
      for (const id of sessionIds) {
        const s = sessionsById.get(id)
        if (!s) continue
        const sLabels = labelsBySession.get(s.id) ?? []
        if (matchesSearch(s, sLabels, search)) sessions.push(s)
      }
      sessions.sort((a, b) => b.lastActivity - a.lastActivity)
      return { label, sessions }
    })
  }, [sortedLabels, labelMemberships, labelsBySession, sessionsById, search])

  // With search, hide label groups whose sessions don't match AND whose
  // own name doesn't match. With no search, always show every group
  // (including empty ones — gives the user a place to see a freshly
  // created label and lets them delete it).
  const q = search.toLowerCase()
  const visibleGroups = groups.filter((g) => {
    if (!search) return true
    if (g.sessions.length > 0) return true
    return g.label.name.toLowerCase().includes(q)
  })

  if (visibleGroups.length === 0) {
    return (
      <EmptyState title="No matches">
        No labels or sessions match "<strong>{search}</strong>".
      </EmptyState>
    )
  }

  return (
    <div className="divide-y divide-border">
      {visibleGroups.map((group) => (
        <LabelGroup
          key={group.label.id}
          label={group.label}
          sessions={group.sessions}
          highlighted={highlightLabelId === group.label.id}
          innerRef={registerLabelRef(group.label.id)}
          onOpenSession={onOpenSession}
          onOpenDetails={onOpenDetails}
        />
      ))}
    </div>
  )
}

function ByCwdView({
  labelsBySession,
  labeledSessionIds,
  sessionsById,
  search,
  onOpenSession,
  onOpenDetails,
}: {
  labelsBySession: Map<string, Label[]>
  labeledSessionIds: Set<string>
  sessionsById: Map<string, RecentSession>
  search: string
  onOpenSession: (session: RecentSession) => void
  onOpenDetails: (sessionId: string) => void
}) {
  const groups = useMemo(() => {
    const byCwd = new Map<string, RecentSession[]>()
    for (const id of labeledSessionIds) {
      const session = sessionsById.get(id)
      if (!session) continue
      const sLabels = labelsBySession.get(session.id) ?? []
      if (!matchesSearch(session, sLabels, search)) continue
      const cwd = sessionCwd(session) ?? '(no cwd)'
      const list = byCwd.get(cwd) ?? []
      list.push(session)
      byCwd.set(cwd, list)
    }
    return [...byCwd.entries()]
      .map(([cwd, sessions]) => ({
        cwd,
        sessions: sessions.sort((a, b) => b.lastActivity - a.lastActivity),
      }))
      .sort((a, b) => a.cwd.localeCompare(b.cwd))
  }, [labeledSessionIds, sessionsById, labelsBySession, search])

  if (groups.length === 0) {
    return (
      <EmptyState title="No matches">
        No labeled sessions match "<strong>{search}</strong>".
      </EmptyState>
    )
  }

  return (
    <div className="divide-y divide-border">
      {groups.map((group) => (
        <div key={group.cwd} className="py-1">
          <div className="px-5 py-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">
            <Folder className="h-3 w-3 shrink-0" />
            <span className="truncate" title={group.cwd}>
              {group.cwd === '(no cwd)' ? group.cwd : shortenCwd(group.cwd)}
            </span>
            <span className="ml-auto">
              {group.sessions.length} {group.sessions.length === 1 ? 'session' : 'sessions'}
            </span>
          </div>
          {group.sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              sessionLabels={labelsBySession.get(session.id) ?? []}
              showLabels
              onOpen={() => onOpenSession(session)}
              onOpenDetails={() => onOpenDetails(session.id)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function LabelGroup({
  label,
  sessions,
  highlighted,
  innerRef,
  onOpenSession,
  onOpenDetails,
}: {
  label: Label
  sessions: RecentSession[]
  highlighted: boolean
  innerRef: (el: HTMLDivElement | null) => void
  onOpenSession: (session: RecentSession) => void
  onOpenDetails: (sessionId: string) => void
}) {
  const renameLabel = useUIStore((s) => s.renameLabel)
  const deleteLabel = useUIStore((s) => s.deleteLabel)
  const toggleSessionLabel = useUIStore((s) => s.toggleSessionLabel)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(label.name)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const submitRename = () => {
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === label.name) {
      setIsRenaming(false)
      setRenameError(null)
      return
    }
    const ok = renameLabel(label.id, trimmed)
    if (!ok) {
      setRenameError('A label with that name already exists')
      return
    }
    setIsRenaming(false)
    setRenameError(null)
  }

  return (
    <div ref={innerRef} className={`py-1 transition-colors ${highlighted ? 'bg-primary/10' : ''}`}>
      <div className="px-5 py-1.5 flex items-center gap-2 group/header">
        <Tag className="h-3 w-3 shrink-0 text-muted-foreground" />
        {isRenaming ? (
          <div className="flex-1 flex items-center gap-1.5">
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => {
                setRenameValue(e.target.value)
                if (renameError) setRenameError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitRename()
                }
                if (e.key === 'Escape') {
                  setIsRenaming(false)
                  setRenameValue(label.name)
                  setRenameError(null)
                }
              }}
              className="h-6 text-xs"
            />
            <Button variant="ghost" size="icon-xs" onClick={submitRename} title="Save">
              <Check className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                setIsRenaming(false)
                setRenameValue(label.name)
                setRenameError(null)
              }}
              title="Cancel"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <>
            <span className="text-xs font-medium truncate">{label.name}</span>
            <Badge variant="secondary" className="text-[10px] h-4 px-1">
              {sessions.length}
            </Badge>
            <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/header:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => {
                  setRenameValue(label.name)
                  setIsRenaming(true)
                }}
                title="Rename"
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </>
        )}
      </div>
      {renameError && <div className="px-5 pb-1 text-[10px] text-destructive">{renameError}</div>}
      {sessions.length === 0 && (
        <div className="px-5 py-2 text-[11px] text-muted-foreground/70 italic">
          No sessions in this label yet.
        </div>
      )}
      {sessions.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          sessionLabels={[]}
          showLabels={false}
          onOpen={() => onOpenSession(session)}
          onOpenDetails={() => onOpenDetails(session.id)}
          onRemoveFromLabel={() => toggleSessionLabel(label.id, session.id)}
        />
      ))}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete label "{label.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the label from every session. The sessions themselves are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                deleteLabel(label.id)
                setConfirmDelete(false)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SessionRow({
  session,
  sessionLabels,
  showLabels,
  onOpen,
  onOpenDetails,
  onRemoveFromLabel,
}: {
  session: RecentSession
  sessionLabels: Label[]
  showLabels: boolean
  onOpen: () => void
  onOpenDetails: () => void
  // Only provided in ByLabel view — where "remove" has clear scope
  // (unassign this session from the enclosing label group). In ByCwd
  // view the session may belong to many labels, so removing "from the
  // label" is ambiguous and we skip the action.
  onRemoveFromLabel?: () => void
}) {
  const name = sessionLabel(session)
  const cwd = sessionCwd(session)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="w-full text-left px-5 py-2 hover:bg-accent/50 transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            session.status === 'active'
              ? 'bg-green-500'
              : 'bg-muted-foreground/60 dark:bg-muted-foreground/40'
          }`}
        />
        <span className="text-xs font-medium truncate">{name}</span>
        {session.projectName && (
          <span className="text-[11px] text-muted-foreground truncate">
            · {session.projectName}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 shrink-0 text-[10px] text-muted-foreground">
          {/* Open session edit modal — standardized SquarePen glyph
              used across the app (sessions tab, projects tab, scope
              bar, sidebar rows). */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenDetails()
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            aria-label="Open session details"
            title="Open session details"
          >
            <SquarePen className="h-3 w-3" />
          </button>
          {onRemoveFromLabel && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRemoveFromLabel()
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
              aria-label="Remove from label"
              title="Remove from label"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground/80">
        <span className="flex items-center gap-1 shrink-0">
          <Clock className="h-3 w-3" />
          {formatRelativeTime(session.lastActivity)}
        </span>
        {cwd && <span className="truncate">· {shortenCwd(cwd)}</span>}
        {showLabels && sessionLabels.length > 0 && (
          <span className="ml-auto flex flex-wrap gap-1 justify-end">
            {sessionLabels.map((l) => (
              <span
                key={l.id}
                className="px-1 py-px rounded bg-muted text-[9px] text-muted-foreground"
              >
                {l.name}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}
