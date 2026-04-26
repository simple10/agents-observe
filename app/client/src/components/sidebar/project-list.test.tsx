import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { ProjectList } from './project-list'
import { useUIStore } from '@/stores/ui-store'
import type { Session, Project } from '@/types'

// Polyfill ResizeObserver for Radix UI Tooltip in jsdom
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

// ── Mock data ──────────────────────────────────────────────

const mockProjects: Project[] = []
const mockSessions: Session[] = []

vi.mock('@/hooks/use-projects', () => ({
  useProjects: () => ({ data: mockProjects }),
}))

vi.mock('@/hooks/use-sessions', () => ({
  useSessions: () => ({ data: mockSessions }),
}))

const mockUnassignedSessions: Session[] = []
vi.mock('@/hooks/use-unassigned-sessions', () => ({
  useUnassignedSessions: () => mockUnassignedSessions,
}))

function setMockUnassignedSessions(sessions: Session[]) {
  mockUnassignedSessions.length = 0
  mockUnassignedSessions.push(...sessions)
}

const mockUpdateSessionSlug = vi.fn((_id: string, _slug: string) => Promise.resolve({ ok: true }))
const mockRenameProject = vi.fn((_id: number, _name: string) => Promise.resolve({ ok: true }))

vi.mock('@/lib/api-client', () => ({
  api: {
    updateSessionSlug: (id: string, slug: string) => mockUpdateSessionSlug(id, slug),
    renameProject: (id: number, name: string) => mockRenameProject(id, name),
    getProjects: vi.fn(() => Promise.resolve([])),
    getSessions: vi.fn(() => Promise.resolve([])),
  },
}))

function setMockProjects(projects: Project[]) {
  mockProjects.length = 0
  mockProjects.push(...projects)
}

function setMockSessions(sessions: Session[]) {
  mockSessions.length = 0
  mockSessions.push(...sessions)
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    projectId: 1,
    slug: 'my-session',
    status: 'active',
    startedAt: Date.now() - 60000,
    stoppedAt: null,
    metadata: null,
    lastActivity: null,
    agentClasses: [],
    ...overrides,
  }
}

beforeEach(() => {
  mockProjects.length = 0
  mockSessions.length = 0
  mockUnassignedSessions.length = 0
  mockUpdateSessionSlug.mockClear()
  mockRenameProject.mockClear()

  setMockProjects([
    { id: 1, slug: 'test-project', name: 'Test Project', createdAt: Date.now(), sessionCount: 1 },
  ])

  setMockSessions([makeSession()])

  useUIStore.setState({
    selectedProjectId: 1,
    selectedSessionId: null,
    sidebarCollapsed: false,
  })
})

describe('ProjectList - Session edit', () => {
  it('should render a pencil edit icon on session items', () => {
    renderWithProviders(<ProjectList collapsed={false} />)

    const editIcon = screen.getByTestId('edit-session-sess-1')
    expect(editIcon).toBeInTheDocument()
  })

  it('should open the session edit modal when pencil icon is clicked', () => {
    renderWithProviders(<ProjectList collapsed={false} />)

    const editIcon = screen.getByTestId('edit-session-sess-1')
    fireEvent.click(editIcon)

    expect(useUIStore.getState().editingSessionId).toBe('sess-1')
  })

  it('should not trigger session selection when clicking the pencil icon', () => {
    renderWithProviders(<ProjectList collapsed={false} />)

    const editIcon = screen.getByTestId('edit-session-sess-1')
    fireEvent.click(editIcon)

    // Should not have selected the session (it was null before)
    const state = useUIStore.getState()
    expect(state.selectedSessionId).toBeNull()
  })
})

