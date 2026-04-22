import { create } from 'zustand'
import type { Label, ParsedEvent } from '@/types'
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

// When true, skip pushState (the URL is already correct from browser navigation)
let suppressHashPush = false

function updateHash(projectSlug: string | null, sessionId: string | null) {
  if (suppressHashPush) return
  let hash = '/'
  if (projectSlug && sessionId) {
    hash = `/${projectSlug}/${sessionId}`
  } else if (projectSlug) {
    hash = `/${projectSlug}`
  } else if (sessionId) {
    hash = `/${sessionId}`
  }
  window.history.pushState(null, '', `#${hash}`)
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
  // The most recently expanded event id — the "row the user is focused
  // on." Used to keep that row in view when filters/search change. Reset
  // on explicit re-collapse of the same row, expand/collapse all, auto-
  // follow re-enable, and session/project switches.
  lastExpandedEventId: number | null
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
  editingSessionTab: 'details' | 'stats' | 'labels'
  setEditingSessionId: (id: string | null, tab?: 'details' | 'stats' | 'labels') => void

  // Labels — user-defined bookmarks across sessions (localStorage only)
  labels: Label[]
  labelMemberships: Map<string, Set<string>> // labelId → sessionIds
  createLabel: (name: string) => Label | null
  renameLabel: (id: string, name: string) => boolean
  deleteLabel: (id: string) => void
  toggleSessionLabel: (labelId: string, sessionId: string) => void
  getLabelsForSession: (sessionId: string) => Label[]
  // Labels live in a tab of the Settings modal now. openLabelsModal
  // just routes to that tab with an optional scroll-to target; close
  // drops you out of Settings entirely. labelsModalScrollToId is still
  // read by the tab body on mount.
  labelsModalScrollToId: string | null
  openLabelsModal: (scrollToLabelId?: string) => void
  closeLabelsModal: () => void
  clearLabelsModalScrollTarget: () => void

  // Sidebar Projects/Labels tab selector — persisted so the sidebar
  // re-opens on whichever view the user was last using.
  sidebarTab: 'projects' | 'labels'
  setSidebarTab: (tab: 'projects' | 'labels') => void

  // Settings modal
  settingsOpen: boolean
  settingsTab: string
  openSettings: (tab?: string) => void
  setSettingsTab: (tab: string) => void
  closeSettings: () => void

  // Auto-follow
  autoFollow: boolean
  setAutoFollow: (enabled: boolean) => void

  // Dedup toggle — when off, all events are shown (no merging)
  dedupEnabled: boolean
  setDedupEnabled: (enabled: boolean) => void

  // Notification alerts — when off, the sidebar bells never appear.
  notificationsEnabled: boolean
  setNotificationsEnabled: (enabled: boolean) => void

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

const LABELS_STORAGE_KEY = 'agents-observe-labels'
const LABEL_MEMBERSHIP_STORAGE_KEY = 'agents-observe-label-memberships'

function loadLabels(): Label[] {
  try {
    const raw = localStorage.getItem(LABELS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (l): l is Label =>
        l &&
        typeof l.id === 'string' &&
        typeof l.name === 'string' &&
        typeof l.createdAt === 'number',
    )
  } catch {
    return []
  }
}

function saveLabels(labels: Label[]) {
  localStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify(labels))
}

function loadLabelMemberships(): Map<string, Set<string>> {
  try {
    const raw = localStorage.getItem(LABEL_MEMBERSHIP_STORAGE_KEY)
    if (!raw) return new Map()
    const parsed = JSON.parse(raw) as Record<string, string[]>
    const map = new Map<string, Set<string>>()
    for (const [labelId, sessionIds] of Object.entries(parsed)) {
      if (Array.isArray(sessionIds)) map.set(labelId, new Set(sessionIds))
    }
    return map
  } catch {
    return new Map()
  }
}

