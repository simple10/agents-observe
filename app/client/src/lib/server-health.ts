import { API_BASE } from '@/config/api'

export interface ServerHealth {
  ok?: boolean
  id?: string
  version?: string
  logLevel?: string
  runtime?: string
  dbPath?: string
  activeConsumers?: number
  activeClients?: number
}

/**
 * Memoized fetch of `/api/health`. Multiple callers (the WS log-level
 * sniffer, the version footer, the settings modal) need different
 * fields off the same response, so we share a single in-flight Promise
 * for the whole page lifetime instead of each running its own fetch.
 *
 * Failures resolve to `null`, not reject — every consumer is opt-in
 * and treats unknown fields as defaults.
 */
let pending: Promise<ServerHealth | null> | null = null

export function getServerHealth(): Promise<ServerHealth | null> {
  if (!pending) {
    pending = fetch(`${API_BASE}/health`)
      .then((r) => (r.ok ? (r.json() as Promise<ServerHealth>) : null))
      .catch(() => null)
  }
  return pending
}
