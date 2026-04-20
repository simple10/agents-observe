import type { RawEvent, EnrichedEvent, ProcessingContext, ProcessEventResult } from '../types'
import { getEventIcon, getEventColor } from './icons'
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

/** Map event to filter categories. Returns null for hidden events. */
function getFilterTags(
  subtype: string | null,
  toolName: string | null,
  display: boolean,
): EnrichedEvent['filterTags'] {
  if (!display) return { static: null, dynamic: [] }

  const isTool =
    subtype === 'PreToolUse' || subtype === 'PostToolUse' || subtype === 'PostToolUseFailure'

  if (isTool) {
    const dynamic: string[] = []
    if (toolName) {
      // Normalize MCP tool names: mcp__chrome-devtools__click → mcp__chrome-devtools
      if (toolName.startsWith('mcp__')) {
        const match = toolName.match(/^(mcp__[^_]+(?:_[^_]+)*?)__/)
        dynamic.push(match ? match[1] : toolName)
      } else {
        dynamic.push(toolName)
      }
    }
    // MCP tools → MCP category
    if (toolName?.startsWith('mcp__')) return { static: 'MCP', dynamic }
    // Agent tool → Agents category (not Tools)
    if (toolName === 'Agent') return { static: 'Agents', dynamic }
    // TaskCreate/TaskUpdate tools → Tasks category
    if (toolName === 'TaskCreate' || toolName === 'TaskUpdate') return { static: 'Tasks', dynamic }
    return { static: 'Tools', dynamic }
  }

  if (subtype === 'UserPromptSubmit') return { static: 'Prompts', dynamic: [] }
  if (subtype === 'SubagentStart' || subtype === 'TeammateIdle')
    return { static: 'Agents', dynamic: [] }
  if (subtype === 'TaskCreated' || subtype === 'TaskCompleted')
    return { static: 'Tasks', dynamic: [] }
  if (subtype === 'SessionStart' || subtype === 'SessionEnd')
    return { static: 'Session', dynamic: [] }
  if (
    subtype === 'Stop' ||
    subtype === 'StopFailure' ||
    subtype === 'SubagentStop' ||
    subtype === 'stop_hook_summary'
  )
    return { static: 'Stop', dynamic: [] }
  if (subtype === 'PermissionRequest') return { static: 'Permissions', dynamic: [] }
  if (subtype === 'Notification') return { static: 'Notifications', dynamic: [] }
  if (subtype === 'Elicitation' || subtype === 'ElicitationResult')
    return { static: 'MCP', dynamic: [] }
  if (subtype === 'PreCompact' || subtype === 'PostCompact')
    return { static: 'Compaction', dynamic: [] }
  if (
    subtype === 'InstructionsLoaded' ||
    subtype === 'ConfigChange' ||
    subtype === 'CwdChanged' ||
    subtype === 'FileChanged'
  )
    return { static: 'Config', dynamic: [subtype] }

  return { static: null, dynamic: subtype ? [subtype] : [] }
}

