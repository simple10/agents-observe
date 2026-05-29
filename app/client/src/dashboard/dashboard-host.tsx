import { useCallback, useMemo } from 'react'
import { Clock, CalendarDays } from 'lucide-react'
import { useRecentSessions } from '@/hooks/use-recent-sessions'
import { useUIStore } from '@/stores/ui-store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { RecentSession } from '@/types'
import { resolveDashboardTheme } from './registry'
import { ThemeSwitcher } from './theme-switcher'

/**
 * Home-page shell. Owns session fetching, sort order, and navigation, then
 * renders whichever registered dashboard theme is active. The header (title +
 * sort toggle) matches the previous home page; the theme switcher sits beside
 * the sort toggle.
 */
export function DashboardHost() {
  const { data: sessions, isLoading } = useRecentSessions(30)
  const sessionSortOrder = useUIStore((s) => s.sessionSortOrder)
  const setSessionSortOrder = useUIStore((s) => s.setSessionSortOrder)
  const dashboardThemeId = useUIStore((s) => s.dashboardThemeId)
  const setDashboardThemeId = useUIStore((s) => s.setDashboardThemeId)
  const openSession = useUIStore((s) => s.openSession)

  const theme = resolveDashboardTheme(dashboardThemeId)
  const ThemeComponent = theme.Component

  const sorted = useMemo(() => {
    if (!sessions) return []
    if (sessionSortOrder === 'activity') return sessions // server already sorts by activity
    return [...sessions].sort((a, b) => b.startedAt - a.startedAt)
  }, [sessions, sessionSortOrder])

  // Single history entry so browser Back returns here, not an intermediate
  // project page (see ui-store openSession).
  const onOpenSession = useCallback(
    (session: RecentSession) => {
      openSession(session.projectId, session.projectId ? session.projectSlug : null, session.id)
    },
    [openSession],
  )

  const showSort = theme.usesSort !== false

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold">Recent Sessions</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Across all projects</p>
        </div>
        <div className="flex items-center gap-4">
          {showSort && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() =>
                    setSessionSortOrder(sessionSortOrder === 'activity' ? 'created' : 'activity')
                  }
                >
                  {sessionSortOrder === 'activity' ? (
                    <>
                      <Clock className="h-3 w-3" /> Recent
                    </>
                  ) : (
                    <>
                      <CalendarDays className="h-3 w-3" /> Created
                    </>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                {sessionSortOrder === 'activity'
                  ? 'Sorted by recent activity'
                  : 'Sorted by creation date'}
              </TooltipContent>
            </Tooltip>
          )}
          <ThemeSwitcher activeId={theme.id} onSelect={setDashboardThemeId} />
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <ThemeComponent sessions={sorted} isLoading={isLoading} onOpenSession={onOpenSession} />
      </div>
    </div>
  )
}
