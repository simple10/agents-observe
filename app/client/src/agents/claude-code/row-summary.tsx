// Claude Code agent class — row summary component.
// Renders the agent-owned section of the row. All per-hookName decisions
// (what goes in each slot, status pills, etc.) live in `processEvent`.
// This component is a dumb renderer for the slot fields.

import { computeRuntimeMs, formatRuntime } from './runtime'
import type { FrameworkDataApi } from '../types'
import type { ClaudeCodeEnrichedEvent } from './types'

interface Props {
  event: ClaudeCodeEnrichedEvent
  dataApi: FrameworkDataApi
}

const STOP_HOOKS = new Set(['Stop', 'stop_hook_summary', 'SubagentStop'])

export function ClaudeCodeRowSummary({ event, dataApi }: Props) {
  // For Stop / SubagentStop events, compute runtime from the matching
  // start in the same turn and render it as a trailing muted pill.
  let runtimeLabel: string | null = null
  if (STOP_HOOKS.has(event.hookName) && event.turnId) {
    const turnEvents = dataApi.getTurnEvents(event.turnId)
    const ms = computeRuntimeMs(event, null, turnEvents)
    if (ms != null) runtimeLabel = formatRuntime(ms)
  }

  const summary = event.summary
  const summaryHasNewline = summary.includes('\n')

  return (
    <>
      {/* Show hook name when dedup is off so you know exactly what this event is */}
      {!event.dedupMode && (
        <span className="text-[10px] text-muted-foreground/40 shrink-0">{event.hookName}</span>
      )}
      {/* Slot 1: colored "tool" slot — uses iconColor from the enriched event */}
      {event.summaryTool && (
        <span
          className={`text-xs font-medium shrink-0 ${event.iconColor || 'text-blue-700 dark:text-blue-400'}`}
        >
          {event.summaryTool}
        </span>
      )}
      {/* Slot 2: gray "cmd" slot */}
      {event.summaryCmd && (
        <span className="text-[10px] text-muted-foreground/50 shrink-0">{event.summaryCmd}</span>
      )}
      {/* Summary text */}
      {summaryHasNewline ? (
        <div className="text-xs text-muted-foreground flex-1 min-w-0">
          {summary.split('\n').map((line, i) => (
            <div key={i} className="truncate">
              {line}
            </div>
          ))}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{summary}</span>
      )}
      {runtimeLabel && (
        <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">
          {runtimeLabel}
        </span>
      )}
    </>
  )
}
