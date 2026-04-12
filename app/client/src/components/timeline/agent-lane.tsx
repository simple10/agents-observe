import { useRef, useMemo, useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { getEventIcon, getEventColor } from '@/config/event-icons'
import { useUIStore } from '@/stores/ui-store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AgentLabel } from '@/components/shared/agent-label'
import { DotTooltipContent } from './dot-tooltip'
import type { Agent, ParsedEvent } from '@/types'

// Renders event dots inside a single animated container.
// Instead of per-dot CSS transitions (which drift at different speeds and
// conflict with React re-renders), all dots share one container animation:
// translateX(0) → translateX(-100%) over rangeMs. Dots have static left
// positions relative to the container, so they all move at exactly the
// same speed and can never pass each other.
function DotContainer({
  events,
  rangeMs,
  generation,
  setScrollToEventId,
}: {
  events: ParsedEvent[]
  rangeMs: number
  generation: number
  setScrollToEventId: (id: number | null) => void
}) {
  const [anchorTime, setAnchorTime] = useState(() => Date.now())
  const containerRef = useRef<HTMLDivElement>(null)

  // Reset anchor when generation changes (time range switch, icon customization)
  useEffect(() => {
    setAnchorTime(Date.now())
  }, [generation])

  // Start/restart the container animation via Web Animations API.
  // On finish, re-anchor — the math cancels out so there's zero visual
  // discontinuity (see spec-timeline-animation-bugs.md).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const anim = el.animate([{ transform: 'translateX(0%)' }, { transform: 'translateX(-100%)' }], {
      duration: rangeMs,
      easing: 'linear',
      fill: 'forwards',
    })

    anim.onfinish = () => setAnchorTime(Date.now())
    return () => anim.cancel()
  }, [anchorTime, rangeMs])

  return (
    <div ref={containerRef} className="absolute inset-0">
      {events.map((event) => {
        // Static position relative to the container. The container's
        // translateX animation slides everything left uniformly.
        const position = ((event.timestamp - anchorTime) / rangeMs) * 100 + 100
        if (position < -5 || position > 110) return null

        const Icon = getEventIcon(event.subtype, event.toolName)
        const { dotColor, customHex } = getEventColor(event.subtype, event.toolName)

        return (
          <Tooltip key={event.id}>
            <TooltipTrigger asChild>
              <button
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer hover:scale-125"
                style={{ left: `${position}%` }}
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
            <TooltipContent side="left" className="text-xs max-w-64">
              <DotTooltipContent event={event} />
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
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

export function AgentLane({
  agent,
  parentAgent,
  events,
  allEvents,
  isSubagent,
  color,
}: AgentLaneProps) {
  const agentId = agent.id
  const { timeRange, setScrollToEventId, iconCustomizationVersion } = useUIStore()

  const rangeMs = useMemo(() => {
    const ranges = {
      '1m': 60_000,
      '5m': 300_000,
      '10m': 600_000,
      '60m': 3_600_000,
      '3h': 10_800_000,
      '24h': 86_400_000,
    }
    return ranges[timeRange]
  }, [timeRange])

  // Increment generation on scale change to reset anchor + animation
  const generationRef = useRef(0)
  const prevRangeRef = useRef(rangeMs)
  if (prevRangeRef.current !== rangeMs) {
    prevRangeRef.current = rangeMs
    generationRef.current++
  }

  // Also reset when icon customizations change
  const prevCustomVersionRef = useRef(iconCustomizationVersion)
  if (prevCustomVersionRef.current !== iconCustomizationVersion) {
    prevCustomVersionRef.current = iconCustomizationVersion
    generationRef.current++
  }

  const generation = generationRef.current

  const visibleEvents = useMemo(() => {
    // Events are sorted by timestamp ascending. Binary search for the cutoff
    // point instead of scanning the entire array — O(log n) vs O(n).
    const cutoff = Date.now() - rangeMs
    let lo = 0
    let hi = events.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (events[mid].timestamp < cutoff) lo = mid + 1
      else hi = mid
    }
    return lo >= events.length ? [] : events.slice(lo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, rangeMs])

  // Tick marks based on time range
  const ticks = useMemo(() => {
    const rangeSec = rangeMs / 1000
    const count =
      ({ '1m': 6, '5m': 5, '10m': 5, '60m': 6, '3h': 6, '24h': 6 } as Record<string, number>)[
        timeRange
      ] ?? 6
    const stepSec = rangeSec / count
    const result: { pct: number; label: string }[] = []
    for (let i = 0; i <= count; i++) {
      const sec = i * stepSec
      const pct = 100 - (sec / rangeSec) * 100
      let label: string
      if (i === 0) label = 'now'
      else if (sec < 60) label = `${sec}s`
      else if (sec < 3600) label = `${Math.round(sec / 60)}m`
      else label = `${Math.round(sec / 3600)}h`
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
          setScrollToEventId={setScrollToEventId}
        />

        {/* Time tick marks — outside the animated container so they stay fixed */}
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