function saveLabelMemberships(memberships: Map<string, Set<string>>) {
  const obj: Record<string, string[]> = {}
  for (const [labelId, sessionIds] of memberships) {
    obj[labelId] = [...sessionIds]
  }
  localStorage.setItem(LABEL_MEMBERSHIP_STORAGE_KEY, JSON.stringify(obj))
}

function genLabelId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `label-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
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
      lastExpandedEventId: null,
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
      lastExpandedEventId: null,
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
  lastExpandedEventId: null,
  toggleExpandedEvent: (id) =>
    set((s) => {
      const next = new Set(s.expandedEventIds)
      const isExpanding = !next.has(id)
      if (isExpanding) next.add(id)
      else next.delete(id)
      // Expanding marks this row as the user's focus. Any collapse
      // (even of a non-focused row) clears focus — the user is
      // signaling "I'm done inspecting." Next expand sets a new focus.
      return {
        expandedEventIds: next,
        lastExpandedEventId: isExpanding ? id : null,
        ...(isExpanding ? { autoFollow: false } : {}),
      }
    }),
  expandAllCounter: 0,
  collapseAllEvents: () => set({ expandedEventIds: new Set(), lastExpandedEventId: null }),
  requestExpandAll: () =>
    set((s) => ({
      expandAllCounter: s.expandAllCounter + 1,
      autoFollow: false,
      lastExpandedEventId: null,
    })),
  expandAllEvents: (ids: number[]) =>
    set({ expandedEventIds: new Set(ids), autoFollow: false, lastExpandedEventId: null }),
  setScrollToEventId: (id) => set({ scrollToEventId: id }),
  setFlashingEventId: (id) => set({ flashingEventId: id }),

  selectedEventId: null,
  setSelectedEventId: (id) => set({ selectedEventId: id }),

  editingSessionId: null,
  editingSessionTab: 'details',
  setEditingSessionId: (id, tab) =>
    set({ editingSessionId: id, editingSessionTab: tab ?? 'details' }),

  sidebarTab:
    (localStorage.getItem('agents-observe-sidebar-tab') as 'projects' | 'labels') || 'projects',
  setSidebarTab: (tab) => {
    localStorage.setItem('agents-observe-sidebar-tab', tab)
    set({ sidebarTab: tab })
  },

  settingsOpen: false,
  // Remember the last tab the user viewed so the gear icon reopens
  // there. Fall back to 'settings' (Display) since that's the leftmost
  // tab in the modal.
  settingsTab: localStorage.getItem('agents-observe-settings-tab') || 'settings',
  openSettings: (tab) => {
    if (tab) {
      localStorage.setItem('agents-observe-settings-tab', tab)
      set({ settingsOpen: true, settingsTab: tab })
    } else {
      set({ settingsOpen: true })
    }
  },
  setSettingsTab: (tab) => {
    localStorage.setItem('agents-observe-settings-tab', tab)
    set({ settingsTab: tab })
  },
  closeSettings: () => set({ settingsOpen: false }),

  autoFollow: true,
  setAutoFollow: (enabled) =>
    set((s) => ({
      autoFollow: enabled,
      // Turning auto-follow back on is an explicit opt-out of the
      // "stay on the row I was inspecting" behavior.
      lastExpandedEventId: enabled ? null : s.lastExpandedEventId,
    })),

  dedupEnabled: localStorage.getItem('agents-observe-dedup') !== 'off',
  setDedupEnabled: (enabled) => {
    localStorage.setItem('agents-observe-dedup', enabled ? 'on' : 'off')
    window.location.reload()
  },

  notificationsEnabled: localStorage.getItem('agents-observe-notifications') !== 'off',
  setNotificationsEnabled: (enabled) => {
    localStorage.setItem('agents-observe-notifications', enabled ? 'on' : 'off')
    set({ notificationsEnabled: enabled })
  },

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

  labels: loadLabels(),
  labelMemberships: loadLabelMemberships(),
  createLabel: (name) => {
    const trimmed = name.trim()
    if (!trimmed) return null
    const state = get()
    const lower = trimmed.toLowerCase()
    if (state.labels.some((l) => l.name.toLowerCase() === lower)) return null
    const label: Label = { id: genLabelId(), name: trimmed, createdAt: Date.now() }
    const nextLabels = [...state.labels, label]
    saveLabels(nextLabels)
    set({ labels: nextLabels })
    return label
  },
  renameLabel: (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return false
    const state = get()
    const lower = trimmed.toLowerCase()
    if (state.labels.some((l) => l.id !== id && l.name.toLowerCase() === lower)) return false
    const nextLabels = state.labels.map((l) => (l.id === id ? { ...l, name: trimmed } : l))
    saveLabels(nextLabels)
    set({ labels: nextLabels })
    return true
  },
  deleteLabel: (id) =>
    set((s) => {
      const nextLabels = s.labels.filter((l) => l.id !== id)
      const nextMemberships = new Map(s.labelMemberships)
      nextMemberships.delete(id)
      saveLabels(nextLabels)
      saveLabelMemberships(nextMemberships)
      return { labels: nextLabels, labelMemberships: nextMemberships }
    }),
  toggleSessionLabel: (labelId, sessionId) =>
    set((s) => {
      const nextMemberships = new Map(s.labelMemberships)
      const existing = new Set(nextMemberships.get(labelId) ?? [])
      if (existing.has(sessionId)) existing.delete(sessionId)
      else existing.add(sessionId)
      nextMemberships.set(labelId, existing)
      saveLabelMemberships(nextMemberships)
      return { labelMemberships: nextMemberships }
    }),
  getLabelsForSession: (sessionId) => {
    const state = get()
    return state.labels.filter((l) => state.labelMemberships.get(l.id)?.has(sessionId))
  },
  labelsModalScrollToId: null,
  openLabelsModal: (scrollToLabelId) => {
    localStorage.setItem('agents-observe-settings-tab', 'labels')
    set({
      settingsOpen: true,
      settingsTab: 'labels',
      labelsModalScrollToId: scrollToLabelId ?? null,
    })
  },
  closeLabelsModal: () => set({ settingsOpen: false, labelsModalScrollToId: null }),
  clearLabelsModalScrollTarget: () => set({ labelsModalScrollToId: null }),

  iconCustomizationVersion: 0,
  bumpIconCustomizationVersion: () =>
    set((s) => ({ iconCustomizationVersion: s.iconCustomizationVersion + 1 })),

  serverVersion: null,
  setServerVersion: (version) => set({ serverVersion: version }),
  latestVersion: null,
  setLatestVersion: (version) => set({ latestVersion: version }),
}))

if (typeof window !== 'undefined') {
  // Seed history for direct URL loads so the back button has somewhere to go.
  // If loading #/project/session, push #/project first (project view),
  // then replace with the full URL. Back then goes to project view.
  if (initialProjectSlug && initialSessionId) {
    window.history.replaceState(null, '', `#/${initialProjectSlug}`)
    window.history.pushState(null, '', `#/${initialProjectSlug}/${initialSessionId}`)
  } else if (initialProjectSlug) {
    window.history.replaceState(null, '', `#/`)
    window.history.pushState(null, '', `#/${initialProjectSlug}`)
  }

  window.addEventListener('hashchange', () => {
    const { projectSlug, sessionId } = parseHash()
    const state = useUIStore.getState()
    // Suppress pushState during browser-initiated navigation (back/forward)
    // — the URL is already correct, pushing would wipe the forward stack
    suppressHashPush = true
    try {
      if (projectSlug !== state.selectedProjectSlug) {
        useUIStore.setState({ selectedProjectSlug: projectSlug })
      }
      if (sessionId !== state.selectedSessionId) {
        state.setSelectedSessionId(sessionId)
      }
    } finally {
      suppressHashPush = false
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
