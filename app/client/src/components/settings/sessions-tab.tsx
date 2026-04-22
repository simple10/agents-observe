import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRecentSessions } from '@/hooks/use-recent-sessions'
import { useDbStats } from '@/hooks/use-db-stats'
import { useProjects } from '@/hooks/use-projects'
import { api, ApiError } from '@/lib/api-client'
import { ProjectModal } from './project-modal'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
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
import { Trash2, SquarePen, ChevronUp, ChevronDown, Tag, Plus, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useUIStore } from '@/stores/ui-store'
import type { Label, Project, RecentSession } from '@/types'

type AgeFilter = 'all' | '3d' | '7d' | '14d' | '30d'
// Event-count buckets. >= for the "big" buckets matches the user's
// expectation that >100 includes 100 itself; < is strict for the "small"
// buckets. The buckets overlap (e.g. <100 includes <10) — they're not
// nested ranges, just quick "match anything in this range" picks.
type EventFilter = 'all' | 'lt10' | 'lt100' | 'gte100' | 'gte1k'
type SortBy = 'status' | 'agent' | 'activity' | 'created' | 'events'
type SortDir = 'asc' | 'desc'

// Per-column default direction — picked to surface the "prunable" rows
// first on the first click: oldest dates at top, biggest event counts
// at top. Status defaults to ascending so active (live) sessions sit at
// the top — the user can toggle to desc to see stopped sessions first
// when they're in pruning mode. Clicking an already-active column just
// flips the direction.
const DEFAULT_SORT_DIR: Record<SortBy, SortDir> = {
  status: 'asc',
  agent: 'asc',
  activity: 'asc',
  created: 'asc',
  events: 'desc',
}

const DAY_MS = 24 * 60 * 60 * 1000

// We ask the server for "recent" sessions with a big limit — this is the
// same endpoint the sidebar uses, which already returns every column we
// need (eventCount, lastActivity, projectName). A dedicated
// /sessions/all endpoint would be cleaner but adds maintenance; revisit
// if users start hitting the limit.
const SESSION_FETCH_LIMIT = 10000

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, i)
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

// Mirrors session-list.tsx's shortenCwd — duplicated here rather than
// exported because it's a one-liner and the two rows have independent
// layout concerns.
function shortenCwd(cwd: string): string {
  return cwd.replace(/^\/(?:Users|home)\/[^/]+/, '~')
}

