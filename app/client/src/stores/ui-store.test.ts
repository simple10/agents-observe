import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './ui-store'
import type { ParsedEvent } from '@/types'

function makeEvent(id: number): ParsedEvent {
  return {
    id,
    agentId: 'a',
    sessionId: 's',
    hookName: 'PreToolUse',
    type: 'tool',
    subtype: 'PreToolUse',
    toolName: 'Bash',
    status: 'completed',
    timestamp: id * 1000,
    createdAt: id * 1000,
    payload: {},
  }
}

// Reset store state before each test to ensure isolation
beforeEach(() => {
  // Reset the hash to avoid polluting tests
  window.location.hash = '#/'

  useUIStore.setState({
    sidebarCollapsed: false,
    sidebarWidth: 260,
    selectedProjectId: null,
    selectedSessionId: null,
    selectedAgentIds: [],
    activeStaticFilters: [],
    activeToolFilters: [],
    searchQuery: '',
    sessionFilterStates: new Map(),
    timelineHeight: 150,
    timeRange: '5m',
    expandedEventIds: new Set(),
    scrollToEventId: null,
    flashingEventId: null,
    expandAllCounter: 0,
    lastExpandedEventId: null,
    selectedEventId: null,
    editingSessionId: null,
    editingSessionTab: 'details',
    autoFollow: true,
    rewindMode: false,
    frozenEvents: null,
    autoFollowBeforeRewind: true,
    iconCustomizationVersion: 0,
  })
})

