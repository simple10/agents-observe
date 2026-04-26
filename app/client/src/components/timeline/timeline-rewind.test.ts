import { describe, it, expect } from 'vitest'
import { findFirstEventAtOrAfter } from './timeline-rewind'
import type { ParsedEvent } from '@/types'

function makeEvent(id: number, timestamp: number): ParsedEvent {
  return {
    id,
    agentId: 'a',
    sessionId: 's',
    hookName: 'PreToolUse',
    timestamp,
    createdAt: timestamp,
    payload: { tool_name: 'Bash' },
  }
}

describe('findFirstEventAtOrAfter', () => {
  it('returns -1 for empty array', () => {
    expect(findFirstEventAtOrAfter([], 100)).toBe(-1)
  })

  it('returns first matching index for target below all', () => {
    const events = [makeEvent(1, 100), makeEvent(2, 200), makeEvent(3, 300)]
    expect(findFirstEventAtOrAfter(events, 0)).toBe(0)
  })

  it('returns exact match index', () => {
    const events = [makeEvent(1, 100), makeEvent(2, 200), makeEvent(3, 300)]
    expect(findFirstEventAtOrAfter(events, 200)).toBe(1)
  })

  it('returns first event past the target', () => {
    const events = [makeEvent(1, 100), makeEvent(2, 200), makeEvent(3, 300)]
    expect(findFirstEventAtOrAfter(events, 150)).toBe(1)
    expect(findFirstEventAtOrAfter(events, 250)).toBe(2)
  })

  it('returns -1 when target is past all events', () => {
    const events = [makeEvent(1, 100), makeEvent(2, 200), makeEvent(3, 300)]
    expect(findFirstEventAtOrAfter(events, 400)).toBe(-1)
  })

  it('handles single-event arrays', () => {
    const events = [makeEvent(1, 100)]
    expect(findFirstEventAtOrAfter(events, 50)).toBe(0)
    expect(findFirstEventAtOrAfter(events, 100)).toBe(0)
    expect(findFirstEventAtOrAfter(events, 150)).toBe(-1)
  })

  it('handles duplicates — returns first occurrence', () => {
    const events = [
      makeEvent(1, 100),
      makeEvent(2, 200),
      makeEvent(3, 200),
      makeEvent(4, 200),
      makeEvent(5, 300),
    ]
    expect(findFirstEventAtOrAfter(events, 200)).toBe(1)
  })

  it('works with 1000 events', () => {
    const events = Array.from({ length: 1000 }, (_, i) => makeEvent(i, i * 10))
    expect(findFirstEventAtOrAfter(events, 0)).toBe(0)
    expect(findFirstEventAtOrAfter(events, 5000)).toBe(500)
    expect(findFirstEventAtOrAfter(events, 5001)).toBe(501)
    expect(findFirstEventAtOrAfter(events, 9990)).toBe(999)
    expect(findFirstEventAtOrAfter(events, 10000)).toBe(-1)
  })
})