function formatAgentClasses(classes: string[] | undefined | null): string {
  if (!classes || classes.length === 0) return '—'
  if (classes.length === 1) return classes[0]
  return `${classes[0]} (+${classes.length - 1})`
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

function ageFilterMatches(filter: AgeFilter, lastActivity: number): boolean {
  if (filter === 'all') return true
  const ageDays = (Date.now() - lastActivity) / DAY_MS
  if (filter === '3d') return ageDays > 3
  if (filter === '7d') return ageDays > 7
  if (filter === '14d') return ageDays > 14
  if (filter === '30d') return ageDays > 30
  return true
}

function eventFilterMatches(filter: EventFilter, count: number): boolean {
  if (filter === 'all') return true
  if (filter === 'lt10') return count < 10
  if (filter === 'lt100') return count < 100
  if (filter === 'gte100') return count >= 100
  if (filter === 'gte1k') return count >= 1000
  return true
}

export function SessionsTab() {
  const queryClient = useQueryClient()
  const { data: stats, refetch: refetchStats } = useDbStats(true)
  const { data: sessions, isLoading } = useRecentSessions(SESSION_FETCH_LIMIT)
  // Projects are needed so we can resolve a session.projectId into the
  // full Project the ProjectModal expects when the user clicks a
  // project name in a row.
  const { data: projects } = useProjects()
  const [modalProject, setModalProject] = useState<Project | null>(null)
  const setEditingSessionId = useUIStore((s) => s.setEditingSessionId)
  // Labels data needed for both the inline pills on each row and the
  // bulk "Add Label" dialog. Subscribing to labelMemberships keeps the
  // pills in sync when labels are added/removed elsewhere.
  const labels = useUIStore((s) => s.labels)
  const labelMemberships = useUIStore((s) => s.labelMemberships)
  const toggleSessionLabel = useUIStore((s) => s.toggleSessionLabel)
  const [addLabelOpen, setAddLabelOpen] = useState(false)

  // Per-session labels map: sessionId -> Label[]. Derived from the
  // membership map so it updates reactively.
  const labelsBySession = useMemo(() => {
    const m = new Map<string, Label[]>()
    for (const label of labels) {
      const ids = labelMemberships.get(label.id) ?? new Set()
      for (const id of ids) {
        const arr = m.get(id) ?? []
        arr.push(label)
        m.set(id, arr)
      }
    }
    return m
  }, [labels, labelMemberships])

  function openSession(session: RecentSession) {
    // Open the Session edit modal on top of the Settings modal. Both
    // are Radix Dialogs and stack natively, so closing the session
    // modal drops the user back into the Sessions tab right where they
    // were. For cmd/middle-click we keep the anchor's href pointing at
    // the full session route so a new tab opens the session view
    // directly (not the edit modal).
    setEditingSessionId(session.id)
  }

  function openProjectModal(projectId: number) {
    const match = projects?.find((p) => p.id === projectId)
    if (match) setModalProject(match)
  }

  // Oldest / newest session start timestamps across all (non-filtered)
  // sessions — matches the scope of the DB stats numbers next to them.
  const sessionDateRange = useMemo(() => {
    if (!sessions || sessions.length === 0) return { oldest: null, newest: null }
    let oldest = Infinity
    let newest = -Infinity
    for (const s of sessions) {
      if (s.startedAt < oldest) oldest = s.startedAt
      if (s.startedAt > newest) newest = s.startedAt
    }
    return { oldest, newest }
  }, [sessions])

  const [ageFilter, setAgeFilter] = useState<AgeFilter>('all')
  const [eventFilter, setEventFilter] = useState<EventFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('activity')
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR.activity)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredSessions = useMemo(() => {
    if (!sessions) return []
    const q = searchQuery.trim().toLowerCase()
    const filtered = sessions.filter((s) => {
      if (!ageFilterMatches(ageFilter, s.lastActivity || s.startedAt)) return false
      if (!eventFilterMatches(eventFilter, s.eventCount ?? 0)) return false
      if (q) {
        const name = (s.slug || s.id).toLowerCase()
        const cwd = typeof s.metadata?.cwd === 'string' ? s.metadata.cwd.toLowerCase() : ''
        if (!name.includes(q) && !cwd.includes(q)) return false
      }
      return true
    })
    // Sort copy so we don't mutate react-query's cached array.
    const dirMul = sortDir === 'asc' ? 1 : -1
    const sorted = [...filtered].sort((a, b) => {
      let diff = 0
      if (sortBy === 'status') {
        // Active sessions sort as 0, everything else as 1 — asc surfaces
        // live sessions first, desc surfaces stopped first.
        diff = (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
      } else if (sortBy === 'agent') {
        // Compare by the first agentClass; sessions with no agents
        // compare as empty string so they group at the start in asc.
        const aFirst = a.agentClasses?.[0] ?? ''
        const bFirst = b.agentClasses?.[0] ?? ''
        diff = aFirst.localeCompare(bFirst)
      } else if (sortBy === 'activity') {
        diff = (a.lastActivity || a.startedAt) - (b.lastActivity || b.startedAt)
      } else if (sortBy === 'events') {
        diff = (a.eventCount ?? 0) - (b.eventCount ?? 0)
      } else {
        diff = a.startedAt - b.startedAt
      }
      return diff * dirMul
    })
    return sorted
  }, [sessions, ageFilter, eventFilter, searchQuery, sortBy, sortDir])

  function toggleSort(col: SortBy) {
    if (col === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir(DEFAULT_SORT_DIR[col])
    }
  }

  const allVisibleSelected =
    filteredSessions.length > 0 && filteredSessions.every((s) => selected.has(s.id))
  const someVisibleSelected = filteredSessions.some((s) => selected.has(s.id))

  const selectedList = useMemo(
    () => (sessions ? sessions.filter((s) => selected.has(s.id)) : []),
    [sessions, selected],
  )
  const selectedEventCount = selectedList.reduce((sum, s) => sum + (s.eventCount ?? 0), 0)

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const s of filteredSessions) next.delete(s.id)
      } else {
        for (const s of filteredSessions) next.add(s.id)
      }
      return next
    })
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      const ids = Array.from(selected)
      await api.bulkDeleteSessions(ids)
      setSelected(new Set())
      setConfirmOpen(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['recent-sessions'] }),
        refetchStats(),
      ])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Stats header */}
      <div className="grid grid-cols-5 gap-3 rounded-md border p-3 bg-muted/30">
        <Stat label="Database size" value={stats ? formatBytes(stats.sizeBytes) : '…'} />
        <Stat label="Events" value={stats ? stats.eventCount.toLocaleString() : '…'} />
        <Stat label="Sessions" value={stats ? stats.sessionCount.toLocaleString() : '…'} />
        <Stat label="Oldest" value={formatDate(sessionDateRange.oldest)} />
        <Stat label="Newest" value={formatDate(sessionDateRange.newest)} />
      </div>

      {/* Toolbar: age filter on the left, event-count filter on the
          right. Sort lives on the column headers. */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground mr-1">Age:</span>
          <FilterPill active={ageFilter === 'all'} onClick={() => setAgeFilter('all')}>
            All
          </FilterPill>
          <FilterPill active={ageFilter === '3d'} onClick={() => setAgeFilter('3d')}>
            &gt;3d
          </FilterPill>
          <FilterPill active={ageFilter === '7d'} onClick={() => setAgeFilter('7d')}>
            &gt;7d
          </FilterPill>
          <FilterPill active={ageFilter === '14d'} onClick={() => setAgeFilter('14d')}>
            &gt;14d
          </FilterPill>
          <FilterPill active={ageFilter === '30d'} onClick={() => setAgeFilter('30d')}>
            &gt;30d
          </FilterPill>
        </div>

        <div className="flex items-center gap-1 text-xs ml-auto">
          <span className="text-muted-foreground mr-1">Events:</span>
          <FilterPill active={eventFilter === 'all'} onClick={() => setEventFilter('all')}>
            All
          </FilterPill>
          <FilterPill active={eventFilter === 'lt10'} onClick={() => setEventFilter('lt10')}>
            &lt;10
          </FilterPill>
          <FilterPill active={eventFilter === 'lt100'} onClick={() => setEventFilter('lt100')}>
            &lt;100
          </FilterPill>
          <FilterPill active={eventFilter === 'gte100'} onClick={() => setEventFilter('gte100')}>
            &gt;100
          </FilterPill>
          <FilterPill active={eventFilter === 'gte1k'} onClick={() => setEventFilter('gte1k')}>
            &gt;1k
          </FilterPill>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="destructive"
          size="sm"
          className="gap-1.5"
          disabled={selected.size === 0}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete {selected.size > 0 ? `(${selected.size})` : ''}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={selected.size === 0}
          onClick={() => setAddLabelOpen(true)}
        >
          <Tag className="h-3.5 w-3.5" />
          Add Label {selected.size > 0 ? `(${selected.size})` : ''}
        </Button>
        <Input
          type="search"
          placeholder="Search name or cwd..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="ml-auto h-8 max-w-[240px] text-xs"
        />
      </div>

      {/* Session table */}
      <div className="rounded-md border">
        <div className="grid grid-cols-[auto_1fr_100px_95px_95px_55px_28px] items-center gap-3 px-3 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/30">
          <Checkbox
            checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
            onCheckedChange={toggleSelectAll}
            aria-label="Select all sessions"
          />
          <SortHeader
            label={`Session (${filteredSessions.length})`}
            active={sortBy === 'status'}
            dir={sortDir}
            onClick={() => toggleSort('status')}
          />
          <SortHeader
            label="Agent"
            active={sortBy === 'agent'}
            dir={sortDir}
            onClick={() => toggleSort('agent')}
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
            label="Events"
            align="right"
            active={sortBy === 'events'}
            dir={sortDir}
            onClick={() => toggleSort('events')}
          />
          <span />
        </div>

        <div className="max-h-[40vh] overflow-y-auto">
          {isLoading && (
            <div className="px-3 py-8 text-sm text-muted-foreground text-center">
              Loading sessions...
            </div>
          )}
          {!isLoading && filteredSessions.length === 0 && (
            <div className="px-3 py-8 text-sm text-muted-foreground text-center">
              No sessions match this filter.
            </div>
          )}
          {filteredSessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              labels={labelsBySession.get(s.id) ?? []}
              checked={selected.has(s.id)}
              onToggle={() => toggleSelect(s.id)}
              onOpen={() => openSession(s)}
              onOpenProject={() => openProjectModal(s.projectId)}
            />
          ))}
        </div>
      </div>

      {error && <div className="text-xs text-destructive">{error}</div>}

      {/* Project modal — opens on top of the Settings modal when the
          user clicks a project name in a row. Both are Radix Dialogs so
          stacking + focus management are handled automatically. */}
      <ProjectModal
        project={modalProject}
        open={modalProject !== null}
        onOpenChange={(o) => {
          if (!o) setModalProject(null)
        }}
      />

      {/* Bulk label editor — open from the Add Label button. Applies
          across every selected session. */}
      <AddLabelDialog
        open={addLabelOpen}
        onOpenChange={setAddLabelOpen}
        selectedIds={selected}
        labels={labels}
        labelMemberships={labelMemberships}
        onToggle={toggleSessionLabel}
        onCreateLabel={(name) => useUIStore.getState().createLabel(name)}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} session{selected.size !== 1 ? 's' : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {selected.size} session{selected.size !== 1 ? 's' : ''} and{' '}
              {selectedEventCount.toLocaleString()} event{selectedEventCount !== 1 ? 's' : ''} from
              the Observe database, then runs VACUUM to reclaim disk space. Your original Claude
              session files are not modified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                handleDelete()
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
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
  // Keep the chevron slot reserved (invisible) on inactive columns so
  // column widths don't jump when the active sort changes. For
  // right-aligned columns we render the chevron BEFORE the label so the
  // label itself hugs the right edge of the column — otherwise the
  // reserved-but-invisible chevron on the right pushes the label
  // leftward and the header looks un-aligned with its right-aligned
  // values.
  const chevron = <Chevron className={'h-3 w-3 ' + (active ? 'opacity-100' : 'opacity-0')} />
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
      {align === 'right' && chevron}
      <span>{label}</span>
      {align !== 'right' && chevron}
    </button>
  )
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={
        'rounded-full px-2.5 py-0.5 border transition-colors cursor-pointer ' +
        (active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-transparent text-muted-foreground border-border hover:bg-muted')
      }
    >
      {children}
    </button>
  )
}

