import { useState, useMemo, useRef } from 'react'
import { useAgents } from '@/hooks/use-agents'
import { useUIStore } from '@/stores/ui-store'
import { getAgentDisplayName, buildAgentColorMap, getAgentColorById } from '@/lib/agent-utils'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command'
import { Bot, Check, ChevronDown, X, Users } from 'lucide-react'
import type { Agent } from '@/types'

function formatRuntime(agent: Agent): string {
  const end = agent.stoppedAt ?? Date.now()
  const ms = end - agent.startedAt
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

function formatStartTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AgentCombobox() {
  const { selectedSessionId, selectedAgentIds, toggleAgentId, setSelectedAgentIds } = useUIStore()
  const { data: agents } = useAgents(selectedSessionId)
  const [open, setOpen] = useState(false)
  const snapshotRef = useRef<Agent[]>([])

  // Flatten agent tree
  const allAgents = useMemo(() => {
    const flat: Agent[] = []
    function collect(list: Agent[] | undefined) {
      list?.forEach((a) => {
        flat.push(a)
        if (a.children) collect(a.children)
      })
    }
    collect(agents)
    return flat.filter((a) => (a.eventCount ?? 0) > 0)
  }, [agents])

  // Snapshot the sorted order when the popover opens so it doesn't
  // re-sort while the user is browsing
  const sortedAgents = useMemo(() => {
    if (!open) return snapshotRef.current

    const main = allAgents.filter((a) => !a.parentAgentId)
    const subs = allAgents
      .filter((a) => a.parentAgentId)
      .sort((a, b) => {
        // Active first
        if (a.status === 'active' && b.status !== 'active') return -1
        if (a.status !== 'active' && b.status === 'active') return 1
        // Most recently started first
        return b.startedAt - a.startedAt
      })

    const sorted = [...main, ...subs]
    snapshotRef.current = sorted
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allAgents])

  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])

  const activeCount = allAgents.filter((a) => a.status === 'active').length
  const selectedAgents = allAgents.filter((a) => selectedAgentIds.includes(a.id))

  return (
    <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs px-2.5"
          >
            <Users className="h-3.5 w-3.5" />
            Agents
            {activeCount > 0 && (
              <span className="text-green-600 dark:text-green-400">
                {activeCount} active
              </span>
            )}
            {selectedAgentIds.length > 0 && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-0.5">
                {selectedAgentIds.length} selected
              </Badge>
            )}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[28rem] p-0" align="start">
          <Command filter={(value, search) => {
            // Custom filter: match against agent display name and description
            const agent = sortedAgents.find((a) => a.id === value)
            if (!agent) return 0
            const name = getAgentDisplayName(agent).toLowerCase()
            const desc = (agent.name || '').toLowerCase()
            const s = search.toLowerCase()
            if (name.includes(s) || desc.includes(s) || agent.id.includes(s)) return 1
            return 0
          }}>
            <CommandInput placeholder="Search agents..." />
            <CommandList>
              <CommandEmpty>No agents found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__show_all__"
                  onSelect={() => setSelectedAgentIds([])}
                  className="text-xs"
                >
                  <Bot className="h-3.5 w-3.5" />
                  <span className="font-medium">Show All Agents</span>
                  {selectedAgentIds.length === 0 && (
                    <Check className="ml-auto h-3.5 w-3.5" />
                  )}
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading={`${allAgents.length} agents`}>
                {sortedAgents.map((agent) => {
                  const isSelected = selectedAgentIds.includes(agent.id)
                  const displayName = getAgentDisplayName(agent)
                  const isMain = !agent.parentAgentId
                  const agentColor = getAgentColorById(agent.id, agentColorMap)

                  return (
                    <CommandItem
                      key={agent.id}
                      value={agent.id}
                      onSelect={() => toggleAgentId(agent.id)}
                      className="text-xs gap-2"
                    >
                      <div className={cn(
                        'flex items-center justify-center h-4 w-4 rounded border shrink-0',
                        isSelected
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'border-muted-foreground/30',
                      )}>
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full',
                          agentColor.dot,
                          agent.status !== 'active' && 'opacity-40',
                        )}
                      />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className={cn('truncate', isMain && 'font-medium', agentColor.textOnly)}>
                          {displayName}
                        </span>
                        {!isMain && (
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 font-mono">
                            {agent.agentType && <span>{agent.agentType}</span>}
                            <span>{agent.id}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-[10px] text-muted-foreground">
                        <span>{formatStartTime(agent.startedAt)}</span>
                        <span>{formatRuntime(agent)}</span>
                        {agent.eventCount != null && (
                          <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                            {agent.eventCount}
                          </Badge>
                        )}
                      </div>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected agent chips (shown inline when filtering) */}
      {selectedAgents.map((agent) => {
        const chipColor = getAgentColorById(agent.id, agentColorMap)
        return (
        <Badge
          key={agent.id}
          variant="secondary"
          className="gap-1 text-xs h-6 cursor-pointer select-none border-primary/60 bg-primary/10 ring-1 ring-primary/40"
          onClick={() => toggleAgentId(agent.id)}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              chipColor.dot,
              agent.status !== 'active' && 'opacity-40',
            )}
          />
          <span className={chipColor.textOnly}>{getAgentDisplayName(agent)}</span>
          <button
            className="ml-0.5 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              toggleAgentId(agent.id)
            }}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
        )
      })}
    </div>
  )
}
