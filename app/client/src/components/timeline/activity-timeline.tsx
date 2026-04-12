import { useCallback, useRef, useMemo, useState, useEffect } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useEffectiveEvents } from '@/hooks/use-effective-events'
import { useAgents } from '@/hooks/use-agents'
import { useSessions } from '@/hooks/use-sessions'
import { buildAgentColorMap, getAgentColorById } from '@/lib/agent-utils'
import { AgentLane } from './agent-lane'
import { TimelineRewind } from './timeline-rewind'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Rewind, Play } from 'lucide-react'
import type { Agent, ParsedEvent } from '@/types'

export function ActivityTimeline() {
  const {
    selectedProjectId,
    selectedSessionId,
    selectedAgentIds,
    timelineHeight,
    timeRange,
    setTimelineHeight,
    setTimeRange,
    rewindMode,
    enterRewindMode,
    exitRewindMode,
  } = useUIStore()

  const { data: sessions } = useSessions(selectedProjectId)
  const effectiveSessionId = selectedSessionId || sessions?.[0]?.id || null
  const events = useEffectiveEvents(effectiveSessionId).data
  const agents = useAgents(effectiveSessionId, events)
  const resizing = useRef(false)
  const startY = useRef(0)
  const startHeight = useRef(0)

  // Periodic cleanup tick: forces re-render so expired dots are removed from DOM.
  // Only runs when there are recent events that could be expiring from view.
  // Also triggers when new events arrive.
  const rangeMs = useMemo(() => {
    const ranges: Record<string, number> = {
      '1m': 60_000, '5m': 300_000, '10m': 600_000,
      '60m': 3_600_000, '3h': 10_800_000, '24h': 86_400_000,
    }
    return ranges[timeRange] ?? 300_000
  }, [timeRange])
  const eventsLength = events?.length ?? 0
  const lastEventTs = events && events.length > 0 ? events[events.length - 1].timestamp : 0
  const hasRecentEvents = lastEventTs > 0 && Date.now() - lastEventTs < rangeMs + 10_000

  const [, setCleanupTick] = useState(0)
  useEffect(() => {
    if (!hasRecentEvents) return
    const id = setInterval(() => setCleanupTick((t) => t + 1), 5_000)
    return () => clearInterval(id)
  }, [hasRecentEvents])
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

  const ranges: Array<'1m' | '5m' | '10m' | '60m' | '3h' | '24h'> = ['1m', '5m', '10m', '60m', '3h', '24h']

  const handleToggleRewind = () => {
    if (rewindMode) {
      exitRewindMode()
    } else {
      enterRewindMode(events || [])
    }
  }

  return (
    <TooltipProvider>
      <div ref={containerRef} className="border-b border-border" style={{ height: timelineHeight }}>
        <div className="flex items-center justify-between px-3 py-1 border-b border-border/50">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Activity</span>
            {rewindMode && (
              <span className="text-[9px] px-1.5 py-px rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                REWIND
              </span>
            )}
          </div>
          <div className="flex gap-1 items-center">
            <Button
              variant="outline"
              size="sm"
              className={
                rewindMode
                  ? 'h-5 px-2 text-[10px] mr-1 border-green-500 bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20'
                  : 'h-5 px-2 text-[10px] mr-1 border-orange-500/70 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10'
              }
              onClick={handleToggleRewind}
              title={rewindMode ? 'Resume live view' : 'Pause and rewind'}
            >
              {rewindMode ? (
                <>
                  <Rewind className="h-2.5 w-2.5 mr-0.5" /> Rewind
                </>
              ) : (
                <>
                  <Play className="h-2.5 w-2.5 mr-0.5" /> Live
                </>
              )}
            </Button>
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
          key={`${rewindMode}-${timeRange}`}
          data-scroll-area
          className={rewindMode ? 'h-full' : 'overflow-y-auto'}
          style={{ height: timelineHeight - 32 }}
        >
          {rewindMode ? (
            <TimelineRewind events={events || []} agents={agents} />
          ) : (
            <>
              {flatAgents.map(({ agent, isSubagent }) => (
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
            </>
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
