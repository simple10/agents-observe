import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAgentPatchDebouncer, type AgentPatch } from './agent-patch-debouncer'

describe('AgentPatchDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces multiple rapid calls for the same agent into a single PATCH', async () => {
    const patchFn = vi.fn(async () => ({}))
    const d = createAgentPatchDebouncer(500, patchFn)

    d.schedule('agent-1', { name: 'first' })
    d.schedule('agent-1', { description: 'second' })
    d.schedule('agent-1', { name: 'third' }) // overwrites earlier name

    expect(patchFn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    await Promise.resolve()

    expect(patchFn).toHaveBeenCalledTimes(1)
    expect(patchFn).toHaveBeenCalledWith('agent-1', {
      name: 'third',
      description: 'second',
    })
  })

  it('different agents fire independent PATCHes', async () => {
    const patchFn = vi.fn(async () => ({}))
    const d = createAgentPatchDebouncer(500, patchFn)

    d.schedule('agent-1', { name: 'a' })
    d.schedule('agent-2', { name: 'b' })

    vi.advanceTimersByTime(500)
    await Promise.resolve()

    expect(patchFn).toHaveBeenCalledTimes(2)
    const calls = patchFn.mock.calls.map((c) => c[0]).sort()
    expect(calls).toEqual(['agent-1', 'agent-2'])
  })

  it('PATCH failures are swallowed (fire-and-forget)', async () => {
    const patchFn = vi.fn(async () => {
      throw new Error('boom')
    })
    const d = createAgentPatchDebouncer(500, patchFn)

    d.schedule('agent-1', { name: 'x' })
    vi.advanceTimersByTime(500)
    // Loop microtasks so the rejection is observed
    await Promise.resolve()
    await Promise.resolve()
    expect(patchFn).toHaveBeenCalledTimes(1)
    // No unhandled-rejection bubbles out — the test would fail if it did.
  })

  it('skips scheduling when no allowed fields are supplied', () => {
    const patchFn = vi.fn(async () => ({}))
    const d = createAgentPatchDebouncer(500, patchFn)
    // @ts-expect-error — testing unrecognized key gets dropped
    d.schedule('agent-1', { foo: 'bar' } as AgentPatch)
    expect(d.size).toBe(0)
    vi.advanceTimersByTime(500)
    expect(patchFn).not.toHaveBeenCalled()
  })

  it('preserves explicit nulls (clearing a field) in the merged payload', async () => {
    const patchFn = vi.fn(async () => ({}))
    const d = createAgentPatchDebouncer(500, patchFn)

    d.schedule('agent-1', { name: 'something' })
    d.schedule('agent-1', { name: null })

    vi.advanceTimersByTime(500)
    await Promise.resolve()

    expect(patchFn).toHaveBeenCalledTimes(1)
    expect(patchFn).toHaveBeenCalledWith('agent-1', { name: null })
  })

  it('a fresh schedule after the timer fires opens a new debounce window', async () => {
    const patchFn = vi.fn(async () => ({}))
    const d = createAgentPatchDebouncer(500, patchFn)

    d.schedule('agent-1', { name: 'first' })
    vi.advanceTimersByTime(500)
    await Promise.resolve()
    expect(patchFn).toHaveBeenCalledTimes(1)

    d.schedule('agent-1', { description: 'later' })
    vi.advanceTimersByTime(500)
    await Promise.resolve()
    expect(patchFn).toHaveBeenCalledTimes(2)
    expect(patchFn).toHaveBeenLastCalledWith('agent-1', { description: 'later' })
  })
})
