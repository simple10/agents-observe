import { create } from 'zustand'

function parseHash(): { projectSlug: string | null; sessionId: string | null } {
  const hash = window.location.hash.slice(1)
  if (!hash || hash === '/') return { projectSlug: null, sessionId: null }
  const parts = hash.split('/').filter(Boolean)
  if (parts.length === 1) {
    // Could be a session ID or a project slug — treat as session ID
    return { projectSlug: null, sessionId: parts[0] }
  }
  if (parts.length >= 2) {
    return { projectSlug: parts[0], sessionId: parts[1] }
  }
  return { projectSlug: null, sessionId: null }
}

function updateHash(projectSlug: string | null, sessionId: string | null) {
  let hash = '/'
  if (projectSlug && sessionId) {
    hash = `/${projectSlug}/${sessionId}`
  } else if (projectSlug) {
    hash = `/${projectSlug}`
  } else if (sessionId) {
    hash = `/${sessionId}`
  }
  window.history.replaceState(null, '', `#${hash}`)
}

interface SessionFilterState {
  activeStaticFilters: string[]
  activeToolFilters: string[]
  searchQuery: string
}

const DEFAULT_FILTER_STATE: SessionFilterState = {
  activeStaticFilters: [],
  activeToolFilters: [],
  searchQuery: '',
}

interface UIState {
  sidebarCollapsed: boolean
  sidebarWidth: number
  setSidebarCollapsed: (collapsed: boolean) => void
  setSidebarWidth: (width: number) => void

  selectedProjectId: number | null
  selectedProjectSlug: string | null
  selectedSessionId: string | null
  selectedAgentIds: string[]
  setSelectedProject: (id: number | null, slug?: string | null) => void
  setSelectedSessionId: (id: string | null) => void
  updateProjectSlug: (slug: string) => void
  setSelectedAgentIds: (ids: string[]) => void
  toggleAgentId: (id: string) => void
  removeAgentId: (id: string) => void

  activeStaticFilters: string[] // labels from STATIC_FILTERS
  activeToolFilters: string[] // tool names from dynamic filters
  searchQuery: string
  sessionFilterStates: Map<string, SessionFilterState> // per-session filter state
  toggleStaticFilter: (label: string) => void
  toggleToolFilter: (toolName: string) => void
  clearAllFilters: () => void
  setSearchQuery: (query: string) => void

  timelineHeight: number
  timeRange: '1m' | '5m' | '10m' | '60m'
  setTimelineHeight: (height: number) => void
  setTimeRange: (range: '1m' | '5m' | '10m' | '60m') => void

  expandedEventIds: Set<number>
  scrollToEventId: number | null
  expandAllCounter: number // incremented to signal "expand all" to event stream
  toggleExpandedEvent: (id: number) => void
  collapseAllEvents: () => void
  requestExpandAll: () => void
  expandAllEvents: (ids: number[]) => void
  setScrollToEventId: (id: number | null) => void

  // Selected event (highlighted row)
  selectedEventId: number | null
  setSelectedEventId: (id: number | null) => void

  // Auto-follow
  autoFollow: boolean
  setAutoFollow: (enabled: boolean) => void

  // Icon customization reactivity
  iconCustomizationVersion: number
  bumpIconCustomizationVersion: () => void

  // Time travel: override Date.now() for testing with historical data
  timeOverride: number | null
  setTimeOverride: (time: number | null) => void
}