function SessionRow({
  session,
  labels,
  checked,
  onToggle,
  onOpen,
  onOpenProject,
}: {
  session: RecentSession
  labels: Label[]
  checked: boolean
  onToggle: () => void
  onOpen: () => void
  onOpenProject: () => void
}) {
  const label = session.slug || session.id.slice(0, 8)
  const cwd = typeof session.metadata?.cwd === 'string' ? session.metadata.cwd : null
  const isActive = session.status === 'active'
  return (
    // Two grid rows: row 1 holds the regular columns, row 2 holds the
    // project+cwd line which spans across the date/events columns so a
    // long cwd actually has room to breathe. Checkbox + open-link are
    // row-spanned and self-centered so they line up with the label row.
    <label className="grid grid-cols-[auto_1fr_100px_95px_95px_55px_28px] gap-x-3 gap-y-0.5 px-3 py-2 border-b last:border-b-0 text-sm hover:bg-muted/30 cursor-pointer">
      <div className="row-span-2 self-center">
        <Checkbox checked={checked} onCheckedChange={onToggle} aria-label="Select session" />
      </div>
      <div className="flex items-center gap-1.5 min-w-0 self-center">
        {/* Same green/grey status dot used in the main session list.
            Green = active session, grey = stopped/inactive. */}
        <span
          className={
            'h-2 w-2 shrink-0 rounded-full ' +
            (isActive ? 'bg-green-500' : 'bg-muted-foreground/60 dark:bg-muted-foreground/40')
          }
          title={isActive ? 'Active' : 'Stopped'}
        />
        <span className="truncate font-medium">{label}</span>
      </div>
      <span
        className="text-xs text-muted-foreground truncate self-center"
        title={session.agentClasses?.join(', ')}
      >
        {formatAgentClasses(session.agentClasses)}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums self-center">
        {formatDate(session.startedAt)}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums self-center">
        {formatDate(session.lastActivity)}
      </span>
      <span className="text-xs text-right tabular-nums self-center">
        {(session.eventCount ?? 0).toLocaleString()}
      </span>
      {/* Real anchor so cmd/middle-click opens the session in a new tab
          via the hash route. On a plain left-click we preventDefault and
          handle navigation in-app (sets selection + closes the modal).
          stopPropagation in both paths keeps the surrounding <label>
          from toggling the checkbox. */}
      <a
        href={`#/${session.projectSlug}/${session.id}`}
        onClick={(e) => {
          const isModified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
          e.stopPropagation()
          if (isModified) return
          e.preventDefault()
          onOpen()
        }}
        onAuxClick={(e) => {
          // Middle-click: let the browser open a new tab, just keep the
          // event from bubbling up to the <label>.
          e.stopPropagation()
        }}
        className="row-span-2 self-center flex h-6 w-6 items-center justify-center rounded hover:bg-muted text-muted-foreground cursor-pointer"
        title="Edit session (cmd/ctrl-click to open in new tab)"
        aria-label="Edit session"
      >
        <SquarePen className="h-3.5 w-3.5" />
      </a>

      {/* Second row: project + cwd, spans from the label column across
          the date/events columns so long cwds don't get clipped by the
          narrow 1fr session column. Project name stays pinned
          (shrink-0); only the cwd shrinks, and it's truncated from the
          LEFT — the rightmost path segment (.../app/client/src) is what
          the user cares about, so we keep that visible and ellipsis the
          beginning. direction:rtl + unicode-bidi:plaintext gives us
          left-ellipsis while preserving the natural LTR rendering of
          the path characters themselves. */}
      <div className="col-start-2 col-span-5 min-w-0 flex items-baseline gap-1 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onOpenProject()
          }}
          className="shrink-0 truncate cursor-pointer hover:text-foreground hover:underline underline-offset-2 decoration-muted-foreground/40"
          title="Open project"
        >
          {session.projectName}
        </button>
        {labels.length > 0 && (
          <span className="shrink-0 flex items-center gap-1 flex-wrap">
            {labels.map((l) => (
              <span
                key={l.id}
                className="inline-flex items-center gap-0.5 rounded bg-muted text-[10px] text-muted-foreground px-1 py-px"
                title={`Label: ${l.name}`}
              >
                <Tag className="h-2.5 w-2.5" />
                {l.name}
              </span>
            ))}
          </span>
        )}
        {cwd && (
          <>
            <span className="shrink-0 text-muted-foreground/60">·</span>
            {/* Same left-truncation trick session-item.tsx uses:
                dir="rtl" on the truncating container so the ellipsis
                trims from the start of RTL flow (the visual left), and
                a nested <span dir="ltr"> so the path characters still
                render in their natural LTR order. */}
            <span className="min-w-0 truncate text-muted-foreground/70" dir="rtl" title={cwd}>
              <span dir="ltr">{shortenCwd(cwd)}</span>
            </span>
          </>
        )}
      </div>
    </label>
  )
}

