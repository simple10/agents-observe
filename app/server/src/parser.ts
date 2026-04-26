// app/server/src/parser.ts
//
// Layer 2 envelope validation. The server only ever inspects identity
// fields, creation hints (_meta), and flags. Payload shape is opaque.
//
// Spec: docs/specs/2026-04-25-three-layer-contract-design.md
//   §"Layer 1 Contract — The Envelope"
//   §"Layer 2 Contract — Server Behavior"

import type { EventEnvelope } from './types'

export interface ValidatedEnvelope {
  envelope: EventEnvelope
  timestamp: number
}

export class EnvelopeValidationError extends Error {
  missingFields: string[]
  constructor(message: string, missingFields: string[]) {
    super(message)
    this.name = 'EnvelopeValidationError'
    this.missingFields = missingFields
  }
}

/**
 * Validate an incoming envelope. The new envelope shape is the only
 * accepted form post-Phase-4: identity fields at the top level,
 * `_meta` for creation hints, `flags` for behavior signals, raw
 * `payload` opaque to the server.
 */
export function validateEnvelope(raw: unknown): ValidatedEnvelope {
  if (!raw || typeof raw !== 'object') {
    throw new EnvelopeValidationError('envelope must be an object', [])
  }

  const candidate = raw as Partial<EventEnvelope>

  const missing: string[] = []
  if (!candidate.agentClass) missing.push('agentClass')
  if (!candidate.sessionId) missing.push('sessionId')
  if (!candidate.agentId) missing.push('agentId')
  if (!candidate.hookName) missing.push('hookName')
  if (candidate.payload === undefined || candidate.payload === null) missing.push('payload')

  if (missing.length > 0) {
    throw new EnvelopeValidationError(
      `envelope missing required fields: ${missing.join(', ')}`,
      missing,
    )
  }

  const timestamp =
    typeof candidate.timestamp === 'number' ? clampTimestamp(candidate.timestamp) : Date.now()

  return { envelope: candidate as EventEnvelope, timestamp }
}

// ---------------------------------------------------------------------------
// Timestamp clamping
// ---------------------------------------------------------------------------

// Guard against bogus future timestamps. A sentinel like `9999999999999`
// (year 2286) injected by a test fixture — or a misconfigured CLI — will
// poison downstream views that compute session spans (rewind timeline
// blows the pixel budget; session sort orders get thrown off). We allow
// up to 24h in the future to tolerate clock skew / timezone drift, then
// clamp anything further to the ingest time.
const FUTURE_TS_CAP_MS = 24 * 60 * 60 * 1000

export function clampTimestamp(ts: number): number {
  const now = Date.now()
  if (!Number.isFinite(ts)) return now
  if (ts > now + FUTURE_TS_CAP_MS) {
    console.warn(
      `[parser] Clamping future timestamp ${ts} (>${FUTURE_TS_CAP_MS / 3600000}h ahead) to now=${now}`,
    )
    return now
  }
  return ts
}