function deriveStatus(subtype: string | null): EnrichedEvent['status'] {
  if (subtype === 'PreToolUse') return 'running'
  if (subtype === 'PostToolUse') return 'completed'
  if (subtype === 'PostToolUseFailure') return 'failed'
  if (subtype === 'PreCompact') return 'running'
  if (subtype === 'PostCompact') return 'completed'
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
  // tool_use_id is Claude-Code-specific — read from payload directly
  // rather than a top-level field. Used for Pre/Post pairing groupId.
  const toolUseId: string | null = typeof p.tool_use_id === 'string' ? p.tool_use_id : null

  // Resolve icon and color
  const icon = getEventIcon(subtype, toolName)
  const { iconColor, dotColor, customHex } = getEventColor(subtype, toolName)
  const dedup = ctx.dedupEnabled

  // Turn tracking (only when dedup is on)
  let turnId: string | null = null
  if (dedup) {
    turnId = ctx.getCurrentTurn(raw.agentId)
    if (subtype === 'UserPromptSubmit' || subtype === 'SubagentStart') {
      turnId = `turn-${raw.id}`
      ctx.setCurrentTurn(raw.agentId, turnId)
    } else if (
      subtype === 'Stop' ||
      subtype === 'SessionEnd' ||
      subtype === 'SubagentStop' ||
      subtype === 'stop_hook_summary'
    ) {
      ctx.clearCurrentTurn(raw.agentId)
    }
  }

  // Group ID, display flags, status override (only when dedup is on)
  let groupId: string | null = null
  let displayEventStream = true
  let displayTimeline = true
  let statusOverride: EnrichedEvent['status'] | null = null

  if (dedup) {
    // Task grouping: group by task_id, hide TaskUpdate/TaskCompleted tool events
    const taskId = (p.task_id ?? p.tool_input?.taskId ?? p.tool_response?.taskId) as
      | string
      | undefined
    if (taskId) {
      groupId = `task-${taskId}`
    }

    if (subtype === 'TaskCreated') {
      statusOverride = 'pending'
    } else if (subtype === 'TaskCompleted') {
      const grouped = groupId ? ctx.getGroupedEvents(groupId) : []
      const createdEvent = grouped.find((e) => e.subtype === 'TaskCreated')
      if (createdEvent) {
        displayEventStream = false
        displayTimeline = false
        ctx.updateEvent(createdEvent.id, { status: 'completed' })
      }
    }

    if (toolName === 'TaskCreate') {
      displayEventStream = false
      displayTimeline = false
    }

    if (toolName === 'TaskUpdate') {
      const updateTaskId = p.tool_input?.taskId as string | undefined
      if (updateTaskId) {
        groupId = `task-${updateTaskId}`
        displayEventStream = false
        displayTimeline = false

        const grouped = ctx.getGroupedEvents(groupId)
        const createdEvent = grouped.find((e) => e.subtype === 'TaskCreated')
        if (createdEvent) {
          const newStatus = p.tool_input?.status as string | undefined
          if (newStatus === 'completed') {
            ctx.updateEvent(createdEvent.id, { status: 'completed' })
          } else if (newStatus === 'in_progress') {
            ctx.updateEvent(createdEvent.id, { status: 'running' })
          }
        }
      }
    }

    if (subtype === 'PreToolUse' && toolUseId) {
      if (!groupId) groupId = toolUseId
    } else if ((subtype === 'PostToolUse' || subtype === 'PostToolUseFailure') && toolUseId) {
      if (!groupId) groupId = toolUseId

      const grouped = ctx.getGroupedEvents(groupId)
      const preEvent = grouped.find((e) => e.subtype === 'PreToolUse')
      if (preEvent) {
        displayEventStream = false
        displayTimeline = false

        const newStatus = subtype === 'PostToolUseFailure' ? 'failed' : 'completed'
        const resultText = extractResultText(p.tool_response)
        ctx.updateEvent(preEvent.id, {
          status: newStatus,
          searchText: preEvent.searchText + ' ' + (resultText?.toLowerCase() ?? ''),
        })
      }
    }

    // Compact pairing — PreCompact / PostCompact have no linking id on
    // their payload, so we stash a synthetic groupId under a per-agent
    // pending key. Compaction is serial per agent, so one slot is enough.
    // When PostCompact arrives we read the slot back, merge Post's payload
    // into the Pre row (so the detail pane can show trigger +
    // custom_instructions + compact_summary together), and hide the Post
    // event from both streams.
    if (subtype === 'PreCompact') {
      groupId = `compact-${raw.id}`
      ctx.setPendingGroup(`compact:${raw.agentId}`, groupId)
    } else if (subtype === 'PostCompact') {
      const pending = ctx.getPendingGroup(`compact:${raw.agentId}`)
      if (pending) {
        groupId = pending
        ctx.clearPendingGroup(`compact:${raw.agentId}`)

        const grouped = ctx.getGroupedEvents(groupId)
        const preEvent = grouped.find((e) => e.subtype === 'PreCompact')
        if (preEvent) {
          displayEventStream = false
          displayTimeline = false

          const summaryText =
            typeof p.compact_summary === 'string' ? p.compact_summary.toLowerCase() : ''
          ctx.updateEvent(preEvent.id, {
            status: 'completed',
            payload: { ...preEvent.payload, ...p },
            summary: 'Compacted context',
            searchText: preEvent.searchText + (summaryText ? ' ' + summaryText : ''),
          })
        }
      }
    }
  }

  // Build the enriched event
  const summary = getEventSummary(raw)
  const enriched: EnrichedEvent = {
    // Core fields
    id: raw.id,
    agentId: raw.agentId,
    sessionId: raw.sessionId,
    hookName: raw.hookName,
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
    dotColor,
    iconColorHex: customHex ?? null,
    dedupMode: dedup,
    status: statusOverride ?? deriveStatus(subtype),
    filterTags: getFilterTags(subtype, toolName, displayEventStream),
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
