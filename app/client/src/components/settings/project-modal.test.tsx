import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { ProjectModal } from './project-modal'
import type { Project, Session } from '@/types'

// Polyfill for Radix UI in jsdom
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

// ── Mock data ──────────────────────────────────────────────

const { mockSessions, mockProjects, mockMoveSession, mockDeleteSession, mockUpdateSessionSlug } =
  vi.hoisted(() => ({
    mockSessions: [] as Session[],
    mockProjects: [] as Project[],
    mockMoveSession: vi.fn(() => Promise.resolve({ ok: true })),
    mockDeleteSession: vi.fn(() => Promise.resolve({ ok: true })),
    mockUpdateSessionSlug: vi.fn(() => Promise.resolve({ ok: true })),
  }))

vi.mock('@/lib/api-client', () => ({
  api: {
    getSessions: () => Promise.resolve(mockSessions),
    getProjects: () => Promise.resolve(mockProjects),
    moveSession: mockMoveSession,
    deleteSession: mockDeleteSession,
    updateSessionSlug: mockUpdateSessionSlug,
    renameProject: vi.fn(() => Promise.resolve({ ok: true })),
    deleteProject: vi.fn(() => Promise.resolve({ ok: true })),
  },
}))

vi.mock('@/hooks/use-projects', () => ({
  useProjects: () => ({ data: mockProjects }),
}))

const project: Project = {
  id: 1,
  slug: 'test-project',
  name: 'Test Project',
  createdAt: Date.now(),
  sessionCount: 2,
}

const otherProject: Project = {
  id: 2,
  slug: 'other-project',
  name: 'Other Project',
  createdAt: Date.now(),
  sessionCount: 5,
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
  mockSessions.length = 0
  mockProjects.length = 0
  mockMoveSession.mockClear()
  mockDeleteSession.mockClear()
  mockUpdateSessionSlug.mockClear()

  mockSessions.push(
    makeSession({ id: 'sess-1', slug: 'session-one' }),
    makeSession({ id: 'sess-2', slug: 'session-two' }),
  )
  mockProjects.push(project, otherProject)
})

function renderModal() {
  return renderWithProviders(<ProjectModal project={project} open={true} onOpenChange={() => {}} />)
}

describe('ProjectModal - Move session', () => {
  it('should show move icon on session rows', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('session-one')).toBeInTheDocument()
    })

    const moveButtons = screen.getAllByTitle('Move to project')
    expect(moveButtons.length).toBe(2)
  })

  it('should open move modal when move icon is clicked', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('session-one')).toBeInTheDocument()
    })

    const moveButtons = screen.getAllByTitle('Move to project')
    fireEvent.click(moveButtons[0])

    await waitFor(() => {
      expect(screen.getByText('Move 1 session to...')).toBeInTheDocument()
    })
  })

  it('should show other projects in the move modal', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('session-one')).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByTitle('Move to project')[0])

    await waitFor(() => {
      expect(screen.getByText('Other Project')).toBeInTheDocument()
    })

    // Should not show the current project
    const moveDialog = screen
      .getByText('Move 1 session to...')
      .closest('[role="dialog"]') as HTMLElement
    expect(within(moveDialog).queryByText('Test Project')).not.toBeInTheDocument()
  })

  it('should move single session without confirmation', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('session-one')).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByTitle('Move to project')[0])

    await waitFor(() => {
      expect(screen.getByText('Other Project')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Other Project'))

    await waitFor(() => {
      expect(mockMoveSession).toHaveBeenCalledWith('sess-1', 2)
    })
  })

  it('should show confirmation for multi-select move', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('session-one')).toBeInTheDocument()
    })

    // Select both sessions via the select-all checkbox
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0]) // select all

    // Click "Move selected"
    await waitFor(() => {
      expect(screen.getByText('Move selected')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Move selected'))

    // Pick a project
    await waitFor(() => {
      expect(screen.getByText('Other Project')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Other Project'))

    // Should show confirmation dialog (alertdialog role)
    await waitFor(() => {
      const alertDialog = screen.getByRole('alertdialog')
      expect(within(alertDialog).getByText(/Move 2 sessions to/)).toBeInTheDocument()
    })
  })

  it('should move multiple sessions after confirmation', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('session-one')).toBeInTheDocument()
    })

    // Select all
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])

    await waitFor(() => {
      expect(screen.getByText('Move selected')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Move selected'))

    await waitFor(() => {
      expect(screen.getByText('Other Project')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Other Project'))

    // Confirm the move
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))

    await waitFor(() => {
      expect(mockMoveSession).toHaveBeenCalledTimes(2)
      expect(mockMoveSession).toHaveBeenCalledWith('sess-1', 2)
      expect(mockMoveSession).toHaveBeenCalledWith('sess-2', 2)
    })
  })
})

describe('ProjectModal - Session rename', () => {
  it('should show rename icon on session rows', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('session-one')).toBeInTheDocument()
    })

    const renameButtons = screen.getAllByTitle('Rename')
    expect(renameButtons.length).toBe(2)
  })

  it('should enter edit mode and save on check click', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('session-one')).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByTitle('Rename')[0])

    const input = screen.getByDisplayValue('session-one')
    expect(input).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'renamed' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(mockUpdateSessionSlug).toHaveBeenCalledWith('sess-1', 'renamed')
    })
  })

  it('should cancel edit on Escape without saving', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('session-one')).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByTitle('Rename')[0])

    const input = screen.getByDisplayValue('session-one')
    fireEvent.change(input, { target: { value: 'renamed' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByDisplayValue('renamed')).not.toBeInTheDocument()
    expect(mockUpdateSessionSlug).not.toHaveBeenCalled()
  })
})
