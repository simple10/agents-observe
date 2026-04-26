import type { ParsedEvent } from '@/types'
import { deriveSubtype, deriveToolName } from '@/agents/claude-code/derivers'

export interface StaticFilter {
  label: string
  // Simple subtype matching (OR'd together)
  subtypes?: string[]
  // Custom match function for payload-level filtering. Receives the raw
  // wire event plus the derived subtype/toolName so each match
  // implementation doesn't have to re-derive.
  match?: (event: ParsedEvent, subtype: string | null, toolName: string | null) => boolean
}

// Row 1: Static filters that group related hook subtypes.
// A filter can use subtypes, a match function, or both (OR'd).
export const STATIC_FILTERS: StaticFilter[] = [
  { label: 'Prompts', subtypes: ['UserPromptSubmit', 'UserPromptExpansion'] },
  {
    label: 'Tools',
    subtypes: ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'],
    // Exclude MCP tools — those are covered by the MCP filter
    match: (_e, subtype, toolName) =>
      (subtype === 'PreToolUse' || subtype === 'PostToolUse' || subtype === 'PostToolUseFailure') &&
      !!toolName &&
      !toolName.startsWith('mcp__'),
  },
  {
    label: 'Agents',
    subtypes: ['SubagentStart', 'SubagentStop'],
    match: (_e, _subtype, toolName) => toolName === 'Agent',
  },
  {
    label: 'Tasks',
    subtypes: ['TaskCreated', 'TaskCompleted'],
    match: (_e, _subtype, toolName) => toolName === 'TaskCreate' || toolName === 'TaskUpdate',
  },
  { label: 'Session', subtypes: ['SessionStart', 'SessionEnd'] },
  {
    label: 'MCP',
    subtypes: ['Elicitation', 'ElicitationResult'],
    match: (_e, _subtype, toolName) => !!toolName?.startsWith('mcp__'),
  },
  { label: 'Permissions', subtypes: ['PermissionRequest'] },
  { label: 'Notifications', subtypes: ['Notification'] },
  { label: 'Stop', subtypes: ['Stop', 'StopFailure', 'SubagentStop'] },
  { label: 'Compaction', subtypes: ['PreCompact', 'PostCompact'] },
  {
    label: 'Config',
    subtypes: ['InstructionsLoaded', 'ConfigChange', 'CwdChanged', 'FileChanged'],
  },
  {
    label: 'Errors',
    match: (e, subtype, _toolName) => {
      const payload = e.payload as Record<string, unknown> | undefined
      // Tool failure subtypes (legacy data has hookName='PostToolUseFailure'
      // directly; new data may have a paired PreToolUse whose status was
      // bumped to 'failed' when a PostToolUseFailure was merged in).
      if (subtype === 'PostToolUseFailure' || subtype === 'StopFailure') return true
      // EnrichedEvent carries a derived `status` after processEvent's
      // Pre/Post pairing — a PreToolUse whose paired PostToolUseFailure
      // landed gets `status === 'failed'` and should match here.
      if ((e as { status?: string }).status === 'failed') return true
      // Top-level error field (covers Notifications and StopFailure
      // payloads, plus any raw error event).
      if (typeof payload?.error === 'string' && payload.error !== '') return true
      // Tool failures for new-shape data where the failure is encoded in
      // the response rather than in the hookName.
      const tr = payload?.tool_response as Record<string, unknown> | undefined
      if (tr?.is_error === true) return true
      if (typeof tr?.error === 'string' && tr.error !== '') return true
      return false
    },
  },
]

// Subtypes that produce dynamic (row 2) tool-name filters.
const DYNAMIC_SUBTYPES = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure'])

// All subtypes explicitly covered by at least one static filter.
// Events with subtypes NOT in this set will appear as dynamic catchall pills.
const STATIC_COVERED_SUBTYPES = new Set(STATIC_FILTERS.flatMap((f) => f.subtypes ?? []))

// Display-name overrides for dynamic catchall subtypes.
// Add entries here to give hook subtypes friendlier pill labels.
const DYNAMIC_DISPLAY_NAMES: Record<string, string> = {
  CwdChanged: 'CWD',
  FileChanged: 'File',
}

/** Return a human-friendly label for a dynamic filter key. */
export function getDynamicDisplayName(key: string): string {
  return DYNAMIC_DISPLAY_NAMES[key] ?? key
}

// Normalize MCP tool names: mcp__chrome-devtools__click → mcp__chrome-devtools
function normalizeMcpName(name: string): string {
  const match = name.match(/^(mcp__[^_]+(?:_[^_]+)*?)__/)
  return match ? match[1] : name
}

// Extract dynamic filter names from events (tool names + uncovered hook subtypes).
// This is the catchall: anything not represented in the static row gets a pill here.
export function getDynamicFilterNames(events: ParsedEvent[]): string[] {
  const names = new Set<string>()
  for (const e of events) {
    const subtype = deriveSubtype(e)
    const toolName = deriveToolName(e)
    // 1. Tool-name pills (existing behavior)
    if (subtype && DYNAMIC_SUBTYPES.has(subtype) && toolName) {
      const name = toolName.startsWith('mcp__') ? normalizeMcpName(toolName) : toolName
      names.add(name)
      continue
    }
    // 2. Catchall: any hook subtype not covered by a static filter
    if (subtype && !STATIC_COVERED_SUBTYPES.has(subtype)) {
      names.add(subtype)
    }
  }
  return Array.from(names).sort()
}

// Returns the set of static filter labels that have at least one matching event.
export function getFiltersWithMatches(events: ParsedEvent[]): Set<string> {
  const matched = new Set<string>()
  for (const filter of STATIC_FILTERS) {
    if (matched.has(filter.label)) continue
    for (const e of events) {
      const subtype = deriveSubtype(e)
      const toolName = deriveToolName(e)
      if (filter.match && filter.match(e, subtype, toolName)) {
        matched.add(filter.label)
        break
      }
      if (filter.subtypes && subtype && filter.subtypes.includes(subtype)) {
        matched.add(filter.label)
        break
      }
    }
  }
  return matched
}

// Pre-built lookup map for O(1) filter access by label
const FILTER_BY_LABEL = new Map(STATIC_FILTERS.map((f) => [f.label, f]))

// Check if an event matches any of the given active filters.
export function eventMatchesFilters(
  event: ParsedEvent,
  activeStaticLabels: string[],
  activeToolNames: string[],
): boolean {
  const hasStaticFilters = activeStaticLabels.length > 0
  const hasToolFilters = activeToolNames.length > 0

  const subtype = deriveSubtype(event)
  const toolName = deriveToolName(event)

  const matchesStatic =
    hasStaticFilters &&
    activeStaticLabels.some((label) => {
      const filter = FILTER_BY_LABEL.get(label)
      if (!filter) return false
      if (filter.match && filter.match(event, subtype, toolName)) return true
      if (filter.subtypes && subtype && filter.subtypes.includes(subtype)) return true
      return false
    })

  const matchesTool =
    hasToolFilters &&
    activeToolNames.some((t) => {
      // Tool-name match (e.g. "Read", "mcp__chrome-devtools")
      if (toolName != null) {
        if (toolName === t) return true
        if (toolName.startsWith(t + '__')) return true
      }
      // Catchall subtype match (e.g. "CwdChanged", "FileChanged")
      if (subtype === t) return true
      return false
    })

  if (hasStaticFilters && hasToolFilters) return matchesStatic || matchesTool
  if (hasStaticFilters) return matchesStatic
  if (hasToolFilters) return matchesTool
  return true
}
