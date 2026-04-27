import { memo } from 'react'
import { cn } from '@/lib/utils'
import { getAgentColorById } from '@/lib/agent-utils'
import { AgentLabel } from '@/components/shared/agent-label'
import { AgentRegistry } from '@/agents/registry'
import { AgentClassIcon } from '@/components/shared/agent-class-icon'
import { useUIStore } from '@/stores/ui-store'
import { Check, X, Loader } from 'lucide-react'
import type { EnrichedEvent, FrameworkDataApi } from '@/agents/types'
import { useTimestampTooltip } from './timestamp-tooltip'

interface EventRowProps {
  event: EnrichedEvent
  dataApi: FrameworkDataApi
  agentColorMap: Map<string, number>
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

export const EventRow = memo(function EventRow({
  event,
  dataApi,
  agentColorMap,
  showAgentLabel,
}: EventRowProps) {
  const isExpanded = useUIStore((s) => s.expandedEventIds.has(event.id))
  const isSelected = useUIStore((s) => s.selectedEventId === event.id)
  const isFlashing = useUIStore((s) => s.flashingEventId === event.id)
  const toggleExpandedEvent = useUIStore((s) => s.toggleExpandedEvent)
  const setSelectedEventId = useUIStore((s) => s.setSelectedEventId)
  const { show: showTimestampTooltip, hide: hideTimestampTooltip } = useTimestampTooltip()

  const agent = dataApi.getAgent(event.agentId)
  const isSubagent = agent?.parentAgentId != null
  const parentAgent = agent?.parentAgentId ? dataApi.getAgent(agent.parentAgentId) : undefined
  const agentColors = getAgentColorById(event.agentId, agentColorMap)

  // Resolve icon and color at render time (not from enriched event) so
  // icon customization changes propagate instantly without full reprocess.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useUIStore((s) => s.iconCustomizationVersion) // subscribe to trigger re-render

  // Resolve the registration from the agent's class (falls back to default
  // when unknown, or claude-code for legacy rows with null agentClass), then
  // use its icon/color resolvers so each agent class controls its own rendering.
  const registration = AgentRegistry.get(agent?.agentClass || 'claude-code')
  const Icon = registration.getEventIcon(event)
  const { iconColor, customHex } = registration.getEventColor(event)
  const RowSummary = registration.RowSummary
  const EventDetail = registration.EventDetail

  const isFailure = event.status === 'failed'
  const isCompleted = event.status === 'completed'
  const isPending = event.status === 'pending' || event.status === 'running'
  const showStatus = isFailure || isCompleted || isPending

  const handleRowClick = (e: React.MouseEvent) => {
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setSelectedEventId(isSelected ? null : event.id)
      return
    }
    toggleExpandedEvent(event.id)
  }

  return (
    <div
      className={cn(
        'transition-shadow',
        isSelected && 'ring-1 ring-primary/40',
        isFlashing && 'animate-[flash-ring_0.4s_ease-in-out_3]',
      )}
    >
      <button
        className={cn(
          'flex flex-col w-full text-left px-3 py-1.5 border-l-2 transition-colors hover:bg-accent/50 overflow-hidden cursor-pointer',
          isSubagent ? 'bg-muted/20' : '',
          isSelected
            ? 'border-l-primary bg-primary/[0.07] dark:bg-primary/[0.12]'
            : agentColors.border,
        )}
        onClick={handleRowClick}
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault()
        }}
      >
        {/* Agent label (framework-owned) */}
        {showAgentLabel && (
          <div
            className={cn(
              'text-[10px] opacity-90 dark:opacity-60 leading-tight',
              agentColors.textOnly,
            )}
          >
            {isSubagent ? '↳ ' : ''}
            {agent ? (
              <AgentLabel agent={agent} parentAgent={parentAgent ?? null} />
            ) : (
              event.agentId.slice(0, 8)
            )}
          </div>
        )}

        {/* Event row content */}
        <div className="flex items-center gap-2 w-full min-w-0">
          {/* Icon (framework-owned, from enriched event) */}
          <span
            className={cn('shrink-0', !customHex && iconColor)}
            style={customHex ? { color: customHex } : undefined}
            title={event.labelTooltip ?? event.hookName}
          >
            <Icon className="h-4 w-4" />
          </span>

          {/* Label (framework-owned) */}
          <span
            className="text-xs font-medium w-16 shrink-0 truncate text-muted-foreground"
            title={event.labelTooltip ?? event.hookName}
          >
            {event.label}
          </span>

          {/* Status indicator (framework-owned) */}
          {showStatus && (
            <span
              className={cn(
                'shrink-0',
                isFailure
                  ? 'text-red-600 dark:text-red-500'
                  : isCompleted
                    ? 'text-green-600 dark:text-green-500'
                    : 'text-yellow-600 dark:text-yellow-500/70',
              )}
            >
              {isFailure ? (
                <X className="h-3 w-3" />
              ) : isCompleted ? (
                <Check className="h-3 w-3" />
              ) : (
                <Loader className="h-3 w-3" />
              )}
            </span>
          )}

          {/* Summary line (agent-class-owned) */}
          <RowSummary event={event} dataApi={dataApi} />

          {/* Agent class icon + timestamp (framework-owned) */}
          <span
            className="flex items-center gap-1 text-[10px] text-muted-foreground/80 dark:text-muted-foreground/60 tabular-nums shrink-0"
            onMouseEnter={(e) =>
              showTimestampTooltip(event.timestamp, e.currentTarget.getBoundingClientRect())
            }
            onMouseLeave={hideTimestampTooltip}
          >
            <AgentClassIcon agentClass={agent?.agentClass} />
            {formatTime(event.timestamp)}
          </span>
        </div>
      </button>

      {/* Expanded detail (agent-class-owned) */}
      {isExpanded && (
        <div className="px-3 py-2 bg-muted/10 border-t border-border/30">
          <EventDetail event={event} dataApi={dataApi} />
        </div>
      )}
    </div>
  )
})
