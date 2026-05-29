import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUIStore } from './ui-store'

// Simulate a browser back/forward landing on `hash` (fires the store's
// module-level hashchange listener).
function navigateTo(hash: string) {
  window.location.hash = hash
  window.dispatchEvent(new Event('hashchange'))
}

beforeEach(() => {
  useUIStore.setState({
    selectedProjectId: null,
    selectedProjectSlug: null,
    selectedSessionId: null,
    currentView: null,
  })
  window.history.replaceState(null, '', '#/')
})

describe('openSession', () => {
  it('sets project + session together as a single history entry', () => {
    const push = vi.spyOn(window.history, 'pushState')
    useUIStore.getState().openSession(7, 'alpha', 'sess-1')

    const s = useUIStore.getState()
    expect(s.selectedProjectId).toBe(7)
    expect(s.selectedProjectSlug).toBe('alpha')
    expect(s.selectedSessionId).toBe('sess-1')
    // The whole point of the fix: one pushState, not two.
    expect(push).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe('#/alpha/sess-1')
    push.mockRestore()
  })

  it('writes a placeholder-project URL when there is no project', () => {
    useUIStore.getState().openSession(null, null, 'sess-2')
    // Sessions always get a 2-segment URL; '_' stands in for the unknown
    // project, which useRouteSync resolves from the session id.
    expect(window.location.hash).toBe('#/_/sess-2')
    expect(useUIStore.getState().selectedProjectId).toBeNull()
    expect(useUIStore.getState().selectedSessionId).toBe('sess-2')
  })
})

describe('hash grammar (positional, encoded segments)', () => {
  // Force the next navigateTo to be a real parse, not a no-op against
  // already-correct state.
  function clearSelection() {
    useUIStore.setState({
      selectedProjectId: null,
      selectedProjectSlug: null,
      selectedSessionId: null,
      currentView: null,
    })
  }

  it('writes a 2-segment URL for a non-UUID session id', () => {
    useUIStore.getState().openSession(null, null, '20260529_124837_f0cebd')
    expect(window.location.hash).toBe('#/_/20260529_124837_f0cebd')
  })

  it('parses a non-UUID single-session URL as a session, not a project', () => {
    // The original UUID_RE bug: a non-UUID id got misread as a project slug.
    clearSelection()
    navigateTo('#/_/20260529_124837_f0cebd')
    const s = useUIStore.getState()
    expect(s.selectedSessionId).toBe('20260529_124837_f0cebd')
    expect(s.selectedProjectSlug).toBeNull()
  })

  it('encodes a colon-bearing project slug on write', () => {
    // Server slugs can look like `branch:prefix:agent`; the ':' must not be
    // confused with the view delimiter.
    useUIStore.getState().openSession(7, 'main:a1b2c3d4:claude', 'sess-1')
    expect(window.location.hash).toBe('#/main%3Aa1b2c3d4%3Aclaude/sess-1')
  })

  it('decodes a colon-bearing slug and keeps the view separable', () => {
    clearSelection()
    navigateTo('#/main%3Aa1%3Aclaude/sess-1:session.stats')
    const s = useUIStore.getState()
    expect(s.selectedProjectSlug).toBe('main:a1:claude')
    expect(s.selectedSessionId).toBe('sess-1')
    expect(s.currentView).toBe('session.stats')
  })

  it('treats a bare placeholder `#/_` as home', () => {
    useUIStore.setState({ selectedProjectSlug: 'stale', selectedSessionId: 'stale' })
    navigateTo('#/_')
    const s = useUIStore.getState()
    expect(s.selectedProjectSlug).toBeNull()
    expect(s.selectedSessionId).toBeNull()
  })
})

describe('back/forward reconciliation', () => {
  it('returns Home (clears the project) when the URL loses its project', () => {
    useUIStore.setState({
      selectedProjectId: 7,
      selectedProjectSlug: 'alpha',
      selectedSessionId: 'sess-1',
    })
    window.history.replaceState(null, '', '#/alpha/sess-1')

    navigateTo('#/') // browser Back to home

    const s = useUIStore.getState()
    expect(s.selectedProjectId).toBeNull()
    expect(s.selectedProjectSlug).toBeNull()
    expect(s.selectedSessionId).toBeNull()
  })

  it('keeps the project when Back lands on a project URL', () => {
    useUIStore.setState({
      selectedProjectId: 7,
      selectedProjectSlug: 'alpha',
      selectedSessionId: 'sess-1',
    })
    window.history.replaceState(null, '', '#/alpha/sess-1')

    navigateTo('#/alpha') // Back from session → project page

    const s = useUIStore.getState()
    expect(s.selectedProjectId).toBe(7) // project preserved
    expect(s.selectedSessionId).toBeNull() // session cleared
  })
})
