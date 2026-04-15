import { create } from 'zustand'
import type { ParsedEvent } from '@/types'
import type { TimeRange } from '@/config/time-ranges'

// Session IDs are UUIDs (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseHash(): { projectSlug: string | null; sessionId: string | null } {
  const hash = window.location.hash.slice(1)
  if (!hash || hash === '/') return { projectSlug: null, sessionId: null }
  const parts = hash.split('/').filter(Boolean)
  if (parts.length === 1) {
    // Distinguish between session ID (UUID) and project slug
    if (UUID_RE.test(parts[0])) {
      return { projectSlug: null, sessionId: parts[0] }
    }
    return { projectSlug: parts[0], sessionId: null }
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
  timeRange: TimeRange
  setTimelineHeight: (height: number) => void
  setTimeRange: (range: TimeRange) => void

  expandedEventIds: Set<number>
  scrollToEventId: number | null
  // Event id currently flashing after a scroll-to. Stored at the store level
  // (not local row state) so the flash survives row unmount/remount during
  // virtualizer scrolling — common when scrolling long distances in rewind.
  flashingEventId: number | null
  expandAllCounter: number // incremented to signal "expand all" to event stream
  toggleExpandedEvent: (id: number) => void
  collapseAllEvents: () => void
  requestExpandAll: () => void
  expandAllEvents: (ids: number[]) => void
  setScrollToEventId: (id: number | null) => void
  setFlashingEventId: (id: number | null) => void

  // Selected event (highlighted row)
  selectedEventId: number | null
  setSelectedEventId: (id: number | null) => void

  // Session being edited in the SessionEditModal (null = closed)
  editingSessionId: string | null
  editingSessionTab: 'details' | 'stats'
  setEditingSessionId: (id: string | null, tab?: 'details' | 'stats') => void

  // Auto-follow
  autoFollow: boolean
  setAutoFollow: (enabled: boolean) => void

  // Dedup toggle — when off, all events are shown (no merging)
  dedupEnabled: boolean
  setDedupEnabled: (enabled: boolean) => void

  // Rewind mode: freezes the event/timeline view at a snapshot of events
  rewindMode: boolean
  frozenEvents: ParsedEvent[] | null
  /** Pre-rewind autoFollow value, restored on exit */
  autoFollowBeforeRewind: boolean
  enterRewindMode: (events: ParsedEvent[]) => void
  exitRewindMode: () => void

  // Session sort order in sidebar
  sessionSortOrder: 'activity' | 'created'
  setSessionSortOrder: (order: 'activity' | 'created') => void

  // Pinned sessions (persisted to localStorage)
  pinnedSessionIds: Set<string>
  togglePinnedSession: (id: string) => void
  isSessionPinned: (id: string) => boolean

  // Icon customization reactivity
  iconCustomizationVersion: number
  bumpIconCustomizationVersion: () => void

  // Version tracking
  serverVersion: string | null
  setServerVersion: (version: string) => void
  latestVersion: string | null
  setLatestVersion: (version: string) => void
}

const PINNED_STORAGE_KEY = 'agents-observe-pinned-sessions'

function loadPinnedSessions(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function savePinnedSessions(ids: Set<string>) {
  localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...ids]))
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
      expandedEventIds: new Set(),
      selectedEventId: null,
      scrollToEventId: null,
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

    // Auto-exit rewind mode if switching to a different session — frozen events
    // from the old session would be stale.
    const exitingRewind = state.rewindMode && state.selectedSessionId !== id
    set({
      selectedSessionId: id,
      selectedAgentIds: [],
      expandedEventIds: new Set(),
      selectedEventId: null,
      scrollToEventId: null,
      sessionFilterStates: nextFilterStates,
      activeStaticFilters: restored.activeStaticFilters,
      activeToolFilters: restored.activeToolFilters,
      searchQuery: restored.searchQuery,
      ...(exitingRewind && {
        rewindMode: false,
        frozenEvents: null,
        autoFollow: state.autoFollowBeforeRewind,
      }),
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
  flashingEventId: null,
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
  setFlashingEventId: (id) => set({ flashingEventId: id }),

  selectedEventId: null,
  setSelectedEventId: (id) => set({ selectedEventId: id }),

  editingSessionId: null,
  editingSessionTab: 'details',
  setEditingSessionId: (id, tab) =>
    set({ editingSessionId: id, editingSessionTab: tab ?? 'details' }),

  autoFollow: true,
  setAutoFollow: (enabled) => set({ autoFollow: enabled }),

  dedupEnabled: true,
  setDedupEnabled: (enabled) => set({ dedupEnabled: enabled }),

  rewindMode: false,
  frozenEvents: null,
  autoFollowBeforeRewind: true,
  enterRewindMode: (events) =>
    set((s) => ({
      rewindMode: true,
      frozenEvents: events,
      autoFollowBeforeRewind: s.autoFollow,
      autoFollow: false,
    })),
  exitRewindMode: () =>
    set((s) => ({
      rewindMode: false,
      frozenEvents: null,
      autoFollow: s.autoFollowBeforeRewind,
    })),

  sessionSortOrder: 'activity',
  setSessionSortOrder: (order) => set({ sessionSortOrder: order }),

  pinnedSessionIds: loadPinnedSessions(),
  togglePinnedSession: (id) =>
    set((s) => {
      const next = new Set(s.pinnedSessionIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      savePinnedSessions(next)
      return { pinnedSessionIds: next }
    }),
  isSessionPinned: (id) => get().pinnedSessionIds.has(id),

  iconCustomizationVersion: 0,
  bumpIconCustomizationVersion: () =>
    set((s) => ({ iconCustomizationVersion: s.iconCustomizationVersion + 1 })),

  serverVersion: null,
  setServerVersion: (version) => set({ serverVersion: version }),
  latestVersion: null,
  setLatestVersion: (version) => set({ latestVersion: version }),
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

  // Check server version on page load
  fetch('/api/health')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data?.version) {
        useUIStore.getState().setServerVersion(data.version)
      }
    })
    .catch(() => {})

  // Fetch latest release version from GitHub on page load
  const githubRepoUrl = typeof __GITHUB_REPO_URL__ !== 'undefined' ? __GITHUB_REPO_URL__ : ''
  if (githubRepoUrl) {
    const match = githubRepoUrl.match(/github\.com\/([^/]+\/[^/]+)/)
    if (match) {
      fetch(`https://api.github.com/repos/${match[1]}/releases/latest`)
        .then((r) => (r.ok ? r.json() : null))
        .then((release) => {
          if (release?.tag_name) {
            useUIStore.getState().setLatestVersion(release.tag_name.replace(/^v/, ''))
          }
        })
        .catch(() => {})
    }
  }
}
