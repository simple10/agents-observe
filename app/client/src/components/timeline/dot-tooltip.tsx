import { format } from 'timeago.js'
import { getEventSummary } from '@/lib/event-summary'
import type { ParsedEvent } from '@/types'

// Friendly label for event types shown at the top of the tooltip
function tooltipLabel(event: ParsedEvent): string {
  if (event.subtype === 'PreToolUse' || event.subtype === 'PostToolUse') {
    return event.toolName || 'Tool'
  }
  const map: Record<string, string> = {
    UserPromptSubmit: 'Prompt',
    Stop: 'Stop',
    SessionStart: 'Session Start',
  }
  return map[event.subtype || ''] || event.subtype || event.type
}

function formatTimeOfDay(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * Tooltip content for a timeline dot. The computations inside this component
 * only run when the tooltip is actually open — Radix's TooltipContent uses
 * Presence to mount children lazily, so rendering thousands of tooltip
 * elements in the parent's JSX has near-zero cost until one is shown.
 */
export function DotTooltipContent({ event }: { event: ParsedEvent }) {
  const label = tooltipLabel(event)
  const summary = getEventSummary(event)
  const time = formatTimeOfDay(event.timestamp)
  const relative = format(event.timestamp)
  const hook = event.subtype && event.subtype !== label ? event.subtype : null

  return (
    <>
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{label}</span>
        {hook && (
          <span className="ml-auto text-[10px] font-normal opacity-70">{hook}</span>
        )}
      </div>
      {summary && <div className="opacity-80 truncate">{summary}</div>}
      <div className="text-[10px] font-medium tabular-nums mt-0.5">
        {time} <span className="opacity-80">({relative})</span>
      </div>
    </>
  )
}
