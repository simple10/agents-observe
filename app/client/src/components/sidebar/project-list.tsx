import { useMemo, useState, useCallback } from 'react'
import { useProjects } from '@/hooks/use-projects'
import { useSessions } from '@/hooks/use-sessions'
import { useEvents } from '@/hooks/use-events'
import { useUIStore } from '@/stores/ui-store'
import { ChevronDown, ChevronRight, Folder, Pencil, Clock, CalendarDays } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { ProjectModal } from '@/components/settings/project-modal'
import { SessionItem } from './session-item'
import {
  NotificationIndicator,
  dismissNotifications,
  useAnyHiddenFlaggedSession,
  useAnySessionHasNotification,
} from './notification-indicator'
import type { Project, Session } from '@/types'

interface ProjectListProps {
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

  // Start of today (midnight)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)

  // Start of this week (Monday)
  const startOfThisWeek = new Date(startOfToday)
  const dayOfWeek = startOfToday.getDay()
  // getDay(): 0=Sun, 1=Mon ... 6=Sat. We want Monday as start of week.
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  startOfThisWeek.setDate(startOfThisWeek.getDate() - daysToMonday)

  const startOfLastWeek = new Date(startOfThisWeek)
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7)

  if (date >= startOfToday) {
    return 'Today'
  }
  if (date >= startOfYesterday) {
    return 'Yesterday'
  }
  if (date >= startOfThisWeek) {
    return 'This Week'
  }
  if (date >= startOfLastWeek) {
    return 'Last Week'
  }
  // Older: group by month
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
  sessions: Session[]
}

