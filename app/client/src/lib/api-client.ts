import { API_BASE } from '@/config/api';
import type { Project, Session, Agent, ParsedEvent } from '@/types';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  getProjects: () => fetchJson<Project[]>('/projects'),
  getSessions: (projectId: string) =>
    fetchJson<Session[]>(`/projects/${encodeURIComponent(projectId)}/sessions`),
  getSession: (sessionId: string) =>
    fetchJson<Session>(`/sessions/${encodeURIComponent(sessionId)}`),
  getAgents: (sessionId: string) =>
    fetchJson<Agent[]>(`/sessions/${encodeURIComponent(sessionId)}/agents`),
  getEvents: (
    sessionId: string,
    filters?: {
      agentIds?: string[];
      type?: string;
      subtype?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ) => {
    const params = new URLSearchParams();
    if (filters?.agentIds?.length) params.set('agent_id', filters.agentIds.join(','));
    if (filters?.type) params.set('type', filters.type);
    if (filters?.subtype) params.set('subtype', filters.subtype);
    if (filters?.search) params.set('search', filters.search);
    if (filters?.limit) params.set('limit', String(filters.limit));
    if (filters?.offset) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return fetchJson<ParsedEvent[]>(
      `/sessions/${encodeURIComponent(sessionId)}/events${qs ? `?${qs}` : ''}`
    );
  },
  getThread: (eventId: number) =>
    fetchJson<ParsedEvent[]>(`/events/${eventId}/thread`),
  deleteSession: (sessionId: string) =>
    fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  clearSessionEvents: (sessionId: string) =>
    fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/events`, { method: 'DELETE' }),
};
