import { create } from 'zustand'
import type { Label } from '@/types'
import type { EnrichedEvent } from '@/agents/types'
import type { TimeRange } from '@/config/time-ranges'
import { getServerHealth } from '@/lib/server-health'

// URL hash grammar (positional, never pattern-based):
//   #/                      → home
//   #/<proj>                → project view
//   #/<proj>/<sess>         → session in a project
//   #/_/<sess>              → session whose project is unknown/unassigned
//   …with an optional `:<view>` deep-link suffix.
// Segment 0 is always the project, segment 1 (if present) the session — no
// UUID/shape sniffing, so any agent's id format works. Every segment is
// percent-encoded on write and decoded on read, so slugs/ids may contain any
// character except a raw '/' (the structural separators '/', ':', '@' only
// ever appear encoded inside a segment). `_` is the reserved placeholder for
// "project unknown"; it's safe because the session id is the source of truth
// (sessions.id is unique) and useRouteSync rewrites the segment from the
// resolved project. NB: encodeURIComponent('_') === '_', so a project whose
// slug were literally '_' could not be distinguished — server slugs never are.
export const PROJECT_PLACEHOLDER = '_'

// decodeURIComponent throws on malformed input (a stray '%'); fall back to the
// raw segment so a hand-mangled URL degrades instead of crashing the router.
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// The view sub-grammar is `scope.name[@target]`; '.' and '@' are structural and
// the scope/name are a controlled vocabulary, so only the @target id (a session
// id) can carry arbitrary characters — encode/decode just that part.
function encodeViewTarget(view: string): string {
  const at = view.indexOf('@')
  return at === -1 ? view : view.slice(0, at + 1) + encodeURIComponent(view.slice(at + 1))
}
function decodeViewTarget(view: string): string {
  const at = view.indexOf('@')
  return at === -1 ? view : view.slice(0, at + 1) + safeDecode(view.slice(at + 1))
}

/**
 * Build the canonical `#/…` hash for a (project, session, view) triple.
 * Single source of truth for hash construction — used by updateHash, the
 * history seeding on load, useRouteSync's canonicalization, and the
 * session-link anchors. A null project with a session yields the `_`
 * placeholder.
 */
export function buildHash(
  projectSlug: string | null,
  sessionId: string | null,
  view: string | null,
): string {
  let path = '/'
  if (sessionId) {
    const proj = projectSlug ? encodeURIComponent(projectSlug) : PROJECT_PLACEHOLDER
    path = `/${proj}/${encodeURIComponent(sessionId)}`
  } else if (projectSlug) {
    path = `/${encodeURIComponent(projectSlug)}`
  }
  const suffix = view ? `:${encodeViewTarget(view)}` : ''
  return `#${path}${suffix}`
}

/**
 * Parses the deep-link view string (the part after `:` in the hash).
 * Convention:
 *   - `:<name>`                  → global modal              (scope='global', target=null)
 *   - `:<scope>.<name>`          → scope-bound to URL context (target=null)
 *   - `:<scope>.<name>@<id>`     → scope-bound to explicit id (target=<id>)
 * Scopes other than 'session' / 'project' fall back to 'global'.
 */
export function parseView(view: string): {
  scope: 'global' | 'session' | 'project'
  name: string
  target: string | null
} {
  let target: string | null = null
  let body = view
  const atIdx = view.indexOf('@')
  if (atIdx !== -1) {
    target = view.slice(atIdx + 1) || null
    body = view.slice(0, atIdx)
  }
  const dotIdx = body.indexOf('.')
  if (dotIdx === -1) {
    return { scope: 'global', name: body, target }
  }
  const scope = body.slice(0, dotIdx)
  const name = body.slice(dotIdx + 1)
  if (scope === 'session' || scope === 'project') {
    return { scope, name, target }
  }
  return { scope: 'global', name: body, target }
}

