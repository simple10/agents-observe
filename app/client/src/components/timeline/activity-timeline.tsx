// ╔══════════════════════════════════════════════════════════════════╗
// ║  !!! PERFORMANCE-CRITICAL — PROFILE CPU AFTER ANY EDIT !!!       ║
// ╠══════════════════════════════════════════════════════════════════╣
// ║  This file feeds a continuously-animating DotContainer (see      ║
// ║  agent-lane.tsx). On large sessions it's easy to regress live-   ║
// ║  mode CPU from ~10% to 100%+. Profile with DevTools Performance  ║
// ║  on a busy session before committing.                            ║
// ║                                                                  ║
// ║  Known gotchas:                                                  ║
// ║                                                                  ║
// ║  1. The Live/Rewind transition spinner uses display:none when    ║
// ║     hidden (NOT visibility:hidden). visibility:hidden keeps the  ║
// ║     CSS animation timeline running and any will-change layer     ║
// ║     allocated forever. display:none removes the element from     ║
// ║     the render tree entirely.                                    ║
// ║                                                                  ║
// ║  2. The cleanup tick (5s setInterval) is what lets AgentLane     ║
// ║     re-evaluate stale visibleEvents and unmount DotContainer     ║
// ║     once events age out. Don't disable it without replacing      ║
// ║     with an equivalent time-forcing trigger.                     ║
// ║                                                                  ║
// ║  3. Agents data (useAgents) rebuilds Agent objects on every      ║
// ║     WS flush. Anything that depends on `agents` references by    ║
// ║     identity will re-render per flush. Use content comparison    ║
// ║     (see AgentLabel's memo) or ref-stabilization if needed.      ║
// ║                                                                  ║
// ║  4. Events flowing to AgentLane should NOT be memoized on        ║
// ║     `[events, rangeMs]` with a Date.now() cutoff — that's a      ║
// ║     stale-state bug that keeps dots mounted forever. See         ║
// ║     agent-lane.tsx visibleEvents comment for details.            ║
// ║                                                                  ║
// ║  See docs/DEVELOPMENT.md § "Timeline rendering perf" for more.   ║
// ╚══════════════════════════════════════════════════════════════════╝

import { useCallback, useRef, useMemo, useState, useEffect } from 'react'
import { getRangeMs, TIME_RANGE_KEYS } from '@/config/time-ranges'
import { useUIStore } from '@/stores/ui-store'
import { useEffectiveEvents } from '@/hooks/use-effective-events'
import { useAgents } from '@/hooks/use-agents'
import { useProcessedEvents } from '@/agents/event-processing-context'
import { useSessions } from '@/hooks/use-sessions'
import { buildAgentColorMap, getAgentColorById } from '@/lib/agent-utils'
import { AgentLane } from './agent-lane'
import { TimelineRewind } from './timeline-rewind'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Rewind, Play } from 'lucide-react'
import type { Agent } from '@/types'
import type { EnrichedEvent } from '@/agents/types'

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
    frozenEvents,
    enterRewindMode,
    exitRewindMode,
  } = useUIStore()

  const { data: sessions } = useSessions(selectedProjectId)
  const effectiveSessionId = selectedSessionId || sessions?.[0]?.id || null
  const rawEvents = useEffectiveEvents(effectiveSessionId).data
  const agents = useAgents(effectiveSessionId, rawEvents)
  const { events: enrichedEvents } = useProcessedEvents()
  // Keep raw events reference for rewind mode (which does its own processing)
  const events = rawEvents
  // Freeze agents snapshot when entering rewind so TimelineRewind doesn't
  // re-render on every live agent update.
  const frozenAgentsRef = useRef(agents)
  if (!rewindMode) frozenAgentsRef.current = agents

  const resizing = useRef(false)
  const startY = useRef(0)
  const startHeight = useRef(0)

  // Periodic cleanup tick: forces re-render so expired dots are removed from DOM.
  // Only runs when there are recent events that could be expiring from view.
  // Also triggers when new events arrive.
  const rangeMs = useMemo(() => getRangeMs(timeRange), [timeRange])
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
  // Force re-render when tab becomes visible so the timeline recalculates
  // visibleEvents with a fresh Date.now() and restarts the cleanup tick.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setCleanupTick((t) => t + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

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
    const map = new Map<string, EnrichedEvent[]>()
    for (const e of enrichedEvents) {
      if (!e.displayTimeline) continue
      const list = map.get(e.agentId) || []
      list.push(e)
      map.set(e.agentId, list)
    }
    return map
  }, [enrichedEvents])

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

  const ranges = TIME_RANGE_KEYS

  const transitionSpinnerRef = useRef<HTMLDivElement>(null)

  // Shared spinner helper for heavy timeline operations (mode toggle,
  // range changes in rewind). Shows the spinner imperatively so it
  // paints before the main thread blocks on the expensive work, then
  // hides it after the work completes.
  const runWithSpinner = (work: () => void) => {
    const spinner = transitionSpinnerRef.current
    if (spinner) spinner.style.display = 'block'
    // Yield one paint tick so the spinner actually renders before the
    // heavy work monopolizes the main thread.
    setTimeout(() => {
      work()
      if (spinner) spinner.style.display = 'none'
    }, 50)
  }

  const handleToggleRewind = () => {
    runWithSpinner(() => {
      if (rewindMode) {
        exitRewindMode()
      } else {
        enterRewindMode(events || [])
      }
    })
  }

  return (
    <TooltipProvider>
      <div
        ref={containerRef}
        className="border-b border-border overflow-hidden"
        style={{ height: timelineHeight }}
      >
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
            {/* Transition spinner — display:none while hidden so no
                compositor layer or animation timeline is kept alive
                between transitions. Shown imperatively in
                handleToggleRewind so the spinner paints before the
                heavy enter/exit rewind work blocks the main thread. */}
            <div
              ref={transitionSpinnerRef}
              style={{
                display: 'none',
                width: 12,
                height: 12,
                marginRight: 4,
                border: '2px solid currentColor',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
              className="text-muted-foreground"
            />
            <Button
              variant="outline"
              size="sm"
              className={
                rewindMode
                  ? 'h-5 px-2 text-[10px] mr-1 border-orange-500/70 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10'
                  : 'h-5 px-2 text-[10px] mr-1 border-green-500 bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20'
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
                onClick={() => {
                  // Rewind mode rebuilds the whole horizontal timeline
                  // on range change — can take several seconds on large
                  // sessions. Show the shared transition spinner so the
                  // click feels acknowledged. Live mode is cheap; skip
                  // the paint yield there.
                  if (rewindMode) {
                    runWithSpinner(() => setTimeRange(r))
                  } else {
                    setTimeRange(r)
                  }
                }}
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
            <TimelineRewind
              events={frozenEvents || events || []}
              agents={frozenAgentsRef.current}
            />
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
                  allEvents={enrichedEvents}
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
