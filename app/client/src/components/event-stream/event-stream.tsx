import { useMemo, useRef, useEffect, useLayoutEffect, useDeferredValue, useCallback } from 'react'
import { useEffectiveEvents } from '@/hooks/use-effective-events'
import { useAgents } from '@/hooks/use-agents'
import { useDedupedEvents } from '@/hooks/use-deduped-events'
import { getTimelineScrollTo, registerEventStreamScroll, withSyncLock } from '@/lib/scroll-sync'
import { useUIStore } from '@/stores/ui-store'
import { EventRow } from './event-row'
import { eventMatchesFilters } from '@/config/filters'
import { format } from 'timeago.js'
import { buildAgentColorMap } from '@/lib/agent-utils'
import type { Agent } from '@/types'

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
    selectedEventId,
    rewindMode,
  } = useUIStore()

  // Defer filter values so the UI stays responsive during filter changes
  const deferredStaticFilters = useDeferredValue(activeStaticFilters)
  const deferredToolFilters = useDeferredValue(activeToolFilters)
  const deferredSearchQuery = useDeferredValue(searchQuery)

  const events = useEffectiveEvents(selectedSessionId)

  const agents = useAgents(selectedSessionId, events)

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>()
    agents.forEach((a) => map.set(a.id, a))
    return map
  }, [agents])

  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])

  // Dedupe tool events + build spawn map (shared with timeline-rewind)
  const { deduped, spawnToolUseIds, spawnInfo, mergedIdMap, pairedPayloads } =
    useDedupedEvents(events)

  // Apply all client-side filters: agent selection + static/tool filters
  const filteredEvents = useMemo(() => {
    let filtered = deduped

    // Agent chip filtering (client-side, includes spawning Tool:Agent calls)
    if (selectedAgentIds.length > 0) {
      const spawnIds = new Set<string>()
      for (const agentId of selectedAgentIds) {
        const toolUseId = spawnToolUseIds.get(agentId)
        if (toolUseId) spawnIds.add(toolUseId)
      }
      filtered = filtered.filter(
        (e) =>
          selectedAgentIds.includes(e.agentId) ||
          (e.toolUseId != null && spawnIds.has(e.toolUseId)),
      )
    }

    // Static + dynamic tool filters
    if (deferredStaticFilters.length > 0 || deferredToolFilters.length > 0) {
      filtered = filtered.filter((e) =>
        eventMatchesFilters(e, deferredStaticFilters, deferredToolFilters),
      )
    }

    // Text search — case-insensitive substring match across key fields and payload
    // Skip search if query is only whitespace (don't trim — users may want leading/trailing spaces)
    if (deferredSearchQuery && deferredSearchQuery.trim().length > 0) {
      const q = deferredSearchQuery.toLowerCase()
      filtered = filtered.filter((e) => {
        if (e.toolName?.toLowerCase().includes(q)) return true
        if (e.subtype?.toLowerCase().includes(q)) return true
        if (e.type?.toLowerCase().includes(q)) return true
        // Search stringified payload
        if (JSON.stringify(e.payload).toLowerCase().includes(q)) return true
        return false
      })
    }

    return filtered
  }, [
    deduped,
    selectedAgentIds,
    spawnToolUseIds,
    deferredStaticFilters,
    deferredToolFilters,
    deferredSearchQuery,
  ])

  // Resolve scroll targets for merged events (PostToolUse → PreToolUse row)
  const { scrollToEventId, setScrollToEventId } = useUIStore()
  useEffect(() => {
    if (scrollToEventId != null && mergedIdMap.has(scrollToEventId)) {
      setScrollToEventId(mergedIdMap.get(scrollToEventId)!)
    }
  }, [scrollToEventId, mergedIdMap, setScrollToEventId])

  const showAgentLabel = agents.length > 1
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasInitiallyScrolled = useRef(false)

  // Track refs for each event row so we can scroll to the selected one
  const eventRowRefs = useRef(new Map<number, HTMLDivElement>())
  const setEventRowRef = useCallback((id: number, el: HTMLDivElement | null) => {
    if (el) {
      eventRowRefs.current.set(id, el)
    } else {
      eventRowRefs.current.delete(id)
    }
  }, [])

  // Auto-scroll to bottom on first load of a session
  useEffect(() => {
    hasInitiallyScrolled.current = false
  }, [selectedSessionId])

  useEffect(() => {
    if (!hasInitiallyScrolled.current && filteredEvents.length > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      hasInitiallyScrolled.current = true
    }
  }, [filteredEvents.length])

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

  // ── Rewind mode scroll sync ──────────────────────────────────────────
  // Scrolling the event stream drives the timeline's horizontal scroll.
  // Uses offsetTop (not getBoundingClientRect) to avoid layout thrashing.
  const syncTimelineFromScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const top = container.scrollTop
    // Find the first event row whose bottom edge is below the viewport top
    const rows = container.querySelectorAll<HTMLDivElement>('[data-event-row]')
    for (const row of rows) {
      if (row.offsetTop + row.offsetHeight > top) {
        const ts = Number(row.dataset.timestamp)
        if (!Number.isNaN(ts)) {
          getTimelineScrollTo()?.(ts)
        }
        return
      }
    }
  }, [])

  // Attach scroll listener only while in rewind mode
  useEffect(() => {
    if (!rewindMode) return
    const container = scrollRef.current
    if (!container) return
    const onScroll = () => {
      withSyncLock('event-stream', syncTimelineFromScroll)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [rewindMode, syncTimelineFromScroll])

  // Register the event-stream scroll-to callback for reverse sync (Phase 5)
  useEffect(() => {
    if (!rewindMode) {
      registerEventStreamScroll(null)
      return
    }
    registerEventStreamScroll((eventId) => {
      const container = scrollRef.current
      if (!container) return
      const row = container.querySelector<HTMLDivElement>(`[data-event-id="${eventId}"]`)
      if (row) {
        container.scrollTop = row.offsetTop
      }
    })
    return () => registerEventStreamScroll(null)
  }, [rewindMode])

  // Initial sync when entering rewind mode: wait for timeline to mount, then
  // sync timeline to match current event stream scroll position.
  useLayoutEffect(() => {
    if (!rewindMode) return
    // Two rAF waits: one for timeline to mount, one for its scroll registration
    const id1 = requestAnimationFrame(() => {
      const id2 = requestAnimationFrame(() => {
        withSyncLock('event-stream', syncTimelineFromScroll)
      })
      return () => cancelAnimationFrame(id2)
    })
    return () => cancelAnimationFrame(id1)
  }, [rewindMode, syncTimelineFromScroll])

  // Auto-scroll to the selected event when filteredEvents change (i.e. filters change)
  const prevFilteredRef = useRef(filteredEvents)
  useEffect(() => {
    if (selectedEventId != null && filteredEvents !== prevFilteredRef.current) {
      // Use rAF to let React render the new list before scrolling
      requestAnimationFrame(() => {
        const el = eventRowRefs.current.get(selectedEventId)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      })
    }
    prevFilteredRef.current = filteredEvents
  }, [filteredEvents, selectedEventId])

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
            <span className="text-muted-foreground/70 dark:text-muted-foreground/50">
              {' '}
              / {rawCount} raw
            </span>
          )}
        </span>
        {firstTs && lastTs && (
          <span className="text-[10px] text-muted-foreground/70 dark:text-muted-foreground/50">
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
              agentColorMap={agentColorMap}
              showAgentLabel={showAgentLabel}
              spawnInfo={spawnInfo.get(event.agentId)}
              pairedPayloads={pairedPayloads.get(event.id)}
              onRowRef={setEventRowRef}
            />
          ))}
          <div className="h-8" />
        </div>
      </div>
    </div>
  )
}