function parseHash(): {
  projectSlug: string | null
  sessionId: string | null
  view: string | null
} {
  const hash = window.location.hash.slice(1)
  if (!hash || hash === '/') return { projectSlug: null, sessionId: null, view: null }

  // Strip the trailing :view suffix (only one `:` per URL by convention).
  let view: string | null = null
  let path = hash
  // The only raw ':' in the hash is the view delimiter — any ':' inside a slug
  // (e.g. `branch:prefix:agent`) is percent-encoded as %3A, so this is safe.
  const colonIdx = hash.indexOf(':')
  if (colonIdx !== -1) {
    const rawView = hash.slice(colonIdx + 1)
    view = rawView ? decodeViewTarget(rawView) : null
    path = hash.slice(0, colonIdx)
  }

  if (!path || path === '/') return { projectSlug: null, sessionId: null, view }
  const parts = path.split('/').filter(Boolean).map(safeDecode)
  if (parts.length === 1) {
    // A bare placeholder (`#/_`) is meaningless — only the project slot of a
    // session URL uses it — so treat it as home.
    if (parts[0] === PROJECT_PLACEHOLDER) return { projectSlug: null, sessionId: null, view }
    return { projectSlug: parts[0], sessionId: null, view }
  }
  // 2+ segments: [project-or-placeholder, session]. The placeholder resolves
  // to a null project that useRouteSync fills in from the session.
  const projectSlug = parts[0] === PROJECT_PLACEHOLDER ? null : parts[0]
  return { projectSlug, sessionId: parts[1], view }
}

// When true, skip pushState (the URL is already correct from browser navigation)
let suppressHashPush = false

function updateHash(projectSlug: string | null, sessionId: string | null, view: string | null) {
  if (suppressHashPush) return
  // No-op guard: opening the same modal twice (or re-pushing the same URL
  // during a redundant set) would otherwise pollute the history stack. Compare
  // the parsed logical triple rather than raw strings — segments are encoded,
  // and the browser may normalize the stored hash differently than buildHash.
  const cur = parseHash()
  if (cur.projectSlug === projectSlug && cur.sessionId === sessionId && cur.view === view) return
  window.history.pushState(null, '', buildHash(projectSlug, sessionId, view))
}

interface SessionFilterState {
  activePrimaryFilters: string[]
  activeSecondaryFilters: string[]
  searchQuery: string
}

