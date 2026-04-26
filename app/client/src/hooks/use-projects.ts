import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

/**
 * Cached project list. Stays fresh via WS-driven invalidation in
 * `use-websocket.ts` (project_update broadcasts). No polling — projects
 * are user-managed; they don't change autonomously between server-side
 * events that already broadcast.
 */
export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
  })
}
