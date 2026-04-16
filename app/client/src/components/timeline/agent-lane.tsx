import { useRef, useMemo, useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { getRangeMs, getRangeTicks } from '@/config/time-ranges'
import { useUIStore } from '@/stores/ui-store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AgentLabel } from '@/components/shared/agent-label'
import { AgentRegistry } from '@/agents/registry'
import { getEventIcon, getEventColor } from '@/agents/claude-code/icons'
import type { Agent } from '@/types'
import type { EnrichedEvent } from '@/agents/types'

// Renders event dots inside a single animated container.
function DotContainer({
  events,
  rangeMs,
  generation,
  setScrollToEventId,
}: {
  events: EnrichedEvent[]
  rangeMs: number
  generation: number
  setScrollToEventId: (id: number | null) => void
}) {
  const [anchorTime, setAnchorTime] = useState(() => Date.now())
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setAnchorTime(Date.now())
  }, [generation])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setAnchorTime(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

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
        const position = ((event.timestamp - anchorTime) / rangeMs) * 100 + 100
        if (position < -5 || position > 205) return null

        // Resolve icon/color at render time for instant customization updates
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
            <TooltipContent side="top" className="text-xs max-w-64">
              <DotTooltipForEvent event={event} />
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

/** Renders the dot tooltip using the registered agent class's DotTooltip component. */
function DotTooltipForEvent({ event }: { event: EnrichedEvent }) {
  // For now, use the default registration since we don't have agentClass on the event yet.
  // When agentClass is tracked per-event, this can use AgentRegistry.get(event.agentClass).
  const registration = AgentRegistry.get('claude-code')
  const DotTooltip = registration.DotTooltip
  return <DotTooltip event={event} />
}

interface AgentLaneProps {
  agent: Agent
  parentAgent?: Agent | null
  events: EnrichedEvent[]
  allEvents: EnrichedEvent[]
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

  const rangeMs = useMemo(() => getRangeMs(timeRange), [timeRange])

  const generationRef = useRef(0)
  const prevRangeRef = useRef(rangeMs)
  if (prevRangeRef.current !== rangeMs) {
    prevRangeRef.current = rangeMs
    generationRef.current++
  }

  const prevCustomVersionRef = useRef(iconCustomizationVersion)
  if (prevCustomVersionRef.current !== iconCustomizationVersion) {
    prevCustomVersionRef.current = iconCustomizationVersion
    generationRef.current++
  }

  const generation = generationRef.current

  const visibleEvents = useMemo(() => {
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

  const ticks = useMemo(() => {
    const rangeSec = rangeMs / 1000
    const count = getRangeTicks(timeRange)
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
    const agentEvents = allEvents.filter((e) => e.agentId === agentId)
    if (agentEvents.length > 0) {
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
        <AgentLabel agent={agent} parentAgent={parentAgent} tooltipSide="top" />
      </button>

      <div className="flex-1 relative h-full overflow-hidden">
        {visibleEvents.length > 0 && (
          <DotContainer
            events={visibleEvents}
            rangeMs={rangeMs}
            generation={generation}
            setScrollToEventId={setScrollToEventId}
          />
        )}

        {ticks.map(({ pct, label }, i) => (
          <div
            key={i}
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
