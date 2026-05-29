import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, act } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { MainPanel } from './main-panel'
import { useUIStore } from '@/stores/ui-store'

// Mock child components to isolate routing logic.
// We verify which component gets rendered based on UI store state.

vi.mock('./home-page', () => ({
  HomePage: () => <div data-testid="home-page">HomePage</div>,
}))

vi.mock('./project-page', () => ({
  ProjectPage: () => <div data-testid="project-page">ProjectPage</div>,
}))

vi.mock('./scope-bar', () => ({
  ScopeBar: () => <div data-testid="scope-bar">ScopeBar</div>,
}))

vi.mock('./event-filter-bar', () => ({
  EventFilterBar: () => <div data-testid="event-filter-bar">EventFilterBar</div>,
}))

vi.mock('@/components/timeline/activity-timeline', () => ({
  ActivityTimeline: () => <div data-testid="activity-timeline">ActivityTimeline</div>,
}))

vi.mock('@/components/event-stream/event-stream', () => ({
  EventStream: () => <div data-testid="event-stream">EventStream</div>,
}))

beforeEach(() => {
  useUIStore.setState({
    selectedProjectId: null,
    selectedProjectSlug: null,
    selectedSessionId: null,
    selectedAgentIds: [],
    activePrimaryFilters: [],
    activeSecondaryFilters: [],
    searchQuery: '',
    sessionFilterStates: new Map(),
  })
})

describe('MainPanel routing', () => {
  it('should render HomePage when no project is selected', () => {
    renderWithProviders(<MainPanel />)

    expect(screen.getByTestId('home-page')).toBeInTheDocument()
    expect(screen.queryByTestId('project-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('scope-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('event-stream')).not.toBeInTheDocument()
  })

  it('should render ProjectPage when project is selected but no session', () => {
    useUIStore.setState({ selectedProjectId: 1 })

    renderWithProviders(<MainPanel />)

    expect(screen.getByTestId('project-page')).toBeInTheDocument()
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('scope-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('event-stream')).not.toBeInTheDocument()
  })

  it('should render full session view when project and session are selected', () => {
    useUIStore.setState({
      selectedProjectId: 1,
      selectedSessionId: 'sess-1',
    })

    renderWithProviders(<MainPanel />)

    expect(screen.getByTestId('scope-bar')).toBeInTheDocument()
    expect(screen.getByTestId('event-filter-bar')).toBeInTheDocument()
    expect(screen.getByTestId('activity-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('event-stream')).toBeInTheDocument()
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('project-page')).not.toBeInTheDocument()
  })

  // Regression guard: direct session navigation (skills `/observe view` &
  // `/observe stats`, and any unassigned session) uses `#/<sessionId>` with no
  // project slug, so `selectedProjectId` is null. The session view MUST still
  // render — it must never blank out or fall back to HomePage.
  it('renders the session view for a session-only route with no project (skills + unassigned)', () => {
    useUIStore.setState({
      selectedProjectId: null,
      selectedProjectSlug: null,
      selectedSessionId: 'befdb994-7a98-42b5-88e2-8cc09c34d0a3',
    })

    renderWithProviders(<MainPanel />)

    expect(screen.getByTestId('scope-bar')).toBeInTheDocument()
    expect(screen.getByTestId('event-stream')).toBeInTheDocument()
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('project-page')).not.toBeInTheDocument()
  })

  it('renders a blank panel (not HomePage) while a bare project slug is still resolving', () => {
    // slug present, id not yet resolved, no session → don't flash HomePage.
    useUIStore.setState({
      selectedProjectId: null,
      selectedProjectSlug: 'agents-observe',
      selectedSessionId: null,
    })

    renderWithProviders(<MainPanel />)

    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('project-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('scope-bar')).not.toBeInTheDocument()
  })

  it('should transition from session view back to ProjectPage when session is deselected', () => {
    useUIStore.setState({
      selectedProjectId: 1,
      selectedSessionId: 'sess-1',
    })

    const { rerender } = renderWithProviders(<MainPanel />)
    expect(screen.getByTestId('scope-bar')).toBeInTheDocument()

    // Deselect session
    act(() => {
      useUIStore.setState({ selectedSessionId: null })
    })
    rerender(<MainPanel />)

    expect(screen.getByTestId('project-page')).toBeInTheDocument()
    expect(screen.queryByTestId('scope-bar')).not.toBeInTheDocument()
  })

  it('should transition from ProjectPage to HomePage when project is deselected', () => {
    useUIStore.setState({ selectedProjectId: 1 })

    const { rerender } = renderWithProviders(<MainPanel />)
    expect(screen.getByTestId('project-page')).toBeInTheDocument()

    // Deselect project
    act(() => {
      useUIStore.setState({ selectedProjectId: null })
    })
    rerender(<MainPanel />)

    expect(screen.getByTestId('home-page')).toBeInTheDocument()
    expect(screen.queryByTestId('project-page')).not.toBeInTheDocument()
  })
})
