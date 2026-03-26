import { useProjects } from '@/hooks/use-projects'
import { useSessions } from '@/hooks/use-sessions'
import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

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

export function ProjectList({ collapsed }: ProjectListProps) {
  const { data: projects } = useProjects()
  const { selectedProjectId, setSelectedProjectId } = useUIStore()

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

          if (collapsed) {
            return (
              <Tooltip key={project.id}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      'flex h-8 w-8 mx-auto items-center justify-center rounded-md text-xs',
                      isSelected
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'text-muted-foreground hover:bg-accent',
                    )}
                    onClick={() => setSelectedProjectId(isSelected ? null : project.id)}
                  >
                    {project.name.charAt(0).toUpperCase()}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{project.name}</TooltipContent>
              </Tooltip>
            )
          }

          return (
            <div key={project.id}>
              <button
                className={cn(
                  'flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm transition-colors',
                  isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent',
                )}
                onClick={() => setSelectedProjectId(isSelected ? null : project.id)}
              >
                {isSelected ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
                <Folder className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{project.name}</span>
                {project.sessionCount != null && (
                  <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">
                    {project.sessionCount}
                  </Badge>
                )}
              </button>
              {isSelected && <SessionList projectId={project.id} />}
            </div>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

function shortenCwd(cwd: string): string {
  // Replace /Users/<name> or /home/<name> with ~
  return cwd.replace(/^\/(?:Users|home)\/[^/]+/, '~')
}

function SessionList({ projectId }: { projectId: string }) {
  const { data: sessions } = useSessions(projectId)
  const { selectedSessionId, setSelectedSessionId } = useUIStore()

  if (!sessions?.length) {
    return <div className="text-xs text-muted-foreground pl-6 py-1">No sessions</div>
  }

  return (
    <div className="ml-4 mt-1 space-y-0.5">
      {sessions.map((session) => {
        const isSelected = selectedSessionId === session.id
        const label = session.slug || session.id.slice(0, 8)
        const cwd = typeof session.metadata?.cwd === 'string' ? session.metadata.cwd : null
        const activeAgents = session.activeAgentCount ?? 0

        const tooltipLines = [cwd, activeAgents > 0 ? `${activeAgents} active agent${activeAgents !== 1 ? 's' : ''}` : null].filter(Boolean)

        return (
          <Tooltip key={session.id}>
            <TooltipTrigger asChild>
              <div>
                <button
                  className={cn(
                    'flex items-center gap-1.5 w-full rounded-md px-2 py-1 text-xs transition-colors',
                    isSelected
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                  onClick={() => setSelectedSessionId(isSelected ? null : session.id)}
                >
                  <span
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      session.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground/40',
                    )}
                  />
                  <span className="truncate">{label}</span>
                  <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">
                    {formatRelativeTime(session.startedAt)}
                  </span>
                  {session.eventCount != null && (
                    <Badge variant="outline" className="text-[9px] h-3.5 px-1 shrink-0">
                      {session.eventCount}
                    </Badge>
                  )}
                </button>
                {cwd && (
                  <div className="px-2 pb-0.5 text-[10px] text-muted-foreground/50 truncate">
                    {shortenCwd(cwd)}
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
    </div>
  )
}
