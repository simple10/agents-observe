import { describe, it, expect } from 'vitest'
import { computeRuntimeMs, formatRuntime } from './runtime'
import type { EnrichedEvent } from '../types'

function makeEvent(overrides: Partial<EnrichedEvent> & { timestamp: number }): EnrichedEvent {
  return {
    id: 1,
    agentId: 'agent-1',
    sessionId: 'sess-1',
    hookName: null,
    createdAt: overrides.timestamp,
    type: 'hook',
    subtype: null,
    groupId: null,
    turnId: null,
    displayEventStream: true,
    displayTimeline: true,
    label: '',
    toolName: null,
    toolUseId: null,
    icon: null,
    iconColor: null,
    dotColor: null,
    iconColorHex: null,
    status: 'pending',
    filterTags: { static: null, dynamic: [] },
    searchText: '',
    dedupMode: false,
    payload: {},
    ...overrides,
  }
}

describe('formatRuntime', () => {
  it('formats sub-second as ms', () => {
    expect(formatRuntime(0)).toBe('0ms')
    expect(formatRuntime(500)).toBe('500ms')
    expect(formatRuntime(999)).toBe('999ms')
  })

  it('formats single-digit seconds with one decimal', () => {
    expect(formatRuntime(1_000)).toBe('1.0s')
    expect(formatRuntime(5_200)).toBe('5.2s')
    expect(formatRuntime(9_949)).toBe('9.9s')
  })

  it('formats two-digit seconds as whole seconds', () => {
    expect(formatRuntime(10_000)).toBe('10s')
    expect(formatRuntime(42_500)).toBe('43s')
    expect(formatRuntime(59_000)).toBe('59s')
  })

  it('formats minute range as "Xm Ys"', () => {
    expect(formatRuntime(60_000)).toBe('1m 0s')
    expect(formatRuntime(63_000)).toBe('1m 3s')
    expect(formatRuntime(30 * 60_000 + 15_000)).toBe('30m 15s')
  })

  it('formats hour range as "Xh Ym"', () => {
    expect(formatRuntime(60 * 60_000)).toBe('1h 0m')
    expect(formatRuntime(83 * 60_000)).toBe('1h 23m')
    expect(formatRuntime(25 * 60 * 60_000 + 10 * 60_000)).toBe('25h 10m')
  })
})

describe('computeRuntimeMs', () => {
  it('returns the absolute delta when a pairedEvent is supplied', () => {
    const pre = makeEvent({ timestamp: 1000, subtype: 'PreToolUse' })
    const post = makeEvent({ id: 2, timestamp: 3500, subtype: 'PostToolUse' })
    expect(computeRuntimeMs(pre, post, [])).toBe(2500)
  })

  it('handles pairedEvent with reversed timestamps (abs)', () => {
    const a = makeEvent({ timestamp: 5000 })
    const b = makeEvent({ id: 2, timestamp: 2000 })
    expect(computeRuntimeMs(a, b, [])).toBe(3000)
  })

  it('finds Stop in the turn for UserPromptSubmit', () => {
    const prompt = makeEvent({ timestamp: 1000, subtype: 'UserPromptSubmit' })
    const stop = makeEvent({ id: 2, timestamp: 4000, subtype: 'Stop' })
    expect(computeRuntimeMs(prompt, null, [prompt, stop])).toBe(3000)
  })

  it('accepts stop_hook_summary as an end event for UserPromptSubmit', () => {
    const prompt = makeEvent({ timestamp: 1000, subtype: 'UserPromptSubmit' })
    const stop = makeEvent({ id: 2, timestamp: 2500, subtype: 'stop_hook_summary' })
    expect(computeRuntimeMs(prompt, null, [prompt, stop])).toBe(1500)
  })

  it('finds SubagentStop in the turn for SubagentStart', () => {
    const start = makeEvent({ timestamp: 2000, subtype: 'SubagentStart' })
    const stop = makeEvent({ id: 2, timestamp: 8000, subtype: 'SubagentStop' })
    expect(computeRuntimeMs(start, null, [start, stop])).toBe(6000)
  })

  it('returns null for UserPromptSubmit with no Stop event in the turn', () => {
    const prompt = makeEvent({ timestamp: 1000, subtype: 'UserPromptSubmit' })
    expect(computeRuntimeMs(prompt, null, [prompt])).toBeNull()
  })

  it('returns null for SubagentStart with no SubagentStop in the turn', () => {
    const start = makeEvent({ timestamp: 1000, subtype: 'SubagentStart' })
    expect(computeRuntimeMs(start, null, [start])).toBeNull()
  })

  it('returns null for event types without a known pairing strategy', () => {
    const session = makeEvent({ timestamp: 1000, subtype: 'SessionStart' })
    expect(computeRuntimeMs(session, null, [])).toBeNull()
  })

  it('prefers pairedEvent over turn lookup when both would match', () => {
    const prompt = makeEvent({ timestamp: 1000, subtype: 'UserPromptSubmit' })
    const paired = makeEvent({ id: 2, timestamp: 1500 })
    const stop = makeEvent({ id: 3, timestamp: 9000, subtype: 'Stop' })
    expect(computeRuntimeMs(prompt, paired, [prompt, stop])).toBe(500)
  })
})
