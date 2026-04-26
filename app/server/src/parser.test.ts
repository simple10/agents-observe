import { describe, test, expect } from 'vitest'
import { validateEnvelope, EnvelopeValidationError, clampTimestamp } from './parser'

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
