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

  it('writes a session-only URL when there is no project', () => {
    useUIStore.getState().openSession(null, null, 'sess-2')
    expect(window.location.hash).toBe('#/sess-2')
    expect(useUIStore.getState().selectedProjectId).toBeNull()
    expect(useUIStore.getState().selectedSessionId).toBe('sess-2')
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
