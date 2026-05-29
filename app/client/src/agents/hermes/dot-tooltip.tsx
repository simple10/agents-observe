import type { EnrichedEvent } from '../types'

export function HermesDotTooltip({ event }: { event: EnrichedEvent }) {
  return (
    <div>
      <div className="font-medium">{event.label}</div>
      {event.summary && <div className="opacity-70 max-w-[260px] truncate">{event.summary}</div>}
    </div>
  )
}
