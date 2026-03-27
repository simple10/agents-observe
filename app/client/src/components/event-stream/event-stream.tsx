import { useMemo, useRef, useEffect, useDeferredValue } from 'react'
import { useEvents } from '@/hooks/use-events'
import { useAgents } from '@/hooks/use-agents'
import { useUIStore } from '@/stores/ui-store'
import { EventRow } from './event-row'
import { eventMatchesFilters } from '@/config/filters'
import { format } from 'timeago.js'
import type { Agent, ParsedEvent } from '@/types'

export function EventStream() {
  const {
    selectedSessionId,
    selectedAgentIds,
    activeStaticFilters,
    activeToolFilters,
    searchQuery,
    autoFollow,
    expandAllCounter,
    expandAllEvents,
  } = useUIStore()

  // Defer filter values so the UI stays responsive during filter changes
  const deferredStaticFilters = useDeferredValue(activeStaticFilters)
  const deferredToolFilters = useDeferredValue(activeToolFilters)

  const { data: events } = useEvents(selectedSessionId, {
    agentIds: selectedAgentIds.length > 0 ? selectedAgentIds : undefined,
    search: searchQuery || undefined,
  })

  const { data: agents } = useAgents(selectedSessionId)

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>()
    function collect(list: Agent[] | undefined) {
      list?.forEach((a) => {
        map.set(a.id, a)
        if (a.children) collect(a.children)
      })
    }
    collect(agents)
    return map
  }, [agents])

  // Dedupe tool events: merge PostToolUse into matching PreToolUse by toolUseId
  const deduped = useMemo(() => {
    if (!events) return []
    const result: ParsedEvent[] = []
    const toolUseMap = new Map<string, number>() // toolUseId -> index in result

    for (const e of events) {
      if (e.subtype === 'PreToolUse' && e.toolUseId) {
        toolUseMap.set(e.toolUseId, result.length)
        result.push({ ...e }) // copy so we can mutate status
      } else if (e.subtype === 'PostToolUse' && e.toolUseId && toolUseMap.has(e.toolUseId)) {
        // Merge: keep PreToolUse row position but swap in PostToolUse payload (has tool_response)
        const idx = toolUseMap.get(e.toolUseId)!
        result[idx] = { ...result[idx], status: 'completed', payload: e.payload }
      } else {
        result.push(e)
      }
    }
    return result
  }, [events])

  const filteredEvents = useMemo(() => {
    if (deferredStaticFilters.length === 0 && deferredToolFilters.length === 0) return deduped
    return deduped.filter((e) => eventMatchesFilters(e, deferredStaticFilters, deferredToolFilters))
  }, [deduped, deferredStaticFilters, deferredToolFilters])

  const showAgentLabel = agentMap.size > 1
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new events arrive (if autoFollow is enabled)
  useEffect(() => {
    if (autoFollow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [autoFollow, filteredEvents.length])

  // Expand all events when requested from the scope bar
  useEffect(() => {
    if (expandAllCounter > 0 && filteredEvents.length > 0) {
      expandAllEvents(filteredEvents.map((e) => e.id))
    }
  }, [expandAllCounter])

  if (!selectedSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Select a project to view events
      </div>
    )
  }

  if (!filteredEvents.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        No events yet
      </div>
    )
  }

  const firstTs = filteredEvents[0]?.timestamp
  const lastTs = filteredEvents[filteredEvents.length - 1]?.timestamp
  const rawCount = events?.length ?? 0
  const showRawCount = rawCount !== filteredEvents.length

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border/50 shrink-0">
        <span className="text-xs text-muted-foreground">
          Events: <span className="text-foreground">{filteredEvents.length}</span>
          {showRawCount && (
            <span className="text-muted-foreground/50"> / {rawCount} raw</span>
          )}
        </span>
        {firstTs && lastTs && (
          <span className="text-[10px] text-muted-foreground/50">
            {format(firstTs)} — {format(lastTs)}
          </span>
        )}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="divide-y divide-border/50">
          {filteredEvents.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              agentMap={agentMap}
              showAgentLabel={showAgentLabel}
            />
          ))}
          <div className="h-8" />
        </div>
      </div>
    </div>
  )
}
