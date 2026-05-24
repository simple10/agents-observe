import { API_BASE } from '@/config/api'
import type {
  Project,
  Session,
  RecentSession,
  ServerAgent,
  ParsedEvent,
  NotificationPayload,
  Filter,
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
  getUnassignedSessions: (limit?: number) =>
    fetchJson<RecentSession[]>(`/sessions/unassigned${limit ? `?limit=${limit}` : ''}`),
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
      /** Optional server-side hookName filter — the server only knows
       *  about `hook_name`. Per-class subtype/toolName filtering happens
       *  client-side via deriver hooks after fetch. */
      hookName?: string
      search?: string
      limit?: number
      offset?: number
    },
  ) => {
    const params = new URLSearchParams()
    if (filters?.agentIds?.length) params.set('agentId', filters.agentIds.join(','))
    if (filters?.hookName) params.set('hookName', filters.hookName)
    if (filters?.search) params.set('search', filters.search)
    if (filters?.limit) params.set('limit', String(filters.limit))
    if (filters?.offset) params.set('offset', String(filters.offset))
    const qs = params.toString()
    return fetchJson<ParsedEvent[]>(
      `/sessions/${encodeURIComponent(sessionId)}/events${qs ? `?${qs}` : ''}`,
    )
  },
  deleteSession: (sessionId: string) =>
    fetchVoid(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  clearSessionEvents: (sessionId: string) =>
    fetchVoid(`/sessions/${encodeURIComponent(sessionId)}/events`, { method: 'DELETE' }),
  deleteProject: (projectId: number) => fetchVoid(`/projects/${projectId}`, { method: 'DELETE' }),
  deleteAllData: () => fetchVoid(`/data`, { method: 'DELETE' }),
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
  /**
   * Layer 3 → server PATCH for agent metadata. The server accepts any
   * subset of `{ name, description, agent_type }`; unrecognized fields
   * (and attempts to overwrite `id` / `agent_class`) are silently
   * ignored. Returns the updated row.
   */
  patchAgent: (
    agentId: string,
    patch: { name?: string | null; description?: string | null; agent_type?: string | null },
  ) =>
    fetchJson<ServerAgent>(`/agents/${encodeURIComponent(agentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
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
  listFilters: () => fetchJson<Filter[]>('/filters'),
  createFilter: (input: {
    name: string
    pillName: string
    display: 'primary' | 'secondary'
    combinator: 'and' | 'or'
    patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
    config?: Record<string, unknown>
  }) =>
    fetchJson<Filter>('/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  updateFilter: (
    id: string,
    patch: Partial<{
      name: string
      pillName: string
      display: 'primary' | 'secondary'
      combinator: 'and' | 'or'
      patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
      enabled: boolean
      config: Record<string, unknown>
    }>,
  ) =>
    fetchJson<Filter>(`/filters/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  deleteFilter: (id: string) =>
    fetchVoid(`/filters/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  duplicateFilter: (id: string) =>
    fetchJson<Filter>(`/filters/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
  resetDefaultFilters: () => fetchJson<Filter[]>(`/filters/defaults/reset`, { method: 'POST' }),
  // Unlike other api.* methods which throw ApiError on non-2xx, this
  // endpoint returns a discriminated-union response. The UI maps each
  // `error` code to a distinct user-facing message; treating these as
  // exceptions would lose that information.
  getTranscriptStats: async (sessionId: string): Promise<TranscriptStatsResponse> => {
    const res = await fetch(
      `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/transcript-stats`,
    )
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: (body.error as TranscriptStatsErrorCode) ?? 'unknown',
        message: body.message ?? 'Unknown error',
      }
    }
    return { ok: true, status: 200, data: body as TranscriptStatsData }
  },
}

// ── Transcript stats types (V2: matches server transcript-parser) ──

export interface TranscriptStatsByModel {
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
  costCents: number | null
}

export interface TranscriptStatsPrompt {
  promptId: string
  text: string
  timestamp: number
  durationMs: number | null
  toolCount: number
  requests: number
  /** Bundled input (fresh + cache_read + cache_write). */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
  models: string[]
  costCents: number | null
}

export interface TranscriptStatsSubagent {
  agentId: string
  agentType: string | null
  description: string | null
  toolUseId: string | null
  model: string
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
  durationMs: number
  toolCount: number
  costCents: number | null
}

export interface TranscriptStatsModelPricing {
  inputPerM: number
  outputPerM: number
  cacheReadPerM: number
  cacheCreate5mPerM: number
  cacheCreate1hPerM: number
}

export interface TranscriptStatsParseError {
  scope: 'main' | 'subagent'
  agentId?: string
  code: 'missing' | 'unreadable' | 'parse_error'
  message: string
}

export interface TranscriptStatsToolStat {
  name: string
  count: number
  minMs: number | null
  medianMs: number | null
  maxMs: number | null
  longestToolUseId: string | null
}

export interface TranscriptStatsData {
  source: 'jsonl'
  summary: {
    totalCalls: number
    inputTotal: number
    outputTotal: number
    cacheHitRate: number
    costTotalCents: number | null
    startedAt: number | null
    durationMs: number | null
    toolCalls: number
    filesRead: number
    filesEdited: number
    gitCommits: number
    toolStats: TranscriptStatsToolStat[]
    userPrompts: number
  }
  byModel: TranscriptStatsByModel[]
  prompts: TranscriptStatsPrompt[]
  subagents: TranscriptStatsSubagent[]
  models: Record<string, { pricing: TranscriptStatsModelPricing | null }>
  errors: TranscriptStatsParseError[]
}

export type TranscriptStatsErrorCode =
  | 'disabled'
  | 'no_transcript'
  | 'file_not_found'
  | 'file_unreadable'
  | 'file_too_large'
  | 'parse_error'
  | 'unknown'

export type TranscriptStatsResponse =
  | { ok: true; status: 200; data: TranscriptStatsData }
  | {
      ok: false
      status: number
      error: TranscriptStatsErrorCode
      message: string
    }
