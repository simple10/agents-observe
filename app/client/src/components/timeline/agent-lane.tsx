import { useRef, useMemo, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { getNow } from '@/lib/get-now'
import { getEventIcon, getEventColor } from '@/config/event-icons'
import { getEventSummary } from '@/lib/event-summary'
import { useUIStore } from '@/stores/ui-store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AgentLabel } from '@/components/shared/agent-label'
import type { Agent, ParsedEvent } from '@/types'

// Renders event dots with CSS-driven drift animation.
// Each dot mounts at its current position and CSS-transitions to -5% (off-screen).
// On scale change, all dots are unmounted and remounted via a key change.
function DotContainer({
  events,
  rangeMs,
  generation,
  timeFrozen,
  setScrollToEventId,
}: {
  events: ParsedEvent[]
  rangeMs: number
  generation: number
  timeFrozen: boolean
  setScrollToEventId: (id: number | null) => void
}) {
  return (
    <>
      {events.map((event) => {
        const age = getNow() - event.timestamp
        const position = 100 - (age / rangeMs) * 100
        if (position < -10 || position > 100) return null

        const remainingMs = Math.max(0, rangeMs - age)
        const Icon = getEventIcon(event.subtype, event.toolName)
        const { dotColor, customHex } = getEventColor(event.subtype, event.toolName)
        const summary = getEventSummary(event)

        return (
          <Tooltip key={`${event.id}-${generation}`}>
            <TooltipTrigger asChild>
              <button
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer hover:scale-125"
                style={{ left: `${position}%` }}
                ref={
                  timeFrozen
                    ? undefined
                    : (el) => {
                        if (!el) return
                        // Start drift: set position without transition, then animate to off-screen
                        requestAnimationFrame(() => {
                          el.style.transition = `left ${remainingMs}ms linear`
                          el.style.left = '-5%'
                        })
                      }
                }
                onClick={() => setScrollToEventId(event.id)}
              >
                <span
                  className={cn(
                    'flex items-center justify-center h-5 w-5 rounded-full',
                    !customHex && dotColor,
                  )}
                  style={customHex ? { backgroundColor: customHex } : undefined}
                >
                  <Icon className="h-3 w-3 text-white" />
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-64">
              <div className="font-medium">{tooltipLabel(event)}</div>
              {summary && <div className="opacity-80 truncate">{summary}</div>}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </>
  )
}

interface AgentLaneProps {
  agent: Agent
  parentAgent?: Agent | null
  events: ParsedEvent[]
  allEvents: ParsedEvent[]
  isSubagent: boolean
  color: string
}

// Friendly label for tooltips
function tooltipLabel(event: ParsedEvent): string {
  if (event.subtype === 'PreToolUse' || event.subtype === 'PostToolUse') {
    return event.toolName || 'Tool'
  }
  const map: Record<string, string> = {
    UserPromptSubmit: 'Prompt',
    Stop: 'Stop',
    SessionStart: 'Session Start',
  }
  return map[event.subtype || ''] || event.subtype || event.type
}

export function AgentLane({
  agent,
  parentAgent,
  events,
  allEvents,
  isSubagent,
  color,
}: AgentLaneProps) {
  const agentId = agent.id
  const { timeRange, setScrollToEventId, iconCustomizationVersion, timeOverride } = useUIStore()

  const rangeMs = useMemo(() => {
    const ranges = { '1m': 60_000, '5m': 300_000, '10m': 600_000, '60m': 3_600_000 }
    return ranges[timeRange]
  }, [timeRange])

  // Increment generation on scale change to force all dots to remount
  const generationRef = useRef(0)
  const prevRangeRef = useRef(rangeMs)
  if (prevRangeRef.current !== rangeMs) {
    prevRangeRef.current = rangeMs
    generationRef.current++
  }

  // Also remount dots when icon customizations change
  const prevCustomVersionRef = useRef(iconCustomizationVersion)
  if (prevCustomVersionRef.current !== iconCustomizationVersion) {
    prevCustomVersionRef.current = iconCustomizationVersion
    generationRef.current++
  }

  // Remount dots when time override changes (time travel)
  const prevTimeOverrideRef = useRef(timeOverride)
  if (prevTimeOverrideRef.current !== timeOverride) {
    prevTimeOverrideRef.current = timeOverride
    generationRef.current++
  }

  const generation = generationRef.current

  const visibleEvents = useMemo(
    () => events.filter((e) => getNow() - e.timestamp < rangeMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, rangeMs, timeOverride],
  )

  // Tick marks based on time range
  const ticks = useMemo(() => {
    const rangeSec = rangeMs / 1000
    const count = { '1m': 6, '5m': 5, '10m': 5, '60m': 6 }[timeRange]
    const stepSec = rangeSec / count
    const result: { pct: number; label: string }[] = []
    for (let i = 0; i <= count; i++) {
      const sec = i * stepSec
      const pct = 100 - (sec / rangeSec) * 100
      let label: string
      if (i === 0) label = 'now'
      else if (sec < 60) label = `${sec}s`
      else label = `${Math.round(sec / 60)}m`
      result.push({ pct, label })
    }
    return result
  }, [timeRange, rangeMs])

  const handleAgentNameClick = useCallback(() => {
    // Find the first event from this agent across all events (sorted by id ascending)
    const agentEvents = allEvents.filter((e) => e.agentId === agentId)
    if (agentEvents.length > 0) {
      // Events are ordered by id; the first one is the earliest
      const first = agentEvents.reduce((a, b) => (a.id < b.id ? a : b))
      setScrollToEventId(first.id)
    }
  }, [allEvents, agentId, setScrollToEventId])

  return (
    <div className="flex items-center h-8 border-b border-border/30">
      <button
        className={cn(
          'w-40 shrink-0 text-[10px] truncate px-2 text-left cursor-pointer hover:underline',
          color,
          isSubagent ? 'opacity-80 dark:opacity-50' : 'opacity-100 dark:opacity-70',
        )}
        onClick={handleAgentNameClick}
      >
        {isSubagent ? '↳ ' : ''}
        <AgentLabel agent={agent} parentAgent={parentAgent} />
      </button>

      <div className="flex-1 relative h-full overflow-hidden">
        <DotContainer
          events={visibleEvents}
          rangeMs={rangeMs}
          generation={generation}
          timeFrozen={timeOverride !== null}
          setScrollToEventId={setScrollToEventId}
        />

        {/* Time tick marks */}
        {ticks.map(({ pct, label }) => (
          <div
            key={label}
            className="absolute top-0 bottom-0 flex flex-col items-center"
            style={{ left: `${pct}%` }}
          >
            <div className="w-px h-full border-l border-border/20" />
            <div className="absolute bottom-0 text-[7px] text-muted-foreground/70 dark:text-muted-foreground/40 -translate-x-1/2 leading-none">
              {label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
