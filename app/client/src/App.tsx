import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme-provider'
import { Sidebar } from '@/components/sidebar/sidebar'
import { MainPanel } from '@/components/main-panel/main-panel'
import { SessionEditModal } from '@/components/settings/session-modal'
import { useWebSocket } from '@/hooks/use-websocket'
import { useRouteSync } from '@/hooks/use-route-sync'
import { useUIStore } from '@/stores/ui-store'

export function App() {
  const selectedSessionId = useUIStore((s) => s.selectedSessionId)
  const { connected } = useWebSocket(selectedSessionId)
  useRouteSync()

  // When the user navigates away from a session, immediately drop the previous
  // session's events / agents from React Query's cache. Without this, the
  // potentially large events array (10s of MB for big sessions) would sit in
  // memory until the default gcTime expires, and rapid session switching
  // could accumulate multiple full sessions in memory.
  const queryClient = useQueryClient()
  const prevSessionIdRef = useRef<string | null>(selectedSessionId)
  useEffect(() => {
    const prev = prevSessionIdRef.current
    if (prev && prev !== selectedSessionId) {
      queryClient.removeQueries({ queryKey: ['events', prev] })
      queryClient.removeQueries({ queryKey: ['agents', prev] })
    }
    prevSessionIdRef.current = selectedSessionId
  }, [selectedSessionId, queryClient])

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar connected={connected} />
        <MainPanel />
      </div>
      <SessionEditModal />
    </ThemeProvider>
  )
}
