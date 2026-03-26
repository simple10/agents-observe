import { useAgents } from '@/hooks/use-agents'
import { useUIStore } from '@/stores/ui-store'
import { Badge } from '@/components/ui/badge'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  X,
  CornerDownRight,
  ArrowDownToLine,
  Trash2,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getAgentDisplayName } from '@/lib/agent-utils'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { Agent } from '@/types'

export function ScopeBar() {
  const {
    selectedProjectId,
    selectedSessionId,
    setSelectedSessionId,
    selectedAgentIds,
    removeAgentId,
    toggleAgentId,
    autoFollow,
    setAutoFollow,
    expandedEventIds,
    collapseAllEvents,
    requestExpandAll,
  } = useUIStore()
  const { data: agents } = useAgents(selectedSessionId)
  const queryClient = useQueryClient()

  if (!selectedProjectId || !selectedSessionId) return null

  const allAgents: Agent[] = []
  function collectAgents(list: Agent[] | undefined) {
    list?.forEach((a) => {
      allAgents.push(a)
      if (a.children) collectAgents(a.children)
    })
  }
  collectAgents(agents)

  const visibleAgents =
    selectedAgentIds.length > 0
      ? allAgents.filter((a) => selectedAgentIds.includes(a.id))
      : allAgents

  const sortedAgents = [...visibleAgents].sort((a, b) => {
    // Main (root) always first
    if (!a.parentAgentId && b.parentAgentId) return -1
    if (a.parentAgentId && !b.parentAgentId) return 1
    // Active before stopped
    if (a.status === 'active' && b.status !== 'active') return -1
    if (a.status !== 'active' && b.status === 'active') return 1
    // Most recently started first
    return b.startedAt - a.startedAt
  })

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border min-h-[40px] flex-wrap">
      <span className="text-xs text-muted-foreground">Agents:</span>

      <div className="flex items-center gap-1 flex-wrap">
        {sortedAgents.map((agent) => {
          const isSubagent = agent.parentAgentId !== null
          const isSelected = selectedAgentIds.includes(agent.id)
          return (
            <Badge
              key={agent.id}
              variant="secondary"
              className={cn(
                'gap-1 text-xs cursor-pointer select-none',
                agent.status === 'active' ? 'border-green-500/30' : '',
                isSelected ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/40' : '',
              )}
              onClick={() => toggleAgentId(agent.id)}
            >
              {isSubagent && <CornerDownRight className="h-2.5 w-2.5" />}
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  agent.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground/40',
                )}
              />
              {getAgentDisplayName(agent)}
              {selectedAgentIds.length > 0 && (
                <button
                  className="ml-0.5 hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeAgentId(agent.id)
                  }}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </Badge>
          )
        })}
        {sortedAgents.length === 0 && (
          <span className="text-xs text-muted-foreground/60">No agents</span>
        )}
      </div>

      <div className="flex items-center gap-1 ml-auto">
        <Button
          variant={autoFollow ? 'default' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => setAutoFollow(!autoFollow)}
          title={autoFollow ? 'Auto-follow enabled' : 'Auto-follow disabled'}
        >
          <ArrowDownToLine className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            if (expandedEventIds.size > 0) {
              collapseAllEvents()
            } else {
              requestExpandAll()
            }
          }}
          title={expandedEventIds.size > 0 ? 'Collapse all' : 'Expand all'}
        >
          {expandedEventIds.size > 0 ? (
            <ChevronsDownUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5" />
          )}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              title="Delete or clear session"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete or clear session?</AlertDialogTitle>
              <AlertDialogDescription>
                Choose an action for this session. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (selectedSessionId) {
                    await api.clearSessionEvents(selectedSessionId)
                    queryClient.invalidateQueries({ queryKey: ['events'] })
                  }
                }}
              >
                Clear logs
              </AlertDialogAction>
              <AlertDialogAction
                variant="destructive"
                onClick={async () => {
                  if (selectedSessionId) {
                    await api.deleteSession(selectedSessionId)
                    setSelectedSessionId(null)
                    queryClient.invalidateQueries({ queryKey: ['sessions'] })
                    queryClient.invalidateQueries({ queryKey: ['events'] })
                  }
                }}
              >
                Delete session
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
