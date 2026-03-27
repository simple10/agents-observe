import { memo, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { getEventIcon } from '@/config/event-icons'
import { getEventSummary } from '@/lib/event-summary'
import { getAgentDisplayName } from '@/lib/agent-utils'
import { useUIStore } from '@/stores/ui-store'
import { EventDetail } from './event-detail'
import type { ParsedEvent, Agent } from '@/types'

interface EventRowProps {
  event: ParsedEvent
  agentMap: Map<string, Agent>
  showAgentLabel: boolean
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const AGENT_COLORS = [
  'text-green-400 border-green-500/50',
  'text-blue-400 border-blue-500/50',
  'text-purple-400 border-purple-500/50',
  'text-amber-400 border-amber-500/50',
  'text-cyan-400 border-cyan-500/50',
  'text-rose-400 border-rose-500/50',
  'text-emerald-400 border-emerald-500/50',
  'text-orange-400 border-orange-500/50',
]

function getAgentColor(agentId: string): string {
  let hash = 0
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length]
}

// Friendly display labels for subtypes
const LABEL_MAP: Record<string, string> = {
  UserPromptSubmit: 'Prompt',
  stop_hook_summary: 'Stop',
  StopFailure: 'Error',
  SubagentStart: 'SubStart',
  SubagentStop: 'SubStop',
  SessionStart: 'Session',
  SessionEnd: 'Session',
  PostToolUseFailure: 'ToolErr',
  PermissionRequest: 'Permit',
  TaskCreated: 'Task',
  TaskCompleted: 'Task',
  TeammateIdle: 'Team',
  InstructionsLoaded: 'Config',
  ConfigChange: 'Config',
  CwdChanged: 'CwdChg',
  FileChanged: 'FileChg',
  PreCompact: 'Compact',
  PostCompact: 'Compact',
  Elicitation: 'MCP',
  ElicitationResult: 'MCP',
  WorktreeCreate: 'Worktree',
  WorktreeRemove: 'Worktree',
}

export const EventRow = memo(function EventRow({ event, agentMap, showAgentLabel }: EventRowProps) {
  const { expandedEventIds, toggleExpandedEvent, scrollToEventId, setScrollToEventId } =
    useUIStore()
  const isExpanded = expandedEventIds.has(event.id)
  const rowRef = useRef<HTMLDivElement>(null)

  const agent = agentMap.get(event.agentId)
  const agentName = agent ? getAgentDisplayName(agent) : event.agentId.slice(0, 8)
  const isSubagent = agent?.parentAgentId != null
  const colorClass = getAgentColor(event.agentId)
  const icon = getEventIcon(event.subtype, event.toolName)

  const isTool = event.subtype === 'PreToolUse' || event.subtype === 'PostToolUse' || event.subtype === 'PostToolUseFailure'
  const isFailure = event.subtype === 'PostToolUseFailure'
  const isCompleted = event.status === 'completed'

  const rawLabel = isTool ? 'Tool' : event.subtype || event.type
  const displayLabel = LABEL_MAP[rawLabel] || rawLabel
  const displaySummary = getEventSummary(event)

  useEffect(() => {
    if (scrollToEventId === event.id && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      rowRef.current.classList.add('ring-2', 'ring-primary/50')
      setTimeout(() => {
        rowRef.current?.classList.remove('ring-2', 'ring-primary/50')
      }, 2000)
      setScrollToEventId(null)
    }
  }, [scrollToEventId, event.id, setScrollToEventId])

  return (
    <div ref={rowRef} className="transition-shadow">
      <button
        className={cn(
          'flex flex-col w-full text-left px-3 py-1.5 border-l-2 transition-colors hover:bg-accent/50 overflow-hidden',
          isSubagent ? 'bg-muted/20' : '',
          colorClass.split(' ')[1],
        )}
        onClick={() => toggleExpandedEvent(event.id)}
      >
        {showAgentLabel && (
          <div className={cn('text-[10px] opacity-60 leading-tight', colorClass.split(' ')[0])}>
            {isSubagent ? '↳ ' : ''}
            {agentName}
          </div>
        )}

        <div className="flex items-center gap-2 w-full min-w-0">
          <span className="text-sm shrink-0" title={event.subtype || event.type}>
            {icon}
          </span>
          <span
            className="text-xs font-medium w-16 shrink-0 truncate text-muted-foreground"
            title={event.subtype || event.type}
          >
            {displayLabel}
          </span>
          {isTool && (
            <span
              className={cn(
                'text-[10px] shrink-0 w-3',
                isFailure ? 'text-red-500' : isCompleted ? 'text-green-500' : 'text-yellow-500/70',
              )}
            >
              {isFailure ? '✗' : isCompleted ? '✓' : '…'}
            </span>
          )}
          {isTool && event.toolName && (
            <span className="text-xs font-medium text-blue-400 shrink-0">{event.toolName}</span>
          )}
          {displaySummary.includes('\n') ? (
            <div className="text-xs text-muted-foreground flex-1 min-w-0">
              {displaySummary.split('\n').map((line, i) => (
                <div key={i} className="truncate">
                  {line}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
              {displaySummary}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
            {formatTime(event.timestamp)}
          </span>
        </div>
      </button>

      {isExpanded && <EventDetail event={event} />}
    </div>
  )
})
