import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useDbStats(enabled: boolean = true) {
  return useQuery({
    queryKey: ['db-stats'],
    queryFn: () => api.getDbStats(),
    enabled,
  })
}
