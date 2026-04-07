import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { useProjects } from '@/hooks/use-projects'
import { useSessions } from '@/hooks/use-sessions'
import { useEvents } from '@/hooks/use-events'
import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, Folder, Pencil, Clock, CalendarDays, Pin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { ProjectModal } from '@/components/settings/project-modal'
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
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
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
    const aTime = sortBy === 'activity' ? (a.lastActivity || a.startedAt) : a.startedAt
    const bTime = sortBy === 'activity' ? (b.lastActivity || b.startedAt) : b.startedAt
    return bTime - aTime
  })

  // Group by date label based on the same field used for sorting
  const groups: SessionGroup[] = []
  let currentLabel: string | null = null
  let currentGroup: Session[] = []

  for (const session of sorted) {
    const ts = sortBy === 'activity' ? (session.lastActivity || session.startedAt) : session.startedAt
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

  const [modalProject, setModalProject] = useState<Project | null>(null)

  const openProjectModal = useCallback((project: Project, e: React.MouseEvent) => {
    e.stopPropagation()
    setModalProject(project)
  }, [])

  if (!projects?.length) {
    return (
      <div className="text-xs text-muted-foreground p-2">{collapsed ? '' : 'No projects yet'}</div>
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-1">
        {!collapsed && (
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
            Projects
          </div>
        )}
        {projects.map((project) => {
          const isSelected = selectedProjectId === project.id
          const displayLabel = project.name

          if (collapsed) {
            return (
              <Tooltip key={project.id}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      'flex h-8 w-8 mx-auto items-center justify-center rounded-md text-xs cursor-pointer',
                      isSelected
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'text-muted-foreground hover:bg-accent',
                    )}
                    onClick={() => setSelectedProject(isSelected ? null : project.id, isSelected ? null : project.slug)}
                  >
                    {displayLabel.charAt(0).toUpperCase()}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{displayLabel}</TooltipContent>
              </Tooltip>
            )
          }

          return (
            <div key={project.id}>
              <button
                className={cn(
                  'group flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer',
                  isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent',
                )}
                onClick={() => setSelectedProject(isSelected ? null : project.id, isSelected ? null : project.slug)}
              >
                {isSelected ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
                <Folder className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{displayLabel}</span>
                {project.sessionCount != null && (
                  <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1 group-hover:hidden">
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
              </button>
              {isSelected && <SessionList projectId={project.id} />}
            </div>
          )
        })}
      </div>
      <ProjectModal
        project={modalProject}
        open={modalProject !== null}
        onOpenChange={(open) => { if (!open) setModalProject(null) }}
      />
    </TooltipProvider>
  )
}

function shortenCwd(cwd: string): string {
  // Replace /Users/<name> or /home/<name> with ~
  return cwd.replace(/^\/(?:Users|home)\/[^/]+/, '~')
}

function SessionList({ projectId }: { projectId: number }) {
  const { data: sessions } = useSessions(projectId)
  const { selectedSessionId, setSelectedSessionId, sessionSortOrder, setSessionSortOrder, togglePinnedSession, pinnedSessionIds } = useUIStore()
  const queryClient = useQueryClient()
  const { data: currentEvents } = useEvents(selectedSessionId)

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingSessionId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingSessionId])

  const startEditing = useCallback((session: Session, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingSessionId(session.id)
    setEditValue(session.slug || session.id.slice(0, 8))
  }, [])

  const cancelEditing = useCallback(() => {
    setEditingSessionId(null)
    setEditValue('')
  }, [])

  const saveSlug = useCallback(async (sessionId: string) => {
    const trimmed = editValue.trim()
    if (trimmed) {
      await api.updateSessionSlug(sessionId, trimmed)
      await queryClient.invalidateQueries({ queryKey: ['sessions', projectId] })
    }
    setEditingSessionId(null)
    setEditValue('')
  }, [editValue, projectId, queryClient])

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
    <div className="ml-4 mt-1 space-y-0.5">
      <div className="flex items-center justify-end px-2 pt-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => setSessionSortOrder(sessionSortOrder === 'activity' ? 'created' : 'activity')}
            >
              {sessionSortOrder === 'activity' ? (
                <><Clock className="h-3 w-3" /> Recent</>
              ) : (
                <><CalendarDays className="h-3 w-3" /> Created</>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            {sessionSortOrder === 'activity' ? 'Sorted by recent activity' : 'Sorted by creation date'}
          </TooltipContent>
        </Tooltip>
      </div>
      {groups.map((group) => {
        const isGroupExpanded = !shouldCollapse || expandedGroups.has(group.label)
        const previewCount = group.label === 'Today' ? 10 : GROUP_PREVIEW_COUNT
        const visibleSessions = isGroupExpanded ? group.sessions : group.sessions.slice(0, previewCount)
        const hiddenCount = group.sessions.length - visibleSessions.length

        return (
        <div key={group.label}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 dark:text-muted-foreground/60 px-2 pt-2 pb-0.5 select-none">
            {group.label}
          </div>
          {visibleSessions.map((session) => {
            const isSelected = selectedSessionId === session.id
            const isEditing = editingSessionId === session.id
            const label = session.slug || session.id.slice(0, 8)
            const cwd = typeof session.metadata?.cwd === 'string' ? session.metadata.cwd : null
            const statusLabel = session.status === 'active' ? 'Active' : 'Ended'
            const tooltipLines = [
              statusLabel,
              cwd,
            ].filter(Boolean)

            return (
              <Tooltip key={session.id}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      'group rounded-md px-2 py-1 transition-colors cursor-pointer',
                      isSelected
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                    onClick={() => !isEditing && setSelectedSessionId(isSelected ? null : session.id)}
                  >
                    <div className="flex items-center gap-1.5 text-xs">
                      <span
                        className="relative h-3 w-3 shrink-0 flex items-center justify-center"
                        onClick={(e) => { e.stopPropagation(); togglePinnedSession(session.id) }}
                      >
                        <span
                          className={cn(
                            'h-2 w-2 rounded-full',
                            pinnedSessionIds.has(session.id) ? 'hidden' : 'group-hover:hidden',
                            session.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground/60 dark:bg-muted-foreground/40',
                          )}
                        />
                        <Pin
                          className={cn(
                            'h-3 w-3 absolute inset-0 cursor-pointer transition-opacity',
                            pinnedSessionIds.has(session.id)
                              ? session.status === 'active' ? 'opacity-80 text-green-500' : 'opacity-60 text-primary'
                              : 'opacity-0 group-hover:opacity-100',
                            !pinnedSessionIds.has(session.id) && (session.status === 'active' ? 'text-green-500/60 hover:text-green-500' : 'text-muted-foreground/50 hover:text-muted-foreground'),
                          )}
                        />
                      </span>
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          className="truncate bg-transparent border border-border rounded px-0.5 text-xs outline-none w-full min-w-0"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              saveSlug(session.id)
                            } else if (e.key === 'Escape') {
                              e.preventDefault()
                              cancelEditing()
                            }
                          }}
                          onBlur={() => saveSlug(session.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="truncate">{label}</span>
                      )}
                      {!isEditing && (
                        <span className="text-[10px] text-muted-foreground/80 dark:text-muted-foreground/60 ml-auto shrink-0 hidden @[250px]:inline group-hover:!hidden">
                          {formatRelativeTime(sessionSortOrder === 'activity' ? (session.lastActivity || session.startedAt) : session.startedAt)}
                        </span>
                      )}
                      {!isEditing && (session.eventCount != null || (session.id === selectedSessionId && currentEvents)) && (
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1 shrink-0 hidden @[200px]:inline-flex ml-auto @[250px]:ml-0 group-hover:!hidden">
                          {session.id === selectedSessionId && currentEvents ? currentEvents.length : session.eventCount}
                        </Badge>
                      )}
                      {!isEditing && (
                        <Pencil
                          data-testid={`edit-session-${session.id}`}
                          className="h-3 w-3 shrink-0 ml-auto hidden group-hover:block text-muted-foreground/50 hover:text-muted-foreground transition-opacity cursor-pointer"
                          onClick={(e) => startEditing(session, e)}
                        />
                      )}
                    </div>
                    {cwd && (
                      <div className="pl-[18px] pb-0.5 text-[10px] text-muted-foreground/30 dark:text-muted-foreground/20 group-hover:text-muted-foreground/70 dark:group-hover:text-muted-foreground/50 transition-colors truncate" dir="rtl">
                        <span dir="ltr">{shortenCwd(cwd)}</span>
                      </div>
                    )}
                  </div>
                </TooltipTrigger>
                {tooltipLines.length > 0 && (
                  <TooltipContent side="right" className="text-xs">
                    {tooltipLines.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </TooltipContent>
                )}
              </Tooltip>
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
          {shouldCollapse && expandedGroups.has(group.label) && group.sessions.length > previewCount && (
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
    </div>
  )
}
