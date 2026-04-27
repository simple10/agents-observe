import type { RawEvent, ProcessingContext } from '../types'
import type { ClaudeCodeEnrichedEvent } from './types'
import { getEventIcon, getEventColor } from './icons'
import { getEventSummary, buildSearchText } from './helpers'
import { deriveToolName } from './derivers'
import { agentPatchDebouncer } from '@/lib/agent-patch-debouncer'

// Label mapping for the framework's left-side chrome. Keyed by hookName.
const LABELS: Record<string, string> = {
  PreToolUse: 'Tool',
  PostToolUse: 'Tool',
  PostToolUseFailure: 'Tool',
  UserPromptSubmit: 'Prompt',
  UserPromptExpansion: 'PromptExp',
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
  hookName: string,
  toolName: string | null,
  display: boolean,
): ClaudeCodeEnrichedEvent['filterTags'] {
  if (!display) return { static: null, dynamic: [] }

  const isTool =
    hookName === 'PreToolUse' || hookName === 'PostToolUse' || hookName === 'PostToolUseFailure'

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
    if (toolName?.startsWith('mcp__')) return { static: 'MCP', dynamic }
    if (toolName === 'Agent') return { static: 'Agents', dynamic }
    if (toolName === 'TaskCreate' || toolName === 'TaskUpdate') return { static: 'Tasks', dynamic }
    return { static: 'Tools', dynamic }
  }

  if (hookName === 'UserPromptSubmit' || hookName === 'UserPromptExpansion')
    return { static: 'Prompts', dynamic: [] }
  if (hookName === 'SubagentStart' || hookName === 'TeammateIdle')
    return { static: 'Agents', dynamic: [] }
  if (hookName === 'TaskCreated' || hookName === 'TaskCompleted')
    return { static: 'Tasks', dynamic: [] }
  if (hookName === 'SessionStart' || hookName === 'SessionEnd')
    return { static: 'Session', dynamic: [] }
  if (
    hookName === 'Stop' ||
    hookName === 'StopFailure' ||
    hookName === 'SubagentStop' ||
    hookName === 'stop_hook_summary'
  )
    return { static: 'Stop', dynamic: [] }
  if (hookName === 'PermissionRequest') return { static: 'Permissions', dynamic: [] }
  if (hookName === 'Notification') return { static: 'Notifications', dynamic: [] }
  if (hookName === 'Elicitation' || hookName === 'ElicitationResult')
    return { static: 'MCP', dynamic: [] }
  if (hookName === 'PreCompact' || hookName === 'PostCompact')
    return { static: 'Compaction', dynamic: [] }
  if (
    hookName === 'InstructionsLoaded' ||
    hookName === 'ConfigChange' ||
    hookName === 'CwdChanged' ||
    hookName === 'FileChanged'
  )
    return { static: 'Config', dynamic: [hookName] }

  return { static: null, dynamic: hookName ? [hookName] : [] }
}

/**
 * Build the minimal `AgentPatch` that would actually change the canonical
 * agent row, given the values discovered in an event.
 */
function diffAgentPatch(
  current:
    | { name?: string | null; description?: string | null; agentType?: string | null }
    | undefined,
  proposed: { name?: string | null; description?: string | null; agent_type?: string | null },
): { name?: string | null; description?: string | null; agent_type?: string | null } | null {
  const patch: { name?: string | null; description?: string | null; agent_type?: string | null } =
    {}
  if ('name' in proposed && proposed.name != null && proposed.name !== current?.name) {
    patch.name = proposed.name
  }
  if (
    'description' in proposed &&
    proposed.description != null &&
    proposed.description !== current?.description
  ) {
    patch.description = proposed.description
  }
  if (
    'agent_type' in proposed &&
    proposed.agent_type != null &&
    proposed.agent_type !== current?.agentType
  ) {
    patch.agent_type = proposed.agent_type
  }
  return Object.keys(patch).length === 0 ? null : patch
}

/** Local fallback for the inline status decision inside processEvent. */
function deriveLocalStatus(hookName: string): ClaudeCodeEnrichedEvent['status'] {
  if (hookName === 'PreToolUse') return 'running'
  if (hookName === 'PostToolUse') return 'completed'
  if (hookName === 'PostToolUseFailure') return 'failed'
  if (hookName === 'PreCompact') return 'running'
  if (hookName === 'PostCompact') return 'completed'
  return 'completed'
}

