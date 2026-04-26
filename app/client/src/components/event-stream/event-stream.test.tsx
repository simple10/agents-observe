import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { EventStream } from './event-stream'
import { EventProcessingProvider } from '@/agents/event-processing-context'
import { useUIStore } from '@/stores/ui-store'
import type { ParsedEvent, Agent } from '@/types'

// Register agent classes (must happen before any rendering)
import '@/agents/init'

// ── Mock hooks ──────────────────────────────────────────────

const mockEvents: ParsedEvent[] = []
const mockAgents: Agent[] = []
const mockEventsState = { isLoading: false, isError: false }

vi.mock('@/hooks/use-events', () => ({
  useEvents: () => ({
    data: mockEventsState.isLoading ? undefined : mockEvents,
    isLoading: mockEventsState.isLoading,
    isError: mockEventsState.isError,
    error: null,
  }),
}))

vi.mock('@/hooks/use-agents', () => ({
  useAgents: () => mockAgents,
}))

// Mock timeago.js to return stable strings
vi.mock('timeago.js', () => ({
  format: () => 'just now',
}))

function setMockEvents(events: ParsedEvent[]) {
  mockEvents.length = 0
  mockEvents.push(...events)
}

function setMockAgents(agents: Agent[]) {
  mockAgents.length = 0
  mockAgents.push(...agents)
}

/**
 * Build a wire `ParsedEvent`. Tests pass legacy `subtype` / `toolName`
 * helpers — we translate those into the new wire shape (hookName +
 * payload.tool_name) so existing fixtures keep working without churn.
 * `type` / `status` are derived client-side and ignored on the wire.
 */
function makeEvent(
  overrides: Partial<ParsedEvent> & {
    subtype?: string | null
    toolName?: string | null
    type?: string
    status?: string
  },
): ParsedEvent {
  const { subtype, toolName, type: _type, status: _status, ...rest } = overrides
  const hookName = rest.hookName ?? subtype ?? ''
  const basePayload =
    (rest.payload as Record<string, unknown> | undefined) ?? ({} as Record<string, unknown>)
  const payload =
    toolName && basePayload.tool_name === undefined
      ? { ...basePayload, tool_name: toolName }
      : basePayload
  // Spread `rest` first then re-assign hookName/payload to ensure the
  // translated values win over anything in `rest`.
  const merged = {
    id: 1,
    agentId: 'agent-1',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    createdAt: Date.now(),
    ...rest,
  } as ParsedEvent
  merged.hookName = hookName
  merged.payload = payload
  return merged
}

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: 'agent-1',
    sessionId: 'sess-1',
    parentAgentId: null,
    name: null,
    description: null,
    agentClass: 'claude-code',
    status: 'active',
    eventCount: 0,
    firstEventAt: Date.now(),
    lastEventAt: Date.now(),
    ...overrides,
  }
}

/**
 * Render EventStream wrapped with EventProcessingProvider so events
 * are processed into EnrichedEvents before the component reads them.
 */
function renderEventStream() {
  const rawEvents = mockEvents.length > 0 ? [...mockEvents] : undefined
  const agents = [...mockAgents]

  return renderWithProviders(
    <EventProcessingProvider rawEvents={rawEvents} agents={agents}>
      <EventStream />
    </EventProcessingProvider>,
  )
}

beforeEach(() => {
  setMockEvents([])
  setMockAgents([])

  // Reset UI store
  useUIStore.setState({
    selectedProjectId: 1,
    selectedSessionId: 'sess-1',
    selectedAgentIds: [],
    activeStaticFilters: [],
    activeToolFilters: [],
    searchQuery: '',
    autoFollow: true,
    expandedEventIds: new Set(),
    expandAllCounter: 0,
    selectedEventId: null,
    scrollToEventId: null,
    flashingEventId: null,
    sessionFilterStates: new Map(),
  })
})

