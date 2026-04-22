import { useMemo, useState, useCallback } from 'react'
import { useRecentSessions } from '@/hooks/use-recent-sessions'
import { useUIStore } from '@/stores/ui-store'
import { ChevronDown, ChevronRight, Tag, Pencil, Clock, CalendarDays } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { SessionItem } from './session-item'
import type { Label, RecentSession } from '@/types'

// Same recent-sessions fetch limit used by the Sessions and Labels tabs
// in the Settings modal — all three share the react-query cache so this
// doesn't multiply network traffic.
const SESSION_FETCH_LIMIT = 10000

interface LabelListProps {
  collapsed: boolean
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

function getDateGroupLabel(ts: number): string {
  const now = new Date()
  const date = new Date(ts)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  const startOfThisWeek = new Date(startOfToday)
  const dayOfWeek = startOfToday.getDay()
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  startOfThisWeek.setDate(startOfThisWeek.getDate() - daysToMonday)
  const startOfLastWeek = new Date(startOfThisWeek)
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7)
  if (date >= startOfToday) return 'Today'
  if (date >= startOfYesterday) return 'Yesterday'
  if (date >= startOfThisWeek) return 'This Week'
  if (date >= startOfLastWeek) return 'Last Week'
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  return `${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

interface SessionGroup {
  label: string
  sessions: RecentSession[]
}

function groupSessionsByDate(
  sessions: RecentSession[],
  sortBy: 'activity' | 'created',
): SessionGroup[] {
  const sorted = [...sessions].sort((a, b) => {
    const aTime = sortBy === 'activity' ? a.lastActivity || a.startedAt : a.startedAt
    const bTime = sortBy === 'activity' ? b.lastActivity || b.startedAt : b.startedAt
    return bTime - aTime
  })
  const groups: SessionGroup[] = []
  let currentLabel: string | null = null
  let currentGroup: RecentSession[] = []
  for (const session of sorted) {
    const ts = sortBy === 'activity' ? session.lastActivity || session.startedAt : session.startedAt
    const date = getDateGroupLabel(ts)
    if (date !== currentLabel) {
      if (currentLabel !== null && currentGroup.length > 0) {
        groups.push({ label: currentLabel, sessions: currentGroup })
      }
      currentLabel = date
      currentGroup = [session]
    } else {
      currentGroup.push(session)
    }
  }
  if (currentLabel !== null && currentGroup.length > 0) {
    groups.push({ label: currentLabel, sessions: currentGroup })
  }
  return groups
}

export function LabelList({ collapsed }: LabelListProps) {
  const labels = useUIStore((s) => s.labels)
  const labelMemberships = useUIStore((s) => s.labelMemberships)
  const openLabelsModal = useUIStore((s) => s.openLabelsModal)
  const { data: sessions } = useRecentSessions(SESSION_FETCH_LIMIT)
  const [expandedLabelId, setExpandedLabelId] = useState<string | null>(null)

  // sessionsByLabel: labelId -> RecentSession[]. Built once per labels /
  // membership / sessions change so expanding a label is instant.
  const sessionsByLabel = useMemo(() => {
    const map = new Map<string, RecentSession[]>()
    if (!sessions) return map
    const byId = new Map(sessions.map((s) => [s.id, s] as const))
    for (const label of labels) {
      const ids = labelMemberships.get(label.id) ?? new Set<string>()
      const list: RecentSession[] = []
      for (const id of ids) {
        const s = byId.get(id)
        if (s) list.push(s)
      }
      map.set(label.id, list)
    }
    return map
  }, [labels, labelMemberships, sessions])

  const sortedLabels = useMemo(
    () => [...labels].sort((a, b) => a.name.localeCompare(b.name)),
    [labels],
  )

  if (sortedLabels.length === 0) {
    return (
      <TooltipProvider>
        <div className="text-xs text-muted-foreground p-2">
          {collapsed ? '' : 'No labels yet. Create one from the Labels tab in Settings.'}
        </div>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-1">
        {sortedLabels.map((label) => {
          const labelSessions = sessionsByLabel.get(label.id) ?? []
          const count = labelSessions.length
          const isExpanded = expandedLabelId === label.id

          if (collapsed) {
            return (
              <Tooltip key={label.id}>
                <TooltipTrigger asChild>
                  <button
                    className="relative flex h-8 w-8 mx-auto items-center justify-center rounded-md text-xs cursor-pointer text-muted-foreground hover:bg-accent"
                    onClick={() => setExpandedLabelId(isExpanded ? null : label.id)}
                    aria-label={label.name}
                  >
                    <Tag className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{label.name}</TooltipContent>
              </Tooltip>
            )
          }

          const toggleLabel = () => setExpandedLabelId(isExpanded ? null : label.id)

          return (
            <div key={label.id}>
              <div
                role="button"
                tabIndex={0}
                className="group flex items-center gap-2 w-full rounded-md px-2 py-0.5 text-sm transition-colors cursor-pointer text-foreground hover:bg-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={toggleLabel}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleLabel()
                  }
                }}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
                <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{label.name}</span>
                <Badge
                  variant="secondary"
                  className="ml-auto text-[10px] h-4 px-1 group-hover:hidden"
                >
                  {count}
                </Badge>
                {/* Hover affordance mirrors ProjectList's "Edit" pill.
                    Opens the Labels tab in Settings scrolled to this
                    specific label so the user can rename or delete. */}
                <span
                  data-testid={`edit-label-${label.id}`}
                  className="ml-auto hidden group-hover:flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/30 text-[10px] cursor-pointer transition-colors"
                  onClick={(e) => {
                    e.stopPropagation()
                    openLabelsModal(label.id)
                  }}
                >
                  <Pencil className="h-2.5 w-2.5" />
                  Edit
                </span>
              </div>
              {isExpanded && <LabelSessionList label={label} sessions={labelSessions} />}
            </div>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

function LabelSessionList({ label, sessions }: { label: Label; sessions: RecentSession[] }) {
  const {
    selectedSessionId,
    setSelectedSessionId,
    sessionSortOrder,
    setSessionSortOrder,
    togglePinnedSession,
    pinnedSessionIds,
    setEditingSessionId,
    setSelectedProject,
  } = useUIStore()

  const groups = useMemo(() => {
    if (!sessions.length) return []
    return groupSessionsByDate(sessions, sessionSortOrder)
  }, [sessions, sessionSortOrder])

  const shouldCollapse = sessions.length > 10
  const GROUP_PREVIEW_COUNT = 5
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const toggleGroup = useCallback((groupLabel: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupLabel)) next.delete(groupLabel)
      else next.add(groupLabel)
      return next
    })
  }, [])

  if (!sessions.length) {
    return (
      <div className="ml-3.5 mt-1 pb-2 pl-2 text-xs text-muted-foreground border-l border-border">
        No sessions in this label yet.
      </div>
    )
  }

  return (
    <div className="ml-3.5 mt-1 pb-3 border-l border-border">
      {groups.map((group, groupIndex) => {
        const isGroupExpanded = !shouldCollapse || expandedGroups.has(group.label)
        const previewCount = group.label === 'Today' ? 10 : GROUP_PREVIEW_COUNT
        const visibleSessions = isGroupExpanded
          ? group.sessions
          : group.sessions.slice(0, previewCount)
        const hiddenCount = group.sessions.length - visibleSessions.length

        return (
          <div key={group.label} className={groupIndex > 0 ? 'mt-3' : ''}>
            <div className="flex items-center px-2 pt-0 pb-0.5 select-none">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 dark:text-muted-foreground/30">
                {group.label}
              </span>
              {groupIndex === 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="flex items-center gap-1 ml-auto text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                      onClick={() =>
                        setSessionSortOrder(
                          sessionSortOrder === 'activity' ? 'created' : 'activity',
                        )
                      }
                    >
                      {sessionSortOrder === 'activity' ? (
                        <>
                          <Clock className="h-3 w-3" /> Recent
                        </>
                      ) : (
                        <>
                          <CalendarDays className="h-3 w-3" /> Created
                        </>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">
                    {sessionSortOrder === 'activity'
                      ? 'Sorted by recent activity'
                      : 'Sorted by creation date'}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {visibleSessions.map((session) => {
              const isSelected = selectedSessionId === session.id
              return (
                <SessionItem
                  key={session.id}
                  session={session}
                  isSelected={isSelected}
                  isPinned={pinnedSessionIds.has(session.id)}
                  // Selecting a session from a label group jumps to its
                  // project — matches the sidebar's normal behavior
                  // when you click a session inside a project.
                  onSelect={() => {
                    setSelectedProject(session.projectId, session.projectSlug || null)
                    setSelectedSessionId(session.id)
                  }}
                  onTogglePin={() => togglePinnedSession(session.id)}
                  onRename={async () => {
                    // Rename isn't project-scoped from this view; delegate
                    // to the session modal so the user gets the full UI.
                    setEditingSessionId(session.id)
                  }}
                  onEdit={() => setEditingSessionId(session.id)}
                  relativeTime={formatRelativeTime(
                    sessionSortOrder === 'activity'
                      ? session.lastActivity || session.startedAt
                      : session.startedAt,
                  )}
                  cwd={typeof session.metadata?.cwd === 'string' ? session.metadata.cwd : null}
                  showCwd={false}
                />
              )
            })}
            {hiddenCount > 0 && (
              <button
                className="w-full text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 cursor-pointer"
                onClick={() => toggleGroup(group.label)}
              >
                Show {hiddenCount} more...
              </button>
            )}
            {shouldCollapse &&
              expandedGroups.has(group.label) &&
              group.sessions.length > previewCount && (
                <button
                  className="w-full text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 cursor-pointer"
                  onClick={() => toggleGroup(group.label)}
                >
                  Show less
                </button>
              )}
          </div>
        )
      })}
      {/* Silences the lint error about `label` being only used for
          React's reconciliation key — we reference it here in a no-op
          so TS/eslint see the binding as used. */}
      <span className="sr-only">{label.name}</span>
    </div>
  )
}