// ---- Slot computation (the slotted-row pattern) ----------------------------
// processEvent decides what (if anything) goes in each summary slot. The
// row-summary component just renders whatever it finds — no per-hookName
// switching at render time.

/** Extract the "[binary]" prefix from a summary, if present. */
function parseBinaryPrefix(summary: string): { binary: string | null; rest: string } {
  const match = summary.match(/^\[([^\]]+)\]\s*(.*)$/)
  if (match) return { binary: match[1], rest: match[2] }
  return { binary: null, rest: summary }
}

/** Compute the (summaryTool, summaryCmd, summary) tuple for a Claude Code event. */
function computeSlots(
  hookName: string,
  toolName: string | null,
  rawSummary: string,
  payload: Record<string, unknown>,
): { summaryTool?: string; summaryCmd?: string; summary: string } {
  const isTool =
    hookName === 'PreToolUse' || hookName === 'PostToolUse' || hookName === 'PostToolUseFailure'

  if (isTool && toolName) {
    const { binary, rest } = parseBinaryPrefix(rawSummary)
    const displayTool = toolName.startsWith('mcp__') ? 'MCP' : toolName
    return {
      summaryTool: displayTool,
      summaryCmd: toolName.startsWith('mcp__') ? toolName : (binary ?? undefined),
      summary: rest,
    }
  }

  if (hookName === 'UserPromptExpansion') {
    const expansionType = (payload as Record<string, unknown>).expansion_type
    if (typeof expansionType === 'string' && expansionType) {
      return { summaryTool: expansionType, summary: rawSummary }
    }
  }

  return { summary: rawSummary }
}

/**
 * Claude Code processEvent implementation.
 */