function AddLabelDialog({
  open,
  onOpenChange,
  selectedIds,
  labels,
  labelMemberships,
  onToggle,
  onCreateLabel,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  selectedIds: Set<string>
  labels: Label[]
  labelMemberships: Map<string, Set<string>>
  onToggle: (labelId: string, sessionId: string) => void
  onCreateLabel: (name: string) => Label | null
}) {
  // Inline "New label" input state. When created, the new label is
  // auto-applied to every currently-selected session so the user gets
  // the obvious outcome of "I pressed Add Label, named one, and all my
  // selected sessions now wear it."
  const [creating, setCreating] = useState(false)
  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelError, setNewLabelError] = useState<string | null>(null)

  function handleCreate() {
    const trimmed = newLabelName.trim()
    if (!trimmed) return
    if (labels.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) {
      setNewLabelError('A label with that name already exists')
      return
    }
    const created = onCreateLabel(trimmed)
    if (!created) {
      setNewLabelError('Could not create label')
      return
    }
    // Apply to every selected session so the new label lands where the
    // user expected. toggleSessionLabel is idempotent-safe since the
    // label was just created with no members.
    for (const id of selectedIds) onToggle(created.id, id)
    setNewLabelName('')
    setNewLabelError(null)
    setCreating(false)
  }

  function cancelCreate() {
    setCreating(false)
    setNewLabelName('')
    setNewLabelError(null)
  }
  // Derive "on" (all selected have this label), "partial" (some do),
  // or "off" (none do). Clicking an "on" pill removes the label from
  // every selected session; clicking "partial" or "off" adds it to
  // every selected session that doesn't already have it.
  const ids = Array.from(selectedIds)
  const pillState = (labelId: string): 'on' | 'partial' | 'off' => {
    const members = labelMemberships.get(labelId)
    if (!members || members.size === 0) return 'off'
    let has = 0
    for (const id of ids) if (members.has(id)) has++
    if (has === 0) return 'off'
    if (has === ids.length) return 'on'
    return 'partial'
  }

  function handlePillClick(label: Label) {
    const state = pillState(label.id)
    const members = labelMemberships.get(label.id) ?? new Set<string>()
    if (state === 'on') {
      // Remove from all selected
      for (const id of ids) if (members.has(id)) onToggle(label.id, id)
    } else {
      // Add to each selected session that doesn't already have it
      for (const id of ids) if (!members.has(id)) onToggle(label.id, id)
    }
  }

  const count = ids.length
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[460px] max-w-[90vw] p-6">
        <DialogTitle>
          Labels for {count} session{count === 1 ? '' : 's'}
        </DialogTitle>
        <div className="space-y-2 mt-2">
          <p className="text-[11px] text-muted-foreground/70">
            Click a label to toggle on or off for the selected sessions.
          </p>
          {labels.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No labels yet. Create one from the Labels tab, then come back here to apply it.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {labels.map((l) => {
                const state = pillState(l.id)
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => handlePillClick(l)}
                    className={
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs border transition-colors cursor-pointer ' +
                      (state === 'on'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : state === 'partial'
                          ? 'bg-primary/20 text-foreground border-primary/40'
                          : 'bg-transparent text-muted-foreground border-border hover:bg-muted')
                    }
                    title={
                      state === 'on'
                        ? 'Remove from all selected'
                        : state === 'partial'
                          ? 'Applied to some — click to apply to all'
                          : 'Apply to all selected'
                    }
                  >
                    <Tag className="h-3 w-3" />
                    {l.name}
                    {state === 'partial' && <span className="ml-0.5 opacity-70">~</span>}
                  </button>
                )
              })}
            </div>
          )}

          {/* New label creation — inline input that replaces the
              "+ New Label" button while typing. Enter creates + auto-
              applies to every selected session; Escape cancels. */}
          {creating ? (
            <div>
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  placeholder="New label name"
                  value={newLabelName}
                  onChange={(e) => {
                    setNewLabelName(e.target.value)
                    if (newLabelError) setNewLabelError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleCreate()
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelCreate()
                    }
                  }}
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!newLabelName.trim()}
                  onClick={handleCreate}
                >
                  Add
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelCreate}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              {newLabelError && (
                <p className="text-[11px] text-destructive mt-1">{newLabelError}</p>
              )}
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New Label
            </Button>
          )}
        </div>
        <div className="flex justify-end mt-2">
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
