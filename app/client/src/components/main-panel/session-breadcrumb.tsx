import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Folder } from 'lucide-react'
import { api } from '@/lib/api-client'
import { useUIStore } from '@/stores/ui-store'
import { useEvents } from '@/hooks/use-events'
import { CopyButton } from '@/components/shared/copy-button'

export function SessionBreadcrumb() {
  const { selectedSessionId, selectedProjectId, setSelectedSessionId, dedupEnabled, openSettings } =
    useUIStore()

  const { data: session } = useQuery({
    queryKey: ['session', selectedSessionId],
    queryFn: () => api.getSession(selectedSessionId!),
    enabled: !!selectedSessionId,
    staleTime: 30_000,
  })

  const { data: events } = useEvents(selectedSessionId)

  if (!selectedProjectId || !selectedSessionId || !session) return null

  // Extract cwd from the first SessionStart event
  const sessionStartEvent = events?.find((e) => e.subtype === 'SessionStart')
  const cwd = (sessionStartEvent?.payload as Record<string, any>)?.cwd as string | undefined

  const projectName = session.projectSlug || session.projectName || 'Project'
  const sessionName = session.slug || selectedSessionId.slice(0, 8)
  const transcriptPath = session.transcriptPath || null

  return (
    <div className="group/breadcrumb flex items-center gap-1.5 px-3 py-1 border-b border-border text-xs text-muted-foreground min-h-[28px]">
      <button
        className="hover:text-foreground transition-colors cursor-pointer truncate max-w-[150px]"
        onClick={() => setSelectedSessionId(null)}
        title={`Back to ${projectName}`}
      >
        {projectName}
      </button>
      <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
      {transcriptPath ? (
        <CopyButton
          text={transcriptPath}
          label={sessionName}
          title={`Click to copy: ${transcriptPath}`}
          className="max-w-[200px] text-foreground"
        />
      ) : (
        <span className="text-foreground truncate max-w-[200px]" title={selectedSessionId}>
          {sessionName}
        </span>
      )}
      {cwd && (
        <>
          <span className="opacity-30 mx-0.5">|</span>
          <CopyButton
            text={cwd}
            label={cwd.split('/').slice(-2).join('/')}
            icon={<Folder className="h-3 w-3 shrink-0" />}
            title={`Click to copy: ${cwd}`}
          />
        </>
      )}
      <button
        className={`ml-auto rounded-full px-2 py-0.5 text-[10px] border cursor-pointer transition-colors shrink-0 ${
          dedupEnabled
            ? 'border-border/50 text-muted-foreground/50 hover:border-border hover:text-muted-foreground'
            : 'border-orange-500/50 text-orange-500 hover:border-orange-500 hover:text-orange-600'
        }`}
        onClick={() => openSettings('settings')}
        title={dedupEnabled ? 'Event dedup is on' : 'Event dedup is off — showing raw events'}
      >
        {dedupEnabled ? 'Dedup Events' : 'Raw Events'}
      </button>
    </div>
  )
}
