import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { useUIStore } from '@/stores/ui-store'
import { ConstellationView } from './constellation-view'
import type { RecentSession } from '@/types'

function session(id: string, over: Partial<RecentSession> = {}): RecentSession {
  return {
    id,
    projectId: 1,
    projectSlug: 'alpha',
    projectName: 'alpha',
    slug: id,
    status: 'active',
    startedAt: 0,
    stoppedAt: null,
    metadata: null,
    lastActivity: Date.now(),
    agentClasses: ['ClaudeCode'],
    eventCount: 100,
    agentCount: 3,
    ...over,
  }
}

afterEach(() => {
  cleanup()
  useUIStore.getState().clearPreviewSession()
})

describe('ConstellationView', () => {
  it('mounts and renders a star + well label per session/project without throwing', () => {
    renderWithProviders(
      <ConstellationView
        sessions={[
          session('swift-otter'),
          session('calm-harbor', { projectName: 'beta', projectId: 2 }),
        ]}
        isLoading={false}
        onOpenSession={() => {}}
      />,
    )
    expect(screen.getByText('swift-otter')).toBeTruthy()
    expect(screen.getByText('calm-harbor')).toBeTruthy()
    // project well labels
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.getByText('beta')).toBeTruthy()
    // palette control present
    expect(screen.getByText('Deep Space')).toBeTruthy()
  })

  it('shows an empty state when there are no sessions', () => {
    renderWithProviders(
      <ConstellationView sessions={[]} isLoading={false} onOpenSession={() => {}} />,
    )
    expect(screen.getByText(/No sessions yet/i)).toBeTruthy()
  })

  it('runs its animation frame without error', () => {
    // Fire exactly one frame: the loop re-schedules itself, so only invoke
    // the first callback (subsequent re-schedules are no-ops).
    let fired = false
    const raf = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        if (!fired) {
          fired = true
          cb(0)
        }
        return 0
      })
    expect(() =>
      renderWithProviders(
        <ConstellationView sessions={[session('a')]} isLoading={false} onOpenSession={() => {}} />,
      ),
    ).not.toThrow()
    raf.mockRestore()
  })

  it('sets the sidebar preview on focus and clears it on background click', () => {
    const { container } = renderWithProviders(
      <ConstellationView
        sessions={[session('swift-otter', { projectId: 7 })]}
        isLoading={false}
        onOpenSession={() => {}}
      />,
    )
    expect(useUIStore.getState().previewSessionId).toBeNull()

    // Click the star (the slug label lives inside the clickable star <g>).
    const star = screen.getByText('swift-otter').closest('g.cst-star')!
    fireEvent.click(star)
    expect(useUIStore.getState().previewSessionId).toBe('swift-otter')
    expect(useUIStore.getState().previewProjectId).toBe(7)

    // Clicking the empty background unfocuses and clears the preview.
    fireEvent.click(container.querySelector('svg')!)
    expect(useUIStore.getState().previewSessionId).toBeNull()
  })
})
