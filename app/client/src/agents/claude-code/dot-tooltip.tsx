// Claude Code agent class — timeline dot tooltip.

import { format } from 'timeago.js'
import type { EnrichedEvent } from '../types'

function formatTimeOfDay(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function tooltipLabel(event: EnrichedEvent): string {
  const sub = event.hookName
  if (sub === 'UserPromptSubmit') return 'Prompt'
  if (sub === 'Stop' || sub === 'stop_hook_summary') return 'Stop'
  if (sub === 'SessionStart') return 'Session Start'
  if (sub === 'SessionEnd') return 'Session End'
  if (sub === 'SubagentStart') return 'Subagent Start'
  if (sub === 'SubagentStop') return 'Subagent Stop'
  if (sub === 'PreToolUse' || sub === 'PostToolUse' || sub === 'PostToolUseFailure') {
    return event.toolName ? `Tool: ${event.toolName}` : 'Tool'
  }
  return event.label || sub || 'Event'
}

export function ClaudeCodeDotTooltip({ event }: { event: EnrichedEvent }) {
  const label = tooltipLabel(event)
  const summary = (event.summary as string) || ''

  return (
    <div className="space-y-0.5">
      <div className="font-medium">{label}</div>
      {summary && <div className="opacity-90 max-w-48 truncate">{summary}</div>}
      <div className="opacity-60 text-[10px]">
        {formatTimeOfDay(event.timestamp)} · {format(event.timestamp)}
      </div>
      {event.hookName !== label && <div className="opacity-40 text-[9px]">{event.hookName}</div>}
    </div>
  )
}
