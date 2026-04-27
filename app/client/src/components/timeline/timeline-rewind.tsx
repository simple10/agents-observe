import { memo, useRef, useMemo, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { getRangeMs } from '@/config/time-ranges'
import { useUIStore } from '@/stores/ui-store'
import { useDedupedEvents } from '@/hooks/use-deduped-events'
import { getEventIcon, getEventColor } from '@/config/event-icons'
import { deriveToolName } from '@/agents/claude-code/derivers'
import { buildAgentColorMap, getAgentColorById } from '@/lib/agent-utils'
import { AgentLabel } from '@/components/shared/agent-label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DotTooltipContent } from './dot-tooltip'
import { registerTimelineScroll, getEventStreamScrollTo, withSyncLock } from '@/lib/scroll-sync'
import type { Agent, ParsedEvent } from '@/types'

const LABEL_WIDTH = 160 // px — matches the w-40 sticky label
const LANE_HEIGHT = 32 // px — matches h-8
const LEFT_PADDING = 20 // px — gap between sticky label and first dot

// Upper bound on the horizontal scroll container. Rewind lays events
// out at `pixelsPerMs` per millisecond of session span; a session with
// a poisoned (far-future) timestamp produces widths of 10^10+ pixels
// which OOMs the browser. A session spanning an entire year at a 10m
// view range is still well under 100M px, so the cap is both defensive
// and generous for legitimate workloads.
const MAX_TOTAL_WIDTH_PX = 10_000_000

/**
 * Find the index of the first event whose timestamp is >= targetTs.
 * Events must be sorted ascending by timestamp. Returns -1 if none found.
 */
export function findFirstEventAtOrAfter(events: ParsedEvent[], targetTs: number): number {
  let lo = 0
  let hi = events.length - 1
  let result = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].timestamp >= targetTs) {
      result = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }
  return result
}

// Captured timestamp to restore after a time-range-triggered remount.
// Set right before the component unmounts (via key change), consumed on next mount.
let pendingLeftmostTs: number | null = null

interface TimelineRewindProps {
  events: ParsedEvent[] // frozen deduped events (shared with event stream)
  agents: Agent[]
}