describe('ui-store', () => {
  // ── Hash parsing / URL sync ─────────────────────────────────

  describe('hash parsing and URL sync', () => {
    it('should parse empty hash as null project and session', () => {
      window.location.hash = '#/'
      const state = useUIStore.getState()
      // After reset, both are null
      expect(state.selectedProjectId).toBeNull()
      expect(state.selectedSessionId).toBeNull()
    })

    it('should update hash when setting project with slug (no session)', () => {
      useUIStore.getState().setSelectedProject(1, 'my-project')
      expect(window.location.hash).toBe('#/my-project')
    })

    it('should update hash with slug and session', () => {
      useUIStore.getState().setSelectedProject(1, 'my-project')
      useUIStore.getState().setSelectedSessionId('sess-1')
      expect(window.location.hash).toBe('#/my-project/sess-1')
    })

    it('should clear session from hash when project is set to null', () => {
      useUIStore.getState().setSelectedProject(1, 'my-project')
      useUIStore.getState().setSelectedSessionId('sess-1')
      useUIStore.getState().setSelectedProject(null)
      expect(window.location.hash).toBe('#/')
      expect(useUIStore.getState().selectedSessionId).toBeNull()
    })

    it('should clear session when a new project is selected', () => {
      useUIStore.getState().setSelectedProject(1, 'proj-a')
      useUIStore.getState().setSelectedSessionId('sess-1')
      useUIStore.getState().setSelectedProject(2, 'proj-b')
      expect(useUIStore.getState().selectedSessionId).toBeNull()
      expect(window.location.hash).toBe('#/proj-b')
    })
  })

  // ── Project/session selection ─────────────────────────────

  describe('project/session selection state transitions', () => {
    it('should set project ID and clear session and agent IDs', () => {
      useUIStore.getState().setSelectedAgentIds(['agent-1'])
      useUIStore.getState().setSelectedProject(1)
      const state = useUIStore.getState()
      expect(state.selectedProjectId).toBe(1)
      expect(state.selectedSessionId).toBeNull()
      expect(state.selectedAgentIds).toEqual([])
    })

    it('should set session ID and clear agent IDs', () => {
      useUIStore.getState().setSelectedProject(1)
      useUIStore.getState().setSelectedAgentIds(['agent-1'])
      useUIStore.getState().setSelectedSessionId('sess-1')
      const state = useUIStore.getState()
      expect(state.selectedSessionId).toBe('sess-1')
      expect(state.selectedAgentIds).toEqual([])
    })

    it('should deselect session when set to null', () => {
      useUIStore.getState().setSelectedProject(1)
      useUIStore.getState().setSelectedSessionId('sess-1')
      useUIStore.getState().setSelectedSessionId(null)
      expect(useUIStore.getState().selectedSessionId).toBeNull()
    })
  })

  // ── Per-session filter state save/restore ─────────────────

  describe('per-session filter state save/restore', () => {
    it('should save filter state when switching sessions', () => {
      useUIStore.getState().setSelectedProject(1)
      useUIStore.getState().setSelectedSessionId('sess-1')

      // Apply some filters in session 1
      useUIStore.getState().toggleStaticFilter('Tools')
      useUIStore.getState().toggleToolFilter('Bash')
      expect(useUIStore.getState().activeStaticFilters).toEqual(['Tools'])
      expect(useUIStore.getState().activeToolFilters).toEqual(['Bash'])

      // Switch to session 2 -- session 1 filters get saved
      useUIStore.getState().setSelectedSessionId('sess-2')
      expect(useUIStore.getState().activeStaticFilters).toEqual([])
      expect(useUIStore.getState().activeToolFilters).toEqual([])

      // Switch back to session 1 -- filters should be restored
      useUIStore.getState().setSelectedSessionId('sess-1')
      expect(useUIStore.getState().activeStaticFilters).toEqual(['Tools'])
      expect(useUIStore.getState().activeToolFilters).toEqual(['Bash'])
    })

    it('should save filter state when switching projects', () => {
      useUIStore.getState().setSelectedProject(1)
      useUIStore.getState().setSelectedSessionId('sess-1')
      useUIStore.getState().toggleStaticFilter('Prompts')

      // Switch to a different project -- session filters saved
      useUIStore.getState().setSelectedProject(2)
      expect(useUIStore.getState().activeStaticFilters).toEqual([])

      // Come back to proj-1, sess-1
      useUIStore.getState().setSelectedProject(1)
      useUIStore.getState().setSelectedSessionId('sess-1')
      expect(useUIStore.getState().activeStaticFilters).toEqual(['Prompts'])
    })

    it('should save searchQuery per session', () => {
      useUIStore.getState().setSelectedProject(1)
      useUIStore.getState().setSelectedSessionId('sess-1')
      useUIStore.getState().setSearchQuery('hello')

      useUIStore.getState().setSelectedSessionId('sess-2')
      expect(useUIStore.getState().searchQuery).toBe('')

      useUIStore.getState().setSelectedSessionId('sess-1')
      expect(useUIStore.getState().searchQuery).toBe('hello')
    })
  })

  // ── Agent ID toggling ─────────────────────────────────────

  describe('agent ID toggle/remove', () => {
    it('should add agent ID on first toggle', () => {
      useUIStore.getState().toggleAgentId('agent-1')
      expect(useUIStore.getState().selectedAgentIds).toEqual(['agent-1'])
    })

    it('should remove agent ID on second toggle', () => {
      useUIStore.getState().toggleAgentId('agent-1')
      useUIStore.getState().toggleAgentId('agent-1')
      expect(useUIStore.getState().selectedAgentIds).toEqual([])
    })

    it('should support multiple agent selections', () => {
      useUIStore.getState().toggleAgentId('agent-1')
      useUIStore.getState().toggleAgentId('agent-2')
      expect(useUIStore.getState().selectedAgentIds).toEqual(['agent-1', 'agent-2'])
    })

    it('should remove specific agent by removeAgentId', () => {
      useUIStore.getState().toggleAgentId('agent-1')
      useUIStore.getState().toggleAgentId('agent-2')
      useUIStore.getState().removeAgentId('agent-1')
      expect(useUIStore.getState().selectedAgentIds).toEqual(['agent-2'])
    })

    it('removeAgentId should be safe when ID is not present', () => {
      useUIStore.getState().removeAgentId('nonexistent')
      expect(useUIStore.getState().selectedAgentIds).toEqual([])
    })
  })

  // ── Static filter toggle ──────────────────────────────────

  describe('static filter toggle', () => {
    it('should add a static filter', () => {
      useUIStore.getState().toggleStaticFilter('Tools')
      expect(useUIStore.getState().activeStaticFilters).toEqual(['Tools'])
    })

    it('should remove a static filter on second toggle', () => {
      useUIStore.getState().toggleStaticFilter('Tools')
      useUIStore.getState().toggleStaticFilter('Tools')
      expect(useUIStore.getState().activeStaticFilters).toEqual([])
    })

    it('should support multiple static filters simultaneously', () => {
      useUIStore.getState().toggleStaticFilter('Tools')
      useUIStore.getState().toggleStaticFilter('Prompts')
      expect(useUIStore.getState().activeStaticFilters).toContain('Tools')
      expect(useUIStore.getState().activeStaticFilters).toContain('Prompts')
    })
  })

  // ── Tool filter toggle ────────────────────────────────────

  describe('tool filter toggle', () => {
    it('should add a tool filter', () => {
      useUIStore.getState().toggleToolFilter('Bash')
      expect(useUIStore.getState().activeToolFilters).toEqual(['Bash'])
    })

    it('should remove a tool filter on second toggle', () => {
      useUIStore.getState().toggleToolFilter('Bash')
      useUIStore.getState().toggleToolFilter('Bash')
      expect(useUIStore.getState().activeToolFilters).toEqual([])
    })
  })

  // ── Clear all filters ─────────────────────────────────────

  describe('clearAllFilters', () => {
    it('should clear both static and tool filters', () => {
      useUIStore.getState().toggleStaticFilter('Tools')
      useUIStore.getState().toggleStaticFilter('Prompts')
      useUIStore.getState().toggleToolFilter('Bash')
      useUIStore.getState().toggleToolFilter('Read')

      useUIStore.getState().clearAllFilters()
      expect(useUIStore.getState().activeStaticFilters).toEqual([])
      expect(useUIStore.getState().activeToolFilters).toEqual([])
    })

    it('should not clear search query', () => {
      useUIStore.getState().setSearchQuery('test')
      useUIStore.getState().toggleStaticFilter('Tools')
      useUIStore.getState().clearAllFilters()
      expect(useUIStore.getState().searchQuery).toBe('test')
    })
  })

  // ── Event expansion ───────────────────────────────────────

  describe('event expansion', () => {
    it('should expand an event on toggle', () => {
      useUIStore.getState().toggleExpandedEvent(1)
      expect(useUIStore.getState().expandedEventIds.has(1)).toBe(true)
    })

    it('should collapse an event on second toggle', () => {
      useUIStore.getState().toggleExpandedEvent(1)
      useUIStore.getState().toggleExpandedEvent(1)
      expect(useUIStore.getState().expandedEventIds.has(1)).toBe(false)
    })

    it('should disable auto-follow when expanding an event', () => {
      expect(useUIStore.getState().autoFollow).toBe(true)
      useUIStore.getState().toggleExpandedEvent(1)
      expect(useUIStore.getState().autoFollow).toBe(false)
    })

    it('should not disable auto-follow when collapsing an event', () => {
      useUIStore.getState().toggleExpandedEvent(1)
      useUIStore.getState().setAutoFollow(true)
      useUIStore.getState().toggleExpandedEvent(1) // collapse
      expect(useUIStore.getState().autoFollow).toBe(true)
    })

    it('collapseAllEvents should clear all expanded events', () => {
      useUIStore.getState().toggleExpandedEvent(1)
      useUIStore.getState().toggleExpandedEvent(2)
      useUIStore.getState().toggleExpandedEvent(3)
      useUIStore.getState().collapseAllEvents()
      expect(useUIStore.getState().expandedEventIds.size).toBe(0)
    })

    it('expandAllEvents should set exactly the provided IDs', () => {
      useUIStore.getState().expandAllEvents([10, 20, 30])
      const ids = useUIStore.getState().expandedEventIds
      expect(ids.size).toBe(3)
      expect(ids.has(10)).toBe(true)
      expect(ids.has(20)).toBe(true)
      expect(ids.has(30)).toBe(true)
    })

    it('expandAllEvents should disable auto-follow', () => {
      useUIStore.getState().expandAllEvents([1])
      expect(useUIStore.getState().autoFollow).toBe(false)
    })

    it('requestExpandAll should increment expandAllCounter', () => {
      const before = useUIStore.getState().expandAllCounter
      useUIStore.getState().requestExpandAll()
      expect(useUIStore.getState().expandAllCounter).toBe(before + 1)
    })

    it('requestExpandAll should disable auto-follow', () => {
      useUIStore.getState().requestExpandAll()
      expect(useUIStore.getState().autoFollow).toBe(false)
    })
  })

  // ── Auto-follow ───────────────────────────────────────────

  describe('auto-follow', () => {
    it('should default to true', () => {
      expect(useUIStore.getState().autoFollow).toBe(true)
    })

    it('should be togglable', () => {
      useUIStore.getState().setAutoFollow(false)
      expect(useUIStore.getState().autoFollow).toBe(false)
      useUIStore.getState().setAutoFollow(true)
      expect(useUIStore.getState().autoFollow).toBe(true)
    })
  })

  // ── Sidebar collapsed state ───────────────────────────────

  describe('sidebar collapsed state', () => {
    it('should default to not collapsed', () => {
      expect(useUIStore.getState().sidebarCollapsed).toBe(false)
    })

    it('should toggle collapsed state', () => {
      useUIStore.getState().setSidebarCollapsed(true)
      expect(useUIStore.getState().sidebarCollapsed).toBe(true)
      useUIStore.getState().setSidebarCollapsed(false)
      expect(useUIStore.getState().sidebarCollapsed).toBe(false)
    })

    it('should persist sidebar width', () => {
      useUIStore.getState().setSidebarWidth(320)
      expect(useUIStore.getState().sidebarWidth).toBe(320)
    })
  })

  // ── Sidebar Projects/Labels tab switcher ──────────────────

  describe('sidebar Projects/Labels tab', () => {
    beforeEach(() => {
      localStorage.removeItem('agents-observe-sidebar-tab')
      useUIStore.setState({ sidebarTab: 'projects' })
    })

    it('defaults to "projects"', () => {
      expect(useUIStore.getState().sidebarTab).toBe('projects')
    })

    it('setSidebarTab updates state', () => {
      useUIStore.getState().setSidebarTab('labels')
      expect(useUIStore.getState().sidebarTab).toBe('labels')
      useUIStore.getState().setSidebarTab('projects')
      expect(useUIStore.getState().sidebarTab).toBe('projects')
    })

    it('setSidebarTab persists to localStorage', () => {
      useUIStore.getState().setSidebarTab('labels')
      expect(localStorage.getItem('agents-observe-sidebar-tab')).toBe('labels')
      useUIStore.getState().setSidebarTab('projects')
      expect(localStorage.getItem('agents-observe-sidebar-tab')).toBe('projects')
    })
  })

  // ── Selected event ────────────────────────────────────────

  describe('selected event', () => {
    it('should default to null', () => {
      expect(useUIStore.getState().selectedEventId).toBeNull()
    })

    it('should select and deselect event', () => {
      useUIStore.getState().setSelectedEventId(42)
      expect(useUIStore.getState().selectedEventId).toBe(42)
      useUIStore.getState().setSelectedEventId(null)
      expect(useUIStore.getState().selectedEventId).toBeNull()
    })
  })

  // ── Timeline ──────────────────────────────────────────────

  describe('timeline settings', () => {
    it('should set time range', () => {
      useUIStore.getState().setTimeRange('10m')
      expect(useUIStore.getState().timeRange).toBe('10m')
    })

    it('should set timeline height', () => {
      useUIStore.getState().setTimelineHeight(200)
      expect(useUIStore.getState().timelineHeight).toBe(200)
    })
  })

  // ── Icon customization version ────────────────────────────

  describe('icon customization version', () => {
    it('should increment version', () => {
      const before = useUIStore.getState().iconCustomizationVersion
      useUIStore.getState().bumpIconCustomizationVersion()
      expect(useUIStore.getState().iconCustomizationVersion).toBe(before + 1)
    })
  })

  // ── Rewind mode ────────────────────────────────────────────

  describe('rewind mode', () => {
    it('should enter rewind mode and snapshot events', () => {
      const events = [makeEvent(1), makeEvent(2), makeEvent(3)]
      useUIStore.getState().enterRewindMode(events)
      const state = useUIStore.getState()
      expect(state.rewindMode).toBe(true)
      expect(state.frozenEvents).toEqual(events)
    })

    it('should disable autoFollow on enter and restore on exit', () => {
      useUIStore.setState({ autoFollow: true })
      useUIStore.getState().enterRewindMode([])
      expect(useUIStore.getState().autoFollow).toBe(false)
      expect(useUIStore.getState().autoFollowBeforeRewind).toBe(true)

      useUIStore.getState().exitRewindMode()
      expect(useUIStore.getState().autoFollow).toBe(true)
      expect(useUIStore.getState().rewindMode).toBe(false)
      expect(useUIStore.getState().frozenEvents).toBeNull()
    })

    it('should preserve autoFollow=false across rewind', () => {
      useUIStore.setState({ autoFollow: false })
      useUIStore.getState().enterRewindMode([])
      expect(useUIStore.getState().autoFollow).toBe(false)

      useUIStore.getState().exitRewindMode()
      expect(useUIStore.getState().autoFollow).toBe(false)
    })

    it('should auto-exit rewind when switching to a different session', () => {
      useUIStore.getState().setSelectedSessionId('sess-a')
      useUIStore.getState().enterRewindMode([makeEvent(1)])
      expect(useUIStore.getState().rewindMode).toBe(true)

      useUIStore.getState().setSelectedSessionId('sess-b')
      expect(useUIStore.getState().rewindMode).toBe(false)
      expect(useUIStore.getState().frozenEvents).toBeNull()
    })

    it('should NOT exit rewind when setting the same session id', () => {
      useUIStore.getState().setSelectedSessionId('sess-a')
      useUIStore.getState().enterRewindMode([makeEvent(1)])
      useUIStore.getState().setSelectedSessionId('sess-a')
      expect(useUIStore.getState().rewindMode).toBe(true)
    })

    it('should exit rewind when clearing selected session', () => {
      useUIStore.getState().setSelectedSessionId('sess-a')
      useUIStore.getState().enterRewindMode([makeEvent(1)])
      useUIStore.getState().setSelectedSessionId(null)
      expect(useUIStore.getState().rewindMode).toBe(false)
    })
  })

  describe('labels', () => {
    beforeEach(() => {
      localStorage.removeItem('agents-observe-labels')
      localStorage.removeItem('agents-observe-label-memberships')
      useUIStore.setState({
        labels: [],
        labelMemberships: new Map(),
        settingsOpen: false,
        settingsTab: 'settings',
        labelsModalScrollToId: null,
      })
    })

    it('creates a label with trimmed name', () => {
      const label = useUIStore.getState().createLabel('  bugs  ')
      expect(label?.name).toBe('bugs')
      expect(useUIStore.getState().labels).toHaveLength(1)
    })

    it('rejects empty label names', () => {
      expect(useUIStore.getState().createLabel('   ')).toBeNull()
      expect(useUIStore.getState().labels).toHaveLength(0)
    })

    it('rejects case-insensitive duplicate label names', () => {
      useUIStore.getState().createLabel('Bugs')
      expect(useUIStore.getState().createLabel('bugs')).toBeNull()
      expect(useUIStore.getState().createLabel('BUGS')).toBeNull()
      expect(useUIStore.getState().labels).toHaveLength(1)
    })

    it('persists labels to localStorage', () => {
      useUIStore.getState().createLabel('auth')
      const raw = localStorage.getItem('agents-observe-labels')
      expect(raw).toBeTruthy()
      const parsed = JSON.parse(raw!) as { name: string }[]
      expect(parsed[0].name).toBe('auth')
    })

    it('toggles session membership and persists', () => {
      const label = useUIStore.getState().createLabel('auth')!
      useUIStore.getState().toggleSessionLabel(label.id, 'sess-1')
      expect(useUIStore.getState().getLabelsForSession('sess-1')).toHaveLength(1)
      useUIStore.getState().toggleSessionLabel(label.id, 'sess-1')
      expect(useUIStore.getState().getLabelsForSession('sess-1')).toHaveLength(0)

      useUIStore.getState().toggleSessionLabel(label.id, 'sess-2')
      const raw = localStorage.getItem('agents-observe-label-memberships')
      expect(raw).toBeTruthy()
      const parsed = JSON.parse(raw!) as Record<string, string[]>
      expect(parsed[label.id]).toEqual(['sess-2'])
    })

    it('renames a label and rejects case-insensitive collisions', () => {
      const a = useUIStore.getState().createLabel('auth')!
      useUIStore.getState().createLabel('bugs')
      expect(useUIStore.getState().renameLabel(a.id, 'Bugs')).toBe(false)
      expect(useUIStore.getState().renameLabel(a.id, 'Auth v2')).toBe(true)
      expect(useUIStore.getState().labels.find((l) => l.id === a.id)?.name).toBe('Auth v2')
    })

    it('deletes a label and removes its memberships', () => {
      const a = useUIStore.getState().createLabel('auth')!
      useUIStore.getState().toggleSessionLabel(a.id, 'sess-1')
      useUIStore.getState().deleteLabel(a.id)
      expect(useUIStore.getState().labels).toHaveLength(0)
      expect(useUIStore.getState().labelMemberships.get(a.id)).toBeUndefined()
      expect(useUIStore.getState().getLabelsForSession('sess-1')).toHaveLength(0)
    })

    it('getLabelsForSession returns labels a session belongs to', () => {
      const a = useUIStore.getState().createLabel('auth')!
      const b = useUIStore.getState().createLabel('bugs')!
      useUIStore.getState().toggleSessionLabel(a.id, 'sess-1')
      useUIStore.getState().toggleSessionLabel(b.id, 'sess-1')
      useUIStore.getState().toggleSessionLabel(a.id, 'sess-2')
      const forOne = useUIStore.getState().getLabelsForSession('sess-1')
      expect(forOne.map((l) => l.name).sort()).toEqual(['auth', 'bugs'])
      const forTwo = useUIStore.getState().getLabelsForSession('sess-2')
      expect(forTwo.map((l) => l.name)).toEqual(['auth'])
    })

    it('opens and closes the labels tab via the settings modal', () => {
      // Labels live inside the Settings modal now; openLabelsModal
      // switches the settings tab + opens the modal, closeLabelsModal
      // drops the user out of Settings.
      expect(useUIStore.getState().settingsOpen).toBe(false)
      useUIStore.getState().openLabelsModal()
      expect(useUIStore.getState().settingsOpen).toBe(true)
      expect(useUIStore.getState().settingsTab).toBe('labels')
      useUIStore.getState().closeLabelsModal()
      expect(useUIStore.getState().settingsOpen).toBe(false)
    })

    it('openLabelsModal carries an optional scroll-to target', () => {
      useUIStore.getState().openLabelsModal('label-42')
      expect(useUIStore.getState().labelsModalScrollToId).toBe('label-42')
      useUIStore.getState().clearLabelsModalScrollTarget()
      expect(useUIStore.getState().labelsModalScrollToId).toBeNull()
    })
  })
})
