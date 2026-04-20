import { useMemo, useRef, useEffect, useDeferredValue, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useQuery } from '@tanstack/react-query'
import { useEffectiveEvents } from '@/hooks/use-effective-events'
import { useAgents } from '@/hooks/use-agents'
import { useProcessedEvents } from '@/agents/event-processing-context'
import { usePermissionModeBackfill } from '@/hooks/use-permission-mode-backfill'
import { getTimelineScrollTo, registerEventStreamScroll, withSyncLock } from '@/lib/scroll-sync'
import { api } from '@/lib/api-client'
import { useUIStore } from '@/stores/ui-store'
import { EventRow } from './event-row'
import { format } from 'timeago.js'
import { buildAgentColorMap } from '@/lib/agent-utils'
import { QueryBoundary } from '@/components/shared/query-boundary'
import { EmptyState, Spinner } from '@/components/shared/loading-states'
import { eventMatchesFilters } from '@/config/filters'
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
  const rawEvents = eventsQuery.data
  const agents = useAgents(selectedSessionId, rawEvents)

  // Backfill permission_mode into session metadata if missing.
  const { data: sessionForBackfill } = useQuery({
    queryKey: ['session-backfill', selectedSessionId],
    queryFn: () => api.getSession(selectedSessionId!),
    enabled: !!selectedSessionId,
    staleTime: Infinity,
  })
  usePermissionModeBackfill(sessionForBackfill, rawEvents, agents)

  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])

  // Use shared processed events from context (single EventStore for both stream + timeline)
  const { events: enrichedEvents, dataApi } = useProcessedEvents()

  // Display query — drives the QueryBoundary loading/empty states.
  // Based on enrichedEvents so it's in sync with what we actually render.
  const displayQuery = useMemo(
    () => ({
      data: enrichedEvents.length > 0 ? enrichedEvents : eventsQuery.data,
      isLoading: eventsQuery.isLoading,
      isError: eventsQuery.isError,
      error: eventsQuery.error,
    }),
    [
      enrichedEvents,
      eventsQuery.data,
      eventsQuery.isLoading,
      eventsQuery.isError,
      eventsQuery.error,
    ],
  )

  // Apply all client-side filters on enriched events
  const filteredEvents = useMemo(() => {
    // Start with events that processEvent marked as displayable
    let filtered = enrichedEvents.filter((e) => e.displayEventStream)

    // Agent chip filtering
    if (selectedAgentIds.length > 0) {
      filtered = filtered.filter((e) => selectedAgentIds.includes(e.agentId))
    }

    // Static category filters (row 1: Prompts, Tools, Agents, etc.)
    // Delegate to the shared STATIC_FILTERS config so events that
    // belong to multiple categories (e.g. SubagentStop → Agents AND
    // Stop) match whichever filter the user picked. Previously we
    // filtered by the singular `filterTags.static`, which forced a
    // single category per event.
    if (deferredStaticFilters.length > 0) {
      filtered = filtered.filter((e) => eventMatchesFilters(e, deferredStaticFilters, []))
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
  const lastExpandedEventId = useUIStore((s) => s.lastExpandedEventId)
  const scrollToEventId = useUIStore((s) => s.scrollToEventId)
  const setScrollToEventId = useUIStore((s) => s.setScrollToEventId)

  // Keep the user's focused (last-expanded) row in view when they change
  // search / filters. The `scrollToEventId` pipeline below resolves the
  // target and no-ops if the row is filtered out, so edge cases (stale
  // id, deleted event) fall through gracefully.
  //
  // We watch the DEFERRED filter values (not the raw ones) because
  // `filteredEvents` is computed from deferred values. Firing on the
  // raw filters would queue a scroll before React has had a chance to
  // regenerate the filtered list, leading to positions that are off by
  // multiple pages.
  //
  // lastExpandedEventId is read via a ref so expanding/collapsing a row
  // doesn't re-fire this effect — only filter/search changes do.
  const lastExpandedRef = useRef(lastExpandedEventId)
  useEffect(() => {
    lastExpandedRef.current = lastExpandedEventId
  }, [lastExpandedEventId])
  const firstFilterChangeRef = useRef(true)
  useEffect(() => {
    if (firstFilterChangeRef.current) {
      firstFilterChangeRef.current = false
      return
    }
    const id = lastExpandedRef.current
    if (id == null) return
    setScrollToEventId(id)
  }, [deferredStaticFilters, deferredToolFilters, deferredSearchQuery, setScrollToEventId])

  const showAgentLabel = agents.length > 1
  const scrollRef = useRef<HTMLDivElement>(null)

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

  // No need to track session changes for scroll — the entire component
  // remounts on session change (key={sessionId} in main-panel).

  // Scroll to bottom on initial load and when new events arrive (if autoFollow).
  // Component remounts on session change, so initial scroll always fires.
  const hasScrolledRef = useRef(false)
  useEffect(() => {
    if (filteredEvents.length === 0) return
    if (!hasScrolledRef.current || autoFollow) {
      virtualizer.scrollToIndex(filteredEvents.length - 1, { align: 'end' })
      hasScrolledRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEvents.length, autoFollow])

  // When the browser tab is re-activated, rAF throttling while hidden can
  // leave the virtualizer scrolled short of the end. Re-issue scrollToBottom
  // on visibility change so autoFollow catches up with events that arrived
  // while the tab was backgrounded.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (!autoFollow) return
      if (filteredEvents.length === 0) return
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(filteredEvents.length - 1, { align: 'end' })
      })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
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
  }, [
    scrollToEventId,
    filteredEvents,
    enrichedEvents,
    dataApi,
    setScrollToEventId,
    setFlashingEventId,
  ])

  if (!selectedSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Select a project to view events
      </div>
    )
  }

  const firstTs = filteredEvents[0]?.timestamp
  const lastTs = filteredEvents[filteredEvents.length - 1]?.timestamp
  const rawCount = rawEvents?.length ?? 0
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
