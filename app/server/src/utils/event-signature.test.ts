import { describe, test, expect } from 'vitest'
import { canonicalJson, computeEventSignature } from './event-signature'

describe('canonicalJson', () => {
  test('sorts object keys recursively', () => {
    const a = canonicalJson({ b: 2, a: 1, c: { z: 1, y: 2 } })
    const b = canonicalJson({ a: 1, c: { y: 2, z: 1 }, b: 2 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":1,"b":2,"c":{"y":2,"z":1}}')
  })

  test('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })

  test('handles nested objects inside arrays', () => {
    const a = canonicalJson([
      { b: 1, a: 2 },
      { d: 3, c: 4 },
    ])
    expect(a).toBe('[{"a":2,"b":1},{"c":4,"d":3}]')
  })

  test('handles null, primitives', () => {
    expect(canonicalJson({ a: null, b: 1, c: 'x', d: true })).toBe(
      '{"a":null,"b":1,"c":"x","d":true}',
    )
  })
})

describe('computeEventSignature', () => {
  const baseEnvelope = {
    sessionId: 'sess-1',
    agentId: 'agent-1',
    hookName: 'PreToolUse',
    cwd: '/repo',
    payload: { tool_name: 'Bash', command: 'ls' },
    _meta: { project: { slug: 'demo' } },
    flags: { stopsSession: false },
  }

  test('same envelope + same bucket → same hash', () => {
    const a = computeEventSignature(baseEnvelope, 1_000_000)
    const b = computeEventSignature(baseEnvelope, 1_000_500)
    expect(a).toBe(b)
  })

  test('different bucket → different hash', () => {
    const a = computeEventSignature(baseEnvelope, 1_000_000)
    const b = computeEventSignature(baseEnvelope, 1_006_000)
    expect(a).not.toBe(b)
  })

  test('payload key reordering does not affect hash', () => {
    const a = computeEventSignature(baseEnvelope, 1_000_000)
    const reordered = {
      ...baseEnvelope,
      payload: { command: 'ls', tool_name: 'Bash' },
    }
    const b = computeEventSignature(reordered, 1_000_000)
    expect(a).toBe(b)
  })

  test('changing payload content changes hash', () => {
    const a = computeEventSignature(baseEnvelope, 1_000_000)
    const b = computeEventSignature(
      { ...baseEnvelope, payload: { tool_name: 'Bash', command: 'pwd' } },
      1_000_000,
    )
    expect(a).not.toBe(b)
  })

  test('changing flags changes hash', () => {
    const a = computeEventSignature(baseEnvelope, 1_000_000)
    const b = computeEventSignature({ ...baseEnvelope, flags: { stopsSession: true } }, 1_000_000)
    expect(a).not.toBe(b)
  })

  test('changing _meta changes hash', () => {
    const a = computeEventSignature(baseEnvelope, 1_000_000)
    const b = computeEventSignature(
      { ...baseEnvelope, _meta: { project: { slug: 'other' } } },
      1_000_000,
    )
    expect(a).not.toBe(b)
  })

  test('missing cwd / _meta / flags normalized', () => {
    const minimal = {
      sessionId: 'sess-1',
      agentId: 'agent-1',
      hookName: 'PreToolUse',
      payload: { foo: 1 },
    }
    expect(() => computeEventSignature(minimal, 1_000_000)).not.toThrow()
  })

  test('returns 64-char hex sha256', () => {
    const hash = computeEventSignature(baseEnvelope, 1_000_000)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })
})