const DEFAULT_FILTER_STATE: SessionFilterState = {
  activePrimaryFilters: [],
  activeSecondaryFilters: [],
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
  /**
   * Navigate straight to a session from a non-project context (home /
   * constellation / pinned) as a SINGLE history entry. Setting the project
   * and session separately pushes two entries (`#/slug` then `#/slug/id`),
   * which strands the browser Back button on an intermediate project page;
   * this sets both at once with one `updateHash`.
   */
  openSession: (projectId: number | null, slug: string | null, sessionId: string) => void

  // Preview selection — highlights a session (and expands its project) in
  // the sidebar WITHOUT navigating the main panel or touching the URL hash.
  // Used by the Constellation drill-in so the sidebar tracks the focused
  // session while the home view stays mounted. Distinct from the real
  // selection above.
  previewProjectId: number | null
  previewSessionId: string | null
  setPreviewSession: (sessionId: string | null, projectId: number | null) => void
  clearPreviewSession: () => void

  updateProjectSlug: (slug: string) => void
  setSelectedAgentIds: (ids: string[]) => void
  toggleAgentId: (id: string) => void
  removeAgentId: (id: string) => void

  activePrimaryFilters: string[] // labels from primary filters
  activeSecondaryFilters: string[] // tool names from secondary filters
  searchQuery: string
  sessionFilterStates: Map<string, SessionFilterState> // per-session filter state
  togglePrimaryFilter: (label: string) => void
  toggleSecondaryFilter: (toolName: string) => void
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

  // Deep-link view string (the `:foo` / `:session.stats@id` suffix). Single
  // source of truth for which modal is open at the URL level. Modal opens
  // computed by syncing modal state → currentView in the actions below;
  // use-route-sync drives the reverse: URL view → modal state on load.
  currentView: string | null
  setCurrentView: (view: string | null) => void

  // The session id or project slug from the URL that failed to resolve to a
  // real row. Held (not just logged) so MainPanel can render a "not found"
  // state instead of a blank panel. Compared against the current target, so a
  // stale error self-clears when the user navigates elsewhere.
  routeError: string | null
  setRouteError: (idOrSlug: string | null) => void
  clearRouteError: () => void

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
  // Last filter id viewed in the Filters tab — persisted so reopening
  // the modal lands on the same filter the user was last editing.
  lastFilterId: string | null
  setLastFilterId: (id: string | null) => void

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
  frozenEvents: EnrichedEvent[] | null
  /** Pre-rewind autoFollow value, restored on exit */
  autoFollowBeforeRewind: boolean
  enterRewindMode: (events: EnrichedEvent[]) => void
  exitRewindMode: () => void

  // Session sort order in sidebar
  sessionSortOrder: 'activity' | 'created'
  setSessionSortOrder: (order: 'activity' | 'created') => void

  // Which home-page dashboard theme is active (persisted to localStorage).
  // See app/client/src/dashboard/ — the registry resolves unknown ids to
  // the default theme, so this is a free-form string, not a union.
  dashboardThemeId: string
  setDashboardThemeId: (id: string) => void

  // Pinned sessions (persisted to localStorage)
  pinnedSessionIds: Set<string>
  togglePinnedSession: (id: string) => void
  isSessionPinned: (id: string) => boolean

  // Icon customization reactivity
  iconCustomizationVersion: number
  bumpIconCustomizationVersion: () => void

  // Session activity pulses — incremented each time the server
  // broadcasts an `activity` WS message for a session. In-memory only;
  // no persistence. Sidebar components subscribe to the specific
  // session's count and play a one-shot pulse animation when it
  // changes. See docs/superpowers/specs/2026-04-24-session-activity-pings-design.md.
  sessionPulses: Record<string, number>
  /** Project-scoped pulse counter, parallel to sessionPulses. Lets the
   *  sidebar's project bell pulse without needing the project's session
   *  list (every activity ping carries projectId; we update both in
   *  one shot). */
  projectPulses: Record<number, number>
  /** Wall-clock ms of the last activity ping per session. Stamped in
   *  `pulseSession`. The Constellation dashboard reads this imperatively
   *  in its animation loop to compute recency "heat" (no React
   *  subscription, no per-ping re-render). */
  sessionActivityAt: Record<string, number>
  pulseSession: (sessionId: string, projectId?: number | null) => void

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

const {
  projectSlug: initialProjectSlug,
  sessionId: initialSessionId,
  view: initialView,
} = parseHash()

/**
 * Computes the deep-link view string from current modal/selection state.
 * Returns null when no modal is open. When the modal targets the same
 * session that's already selected in the URL, the `@<id>` suffix is
 * omitted; when it targets a different session, the override is added.
 *
 * As more modals become deep-linkable (project edit, global settings,
 * etc.), extend this helper rather than adding ad-hoc view writes.
 */
function computeViewFromState(state: {
  editingSessionId: string | null
  editingSessionTab: 'details' | 'stats' | 'labels'
  selectedSessionId: string | null
}): string | null {
  if (state.editingSessionId !== null) {
    const tab = state.editingSessionTab
    return state.editingSessionId === state.selectedSessionId
      ? `session.${tab}`
      : `session.${tab}@${state.editingSessionId}`
  }
  return null
}

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
        activePrimaryFilters: state.activePrimaryFilters,
        activeSecondaryFilters: state.activeSecondaryFilters,
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
      activePrimaryFilters: DEFAULT_FILTER_STATE.activePrimaryFilters,
      activeSecondaryFilters: DEFAULT_FILTER_STATE.activeSecondaryFilters,
      searchQuery: DEFAULT_FILTER_STATE.searchQuery,
    })
    const view = computeViewFromState(get())
    if (get().currentView !== view) set({ currentView: view })
    updateHash(newSlug, null, view)
  },
  setSelectedSessionId: (id) => {
    const state = get()
    const nextFilterStates = new Map(state.sessionFilterStates)

    // Save current session's filter state before switching
    if (state.selectedSessionId) {
      nextFilterStates.set(state.selectedSessionId, {
        activePrimaryFilters: state.activePrimaryFilters,
        activeSecondaryFilters: state.activeSecondaryFilters,
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
      activePrimaryFilters: restored.activePrimaryFilters,
      activeSecondaryFilters: restored.activeSecondaryFilters,
      searchQuery: restored.searchQuery,
      ...(exitingRewind && {
        rewindMode: false,
        frozenEvents: null,
        autoFollow: state.autoFollowBeforeRewind,
      }),
    })
    const view = computeViewFromState(get())
    if (get().currentView !== view) set({ currentView: view })
    updateHash(state.selectedProjectSlug, id, view)
  },
  openSession: (projectId, slug, sessionId) => {
    const state = get()
    const nextFilterStates = new Map(state.sessionFilterStates)
    // Save the outgoing session's filter state, restore the incoming one.
    if (state.selectedSessionId) {
      nextFilterStates.set(state.selectedSessionId, {
        activePrimaryFilters: state.activePrimaryFilters,
        activeSecondaryFilters: state.activeSecondaryFilters,
        searchQuery: state.searchQuery,
      })
    }
    const restored = nextFilterStates.get(sessionId) ?? DEFAULT_FILTER_STATE
    const newSlug = slug ?? null
    const exitingRewind = state.rewindMode && state.selectedSessionId !== sessionId
    set({
      selectedProjectId: projectId,
      selectedProjectSlug: newSlug,
      selectedSessionId: sessionId,
      selectedAgentIds: [],
      expandedEventIds: new Set(),
      lastExpandedEventId: null,
      selectedEventId: null,
      scrollToEventId: null,
      sessionFilterStates: nextFilterStates,
      activePrimaryFilters: restored.activePrimaryFilters,
      activeSecondaryFilters: restored.activeSecondaryFilters,
      searchQuery: restored.searchQuery,
      ...(exitingRewind && {
        rewindMode: false,
        frozenEvents: null,
        autoFollow: state.autoFollowBeforeRewind,
      }),
    })
    const view = computeViewFromState(get())
    if (get().currentView !== view) set({ currentView: view })
    updateHash(newSlug, sessionId, view) // single history entry
  },
  updateProjectSlug: (slug) => {
    set({ selectedProjectSlug: slug })
    const state = get()
    const view = computeViewFromState(state)
    if (state.currentView !== view) set({ currentView: view })
    updateHash(slug, state.selectedSessionId, view)
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

  activePrimaryFilters: [],
  activeSecondaryFilters: [],
  searchQuery: '',
  sessionFilterStates: new Map(),
  togglePrimaryFilter: (label) =>
    set((s) => ({
      activePrimaryFilters: s.activePrimaryFilters.includes(label)
        ? s.activePrimaryFilters.filter((l) => l !== label)
        : [...s.activePrimaryFilters, label],
    })),
  toggleSecondaryFilter: (toolName) =>
    set((s) => ({
      activeSecondaryFilters: s.activeSecondaryFilters.includes(toolName)
        ? s.activeSecondaryFilters.filter((t) => t !== toolName)
        : [...s.activeSecondaryFilters, toolName],
    })),
  clearAllFilters: () => set({ activePrimaryFilters: [], activeSecondaryFilters: [] }),
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
  setEditingSessionId: (id, tab) => {
    set({ editingSessionId: id, editingSessionTab: tab ?? 'details' })
    const state = get()
    const view = computeViewFromState(state)
    if (state.currentView !== view) set({ currentView: view })
    updateHash(state.selectedProjectSlug, state.selectedSessionId, view)
  },

  currentView: initialView,
  setCurrentView: (view) => {
    set({ currentView: view })
    const state = get()
    updateHash(state.selectedProjectSlug, state.selectedSessionId, view)
  },

  routeError: null,
  setRouteError: (idOrSlug) => {
    if (get().routeError !== idOrSlug) set({ routeError: idOrSlug })
  },
  clearRouteError: () => {
    if (get().routeError !== null) set({ routeError: null })
  },

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

  lastFilterId: localStorage.getItem('agents-observe-last-filter-id') || null,
  setLastFilterId: (id) => {
    if (id) localStorage.setItem('agents-observe-last-filter-id', id)
    else localStorage.removeItem('agents-observe-last-filter-id')
    set({ lastFilterId: id })
  },

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

  dashboardThemeId: localStorage.getItem('agents-observe-dashboard-theme') || 'sessions-list',
  setDashboardThemeId: (id) => {
    localStorage.setItem('agents-observe-dashboard-theme', id)
    set({ dashboardThemeId: id })
  },

  previewProjectId: null,
  previewSessionId: null,
  setPreviewSession: (sessionId, projectId) =>
    set({ previewSessionId: sessionId, previewProjectId: projectId }),
  clearPreviewSession: () => set({ previewSessionId: null, previewProjectId: null }),

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

  sessionPulses: {},
  projectPulses: {},
  sessionActivityAt: {},
  pulseSession: (sessionId, projectId) =>
    set((s) => {
      const sessionPulses = {
        ...s.sessionPulses,
        [sessionId]: (s.sessionPulses[sessionId] ?? 0) + 1,
      }
      // Stamp the activity time so the Constellation dashboard can compute
      // recency heat. Kept in its own map (read imperatively in a rAF loop)
      // so it never triggers a React render on its own.
      const sessionActivityAt = { ...s.sessionActivityAt, [sessionId]: Date.now() }
      // Only rebuild the project map when we got a projectId and there's
      // a real bump to record — avoids reference churn on null-project
      // pings (e.g. sessions still in the Unassigned bucket).
      if (projectId != null) {
        return {
          sessionPulses,
          sessionActivityAt,
          projectPulses: {
            ...s.projectPulses,
            [projectId]: (s.projectPulses[projectId] ?? 0) + 1,
          },
        }
      }
      return { sessionPulses, sessionActivityAt }
    }),

  serverVersion: null,
  setServerVersion: (version) => set({ serverVersion: version }),
  latestVersion: null,
  setLatestVersion: (version) => set({ latestVersion: version }),
}))