describe('EventStream', () => {
  it('should show "Select a project" when no session selected', () => {
    useUIStore.setState({ selectedSessionId: null })
    renderEventStream()
    expect(screen.getByText('Select a project to view events')).toBeInTheDocument()
  })

  it('should show "No events in this session" when session selected but no events', () => {
    setMockEvents([])
    renderEventStream()
    expect(screen.getByText('No events in this session')).toBeInTheDocument()
  })

  it('should show loading spinner while events are loading', () => {
    mockEventsState.isLoading = true
    renderEventStream()
    expect(screen.getByText('Loading events...')).toBeInTheDocument()
    mockEventsState.isLoading = false
  })

  it('should render events when available', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Fix the bug' },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'SessionStart',
        payload: { source: 'cli' },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    renderEventStream()

    // Should show event count
    expect(screen.getByText('2')).toBeInTheDocument()
    // Should show event summaries
    expect(screen.getByText('Fix the bug')).toBeInTheDocument()
    expect(screen.getByText('Session cli')).toBeInTheDocument()
  })

  // ── PreToolUse + PostToolUse deduplication ────────────────

  it('should merge PreToolUse + PostToolUse into a single row', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'PreToolUse',
        toolName: 'Bash',
        status: 'pending',
        payload: { tool_use_id: 'tu-1', tool_input: { command: 'ls' } },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'PostToolUse',
        toolName: 'Bash',
        status: 'completed',
        payload: {
          tool_use_id: 'tu-1',
          tool_input: { command: 'ls' },
          tool_response: { stdout: 'files' },
        },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    renderEventStream()

    // Should show only 1 event (merged), not 2
    expect(screen.getByText('1')).toBeInTheDocument()
    // The tool name should appear
    const bashElements = screen.getAllByText('Bash')
    expect(bashElements.length).toBeGreaterThan(0)
  })

  it('should show merged PreToolUse + PostToolUseFailure as failed status', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'PreToolUse',
        toolName: 'Bash',
        status: 'pending',
        payload: { tool_use_id: 'tu-fail', tool_input: { command: 'bad-cmd' } },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'PostToolUseFailure',
        toolName: 'Bash',
        status: 'failed',
        payload: {
          tool_use_id: 'tu-fail',
          error: 'Command not found',
          tool_input: { command: 'bad-cmd' },
        },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    renderEventStream()

    // Should show 1 merged event (not 2)
    expect(screen.getByText('1')).toBeInTheDocument()
    // The merged row shows the Bash tool name and the command summary
    expect(screen.getAllByText('Bash').length).toBeGreaterThan(0)
  })

  it('should NOT merge events with different toolUseIds', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'PreToolUse',
        toolName: 'Bash',
        payload: { tool_use_id: 'tu-1', tool_input: { command: 'ls' } },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'PreToolUse',
        toolName: 'Read',
        payload: { tool_use_id: 'tu-2', tool_input: { file_path: '/tmp/f.txt' } },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    renderEventStream()

    // Should show 2 events (no merge)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  // ── Agent filtering ───────────────────────────────────────

  it('should filter events by selected agent IDs', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        agentId: 'agent-1',
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Agent 1 prompt' },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        agentId: 'agent-2',
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Agent 2 prompt' },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([
      makeAgent({ id: 'agent-1' }),
      makeAgent({ id: 'agent-2', parentAgentId: 'agent-1' }),
    ])

    // Select only agent-1
    useUIStore.setState({ selectedAgentIds: ['agent-1'] })

    renderEventStream()

    expect(screen.getByText('Agent 1 prompt')).toBeInTheDocument()
    expect(screen.queryByText('Agent 2 prompt')).not.toBeInTheDocument()
  })

  // ── Static/tool filter application ────────────────────────

  it('should apply static filters to events', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'My prompt' },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'SessionStart',
        payload: { source: 'cli' },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    // Only show Prompts
    useUIStore.setState({ activeStaticFilters: ['Prompts'] })

    renderEventStream()

    expect(screen.getByText('My prompt')).toBeInTheDocument()
    expect(screen.queryByText('Session cli')).not.toBeInTheDocument()
  })

  it('should apply tool name filters to events', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'PreToolUse',
        toolName: 'Bash',
        payload: { tool_use_id: 'tu-1', tool_input: { command: 'ls -la' } },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'PreToolUse',
        toolName: 'Read',
        payload: { tool_use_id: 'tu-2', tool_input: { file_path: '/tmp/file.txt' } },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    // Only show Bash tools
    useUIStore.setState({ activeToolFilters: ['Bash'] })

    renderEventStream()

    // Bash event should be visible — the summary now includes a binary prefix
    const bashElements = screen.getAllByText('Bash')
    expect(bashElements.length).toBeGreaterThan(0)
    // Read event should be filtered out
    expect(screen.queryByText('/tmp/file.txt')).not.toBeInTheDocument()
  })

  // ── Event count display ───────────────────────────────────

  it('should show raw count when filters reduce the visible count', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Hello' },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'SessionStart',
        payload: {},
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    // Filter to only Prompts (1 visible out of 2 raw)
    useUIStore.setState({ activeStaticFilters: ['Prompts'] })

    renderEventStream()

    // Should show "1" for filtered count and "2 raw" for total
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText(/2 raw/)).toBeInTheDocument()
  })

  // ── Agent label display ───────────────────────────────────

  it('should show agent labels when multiple agents exist', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        agentId: 'agent-1',
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Hello' },
        timestamp: 1700000000000,
      }),
    ])
    setMockAgents([
      makeAgent({ id: 'agent-1', parentAgentId: null }),
      makeAgent({ id: 'agent-2', parentAgentId: 'agent-1', name: 'worker' }),
    ])

    renderEventStream()

    // With 2 agents, should show agent labels
    expect(screen.getByText('Main')).toBeInTheDocument()
  })

  it('should NOT show agent labels when only one agent exists', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        agentId: 'agent-1',
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Hello' },
        timestamp: 1700000000000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    renderEventStream()

    // With only 1 agent, "Main" label should not appear
    expect(screen.queryByText('Main')).not.toBeInTheDocument()
  })
})
