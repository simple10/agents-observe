import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Folder, Check, Copy } from 'lucide-react'
import { api } from '@/lib/api-client'
import { useUIStore } from '@/stores/ui-store'
import { useEvents } from '@/hooks/use-events'

export function SessionBreadcrumb() {
  const { selectedSessionId, selectedProjectId, setSelectedSessionId } = useUIStore()

  const { data: session } = useQuery({
    queryKey: ['session', selectedSessionId],
    queryFn: () => api.getSession(selectedSessionId!),
    enabled: !!selectedSessionId,
    staleTime: 30_000,
  })

  const { data: events } = useEvents(selectedSessionId)

  const [cwdCopied, setCwdCopied] = useState(false)
  const [transcriptCopied, setTranscriptCopied] = useState(false)

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
      <span className="text-foreground truncate max-w-[200px]" title={selectedSessionId}>
        {sessionName}
      </span>
      {cwd && (
        <>
          <span className="opacity-30 mx-0.5">|</span>
          <button
            className="flex items-center gap-1 truncate opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
            onClick={() => {
              navigator.clipboard.writeText(cwd)
              setCwdCopied(true)
              setTimeout(() => setCwdCopied(false), 2000)
            }}
            title={`Click to copy: ${cwd}`}
          >
            {cwdCopied ? (
              <Check className="h-3 w-3 shrink-0 text-green-500" />
            ) : (
              <Folder className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">
              {cwdCopied ? 'Copied!' : cwd.split('/').slice(-2).join('/')}
            </span>
          </button>
        </>
      )}
      {transcriptPath && (
        <button
          className="ml-auto shrink-0 opacity-0 group-hover/breadcrumb:opacity-40 hover:!opacity-100 transition-opacity cursor-pointer"
          onClick={() => {
            navigator.clipboard.writeText(transcriptPath)
            setTranscriptCopied(true)
            setTimeout(() => setTranscriptCopied(false), 2000)
          }}
          title={
            transcriptCopied ? 'Copied transcript path!' : `Copy transcript: ${transcriptPath}`
          }
        >
          {transcriptCopied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      )}
    </div>
  )
}
