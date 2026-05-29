import type { EnrichedEvent, FrameworkDataApi } from '../types'

export function HermesRowSummary({ event }: { event: EnrichedEvent; dataApi: FrameworkDataApi }) {
  return (
    <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{event.summary}</span>
  )
}
