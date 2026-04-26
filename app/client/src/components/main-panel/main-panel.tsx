import { useUIStore } from '@/stores/ui-store'
import { useEffectiveEvents } from '@/hooks/use-effective-events'
import { useAgents } from '@/hooks/use-agents'
import { useSessions } from '@/hooks/use-sessions'
import { EventProcessingProvider } from '@/agents/event-processing-context'
import { SessionBreadcrumb } from './session-breadcrumb'
import { ScopeBar } from './scope-bar'
import { EventFilterBar } from './event-filter-bar'
import { ActivityTimeline } from '@/components/timeline/activity-timeline'
import { EventStream } from '@/components/event-stream/event-stream'
import { HomePage } from './home-page'
import { ProjectPage } from './project-page'
import { useRegionShortcuts } from '@/hooks/use-region-shortcuts'

export function MainPanel() {
  const { selectedProjectId, selectedProjectSlug, selectedSessionId } = useUIStore()

  // The URL hash populates `selectedProjectSlug` / `selectedSessionId`
  // synchronously on store init, but `selectedProjectId` is resolved
  // asynchronously by `useRouteSync` once /api/projects (and possibly
  // /api/sessions/:id) has returned. Don't flash HomePage in that
  // window — it triggers /api/sessions/recent and other home-page
  // queries that get torn down a tick later.
  const isResolvingRoute = !selectedProjectId && (!!selectedProjectSlug || !!selectedSessionId)
  if (isResolvingRoute) {
    return <div className="flex-1" />
  }

  if (!selectedProjectId) {
    return <HomePage />
  }

  if (!selectedSessionId) {
    return <ProjectPage />
  }

  return <SessionView sessionId={selectedSessionId} projectId={selectedProjectId} />
}

function SessionView({ sessionId, projectId }: { sessionId: string; projectId: number }) {
  useRegionShortcuts()
  const { data: sessions } = useSessions(projectId)
  const effectiveSessionId = sessionId || sessions?.[0]?.id || null
  const eventsQuery = useEffectiveEvents(effectiveSessionId)
  const rawEvents = eventsQuery.data
  const agents = useAgents(effectiveSessionId, rawEvents)

  return (
    <EventProcessingProvider rawEvents={rawEvents} agents={agents}>
      <div className="flex-1 flex flex-col overflow-hidden">
        <SessionBreadcrumb />
        <ScopeBar />
        <EventFilterBar />
        <ActivityTimeline />
        <EventStream key={sessionId} />
      </div>
    </EventProcessingProvider>
  )
}
