import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

/**
 * Per-project session list. Stays fresh via WS-driven invalidation in
 * `use-websocket.ts` (session_update broadcasts match the `['sessions']`
 * query key prefix). No polling — every expanded project in the sidebar
 * mounts this hook, so a 30s refetchInterval would fan out to N
 * `/api/projects/:id/sessions` requests every interval.
 */
export function useSessions(projectId: number | null) {
  return useQuery({
    queryKey: ['sessions', projectId],
    queryFn: () => api.getSessions(projectId!),
    enabled: !!projectId,
  })
}
