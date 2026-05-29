import { List } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { SessionList } from '@/components/main-panel/session-list'
import type { DashboardTheme, DashboardThemeProps } from '../../types'

/**
 * The classic vertical list of recent sessions — the default dashboard theme.
 * SessionList handles its own click→navigation, so onOpenSession is unused here.
 */
function SessionsListView({ sessions, isLoading }: DashboardThemeProps) {
  const sessionSortOrder = useUIStore((s) => s.sessionSortOrder)

  return (
    <div className="h-full overflow-y-auto">
      {isLoading && (
        <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
          Loading...
        </div>
      )}
      {!isLoading && sessions.length > 0 && (
        <SessionList sessions={sessions} showProject sortBy={sessionSortOrder} />
      )}
    </div>
  )
}

export const sessionsListTheme: DashboardTheme = {
  id: 'sessions-list',
  name: 'List',
  description: 'The classic vertical list of recent sessions.',
  icon: List,
  usesSort: true,
  Component: SessionsListView,
}