function groupSessionsByDate(sessions: Session[], sortBy: 'activity' | 'created'): SessionGroup[] {
  // Sort sessions by the chosen field (descending — most recent first)
  const sorted = [...sessions].sort((a, b) => {
    const aTime = sortBy === 'activity' ? a.lastActivity || a.startedAt : a.startedAt
    const bTime = sortBy === 'activity' ? b.lastActivity || b.startedAt : b.startedAt
    return bTime - aTime
  })

  // Group by date label based on the same field used for sorting
  const groups: SessionGroup[] = []
  let currentLabel: string | null = null
  let currentGroup: Session[] = []

  for (const session of sorted) {
    const ts = sortBy === 'activity' ? session.lastActivity || session.startedAt : session.startedAt
    const label = getDateGroupLabel(ts)
    if (label !== currentLabel) {
      if (currentLabel !== null && currentGroup.length > 0) {
        groups.push({ label: currentLabel, sessions: currentGroup })
      }
      currentLabel = label
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

export function ProjectList({ collapsed }: ProjectListProps) {
  const { data: projects } = useProjects()
  const { selectedProjectId, setSelectedProject } = useUIStore()

  const [modalProjectId, setModalProjectId] = useState<number | null>(null)
  const modalProject = projects?.find((p) => p.id === modalProjectId) ?? null

  const openProjectModal = useCallback((project: Project, e: React.MouseEvent) => {
    e.stopPropagation()
    setModalProjectId(project.id)
  }, [])

  if (!projects?.length) {
    return (
      <TooltipProvider>
        <div className="text-xs text-muted-foreground p-2">
          {collapsed ? '' : 'No projects yet'}
        </div>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-1">
        {projects.map((project) => {
          const isSelected = selectedProjectId === project.id
          const displayLabel = project.name

          if (collapsed) {
            return (
              <Tooltip key={project.id}>
                <TooltipTrigger asChild>
                  <button
                    className="relative flex h-8 w-8 mx-auto items-center justify-center rounded-md text-xs cursor-pointer text-muted-foreground hover:bg-accent"
                    onClick={() =>
                      setSelectedProject(
                        isSelected ? null : project.id,
                        isSelected ? null : project.slug,
                      )
                    }
                  >
                    {displayLabel.charAt(0).toUpperCase()}
                    <ProjectNotificationDot
                      projectId={project.id}
                      className="absolute top-0.5 right-0.5"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{displayLabel}</TooltipContent>
              </Tooltip>
            )
          }

          const toggleProject = () =>
            setSelectedProject(isSelected ? null : project.id, isSelected ? null : project.slug)

          return (
            <div key={project.id}>
              <div
                role="button"
                tabIndex={0}
                data-sidebar-item=""
                className="group flex items-center gap-2 w-full rounded-md px-2 py-0.5 text-sm transition-colors cursor-pointer text-foreground hover:bg-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={toggleProject}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleProject()
                  }
                }}
              >
                {isSelected ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
                <ProjectFolderWithBell projectId={project.id} />
                <span className="truncate">{displayLabel}</span>
                {project.sessionCount != null && (
                  <Badge
                    variant="secondary"
                    className="ml-auto text-[10px] h-4 px-1 group-hover:hidden"
                  >
                    {project.sessionCount}
                  </Badge>
                )}
                <span
                  data-testid={`edit-project-${project.id}`}
                  className="ml-auto hidden group-hover:flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/30 text-[10px] cursor-pointer transition-colors"
                  onClick={(e) => openProjectModal(project, e)}
                >
                  <Pencil className="h-2.5 w-2.5" />
                  Edit
                </span>
              </div>
              {isSelected && <SessionList projectId={project.id} />}
            </div>
          )
        })}
      </div>
      <ProjectModal
        project={modalProject}
        open={modalProject !== null}
        onOpenChange={(open) => {
          if (!open) setModalProjectId(null)
        }}
      />
    </TooltipProvider>
  )
}

/**
 * Folder icon with an optional bell overlay on top. The bell shows when
 * any session in the project is waiting on the user; clicking dismisses
 * every flagged session in the project and the overlay disappears,
 * revealing the plain folder icon underneath.
 */
/**
 * Folder icon that swaps to a bell when a session in the project is
 * waiting on the user AND that session isn't already showing its own
 * bell elsewhere in the sidebar (Pinned row, or the expanded
 * SessionList for this project). Prevents redundant double-signaling.
 * Clicking the bell dismisses every flagged session in the project.
 */
function ProjectFolderWithBell({ projectId }: { projectId: number }) {
  const { data: sessions } = useSessions(projectId)
  const sessionIds = sessions?.map((s) => s.id) ?? []
  const hasHiddenFlagged = useAnyHiddenFlaggedSession(sessionIds)
  if (hasHiddenFlagged) {
    return (
      <NotificationIndicator
        className="h-3.5 w-3.5 shrink-0"
        onClick={(e) => {
          e.stopPropagation()
          dismissNotifications(sessionIds)
        }}
      />
    )
  }
  return <Folder className="h-3.5 w-3.5 shrink-0" />
}

/**
 * Collapsed-sidebar variant — pulsing amber dot in the top-right of the
 * square project icon. Clicking dismisses every flagged session in the
 * project so the dot goes away.
 */
function ProjectNotificationDot({
  projectId,
  className,
}: {
  projectId: number
  className?: string
}) {
  const { data: sessions } = useSessions(projectId)
  const sessionIds = sessions?.map((s) => s.id) ?? []
  const anyFlagged = useAnySessionHasNotification(sessionIds)
  if (!anyFlagged) return null
  return (
    <button
      type="button"
      className={`relative flex h-2 w-2 items-center justify-center rounded-full bg-amber-500 cursor-pointer ${className ?? ''}`}
      aria-label="Click to dismiss notifications"
      title="Click to dismiss notifications"
      onClick={(e) => {
        e.stopPropagation()
        dismissNotifications(sessionIds)
      }}
    >
      <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-amber-400/70" />
    </button>
  )
}

function SessionList({ projectId }: { projectId: number }) {
  const { data: sessions } = useSessions(projectId)
  const {
    selectedSessionId,
    setSelectedSessionId,
    sessionSortOrder,
    setSessionSortOrder,
    togglePinnedSession,
    pinnedSessionIds,
    setEditingSessionId,
  } = useUIStore()
  const queryClient = useQueryClient()
  const { data: currentEvents } = useEvents(selectedSessionId)

  const handleRename = useCallback(
    async (sessionId: string, name: string) => {
      await api.updateSessionSlug(sessionId, name)
      await queryClient.invalidateQueries({ queryKey: ['sessions', projectId] })
    },
    [projectId, queryClient],
  )

  const groups = useMemo(() => {
    if (!sessions?.length) return []
    return groupSessionsByDate(sessions, sessionSortOrder)
  }, [sessions, sessionSortOrder])

  const totalSessions = sessions?.length ?? 0
  const shouldCollapse = totalSessions > 10
  const GROUP_PREVIEW_COUNT = 5
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const toggleGroup = useCallback((label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }, [])

  if (!sessions?.length) {
    return <div className="text-xs text-muted-foreground pl-6 py-1">No sessions</div>
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
              const liveEventCount =
                session.id === selectedSessionId && currentEvents ? currentEvents.length : undefined

              return (
                <SessionItem
                  key={session.id}
                  session={session}
                  isSelected={isSelected}
                  isPinned={pinnedSessionIds.has(session.id)}
                  onSelect={() => setSelectedSessionId(session.id)}
                  onTogglePin={() => togglePinnedSession(session.id)}
                  onRename={handleRename}
                  onEdit={() => setEditingSessionId(session.id)}
                  eventCountOverride={liveEventCount}
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
                data-sidebar-item=""
                className="w-full text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                onClick={() => toggleGroup(group.label)}
              >
                Show {hiddenCount} more...
              </button>
            )}
            {shouldCollapse &&
              expandedGroups.has(group.label) &&
              group.sessions.length > previewCount && (
                <button
                  data-sidebar-item=""
                  className="w-full text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                  onClick={() => toggleGroup(group.label)}
                >
                  Show less
                </button>
              )}
          </div>
        )
      })}
    </div>
  )
}
