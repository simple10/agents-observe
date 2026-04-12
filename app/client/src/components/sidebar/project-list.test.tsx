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
    eventCount: 5,
    ...overrides,
  }
}

beforeEach(() => {
  mockProjects.length = 0
  mockSessions.length = 0
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
