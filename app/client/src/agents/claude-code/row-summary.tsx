// Claude Code agent class — row summary component.
// Renders the summary line for a collapsed event row (the agent-owned section).

import type { EventProps } from '../types'

/**
 * Renders the one-line summary for a Claude Code event.
 * The framework handles the chrome (agent label, type badge, icon, timestamp).
 * This component renders the content area — tool name, status, and summary text.
 */
export function ClaudeCodeRowSummary({ event }: EventProps) {
  const summary = (event.summary as string) || ''
  const toolName = event.toolName
  const isTool = event.subtype === 'PreToolUse' || event.subtype === 'PostToolUse' || event.subtype === 'PostToolUseFailure'

  return (
    <>
      {isTool && toolName && (
        <span className="text-xs font-medium text-blue-700 dark:text-blue-400 shrink-0">
          {toolName}
        </span>
      )}
      {summary.includes('\n') ? (
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
    </>
  )
}