describe('ProjectList - Project edit modal', () => {
  it('should render a pencil edit icon on project items', () => {
    renderWithProviders(<ProjectList collapsed={false} />)

    const editIcon = screen.getByTestId('edit-project-1')
    expect(editIcon).toBeInTheDocument()
  })

  it('should display project name', () => {
    setMockProjects([
      { id: 1, slug: 'test-project', name: 'Test Project', createdAt: Date.now(), sessionCount: 1 },
    ])

    renderWithProviders(<ProjectList collapsed={false} />)

    expect(screen.getByText('Test Project')).toBeInTheDocument()
  })

  it('should open project modal when pencil icon is clicked', async () => {
    renderWithProviders(<ProjectList collapsed={false} />)

    const editIcon = screen.getByTestId('edit-project-1')
    fireEvent.click(editIcon)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('should not toggle project expand/collapse when clicking the pencil icon', () => {
    // Project is already expanded (selectedProjectId = 1)
    renderWithProviders(<ProjectList collapsed={false} />)

    const editIcon = screen.getByTestId('edit-project-1')
    fireEvent.click(editIcon)

    // Should still be expanded (selectedProjectId should not have changed)
    const state = useUIStore.getState()
    expect(state.selectedProjectId).toBe(1)
  })
})

describe('ProjectList - Unassigned bucket', () => {
  it('does not render the Unassigned bucket when there are no null-project sessions', () => {
    setMockProjects([
      { id: 1, slug: 'p', name: 'P', createdAt: Date.now(), sessionCount: 0 },
    ])
    setMockUnassignedSessions([])
    renderWithProviders(<ProjectList collapsed={false} />)
    expect(screen.queryByTestId('unassigned-bucket')).not.toBeInTheDocument()
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument()
  })

  it('renders the Unassigned bucket when at least one null-project session exists', () => {
    setMockProjects([
      { id: 1, slug: 'p', name: 'P', createdAt: Date.now(), sessionCount: 0 },
    ])
    setMockUnassignedSessions([
      makeSession({ id: 'sess-orphan-1', projectId: null, slug: 'orphan-1' }),
    ])
    renderWithProviders(<ProjectList collapsed={false} />)
    expect(screen.getByTestId('unassigned-bucket')).toBeInTheDocument()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
    // Session is rendered inside (default expanded)
    expect(screen.getByText('orphan-1')).toBeInTheDocument()
  })

  it('renders even when there are zero real projects (only unassigned sessions exist)', () => {
    setMockProjects([])
    setMockUnassignedSessions([
      makeSession({ id: 'sess-orphan-1', projectId: null, slug: 'orphan-1' }),
    ])
    renderWithProviders(<ProjectList collapsed={false} />)
    expect(screen.getByTestId('unassigned-bucket')).toBeInTheDocument()
  })

  it('toggles collapse/expand when the bucket header is clicked', () => {
    setMockProjects([
      { id: 1, slug: 'p', name: 'P', createdAt: Date.now(), sessionCount: 0 },
    ])
    setMockUnassignedSessions([
      makeSession({ id: 'sess-orphan-1', projectId: null, slug: 'orphan-1' }),
    ])
    renderWithProviders(<ProjectList collapsed={false} />)
    // Default expanded — session is visible
    expect(screen.getByText('orphan-1')).toBeInTheDocument()
    // Click the bucket header to collapse
    const bucket = screen.getByTestId('unassigned-bucket')
    const header = bucket.querySelector('[role="button"]') as HTMLElement
    fireEvent.click(header)
    expect(screen.queryByText('orphan-1')).not.toBeInTheDocument()
    // Click again to re-expand
    fireEvent.click(header)
    expect(screen.getByText('orphan-1')).toBeInTheDocument()
  })

  it('opens the SessionEditModal when the pencil icon on an unassigned session is clicked', () => {
    setMockProjects([
      { id: 1, slug: 'p', name: 'P', createdAt: Date.now(), sessionCount: 0 },
    ])
    setMockUnassignedSessions([
      makeSession({ id: 'sess-orphan-1', projectId: null, slug: 'orphan-1' }),
    ])
    renderWithProviders(<ProjectList collapsed={false} />)
    const editIcon = screen.getByTestId('edit-session-sess-orphan-1')
    fireEvent.click(editIcon)
    expect(useUIStore.getState().editingSessionId).toBe('sess-orphan-1')
  })
})
