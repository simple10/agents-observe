import { API_BASE } from '@/config/api'
import type {
  Project,
  Session,
  RecentSession,
  ServerAgent,
  ParsedEvent,
  NotificationPayload,
} from '@/types'

/**
 * Rich error thrown by all api.* methods on failure. Carries the HTTP status,
 * the server's error message (if it returned a JSON body with `message` or
 * `error`), and the request path so toasts can display useful context.
 */
export class ApiError extends Error {
  status: number
  path: string
  serverMessage?: string

  constructor(status: number, path: string, message: string, serverMessage?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.path = path
    this.serverMessage = serverMessage
  }
}

async function parseErrorBody(res: Response): Promise<string | undefined> {
  try {
    const body = await res.json()
    if (typeof body === 'object' && body !== null) {
      // Server convention: { error: { message, details?, ... } }
      if (typeof body.error === 'object' && body.error !== null) {
        const err = body.error
        if (err.details) return `${err.message}: ${err.details}`
        return err.message
      }
      // Legacy fallback
      if (typeof body.error === 'string') return body.error
    }
  } catch {
    // not JSON; fall through
  }
  return undefined
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, init)
  } catch (err) {
    // Network failure (server down, CORS, DNS, etc.)
    const message = err instanceof Error ? err.message : 'Network error'
    throw new ApiError(0, path, `Network error: ${message}`)
  }
  if (!res.ok) {
    const serverMessage = await parseErrorBody(res)
    const message = serverMessage
      ? `${res.status} ${res.statusText}: ${serverMessage}`
      : `${res.status} ${res.statusText}`
    throw new ApiError(res.status, path, message, serverMessage)
  }
  return res.json()
}

/**
 * Like fetchJson but for endpoints that return no body (DELETE, etc.).
 * Still validates the response status and throws ApiError on failure.
 */
async function fetchVoid(path: string, init?: RequestInit): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, init)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error'
    throw new ApiError(0, path, `Network error: ${message}`)
  }
  if (!res.ok) {
    const serverMessage = await parseErrorBody(res)
    const message = serverMessage
      ? `${res.status} ${res.statusText}: ${serverMessage}`
      : `${res.status} ${res.statusText}`
    throw new ApiError(res.status, path, message, serverMessage)
  }
}

export const api = {
  getProjects: () => fetchJson<Project[]>('/projects'),
  getPendingNotifications: (sinceTs: number) =>
    fetchJson<NotificationPayload[]>(`/notifications?since=${sinceTs}`),
  getRecentSessions: (limit?: number) =>
    fetchJson<RecentSession[]>(`/sessions/recent${limit ? `?limit=${limit}` : ''}`),
  getSessions: (projectId: number) => fetchJson<Session[]>(`/projects/${projectId}/sessions`),
  getSession: (sessionId: string) =>
    fetchJson<Session>(`/sessions/${encodeURIComponent(sessionId)}`),
  getAgent: (agentId: string) => fetchJson<ServerAgent>(`/agents/${encodeURIComponent(agentId)}`),
  getAgents: (sessionId: string) =>
    fetchJson<ServerAgent[]>(`/sessions/${encodeURIComponent(sessionId)}/agents`),
  getEvents: (
    sessionId: string,
    filters?: {
      agentIds?: string[]
      type?: string
      subtype?: string
      search?: string
      limit?: number
      offset?: number
    },
  ) => {
    const params = new URLSearchParams()
    if (filters?.agentIds?.length) params.set('agentId', filters.agentIds.join(','))
    if (filters?.type) params.set('type', filters.type)
    if (filters?.subtype) params.set('subtype', filters.subtype)
    if (filters?.search) params.set('search', filters.search)
    if (filters?.limit) params.set('limit', String(filters.limit))
    if (filters?.offset) params.set('offset', String(filters.offset))
    const qs = params.toString()
    return fetchJson<ParsedEvent[]>(
      `/sessions/${encodeURIComponent(sessionId)}/events${qs ? `?${qs}` : ''}`,
    )
  },
  getThread: (eventId: number) => fetchJson<ParsedEvent[]>(`/events/${eventId}/thread`),
  deleteSession: (sessionId: string) =>
    fetchVoid(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  clearSessionEvents: (sessionId: string) =>
    fetchVoid(`/sessions/${encodeURIComponent(sessionId)}/events`, { method: 'DELETE' }),
  deleteProject: (projectId: number) => fetchVoid(`/projects/${projectId}`, { method: 'DELETE' }),
  deleteAllData: () => fetchVoid(`/data`, { method: 'DELETE' }),
  updateAgentMetadata: (agentId: string, data: { agentType?: string; name?: string }) =>
    fetchVoid(`/agents/${encodeURIComponent(agentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  updateSessionSlug: (sessionId: string, slug: string) =>
    fetchVoid(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    }),
  patchSessionMetadata: (sessionId: string, patch: Record<string, unknown>) =>
    fetchVoid(`/sessions/${encodeURIComponent(sessionId)}/metadata`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  moveSession: (sessionId: string, projectId: number) =>
    fetchVoid(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    }),
  renameProject: (projectId: number, name: string) =>
    fetchVoid(`/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  createProject: (data: { name: string; slug?: string }) =>
    fetchJson<Project>(`/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  getChangelog: () => fetchJson<{ markdown: string }>('/changelog'),
  getDbStats: () =>
    fetchJson<{ dbPath: string; sizeBytes: number; sessionCount: number; eventCount: number }>(
      '/db/stats',
    ),
  bulkDeleteSessions: (sessionIds: string[]) =>
    fetchJson<{
      ok: true
      deleted: { events: number; agents: number; sessions: number }
      sizeBefore: number
      sizeAfter: number
    }>('/sessions/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds }),
    }),
}
