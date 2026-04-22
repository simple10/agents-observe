import { useState, useMemo, useRef } from 'react'
import { useEvents } from '@/hooks/use-events'
import { useAgents } from '@/hooks/use-agents'
import { useUIStore } from '@/stores/ui-store'
import { getAgentDisplayName, buildAgentColorMap, getAgentColorById } from '@/lib/agent-utils'
import { AgentLabel } from '@/components/shared/agent-label'
import { AgentClassIcon, agentClassDisplayName } from '@/components/shared/agent-class-icon'
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
import { Bot, Check, ChevronDown, X, Users, Copy } from 'lucide-react'
import type { Agent } from '@/types'

function formatRuntime(agent: Agent): string {
  const end = agent.lastEventAt ?? Date.now()
  const start = agent.firstEventAt ?? end
  const ms = end - start
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
  const { data: events } = useEvents(selectedSessionId)
  const agents = useAgents(selectedSessionId, events)
  const [open, setOpen] = useState(false)
  const snapshotRef = useRef<Agent[]>([])

  // Snapshot the sorted order when the popover opens so it doesn't
  // re-sort while the user is browsing
  const sortedAgents = useMemo(() => {
    if (!open) return snapshotRef.current

    const main = agents.filter((a) => !a.parentAgentId)
    const subs = agents
      .filter((a) => a.parentAgentId)
      .sort((a, b) => {
        // Active first
        if (a.status === 'active' && b.status !== 'active') return -1
        if (a.status !== 'active' && b.status === 'active') return 1
        // Most recently started first
        return (b.firstEventAt ?? 0) - (a.firstEventAt ?? 0)
      })

    const sorted = [...main, ...subs]
    snapshotRef.current = sorted
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agents])

  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])

  const activeCount = agents.filter((a) => a.status === 'active').length
  const selectedAgents = agents.filter((a) => selectedAgentIds.includes(a.id))

  return (
    <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            data-region-target="agents"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs px-2.5"
          >
            <Users className="h-3.5 w-3.5" />
            Agents
            {activeCount > 0 && (
              <span className="text-green-600 dark:text-green-400">{activeCount} active</span>
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
          <Command
            filter={(value, search) => {
              // Custom filter: match against agent display name and description
              const agent = sortedAgents.find((a) => a.id === value)
              if (!agent) return 0
              const name = getAgentDisplayName(agent).toLowerCase()
              const desc = (agent.name || '').toLowerCase()
              const s = search.toLowerCase()
              if (name.includes(s) || desc.includes(s) || agent.id.includes(s)) return 1
              return 0
            }}
          >
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
                  {selectedAgentIds.length === 0 && <Check className="ml-auto h-3.5 w-3.5" />}
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading={`${agents.length} agents`}>
                {sortedAgents.map((agent) => {
                  const isSelected = selectedAgentIds.includes(agent.id)
                  const isMain = !agent.parentAgentId
                  const agentColor = getAgentColorById(agent.id, agentColorMap)

                  return (
                    <CommandItem
                      key={agent.id}
                      value={agent.id}
                      onSelect={() => toggleAgentId(agent.id)}
                      className="text-xs gap-2 items-start"
                    >
                      <div
                        className={cn(
                          'flex items-center justify-center h-4 w-4 rounded border shrink-0 mt-0.5',
                          isSelected
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-muted-foreground/30',
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full mt-1.5',
                          agent.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground/40',
                        )}
                      />
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-1 min-w-0">
                          <AgentClassIcon
                            agentClass={agent.agentClass}
                            className="text-muted-foreground/70"
                          />
                          <AgentLabel
                            agent={agent}
                            disableTooltip
                            className={cn('truncate', isMain && 'font-medium', agentColor.textOnly)}
                          />
                        </div>
                        {(() => {
                          const showDesc =
                            !isMain &&
                            agent.description &&
                            agent.description !== getAgentDisplayName(agent)
                          const showType = !isMain && !!agent.agentType
                          const showCwd = !isMain && !!agent.cwd
                          const className = agentClassDisplayName(agent.agentClass)
                          return (
                            <div className="flex items-center gap-0 text-[10px] text-muted-foreground/50 min-w-0">
                              <span className="shrink-0">{className}</span>
                              {(showDesc || showType) && <span className="shrink-0 mx-1">-</span>}
                              {showDesc && <span className="truncate">{agent.description}</span>}
                              {showDesc && showType && <span className="shrink-0 mx-1">-</span>}
                              {showType && (
                                <span className="font-mono shrink-0">{agent.agentType}</span>
                              )}
                              {showCwd && (
                                <span className="ml-auto truncate pl-2" dir="rtl">
                                  <span dir="ltr">
                                    {agent.cwd!.replace(/^\/(?:Users|home)\/[^/]+/, '~')}
                                  </span>
                                </span>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-[10px] text-muted-foreground">
                        <span>{formatStartTime(agent.firstEventAt ?? 0)}</span>
                        <span>{formatRuntime(agent)}</span>
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                          {agent.eventCount}
                        </Badge>
                        <button
                          className="opacity-40 hover:opacity-100 transition-opacity"
                          title="Copy agent ID"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigator.clipboard.writeText(agent.id)
                          }}
                        >
                          <Copy className="h-3 w-3" />
                        </button>
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
                agent.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground/40',
              )}
            />
            <AgentLabel
              agent={agent}
              parentAgent={agent.parentAgentId ? agentMap.get(agent.parentAgentId) : null}
              className={chipColor.textOnly}
            />
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