const { projectSlug: initialProjectSlug, sessionId: initialSessionId } = parseHash()

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: false,
  sidebarWidth: 260,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  selectedProjectId: null,
  selectedProjectSlug: initialProjectSlug,
  selectedSessionId: initialSessionId,
  selectedAgentIds: [],
  setSelectedProject: (id, slug) => {
    const state = get()
    const nextFilterStates = new Map(state.sessionFilterStates)

    // Save current session's filter state before switching projects
    if (state.selectedSessionId) {
      nextFilterStates.set(state.selectedSessionId, {
        activeStaticFilters: state.activeStaticFilters,
        activeToolFilters: state.activeToolFilters,
        searchQuery: state.searchQuery,
      })
    }

    const newSlug = slug ?? null
    set({
      selectedProjectId: id,
      selectedProjectSlug: newSlug,
      selectedSessionId: null,
      selectedAgentIds: [],
      sessionFilterStates: nextFilterStates,
      activeStaticFilters: DEFAULT_FILTER_STATE.activeStaticFilters,
      activeToolFilters: DEFAULT_FILTER_STATE.activeToolFilters,
      searchQuery: DEFAULT_FILTER_STATE.searchQuery,
    })
    updateHash(newSlug, null)
  },
  setSelectedSessionId: (id) => {
    const state = get()
    const nextFilterStates = new Map(state.sessionFilterStates)

    // Save current session's filter state before switching
    if (state.selectedSessionId) {
      nextFilterStates.set(state.selectedSessionId, {
        activeStaticFilters: state.activeStaticFilters,
        activeToolFilters: state.activeToolFilters,
        searchQuery: state.searchQuery,
      })
    }

    // Restore saved filter state for the new session, or default to "All"
    const restored = id ? (nextFilterStates.get(id) ?? DEFAULT_FILTER_STATE) : DEFAULT_FILTER_STATE

    set({
      selectedSessionId: id,
      selectedAgentIds: [],
      sessionFilterStates: nextFilterStates,
      activeStaticFilters: restored.activeStaticFilters,
      activeToolFilters: restored.activeToolFilters,
      searchQuery: restored.searchQuery,
    })
    updateHash(state.selectedProjectSlug, id)
  },
  updateProjectSlug: (slug) => {
    set({ selectedProjectSlug: slug })
    const state = get()
    updateHash(slug, state.selectedSessionId)
  },
  setSelectedAgentIds: (ids) => set({ selectedAgentIds: ids }),
  toggleAgentId: (id) =>
    set((s) => ({
      selectedAgentIds: s.selectedAgentIds.includes(id)
        ? s.selectedAgentIds.filter((a) => a !== id)
        : [...s.selectedAgentIds, id],
    })),
  removeAgentId: (id) =>
    set((s) => ({ selectedAgentIds: s.selectedAgentIds.filter((a) => a !== id) })),

  activeStaticFilters: [],
  activeToolFilters: [],
  searchQuery: '',
  sessionFilterStates: new Map(),
  toggleStaticFilter: (label) =>
    set((s) => ({
      activeStaticFilters: s.activeStaticFilters.includes(label)
        ? s.activeStaticFilters.filter((l) => l !== label)
        : [...s.activeStaticFilters, label],
    })),
  toggleToolFilter: (toolName) =>
    set((s) => ({
      activeToolFilters: s.activeToolFilters.includes(toolName)
        ? s.activeToolFilters.filter((t) => t !== toolName)
        : [...s.activeToolFilters, toolName],
    })),
  clearAllFilters: () => set({ activeStaticFilters: [], activeToolFilters: [] }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  timelineHeight: 150,
  timeRange: '5m',
  setTimelineHeight: (height) => set({ timelineHeight: height }),
  setTimeRange: (range) => set({ timeRange: range }),

  expandedEventIds: new Set(),
  scrollToEventId: null,
  toggleExpandedEvent: (id) =>
    set((s) => {
      const next = new Set(s.expandedEventIds)
      const isExpanding = !next.has(id)
      if (isExpanding) next.add(id)
      else next.delete(id)
      // Disable auto-follow when expanding a row
      return { expandedEventIds: next, ...(isExpanding ? { autoFollow: false } : {}) }
    }),
  expandAllCounter: 0,
  collapseAllEvents: () => set({ expandedEventIds: new Set() }),
  requestExpandAll: () =>
    set((s) => ({ expandAllCounter: s.expandAllCounter + 1, autoFollow: false })),
  expandAllEvents: (ids: number[]) => set({ expandedEventIds: new Set(ids), autoFollow: false }),
  setScrollToEventId: (id) => set({ scrollToEventId: id }),

  selectedEventId: null,
  setSelectedEventId: (id) => set({ selectedEventId: id }),

  autoFollow: true,
  setAutoFollow: (enabled) => set({ autoFollow: enabled }),

  iconCustomizationVersion: 0,
  bumpIconCustomizationVersion: () =>
    set((s) => ({ iconCustomizationVersion: s.iconCustomizationVersion + 1 })),

  timeOverride: null,
  setTimeOverride: (time) => set({ timeOverride: time }),
}))

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const { projectSlug, sessionId } = parseHash()
    const state = useUIStore.getState()
    if (projectSlug !== state.selectedProjectSlug) {
      // Slug changed in URL — update slug but keep projectId (will be resolved by components)
      useUIStore.setState({ selectedProjectSlug: projectSlug })
    }
    if (sessionId !== state.selectedSessionId) {
      state.setSelectedSessionId(sessionId)
    }
  })
}
