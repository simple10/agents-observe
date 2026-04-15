import type { RawEvent, EnrichedEvent, ProcessingContext, ProcessEventResult } from '../types'
import { getEventIcon, getEventColor, resolveEventKey } from './icons'
import { getEventSummary, buildSearchText } from './helpers'

// Label mapping for the framework's left-side chrome
const LABELS: Record<string, string> = {
  PreToolUse: 'Tool',
  PostToolUse: 'Tool',
  PostToolUseFailure: 'Tool',
  UserPromptSubmit: 'Prompt',
  Stop: 'Stop',
  StopFailure: 'Stop',
  SessionStart: 'Session',
  SessionEnd: 'Session',
  SubagentStart: 'SubStart',
  SubagentStop: 'SubStop',
  PermissionRequest: 'Permission',
  PermissionDenied: 'Permission',
  Notification: 'Notice',
  TaskCreated: 'Task',
  TaskCompleted: 'Task',
  TeammateIdle: 'Idle',
  InstructionsLoaded: 'Config',
  ConfigChange: 'Config',
  CwdChanged: 'Config',
  FileChanged: 'File',
  PreCompact: 'Compact',
  PostCompact: 'Compact',
  Elicitation: 'MCP',
  ElicitationResult: 'MCP',
  WorktreeCreate: 'Worktree',
  WorktreeRemove: 'Worktree',
  stop_hook_summary: 'Stop',
}

// Filter tag mapping — which categories an event belongs to
function getFilterTags(subtype: string | null, toolName: string | null): string[] {
  const tags: string[] = []

  if (subtype === 'PreToolUse' || subtype === 'PostToolUse' || subtype === 'PostToolUseFailure') {
    tags.push('tool')
    if (toolName) tags.push(toolName)
  } else if (subtype === 'UserPromptSubmit') {
    tags.push('prompt')
  } else if (subtype === 'SubagentStart' || subtype === 'SubagentStop' || subtype === 'TeammateIdle') {
    tags.push('agent')
  } else if (subtype === 'TaskCreated' || subtype === 'TaskCompleted') {
    tags.push('task')
  } else if (subtype === 'SessionStart' || subtype === 'SessionEnd' || subtype === 'Stop' || subtype === 'StopFailure' || subtype === 'stop_hook_summary') {
    tags.push('session')
  } else if (subtype === 'PermissionRequest' || subtype === 'PermissionDenied') {
    tags.push('permission')
  } else if (subtype === 'Notification') {
    tags.push('notification')
  } else if (subtype === 'Elicitation' || subtype === 'ElicitationResult') {
    tags.push('mcp')
  } else if (subtype === 'InstructionsLoaded' || subtype === 'ConfigChange' || subtype === 'CwdChanged' || subtype === 'FileChanged') {
    tags.push('config')
  }

  return tags
}

function deriveStatus(subtype: string | null): EnrichedEvent['status'] {
  if (subtype === 'PreToolUse') return 'running'
  if (subtype === 'PostToolUse') return 'completed'
  if (subtype === 'PostToolUseFailure') return 'failed'
  return 'completed'
}

/**
 * Claude Code processEvent implementation.
 *
 * Handles:
 * - Pre/PostToolUse pairing (groupId = toolUseId)
 * - Turn tracking (UserPromptSubmit starts turn, Stop ends turn)
 * - Display flags (PostToolUse hidden from stream, merged into Pre)
 * - Spawn info extraction for Agent tool calls
 */
export function processEvent(raw: RawEvent, ctx: ProcessingContext): ProcessEventResult {
  const p = raw.payload as Record<string, any>
  const subtype = raw.subtype
  const toolName = raw.toolName
  const toolUseId = raw.toolUseId

  // Resolve icon and color
  const iconKey = resolveEventKey(subtype, toolName)
  const icon = getEventIcon(subtype, toolName)
  const { iconColor, dotColor, customHex } = getEventColor(subtype, toolName)

  // Turn tracking
  let turnId = ctx.getCurrentTurn(raw.agentId)
  if (subtype === 'UserPromptSubmit' || subtype === 'SubagentStart') {
    turnId = `turn-${raw.id}`
    ctx.setCurrentTurn(raw.agentId, turnId)
  } else if (subtype === 'Stop' || subtype === 'SessionEnd' || subtype === 'SubagentStop' || subtype === 'stop_hook_summary') {
    // Keep the current turnId for this event, then clear
    ctx.clearCurrentTurn(raw.agentId)
  }

  // Group ID for pairing (tool use events)
  let groupId: string | null = null
  let displayEventStream = true
  let displayTimeline = true

  if (subtype === 'PreToolUse' && toolUseId) {
    groupId = toolUseId
  } else if ((subtype === 'PostToolUse' || subtype === 'PostToolUseFailure') && toolUseId) {
    groupId = toolUseId

    // Check if there's a corresponding PreToolUse to merge into
    const grouped = ctx.getGroupedEvents(toolUseId)
    const preEvent = grouped.find((e) => e.subtype === 'PreToolUse')
    if (preEvent) {
      // Hide this PostToolUse from the stream — it merges into the Pre
      displayEventStream = false
      displayTimeline = false

      // Update the PreToolUse with completion status and result info
      const newStatus = subtype === 'PostToolUseFailure' ? 'failed' : 'completed'
      const resultText = extractResultText(p.tool_response)
      ctx.updateEvent(preEvent.id, {
        status: newStatus,
        // Append Post payload info to searchText for searchability
        searchText: preEvent.searchText + ' ' + (resultText?.toLowerCase() ?? ''),
      })
    }
    // If no PreToolUse found, show this PostToolUse normally
  }

  // Build the enriched event
  const summary = getEventSummary(raw)
  const enriched: EnrichedEvent = {
    // Core fields
    id: raw.id,
    agentId: raw.agentId,
    sessionId: raw.sessionId,
    timestamp: raw.timestamp,
    createdAt: raw.createdAt,
    type: raw.type,
    subtype: raw.subtype,

    // Enrichment
    groupId,
    turnId,
    displayEventStream,
    displayTimeline,
    label: LABELS[subtype ?? ''] || subtype || 'Event',
    toolName,
    toolUseId,
    icon,
    iconColor,
    iconColorHex: customHex ?? null,
    status: deriveStatus(subtype),
    filterTags: getFilterTags(subtype, toolName),
    searchText: buildSearchText(raw, summary),

    // Original payload
    payload: raw.payload,

    // Convenience fields for components
    cwd: p.cwd as string | undefined,
    summary,
  }

  return { event: enriched }
}

/** Extract display text from a tool_response for search indexing */
function extractResultText(toolResponse: any): string | null {
  if (!toolResponse) return null
  if (typeof toolResponse === 'string') return toolResponse
  if (toolResponse.stdout) return toolResponse.stdout
  if (Array.isArray(toolResponse.content)) {
    return toolResponse.content
      .map((r: any) => (r?.type === 'text' && r?.text ? r.text : ''))
      .filter(Boolean)
      .join(' ')
  }
  if (typeof toolResponse.content === 'string') return toolResponse.content
  return null
}
