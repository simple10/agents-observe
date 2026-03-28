import { useCallback, useRef, useMemo, useState, useEffect } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useEvents } from '@/hooks/use-events'
import { useAgents } from '@/hooks/use-agents'
import { useSessions } from '@/hooks/use-sessions'
import { getAgentDisplayName, buildAgentColorMap, getAgentColorById } from '@/lib/agent-utils'
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
    setTimelineHeight,
    setTimeRange,
  } = useUIStore()

  const { data: sessions } = useSessions(selectedProjectId)
  const effectiveSessionId = selectedSessionId || sessions?.[0]?.id || null
  const { data: agents } = useAgents(effectiveSessionId)
  const { data: events } = useEvents(effectiveSessionId)
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
    function collect(list: Agent[] | undefined, isSub: boolean) {
      list?.forEach((a) => {
        if (selectedAgentIds.length === 0 || selectedAgentIds.includes(a.id)) {
          if (!isSub) {
            mainAgents.push({ agent: a, isSubagent: false })
          } else {
            nonMainAgents.push({ agent: a, isSubagent: true })
          }
        }
        if (a.children) collect(a.children, true)
      })
    }
    collect(agents, false)
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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      resizing.current = true
      startY.current = e.clientY
      startHeight.current = timelineHeight

      const onMouseMove = (e: MouseEvent) => {
        if (!resizing.current) return
        const delta = e.clientY - startY.current
        setTimelineHeight(Math.max(60, Math.min(400, startHeight.current + delta)))
      }

      const onMouseUp = () => {
        resizing.current = false
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

  return (
    <TooltipProvider>
      <div className="border-b border-border" style={{ height: timelineHeight }}>
        <div className="flex items-center justify-between px-3 py-1 border-b border-border/50">
          <span className="text-xs text-muted-foreground font-medium">Activity</span>
          <div className="flex gap-1">
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

        <div className="overflow-y-auto" style={{ height: timelineHeight - 32 }}>
          {flatAgents.map(({ agent, isSubagent }, idx) => (
            <AgentLane
              key={agent.id}
              agentId={agent.id}
              agentName={getAgentDisplayName(agent)}
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
