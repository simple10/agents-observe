import { useCallback } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { Pin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { api } from '@/lib/api-client'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SessionItem } from './session-item'
import type { Session } from '@/types'

export function PinnedSessions({ collapsed }: { collapsed: boolean }) {
  const pinnedIds = useUIStore((s) => s.pinnedSessionIds)
  const selectedSessionId = useUIStore((s) => s.selectedSessionId)
  const togglePinnedSession = useUIStore((s) => s.togglePinnedSession)
  const queryClient = useQueryClient()

  const queries = useQueries({
    queries: [...pinnedIds].map((id) => ({
      queryKey: ['session', id],
      queryFn: () => api.getSession(id),
      staleTime: 30_000,
    })),
  })

  const sessions = queries.map((q) => q.data).filter(Boolean) as Session[]

  function selectSession(session: Session) {
    const isSelected = selectedSessionId === session.id
    if (isSelected) {
      useUIStore.getState().setSelectedSessionId(null)
    } else {
      useUIStore.getState().setSelectedProject(session.projectId, session.projectSlug || null)
      useUIStore.getState().setSelectedSessionId(session.id)
    }
  }

  const handleRename = useCallback(
    async (id: string, name: string) => {
      await api.updateSessionSlug(id, name)
      await queryClient.invalidateQueries({ queryKey: ['session', id] })
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
    [queryClient],
  )

  if (pinnedIds.size === 0) return null

  if (collapsed) {
    return (
      <div className="px-1 py-1 space-y-1">
        {sessions.map((session) => (
          <Tooltip key={session.id}>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  'flex h-8 w-8 mx-auto items-center justify-center rounded-md text-xs cursor-pointer',
                  selectedSessionId === session.id
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'text-muted-foreground hover:bg-accent',
                )}
                onClick={() => selectSession(session)}
              >
                <Pin className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{session.slug || session.id.slice(0, 8)}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    )
  }

  return (
    <div className="px-2 py-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 dark:text-muted-foreground/60 px-2 pb-0.5 select-none">
        Pinned
      </div>
      {sessions.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          isSelected={selectedSessionId === session.id}
          isPinned={true}
          onSelect={() => selectSession(session)}
          onTogglePin={() => togglePinnedSession(session.id)}
          onRename={handleRename}
          onEdit={() => useUIStore.getState().setEditingSessionId(session.id)}
          cwd={typeof session.metadata?.cwd === 'string' ? session.metadata.cwd : null}
          showCwd={false}
        />
      ))}
    </div>
  )
}
