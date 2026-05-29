import { describe, test, expect } from 'vitest'
import {
  validateEnvelope,
  EnvelopeValidationError,
  clampTimestamp,
  normalizeTimestamp,
} from './parser'

describe('validateEnvelope — new shape', () => {
  test('accepts a minimally valid envelope', () => {
    const result = validateEnvelope({
      agentClass: 'claude-code',
      sessionId: 's1',
      agentId: 'a1',
      hookName: 'PreToolUse',
      payload: {},
    })
    expect(result.envelope.sessionId).toBe('s1')
    expect(result.envelope.agentId).toBe('a1')
    expect(result.envelope.agentClass).toBe('claude-code')
    expect(result.envelope.hookName).toBe('PreToolUse')
    expect(result.timestamp).toBeGreaterThan(0)
  })

  test('preserves _meta and flags verbatim when provided', () => {
    const result = validateEnvelope({
      agentClass: 'claude-code',
      sessionId: 's1',
      agentId: 'a1',
      hookName: 'SessionStart',
      payload: { hello: 'world' },
      _meta: {
        session: { transcriptPath: '/x', startCwd: '/cwd' },
        project: { slug: 'override' },
      },
      flags: { startsNotification: true, resolveProject: true },
    })
    expect(result.envelope._meta?.session?.transcriptPath).toBe('/x')
    expect(result.envelope._meta?.project?.slug).toBe('override')
    expect(result.envelope.flags?.startsNotification).toBe(true)
    expect(result.envelope.flags?.resolveProject).toBe(true)
  })

  test('uses provided timestamp when present', () => {
    const result = validateEnvelope({
      agentClass: 'x',
      sessionId: 's',
      agentId: 'a',
      hookName: 'h',
      payload: {},
      timestamp: 1700000000000,
    })
    expect(result.timestamp).toBe(1700000000000)
  })

  test('normalizes epoch-seconds timestamps to milliseconds', () => {
    // 1780084122.37901 is epoch seconds (Python time.time()); read as ms it
    // would land in Jan 1970. Should be scaled to ms and preserved.
    const result = validateEnvelope({
      agentClass: 'x',
      sessionId: 's',
      agentId: 'a',
      hookName: 'h',
      payload: {},
      timestamp: 1780084122.37901,
    })
    expect(result.timestamp).toBe(1780084122379)
  })

  test('clamps absurd future timestamps to now', () => {
    const result = validateEnvelope({
      agentClass: 'x',
      sessionId: 's',
      agentId: 'a',
      hookName: 'h',
      payload: {},
      timestamp: Number.MAX_SAFE_INTEGER,
    })
    expect(result.timestamp).toBeLessThan(Date.now() + 1000)
  })

  test('falls back to ingest time when timestamp is absent', () => {
    const before = Date.now()
    const result = validateEnvelope({
      agentClass: 'x',
      sessionId: 's',
      agentId: 'a',
      hookName: 'h',
      payload: {},
    })
    expect(result.timestamp).toBeGreaterThanOrEqual(before)
    expect(result.timestamp).toBeLessThanOrEqual(Date.now())
  })
})

describe('validateEnvelope — rejection', () => {
  test('rejects non-object input', () => {
    expect(() => validateEnvelope(null)).toThrow(EnvelopeValidationError)
    expect(() => validateEnvelope('string')).toThrow(EnvelopeValidationError)
    expect(() => validateEnvelope(42)).toThrow(EnvelopeValidationError)
  })

  test('rejects empty object with full missingFields list', () => {
    let caught: unknown
    try {
      validateEnvelope({})
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(EnvelopeValidationError)
    const err = caught as EnvelopeValidationError
    expect(err.missingFields).toEqual(['agentClass', 'sessionId', 'agentId', 'hookName', 'payload'])
  })

  test('rejects with a partial missingFields list', () => {
    let caught: unknown
    try {
      validateEnvelope({
        agentClass: 'x',
        sessionId: 's',
        payload: {},
        // agentId + hookName missing
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(EnvelopeValidationError)
    expect((caught as EnvelopeValidationError).missingFields).toEqual(['agentId', 'hookName'])
  })

  test('rejects when payload is null', () => {
    let caught: unknown
    try {
      validateEnvelope({
        agentClass: 'x',
        sessionId: 's',
        agentId: 'a',
        hookName: 'h',
        payload: null,
      })
    } catch (err) {
      caught = err
    }
    expect((caught as EnvelopeValidationError).missingFields).toEqual(['payload'])
  })
})

describe('normalizeTimestamp', () => {
  test('scales fractional epoch-seconds to integer milliseconds', () => {
    expect(normalizeTimestamp(1780084122.37901)).toBe(1780084122379)
  })

  test('leaves millisecond timestamps unchanged', () => {
    const ms = 1780084122379
    expect(normalizeTimestamp(ms)).toBe(ms)
  })

  test('passes through 0, negative, and out-of-range values for clamp to handle', () => {
    expect(normalizeTimestamp(0)).toBe(0)
    expect(normalizeTimestamp(-5)).toBe(-5)
    expect(normalizeTimestamp(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
  })

  test('leaves sub-1e9 values untouched (test fixtures / sentinels, not epoch seconds)', () => {
    expect(normalizeTimestamp(1000)).toBe(1000)
    expect(normalizeTimestamp(2_000_000)).toBe(2_000_000)
  })

  test('boundary: 1e9 normalizes, just under does not', () => {
    expect(normalizeTimestamp(1e9)).toBe(1e9 * 1000)
    expect(normalizeTimestamp(1e9 - 1)).toBe(1e9 - 1)
  })
})

describe('clampTimestamp', () => {
  test('returns reasonable values unchanged', () => {
    const ts = Date.now() - 1000
    expect(clampTimestamp(ts)).toBe(ts)
  })

  test('clamps far-future to now', () => {
    const before = Date.now()
    const result = clampTimestamp(Number.MAX_SAFE_INTEGER)
    expect(result).toBeGreaterThanOrEqual(before)
    expect(result).toBeLessThanOrEqual(Date.now())
  })

  test('NaN/Infinity fall back to now', () => {
    const before = Date.now()
    expect(clampTimestamp(NaN)).toBeGreaterThanOrEqual(before)
    expect(clampTimestamp(Infinity)).toBeGreaterThanOrEqual(before)
  })
})
