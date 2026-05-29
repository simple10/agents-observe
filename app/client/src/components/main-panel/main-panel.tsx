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

  // A session route renders as soon as we know the session id — even with no
  // resolved (or no existing) project. Unassigned sessions have no project at
  // all, and skill deep-links (/observe view, /observe stats) plus direct
  // `#/<sessionId>` URLs must ALWAYS land on the session, never a blank panel.
  // SessionView keys its data off the session id; the project is optional.
  if (selectedSessionId) {
    return <SessionView sessionId={selectedSessionId} projectId={selectedProjectId} />
  }

  // No session in the route. A bare project slug from the URL still needs its
  // id resolved asynchronously by `useRouteSync` (via /api/projects). Render
  // nothing during that window rather than flashing HomePage — which would
  // fire /api/sessions/recent and other home queries that get torn down a
  // tick later.
  if (!selectedProjectId && selectedProjectSlug) {
    return <div className="flex-1" />
  }

  if (!selectedProjectId) {
    return <HomePage />
  }

  return <ProjectPage />
}

function SessionView({ sessionId, projectId }: { sessionId: string; projectId: number | null }) {
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
