import { createHash } from 'node:crypto'
import type { EventEnvelope } from '../types'

const BUCKET_MS = 5000

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key])
    }
    return out
  }
  return value
}

// Identical envelopes within the same 5-second bucket produce the same hash;
// >5s apart they don't — treated as distinct real events.
export function computeEventSignature(
  envelope: Pick<
    EventEnvelope,
    'sessionId' | 'agentId' | 'hookName' | 'cwd' | 'payload' | '_meta' | 'flags'
  >,
  timestamp: number,
): string {
  const material = {
    session_id: envelope.sessionId,
    agent_id: envelope.agentId,
    hook_name: envelope.hookName,
    cwd: envelope.cwd ?? null,
    payload: envelope.payload,
    _meta: envelope._meta ?? null,
    flags: envelope.flags ?? null,
    ts_bucket: Math.floor(timestamp / BUCKET_MS),
  }
  return createHash('sha256').update(canonicalJson(material)).digest('hex')
}
