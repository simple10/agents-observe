// Claude Code agent class — row summary component.
// Renders the summary line for a collapsed event row (the agent-owned section).

import { getEventColor } from './icons'
import type { EventProps } from '../types'

/**
 * Renders the one-line summary for a Claude Code event.
 * The framework handles the chrome (agent label, type badge, icon, timestamp).
 * This component renders the content area — tool name, status, and summary text.
 */
/** Extract [binary] prefix from summary if present */
function parseBinaryPrefix(summary: string): { binary: string | null; rest: string } {
  const match = summary.match(/^\[([^\]]+)\]\s*(.*)$/)
  if (match) return { binary: match[1], rest: match[2] }
  return { binary: null, rest: summary }
}

export function ClaudeCodeRowSummary({ event }: EventProps) {
  const summary = (event.summary as string) || ''
  const toolName = event.toolName
  const isTool =
    event.subtype === 'PreToolUse' ||
    event.subtype === 'PostToolUse' ||
    event.subtype === 'PostToolUseFailure'
  const { binary, rest } = isTool ? parseBinaryPrefix(summary) : { binary: null, rest: summary }

  return (
    <>
      {/* Show hook subtype when dedup is off so you know exactly what this event is */}
      {!event.dedupMode && event.subtype && (
        <span className="text-[10px] text-muted-foreground/40 shrink-0">{event.subtype}</span>
      )}
      {isTool && toolName && (
        <span
          className={`text-xs font-medium shrink-0 ${getEventColor(event.subtype, event.toolName).iconColor || 'text-blue-700 dark:text-blue-400'}`}
        >
          {toolName.startsWith('mcp__') ? 'MCP' : toolName}
        </span>
      )}
      {isTool && toolName?.startsWith('mcp__') && (
        <span className="text-[10px] text-muted-foreground/50 shrink-0">{toolName}</span>
      )}
      {binary && <span className="text-[10px] text-muted-foreground/50 shrink-0">{binary}</span>}
      {rest.includes('\n') ? (
        <div className="text-xs text-muted-foreground flex-1 min-w-0">
          {rest.split('\n').map((line, i) => (
            <div key={i} className="truncate">
              {line}
            </div>
          ))}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{rest}</span>
      )}
    </>
  )
}