export function processEvent(
  raw: RawEvent,
  ctx: ProcessingContext,
): { event: ClaudeCodeEnrichedEvent } {
  const p = raw.payload as Record<string, any>
  const hookName = raw.hookName
  const toolName = deriveToolName(raw)
  const toolUseId: string | null = typeof p.tool_use_id === 'string' ? p.tool_use_id : null

  // ---- Subagent-pairing (PreToolUse:Agent → PostToolUse:Agent) ---------
  if (hookName === 'PreToolUse' && toolName === 'Agent' && toolUseId) {
    const inputName = typeof p.tool_input?.name === 'string' ? (p.tool_input.name as string) : null
    const inputDesc =
      typeof p.tool_input?.description === 'string' ? (p.tool_input.description as string) : null
    if (inputName !== null || inputDesc !== null) {
      ctx.stashPendingAgentMeta(toolUseId, { name: inputName, description: inputDesc })
    }
  }
  if (hookName === 'SubagentStart') {
    const agentType = typeof p.agent_type === 'string' ? (p.agent_type as string) : null
    const agentName = typeof p.name === 'string' ? (p.name as string) : null
    const patch = diffAgentPatch(ctx.getAgent(raw.agentId), {
      name: agentName,
      agent_type: agentType,
    })
    if (patch) agentPatchDebouncer.schedule(raw.agentId, patch)
  }
  if (hookName === 'PostToolUse' && toolName === 'Agent' && toolUseId) {
    const spawnedAgentId =
      typeof p.tool_response?.agentId === 'string' ? (p.tool_response.agentId as string) : null
    if (spawnedAgentId) {
      const meta = ctx.consumePendingAgentMeta(toolUseId)
      if (meta && (meta.name || meta.description)) {
        const patch = diffAgentPatch(ctx.getAgent(spawnedAgentId), {
          name: meta.name,
          description: meta.description,
        })
        if (patch) agentPatchDebouncer.schedule(spawnedAgentId, patch)
      }
    }
  }

  // Resolve icon and color
  const icon = getEventIcon(hookName, toolName)
  const { iconColor, dotColor, customHex } = getEventColor(hookName, toolName)
  const dedup = ctx.dedupEnabled

  // Turn tracking (only when dedup is on)
  let turnId: string | null = null
  if (dedup) {
    turnId = ctx.getCurrentTurn(raw.agentId)
    if (hookName === 'UserPromptSubmit' || hookName === 'SubagentStart') {
      turnId = `turn-${raw.id}`
      ctx.setCurrentTurn(raw.agentId, turnId)
    } else if (
      hookName === 'Stop' ||
      hookName === 'SessionEnd' ||
      hookName === 'SubagentStop' ||
      hookName === 'stop_hook_summary'
    ) {
      ctx.clearCurrentTurn(raw.agentId)
    }
  }

  // Group ID, display flags, status override (only when dedup is on)
  let groupId: string | null = null
  let displayEventStream = true
  let displayTimeline = true
  let statusOverride: ClaudeCodeEnrichedEvent['status'] | null = null

  if (dedup) {
    // Task grouping
    const taskId = (p.task_id ?? p.tool_input?.taskId ?? p.tool_response?.taskId) as
      | string
      | undefined
    if (taskId) {
      groupId = `task-${taskId}`
    }

    if (hookName === 'TaskCreated') {
      statusOverride = 'pending'
    } else if (hookName === 'TaskCompleted') {
      const grouped = groupId ? ctx.getGroupedEvents(groupId) : []
      const createdEvent = grouped.find((e) => e.hookName === 'TaskCreated')
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
        const createdEvent = grouped.find((e) => e.hookName === 'TaskCreated')
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

    if (hookName === 'PreToolUse' && toolUseId) {
      if (!groupId) groupId = toolUseId
    } else if ((hookName === 'PostToolUse' || hookName === 'PostToolUseFailure') && toolUseId) {
      if (!groupId) groupId = toolUseId

      const grouped = ctx.getGroupedEvents(groupId)
      const preEvent = grouped.find((e) => e.hookName === 'PreToolUse')
      if (preEvent) {
        displayEventStream = false
        displayTimeline = false

        const newStatus = hookName === 'PostToolUseFailure' ? 'failed' : 'completed'
        const resultText = extractResultText(p.tool_response)
        ctx.updateEvent(preEvent.id, {
          status: newStatus,
          searchText: preEvent.searchText + ' ' + (resultText?.toLowerCase() ?? ''),
        })
      }
    }

    // Compact pairing
    if (hookName === 'PreCompact') {
      groupId = `compact-${raw.id}`
      ctx.setPendingGroup(`compact:${raw.agentId}`, groupId)
    } else if (hookName === 'PostCompact') {
      const pending = ctx.getPendingGroup(`compact:${raw.agentId}`)
      if (pending) {
        groupId = pending
        ctx.clearPendingGroup(`compact:${raw.agentId}`)

        const grouped = ctx.getGroupedEvents(groupId)
        const preEvent = grouped.find((e) => e.hookName === 'PreCompact')
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
  const rawSummary = getEventSummary(raw, hookName, toolName)
  const slots = computeSlots(hookName, toolName, rawSummary, raw.payload)

  const enriched: ClaudeCodeEnrichedEvent = {
    // Identity
    id: raw.id,
    agentId: raw.agentId,
    hookName,
    timestamp: raw.timestamp,

    // Per-class enrichment
    toolName,
    groupId,
    turnId,
    displayEventStream,
    displayTimeline,
    label: LABELS[hookName] || hookName || 'Event',
    labelTooltip: hookName,
    icon,
    iconColor,
    dotColor,
    iconColorHex: customHex ?? null,
    dedupMode: dedup,
    status: statusOverride ?? deriveLocalStatus(hookName),
    filterTags: getFilterTags(hookName, toolName, displayEventStream),
    searchText: buildSearchText(raw, slots.summary, toolName),
    summary: slots.summary,

    // Original payload
    payload: raw.payload,

    // Claude-specific fields (optional — only set when payload carries them)
    ...(toolUseId !== null ? { toolUseId } : {}),
    ...(typeof p.cwd === 'string' ? { cwd: p.cwd as string } : {}),

    // Summary slots (optional — set by computeSlots when applicable)
    ...(slots.summaryTool !== undefined ? { summaryTool: slots.summaryTool } : {}),
    ...(slots.summaryCmd !== undefined ? { summaryCmd: slots.summaryCmd } : {}),
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
