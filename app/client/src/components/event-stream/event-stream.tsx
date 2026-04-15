import { useMemo, useRef, useEffect, useDeferredValue, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useQuery } from '@tanstack/react-query'
import { useEffectiveEvents } from '@/hooks/use-effective-events'
import { useAgents } from '@/hooks/use-agents'
import { useEventProcessing } from '@/agents/use-event-processing'
import { usePermissionModeBackfill } from '@/hooks/use-permission-mode-backfill'
import { getTimelineScrollTo, registerEventStreamScroll, withSyncLock } from '@/lib/scroll-sync'
import { api } from '@/lib/api-client'
import { useUIStore } from '@/stores/ui-store'
import { EventRow } from './event-row'
import { format } from 'timeago.js'
import { buildAgentColorMap } from '@/lib/agent-utils'
import { QueryBoundary } from '@/components/shared/query-boundary'
import { EmptyState, Spinner } from '@/components/shared/loading-states'
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

  const eventsQuery = useEffectiveEvents(selectedSessionId)
  const events = useDeferredValue(eventsQuery.data)
  const displayQuery = useMemo(
    () => ({
      data: events,
      isLoading: eventsQuery.isLoading || (eventsQuery.data !== undefined && events === undefined),
      isError: eventsQuery.isError,
      error: eventsQuery.error,
    }),
    [events, eventsQuery.data, eventsQuery.isLoading, eventsQuery.isError, eventsQuery.error],
  )

  const agents = useAgents(selectedSessionId, events)

  // Backfill permission_mode into session metadata if missing.
  const { data: sessionForBackfill } = useQuery({
    queryKey: ['session-backfill', selectedSessionId],
    queryFn: () => api.getSession(selectedSessionId!),
    enabled: !!selectedSessionId,
    staleTime: Infinity,
  })
  usePermissionModeBackfill(sessionForBackfill, events, agents)

  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])

  // Process raw events through agent class registry
  const { events: enrichedEvents, dataApi } = useEventProcessing(events, agents)

  // Apply all client-side filters on enriched events
  const filteredEvents = useMemo(() => {
    // Start with events that processEvent marked as displayable
    let filtered = enrichedEvents.filter((e) => e.displayEventStream)

    // Agent chip filtering
    if (selectedAgentIds.length > 0) {
      filtered = filtered.filter((e) => selectedAgentIds.includes(e.agentId))
    }

    // Static category filters (row 1: Prompts, Tools, Agents, etc.)
    if (deferredStaticFilters.length > 0) {
      filtered = filtered.filter(
        (e) => e.filterTags.static !== null && deferredStaticFilters.includes(e.filterTags.static),
      )
    }

    // Dynamic tool filters (row 2: Bash, Read, Edit, etc.)
    if (deferredToolFilters.length > 0) {
      filtered = filtered.filter((e) =>
        deferredToolFilters.some((f) => e.filterTags.dynamic.includes(f)),
      )
    }

    // Text search — uses pre-computed searchText (no JSON.stringify)
    if (deferredSearchQuery && deferredSearchQuery.trim().length > 0) {
      const q = deferredSearchQuery.toLowerCase()
      filtered = filtered.filter((e) => e.searchText.includes(q))
    }

    return filtered
  }, [
    enrichedEvents,
    selectedAgentIds,
    deferredStaticFilters,
    deferredToolFilters,
    deferredSearchQuery,
  ])

  const expandedEventIds = useUIStore((s) => s.expandedEventIds)
  const scrollToEventId = useUIStore((s) => s.scrollToEventId)
  const setScrollToEventId = useUIStore((s) => s.setScrollToEventId)

  const showAgentLabel = agents.length > 1
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasInitiallyScrolled = useRef(false)

  const virtualizer = useVirtualizer({
    count: filteredEvents.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const event = filteredEvents[index]
      return event && expandedEventIds.has(event.id) ? 200 : 36
    },
    overscan: 10,
    getItemKey: (index) => filteredEvents[index]?.id ?? index,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  // Auto-scroll to bottom on first load of a session
  useEffect(() => {
    hasInitiallyScrolled.current = false
  }, [selectedSessionId])

  useEffect(() => {
    if (!hasInitiallyScrolled.current && filteredEvents.length > 0) {
      virtualizer.scrollToIndex(filteredEvents.length - 1, { align: 'end' })
      hasInitiallyScrolled.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEvents.length])

  // Auto-scroll to bottom when new events arrive (if autoFollow is enabled)
  useEffect(() => {
    if (autoFollow && filteredEvents.length > 0) {
      virtualizer.scrollToIndex(filteredEvents.length - 1, { align: 'end' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFollow, filteredEvents.length])

  // Expand all events when requested from the scope bar
  useEffect(() => {
    if (expandAllCounter > 0 && filteredEvents.length > 0) {
      expandAllEvents(filteredEvents.map((e) => e.id))
    }
  }, [expandAllCounter])

  // ── Rewind mode scroll sync ──────────────────────────────────────────
  const syncTimelineFromScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const top = container.scrollTop
    const items = virtualizer.getVirtualItems()
    for (const item of items) {
      if (item.start + item.size > top) {
        const event = filteredEvents[item.index]
        if (event) {
          getTimelineScrollTo()?.(event.timestamp)
        }
        return
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEvents])

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

  useEffect(() => {
    if (!rewindMode) {
      registerEventStreamScroll(null)
      return
    }
    registerEventStreamScroll((eventId) => {
      const idx = filteredEvents.findIndex((e) => e.id === eventId)
      if (idx >= 0) {
        virtualizer.scrollToIndex(idx, { align: 'start' })
      }
    })
    return () => registerEventStreamScroll(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewindMode, filteredEvents])

  useEffect(() => {
    if (!rewindMode) return
    let id2: number | null = null
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        withSyncLock('event-stream', syncTimelineFromScroll)
      })
    })
    return () => {
      cancelAnimationFrame(id1)
      if (id2 != null) cancelAnimationFrame(id2)
    }
  }, [rewindMode, syncTimelineFromScroll])

  const prevFilteredRef = useRef(filteredEvents)
  useEffect(() => {
    if (selectedEventId != null && filteredEvents !== prevFilteredRef.current) {
      const idx = filteredEvents.findIndex((e) => e.id === selectedEventId)
      if (idx >= 0) {
        virtualizer.scrollToIndex(idx, { align: 'center' })
      }
    }
    prevFilteredRef.current = filteredEvents
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEvents, selectedEventId])

  // Scroll to a requested event — resolves grouped events (PostToolUse → displayed PreToolUse)
  const setFlashingEventId = useUIStore((s) => s.setFlashingEventId)
  useEffect(() => {
    if (scrollToEventId == null) return
    setScrollToEventId(null)

    // Resolve merged event IDs: if the target event is hidden (displayEventStream=false),
    // find the displayed event in its group
    let resolvedId = scrollToEventId
    const targetIdx = filteredEvents.findIndex((e) => e.id === scrollToEventId)
    if (targetIdx < 0) {
      // Not in filtered events — might be a hidden PostToolUse. Search enriched events.
      const hidden = enrichedEvents.find((e) => e.id === scrollToEventId)
      if (hidden?.groupId) {
        const grouped = dataApi.getGroupedEvents(hidden.groupId)
        const displayed = grouped.find((e) => e.displayEventStream)
        if (displayed) resolvedId = displayed.id
      }
    }

    const idx = filteredEvents.findIndex((e) => e.id === resolvedId)
    if (idx < 0) return
    virtualizer.scrollToIndex(idx, { align: 'center' })
    setFlashingEventId(resolvedId)
    const timeout = setTimeout(() => {
      if (useUIStore.getState().flashingEventId === resolvedId) {
        setFlashingEventId(null)
      }
    }, 1200)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToEventId, filteredEvents, enrichedEvents, dataApi, setScrollToEventId, setFlashingEventId])

  if (!selectedSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Select a project to view events
      </div>
    )
  }

  const firstTs = filteredEvents[0]?.timestamp
  const lastTs = filteredEvents[filteredEvents.length - 1]?.timestamp
  const rawCount = events?.length ?? 0
  const showRawCount = rawCount !== filteredEvents.length

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <QueryBoundary
        query={displayQuery}
        loading={
          <div className="flex-1 flex items-center justify-center">
            <Spinner label="Loading events..." />
          </div>
        }
        empty={
          <div className="flex-1 flex items-center justify-center">
            <EmptyState text="No events in this session" />
          </div>
        }
        isEmpty={(events) => events.length === 0}
      >
        {() => (
          <>
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
              {filteredEvents.length === 0 ? (
                <EmptyState text="No events match the current filters" />
              ) : (
                <div className="relative" style={{ height: `${totalSize}px`, width: '100%' }}>
                  {virtualItems.map((virtualItem) => {
                    const event = filteredEvents[virtualItem.index]
                    if (!event) return null
                    return (
                      <div
                        key={virtualItem.key}
                        ref={virtualizer.measureElement}
                        data-index={virtualItem.index}
                        className="absolute top-0 left-0 w-full border-b border-border/50"
                        style={{ transform: `translateY(${virtualItem.start}px)` }}
                      >
                        <EventRow
                          event={event}
                          dataApi={dataApi}
                          agentColorMap={agentColorMap}
                          showAgentLabel={showAgentLabel}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </QueryBoundary>
    </div>
  )
}