if (typeof window !== 'undefined') {
  // Seed history for direct URL loads so the back button has somewhere to go.
  // For #/project/session, replace with the project view first, then push the
  // full URL — Back then drops to the project page. The :view suffix rides only
  // on the final URL, so Back peels off the modal before the session.
  if (initialSessionId && initialProjectSlug) {
    window.history.replaceState(null, '', buildHash(initialProjectSlug, null, null))
    window.history.pushState(null, '', buildHash(initialProjectSlug, initialSessionId, initialView))
  } else if (initialSessionId) {
    // Unknown/unassigned project (`#/_/session`): there is no meaningful
    // intermediate Back target, so canonicalize in place. useRouteSync resolves
    // the real project from the session id and rewrites the segment.
    window.history.replaceState(null, '', buildHash(null, initialSessionId, initialView))
  } else if (initialProjectSlug) {
    window.history.replaceState(null, '', `#/`)
    window.history.pushState(null, '', buildHash(initialProjectSlug, null, initialView))
  }

  window.addEventListener('hashchange', () => {
    const { projectSlug, sessionId, view } = parseHash()
    const state = useUIStore.getState()
    // Suppress pushState during browser-initiated navigation (back/forward)
    // — the URL is already correct, pushing would wipe the forward stack
    suppressHashPush = true
    try {
      if (projectSlug !== state.selectedProjectSlug) {
        // Browser navigation is authoritative. When the URL carries no
        // project (Home `#/` or a session-only `#/id`), clear the resolved
        // `selectedProjectId` too — otherwise MainPanel keeps rendering the
        // old project and useRouteSync re-adds its slug. A session-only URL
        // re-resolves its project from the sessionId via useRouteSync.
        useUIStore.setState(
          projectSlug
            ? { selectedProjectSlug: projectSlug }
            : { selectedProjectSlug: null, selectedProjectId: null },
        )
      }
      if (sessionId !== state.selectedSessionId) {
        state.setSelectedSessionId(sessionId)
      }
      if (view !== state.currentView) {
        useUIStore.setState({ currentView: view })
      }
    } finally {
      suppressHashPush = false
    }
  })

  // Check server version on page load. Shares the single page-wide
  // /api/health fetch with the WS log-level sniffer + settings modal.
  getServerHealth().then((data) => {
    if (data?.version) {
      useUIStore.getState().setServerVersion(data.version)
    }
  })

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
