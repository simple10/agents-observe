import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { SessionItem } from './session-item'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Session } from '@/types'

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    projectId: 1,
    slug: 'my-session',
    status: 'active',
    startedAt: Date.now() - 60_000,
    stoppedAt: null,
    metadata: null,
    agentCount: 1,
    eventCount: 5,
    lastActivity: null,
    agentClasses: [],
    ...overrides,
  }
}

function renderItem(session: Session) {
  return renderWithProviders(
    <TooltipProvider>
      <SessionItem
        session={session}
        isSelected={false}
        isPinned={false}
        onSelect={() => {}}
        onTogglePin={() => {}}
        onRename={async () => {}}
      />
    </TooltipProvider>,
  )
}

describe('SessionItem tooltip — agent classes', () => {
  it('omits the "Agents:" line when agentClasses is empty', async () => {
    renderItem(makeSession({ agentClasses: [] }))
    await userEvent.hover(screen.getAllByText('my-session')[0])
    // Wait a tick for the tooltip to appear
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/Agents:/)).not.toBeInTheDocument()
  })

  it('shows agent class display names joined by commas', async () => {
    renderItem(makeSession({ agentClasses: ['claude-code', 'codex'] }))
    await userEvent.hover(screen.getAllByText('my-session')[0])
    await new Promise((r) => setTimeout(r, 50))

    // "Agents:" label rendered
    const agentsLabel = await screen.findAllByText(/Agents:/)
    expect(agentsLabel.length).toBeGreaterThan(0)

    // Class display names appear (with trailing comma on all but last)
    const claudeNodes = await screen.findAllByText(/^claude,$/)
    expect(claudeNodes.length).toBeGreaterThan(0)
    const codexNodes = await screen.findAllByText(/^codex$/)
    expect(codexNodes.length).toBeGreaterThan(0)
  })

  it('shows a single class without a trailing comma', async () => {
    renderItem(makeSession({ agentClasses: ['codex'] }))
    await userEvent.hover(screen.getAllByText('my-session')[0])
    await new Promise((r) => setTimeout(r, 50))

    const codexNodes = await screen.findAllByText(/^codex$/)
    expect(codexNodes.length).toBeGreaterThan(0)
    // No "codex," with trailing comma
    expect(screen.queryByText(/^codex,$/)).not.toBeInTheDocument()
  })
})

describe('SessionItem accessibility', () => {
  it('renders the outer container as a focusable button', () => {
    renderItem(makeSession())
    const container = screen.getAllByText('my-session')[0].closest('[role="button"]')
    expect(container).not.toBeNull()
    expect(container).toHaveAttribute('tabindex', '0')
    expect(container).toHaveAttribute('data-sidebar-item')
  })

  it('sets aria-current="true" when isSelected', () => {
    renderWithProviders(
      <TooltipProvider>
        <SessionItem
          session={makeSession()}
          isSelected={true}
          isPinned={false}
          onSelect={() => {}}
          onTogglePin={() => {}}
          onRename={async () => {}}
        />
      </TooltipProvider>,
    )
    const container = screen.getAllByText('my-session')[0].closest('[role="button"]')
    expect(container).toHaveAttribute('aria-current', 'true')
  })

  it('omits aria-current when not selected', () => {
    renderItem(makeSession())
    const container = screen.getAllByText('my-session')[0].closest('[role="button"]')
    expect(container).not.toHaveAttribute('aria-current')
  })

  it('calls onSelect when Enter is pressed', async () => {
    const onSelect = vi.fn()
    renderWithProviders(
      <TooltipProvider>
        <SessionItem
          session={makeSession()}
          isSelected={false}
          isPinned={false}
          onSelect={onSelect}
          onTogglePin={() => {}}
          onRename={async () => {}}
        />
      </TooltipProvider>,
    )
    const container = screen.getAllByText('my-session')[0].closest('[role="button"]') as HTMLElement
    container.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('calls onSelect when Space is pressed', async () => {
    const onSelect = vi.fn()
    renderWithProviders(
      <TooltipProvider>
        <SessionItem
          session={makeSession()}
          isSelected={false}
          isPinned={false}
          onSelect={onSelect}
          onTogglePin={() => {}}
          onRename={async () => {}}
        />
      </TooltipProvider>,
    )
    const container = screen.getAllByText('my-session')[0].closest('[role="button"]') as HTMLElement
    container.focus()
    await userEvent.keyboard(' ')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
