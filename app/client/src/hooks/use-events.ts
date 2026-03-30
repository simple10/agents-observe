import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useEvents(sessionId: string | null) {
  return useQuery({
    queryKey: ['events', sessionId],
    queryFn: () => api.getEvents(sessionId!),
    enabled: !!sessionId,
    refetchInterval: false,
  })
}
