import { useCallback, useRef, useMemo, useState, useEffect } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useEvents } from '@/hooks/use-events'
import { useAgents } from '@/hooks/use-agents'
import { useSessions } from '@/hooks/use-sessions'
import { buildAgentColorMap, getAgentColorById } from '@/lib/agent-utils'
import { AgentLane } from './agent-lane'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Agent, ParsedEvent } from '@/types'

export function ActivityTimeline() {
  const {
    selectedProjectId,
    selectedSessionId,
    selectedAgentIds,
    timelineHeight,
    timeRange,
    timeOverride,
    setTimelineHeight,
    setTimeRange,
    setTimeOverride,
  } = useUIStore()

  const { data: sessions } = useSessions(selectedProjectId)
  const effectiveSessionId = selectedSessionId || sessions?.[0]?.id || null
  const { data: events } = useEvents(effectiveSessionId)
  const agents = useAgents(effectiveSessionId, events)
  const resizing = useRef(false)
  const startY = useRef(0)
  const startHeight = useRef(0)

  // Periodic cleanup tick: forces re-render so expired dots are removed from DOM.
  // Also triggers when new events arrive.
  const [, setCleanupTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setCleanupTick((t) => t + 1), 5_000)
    return () => clearInterval(id)
  }, [])
  const eventsLength = events?.length ?? 0
  useEffect(() => {
    setCleanupTick((t) => t + 1)
  }, [eventsLength])

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
    // Reverse non-main agents so newest appear right after Main
    nonMainAgents.reverse()
    return [...mainAgents, ...nonMainAgents]
  }, [agents, selectedAgentIds])

  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])

  const eventsByAgent = useMemo(() => {
    const map = new Map<string, ParsedEvent[]>()
    events?.forEach((e) => {
      const list = map.get(e.agentId) || []
      list.push(e)
      map.set(e.agentId, list)
    })
    return map
  }, [events])

  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      resizing.current = true
      startY.current = e.clientY
      startHeight.current = timelineHeight

      const onMouseMove = (e: MouseEvent) => {
        if (!resizing.current) return
        const delta = e.clientY - startY.current
        const newHeight = Math.max(60, Math.min(400, startHeight.current + delta))
        // Update DOM directly during drag to avoid React re-renders
        if (containerRef.current) {
          containerRef.current.style.height = `${newHeight}px`
          const scrollArea = containerRef.current.querySelector('[data-scroll-area]') as HTMLElement
          if (scrollArea) scrollArea.style.height = `${newHeight - 32}px`
        }
      }

      const onMouseUp = (e: MouseEvent) => {
        resizing.current = false
        const delta = e.clientY - startY.current
        const finalHeight = Math.max(60, Math.min(400, startHeight.current + delta))
        // Commit final height to React state
        setTimelineHeight(finalHeight)
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [timelineHeight, setTimelineHeight],
  )

  if (!effectiveSessionId) return null

  const ranges: Array<'1m' | '5m' | '10m' | '60m'> = ['1m', '5m', '10m', '60m']

  // Event time bounds for clamping scroll
  const eventTimeBounds = useMemo(() => {
    if (!events || events.length === 0) return null
    let min = Infinity,
      max = -Infinity
    for (const e of events) {
      if (e.timestamp < min) min = e.timestamp
      if (e.timestamp > max) max = e.timestamp
    }
    return { min, max }
  }, [events])

  const handleTimeTravel = useCallback(() => {
    if (timeOverride) {
      setTimeOverride(null)
    } else if (eventTimeBounds) {
      setTimeOverride(eventTimeBounds.max)
    }
  }, [timeOverride, eventTimeBounds, setTimeOverride])

  // Horizontal scroll in rewind mode shifts timeOverride.
  // Scrolling left in live mode auto-enters rewind.
  const rangeMs = useMemo(() => {
    const ranges = { '1m': 60_000, '5m': 300_000, '10m': 600_000, '60m': 3_600_000 }
    return ranges[timeRange]
  }, [timeRange])

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      // Use deltaX for horizontal scroll (trackpad swipe).
      // Also support shift+deltaY for mouse wheel users.
      // Dominant axis: if vertical scroll is stronger, let it scroll agents normally.
      const deltaX = e.shiftKey ? e.deltaY : e.deltaX
      if (deltaX === 0 || (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey)) return
      if (!eventTimeBounds) return

      e.preventDefault()

      // Scrolling left (negative deltaX) = go back in time (decrease timeOverride)
      // Scrolling right (positive deltaX) = go forward (increase timeOverride)
      // Scale: full container width ≈ 600px maps to one full range
      const msPerPixel = rangeMs / 600
      const deltaMs = deltaX * msPerPixel

      const current = timeOverride ?? Date.now()
      // Lower bound: first event sits at the left edge with a small buffer (2% of range)
      // so the dot icon is fully visible
      const next = Math.max(
        eventTimeBounds.min + rangeMs * 0.98,
        Math.min(eventTimeBounds.max, current + deltaMs),
      )
      setTimeOverride(next)
    },
    [timeOverride, eventTimeBounds, rangeMs, setTimeOverride],
  )

  const timeTravelLabel = useMemo(() => {
    if (!timeOverride) return null
    const d = new Date(timeOverride)
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }, [timeOverride])

  return (
    <TooltipProvider>
      <div ref={containerRef} className="border-b border-border" style={{ height: timelineHeight }}>
        <div className="flex items-center justify-between px-3 py-1 border-b border-border/50">
          <span className="text-xs text-muted-foreground font-medium">
            Activity
            {timeTravelLabel && <span className="ml-2 text-amber-500">@ {timeTravelLabel}</span>}
          </span>
          <div className="flex gap-1">
            <Button
              variant={timeOverride ? 'default' : 'ghost'}
              size="sm"
              className={`h-5 px-2 text-[10px] ${timeOverride ? 'bg-amber-600 hover:bg-amber-700 text-white' : ''}`}
              onClick={handleTimeTravel}
              title={timeOverride ? 'Return to live' : 'Jump to latest event (time travel)'}
            >
              {timeOverride ? 'Switch to live' : 'Rewind'}
            </Button>
            <span className="w-px bg-border/50" />
            {ranges.map((r) => (
              <Button
                key={r}
                variant={timeRange === r ? 'default' : 'ghost'}
                size="sm"
                className="h-5 px-2 text-[10px]"
                onClick={() => setTimeRange(r)}
              >
                {r}
              </Button>
            ))}
          </div>
        </div>

        <div
          data-scroll-area
          className="overflow-y-auto"
          style={{ height: timelineHeight - 32 }}
          onWheel={handleWheel}
        >
          {flatAgents.map(({ agent, isSubagent }, idx) => (
            <AgentLane
              key={agent.id}
              agent={agent}
              parentAgent={
                agent.parentAgentId ? agents.find((a) => a.id === agent.parentAgentId) : null
              }
              events={eventsByAgent.get(agent.id) || []}
              allEvents={events || []}
              isSubagent={isSubagent}
              color={getAgentColorById(agent.id, agentColorMap).textOnly}
            />
          ))}
          {flatAgents.length === 0 && (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              No agent activity
            </div>
          )}
        </div>

        <div
          className="h-1 cursor-row-resize hover:bg-primary/20 active:bg-primary/30"
          onMouseDown={handleMouseDown}
        />
      </div>
    </TooltipProvider>
  )
}