export const TimelineRewind = memo(function TimelineRewind({
  events,
  agents,
}: TimelineRewindProps) {
  const { timeRange, selectedAgentIds, setScrollToEventId } = useUIStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Re-dedupe is a no-op when we receive already-deduped events, but the
  // hook is cheap and keeps this component resilient to callers passing
  // raw events.
  const deduped = useDedupedEvents(events)

  // Compute session time span and pixel scale
  const { sessionStart, totalWidth, pixelsPerMs } = useMemo(() => {
    if (deduped.length === 0) {
      return { sessionStart: 0, totalWidth: 0, pixelsPerMs: 0 }
    }
    const start = deduped[0].timestamp
    const end = deduped[deduped.length - 1].timestamp
    const viewportWidth = scrollRef.current?.clientWidth ?? 800
    const availableWidth = Math.max(200, viewportWidth - LABEL_WIDTH)
    const rangeMs = getRangeMs(timeRange)
    // pixelsPerMs chosen so one "time range" fills the available viewport width
    const pxPerMs = availableWidth / rangeMs
    const span = Math.max(1, end - start)
    const width = span * pxPerMs + LEFT_PADDING * 2
    return { sessionStart: start, totalWidth: width, pixelsPerMs: pxPerMs }
  }, [deduped, timeRange])

  // Group agents into main + subagents (same logic as ActivityTimeline)
  const flatAgents = useMemo(() => {
    const mainAgents: { agent: Agent; isSubagent: boolean }[] = []
    const nonMainAgents: { agent: Agent; isSubagent: boolean }[] = []
    for (const a of agents) {
      if (selectedAgentIds.length > 0 && !selectedAgentIds.includes(a.id)) continue
      if (!a.parentAgentId) {
        mainAgents.push({ agent: a, isSubagent: false })
      } else {
        nonMainAgents.push({ agent: a, isSubagent: true })
      }
    }
    nonMainAgents.reverse()
    return [...mainAgents, ...nonMainAgents]
  }, [agents, selectedAgentIds])

  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])

  const eventsByAgent = useMemo(() => {
    const map = new Map<string, ParsedEvent[]>()
    deduped.forEach((e) => {
      const list = map.get(e.agentId) || []
      list.push(e)
      map.set(e.agentId, list)
    })
    return map
  }, [deduped])

  // Handle agent label clicks: scroll event stream to first event for this agent
  const handleAgentClick = useCallback(
    (agentId: string) => {
      const agentEvents = eventsByAgent.get(agentId)
      if (!agentEvents || agentEvents.length === 0) return
      const first = agentEvents.reduce((a, b) => (a.id < b.id ? a : b))
      setScrollToEventId(first.id)
    },
    [eventsByAgent, setScrollToEventId],
  )

  // Tick marks: one per "time range" unit along the timeline. Short-
  // circuits when `totalWidth` exceeds the cap — with a poisoned future
  // timestamp, `tickCount` would be in the tens of millions and the
  // loop below OOMs. The render-time guard below can't save us here
  // because React evaluates every useMemo before reaching the return.
  const ticks = useMemo(() => {
    if (totalWidth === 0 || totalWidth > MAX_TOTAL_WIDTH_PX) return []
    const result: { left: number; label: string }[] = []
    const tickIntervalMs = getRangeMs(timeRange) / 6 // 6 ticks per viewport width
    const span = (deduped[deduped.length - 1]?.timestamp ?? 0) - sessionStart
    const tickCount = Math.ceil(span / tickIntervalMs)
    for (let i = 0; i <= tickCount; i++) {
      const ms = i * tickIntervalMs
      const left = LEFT_PADDING + ms * pixelsPerMs
      let label: string
      if (ms < 60_000) label = `${Math.round(ms / 1000)}s`
      else if (ms < 3_600_000) label = `${Math.round(ms / 60_000)}m`
      else label = `${(ms / 3_600_000).toFixed(1)}h`
      result.push({ left, label })
    }
    return result
  }, [totalWidth, timeRange, deduped, sessionStart, pixelsPerMs])

  // Initial scroll: on first mount, go to end (most recent events).
  // On range-change remount, restore the previous leftmost timestamp.
  useEffect(() => {
    const container = scrollRef.current
    if (!container || totalWidth === 0 || pixelsPerMs === 0) return
    if (pendingLeftmostTs != null) {
      const x = LEFT_PADDING + (pendingLeftmostTs - sessionStart) * pixelsPerMs
      container.scrollLeft = Math.max(0, x - LABEL_WIDTH - 20)
      pendingLeftmostTs = null
    } else {
      container.scrollLeft = Math.max(0, totalWidth - container.clientWidth)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Before unmount (triggered by range change via React key), capture the
  // current leftmost visible timestamp so the next mount can restore it.
  useEffect(() => {
    return () => {
      const container = scrollRef.current
      if (!container || pixelsPerMs === 0) return
      pendingLeftmostTs =
        sessionStart + (container.scrollLeft + LABEL_WIDTH + 20 - LEFT_PADDING) / pixelsPerMs
    }
  }, [sessionStart, pixelsPerMs])

  // Register scroll callback so event-stream can drive timeline horizontal scroll.
  // Positions the target timestamp near the left edge, just past the sticky label.
  useEffect(() => {
    registerTimelineScroll((ts: number) => {
      const container = scrollRef.current
      if (!container || pixelsPerMs === 0) return
      const x = LEFT_PADDING + (ts - sessionStart) * pixelsPerMs
      const targetLeft = Math.max(0, x - LABEL_WIDTH - 20)
      container.scrollLeft = targetLeft
    })
    return () => registerTimelineScroll(null)
  }, [sessionStart, pixelsPerMs])

  // Reverse sync: scrolling the timeline drives event stream to matching event
  useEffect(() => {
    const container = scrollRef.current
    if (!container || pixelsPerMs === 0 || deduped.length === 0) return
    const onScroll = () => {
      withSyncLock('timeline', () => {
        const leftmostTs =
          sessionStart + (container.scrollLeft + LABEL_WIDTH + 20 - LEFT_PADDING) / pixelsPerMs
        const idx = findFirstEventAtOrAfter(deduped, leftmostTs)
        if (idx >= 0) {
          getEventStreamScrollTo()?.(deduped[idx].id)
        }
      })
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [sessionStart, pixelsPerMs, deduped])

  if (deduped.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        No events in this session
      </div>
    )
  }

  // Guard against sessions with a poisoned timestamp (e.g. a manually
  // injected debug event at 9999999999999). Rendering a DOM element
  // billions of pixels wide OOMs the browser. Server-side
  // `parseTimestamp` clamps new events, but existing bad data in the DB
  // still needs this fallback.
  if (totalWidth > MAX_TOTAL_WIDTH_PX) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-1 p-4 text-center text-xs text-muted-foreground">
        <div className="font-medium text-foreground">Can't render rewind for this session</div>
        <div>
          Session span is too large — likely one or more events have an invalid timestamp far in the
          future.
        </div>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto overflow-y-auto h-full relative">
      <div style={{ width: `${totalWidth}px`, minWidth: '100%' }} className="relative">
        {flatAgents.map(({ agent, isSubagent }) => {
          const agentEvents = eventsByAgent.get(agent.id) || []
          const color = getAgentColorById(agent.id, agentColorMap).textOnly
          const parentAgent = agent.parentAgentId
            ? agents.find((a) => a.id === agent.parentAgentId)
            : null

          return (
            <div
              key={agent.id}
              className="flex items-center border-b border-border/30 relative"
              style={{ height: `${LANE_HEIGHT}px` }}
            >
              {/* Sticky agent label */}
              <button
                className={cn(
                  'sticky left-0 z-10 bg-background w-40 shrink-0 text-[10px] truncate px-2 text-left cursor-pointer hover:underline border-r border-border/30',
                  color,
                  isSubagent ? 'opacity-80 dark:opacity-50' : 'opacity-100 dark:opacity-70',
                )}
                style={{ height: `${LANE_HEIGHT}px` }}
                onClick={() => handleAgentClick(agent.id)}
              >
                {isSubagent ? '↳ ' : ''}
                <AgentLabel agent={agent} parentAgent={parentAgent} />
              </button>

              {/* Dot lane */}
              <div className="flex-1 relative h-full">
                {agentEvents.map((event) => {
                  const left = LEFT_PADDING + (event.timestamp - sessionStart) * pixelsPerMs
                  // Per the three-layer contract, derive toolName from
                  // the wire event before resolving icon + color.
                  const hookName = event.hookName || null
                  const toolName = deriveToolName(event)
                  const Icon = getEventIcon(hookName, toolName)
                  const { dotColor, customHex } = getEventColor(hookName, toolName)

                  return (
                    <Tooltip key={event.id}>
                      <TooltipTrigger asChild>
                        <button
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer hover:scale-125"
                          style={{ left: `${left}px` }}
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
                        <DotTooltipContent event={event} />
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* Tick marks as a thin row at the bottom */}
        <div
          className="sticky bottom-0 h-4 pointer-events-none"
          style={{ width: `${totalWidth}px` }}
        >
          {ticks.map(({ left, label }, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 flex flex-col items-center"
              style={{ left: `${left}px` }}
            >
              <div className="w-px h-full border-l border-border/20" />
              <div className="absolute bottom-0 text-[7px] text-muted-foreground/70 dark:text-muted-foreground/40 -translate-x-1/2 leading-none">
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})
