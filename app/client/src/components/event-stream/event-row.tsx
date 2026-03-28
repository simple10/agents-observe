import { memo, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { getEventIcon, getEventColor } from '@/config/event-icons'
import { getEventSummary } from '@/lib/event-summary'
import { getAgentDisplayName, getAgentColorById } from '@/lib/agent-utils'
import { useUIStore } from '@/stores/ui-store'
import { EventDetail } from './event-detail'
import { Check, X, Loader } from 'lucide-react'
import type { ParsedEvent, Agent } from '@/types'

export interface SpawnInfo {
  description?: string
  prompt?: string
}

interface EventRowProps {
  event: ParsedEvent
  agentMap: Map<string, Agent>
  agentColorMap: Map<string, number>
  showAgentLabel: boolean
  spawnInfo?: SpawnInfo
  onRowRef?: (id: number, el: HTMLDivElement | null) => void
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
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

export const EventRow = memo(function EventRow({ event, agentMap, agentColorMap, showAgentLabel, spawnInfo, onRowRef }: EventRowProps) {
  const { expandedEventIds, toggleExpandedEvent, scrollToEventId, setScrollToEventId, selectedEventId, setSelectedEventId } =
    useUIStore()
  const isExpanded = expandedEventIds.has(event.id)
  const isSelected = selectedEventId === event.id
  const rowRef = useRef<HTMLDivElement>(null)

  // Register this row's DOM element with the parent for scroll-to-selected
  const combinedRef = useCallback((el: HTMLDivElement | null) => {
    (rowRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    onRowRef?.(event.id, el)
  }, [event.id, onRowRef])

  const agent = agentMap.get(event.agentId)
  const agentName = agent ? getAgentDisplayName(agent) : event.agentId.slice(0, 8)
  const isSubagent = agent?.parentAgentId != null
  const agentColors = getAgentColorById(event.agentId, agentColorMap)
  const Icon = getEventIcon(event.subtype, event.toolName)
  const { iconColor } = getEventColor(event.subtype, event.toolName)

  const isTool = event.subtype === 'PreToolUse' || event.subtype === 'PostToolUse' || event.subtype === 'PostToolUseFailure'
  const isFailure = event.subtype === 'PostToolUseFailure'
  const isCompleted = event.status === 'completed'

  const rawLabel = isTool ? 'Tool' : event.subtype || event.type
  const displayLabel = LABEL_MAP[rawLabel] || rawLabel
  const displaySummary = getEventSummary(event)

  useEffect(() => {
    if (scrollToEventId === event.id && rowRef.current) {
      const el = rowRef.current
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setScrollToEventId(null)

      // Flash after scroll completes — use IntersectionObserver to detect visibility
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            observer.disconnect()
            el.classList.add('animate-[flash-ring_0.4s_ease-in-out_3]')
            el.addEventListener('animationend', () => {
              el.classList.remove('animate-[flash-ring_0.4s_ease-in-out_3]')
            }, { once: true })
          }
        },
        { threshold: 0.5 },
      )
      observer.observe(el)
      // Fallback: disconnect after 5s in case scroll never brings it into view
      setTimeout(() => observer.disconnect(), 5000)
    }
  }, [scrollToEventId, event.id, setScrollToEventId])

  const handleRowClick = (e: React.MouseEvent) => {
    // Middle-click or ctrl/meta+click: select/deselect the row
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setSelectedEventId(isSelected ? null : event.id)
      return
    }
    // Normal click: toggle expand
    toggleExpandedEvent(event.id)
  }

  return (
    <div ref={combinedRef} className={cn('transition-shadow', isSelected && 'ring-1 ring-primary/40')}>
      <button
        className={cn(
          'flex flex-col w-full text-left px-3 py-1.5 border-l-2 transition-colors hover:bg-accent/50 overflow-hidden',
          isSubagent ? 'bg-muted/20' : '',
          isSelected
            ? 'border-l-primary bg-primary/[0.07] dark:bg-primary/[0.12]'
            : agentColors.border,
        )}
        onClick={handleRowClick}
        onMouseDown={(e) => { if (e.button === 1) e.preventDefault() }}
      >
        {showAgentLabel && (
          <div className={cn('text-[10px] opacity-90 dark:opacity-60 leading-tight', agentColors.textOnly)}>
            {isSubagent ? '↳ ' : ''}
            {agentName}
          </div>
        )}

        <div className="flex items-center gap-2 w-full min-w-0">
          <span className={cn('shrink-0', iconColor)} title={event.subtype || event.type}>
            <Icon className="h-4 w-4" />
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
                'shrink-0',
                isFailure ? 'text-red-600 dark:text-red-500' : isCompleted ? 'text-green-600 dark:text-green-500' : 'text-yellow-600 dark:text-yellow-500/70',
              )}
            >
              {isFailure ? <X className="h-3 w-3" /> : isCompleted ? <Check className="h-3 w-3" /> : <Loader className="h-3 w-3" />}
            </span>
          )}
          {isTool && event.toolName && (
            <span className="text-xs font-medium text-blue-700 dark:text-blue-400 shrink-0">{event.toolName}</span>
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
          <span className="text-[10px] text-muted-foreground/80 dark:text-muted-foreground/60 tabular-nums shrink-0">
            {formatTime(event.timestamp)}
          </span>
        </div>
      </button>

      {isExpanded && <EventDetail event={event} agentMap={agentMap} spawnInfo={spawnInfo} />}
    </div>
  )
})
