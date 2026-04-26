import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

/**
 * Cached fetch of `/api/sessions/recent`. The query stays fresh via
 * WS-driven invalidation in `use-websocket.ts` (session_update +
 * project_update). No polling — the sidebar's Unassigned bucket calls
 * this on every page mount, so a 10s refetch loop ran continuously
 * across the app and showed up as recurring `/api/sessions/recent`
 * traffic on the network panel.
 */
export function useRecentSessions(limit?: number) {
  return useQuery({
    queryKey: ['recent-sessions', limit],
    queryFn: () => api.getRecentSessions(limit),
  })
}
