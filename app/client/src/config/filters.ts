import type { ParsedEvent } from '@/types'

export interface StaticFilter {
  label: string
  // Simple subtype matching (OR'd together)
  subtypes?: string[]
  // Custom match function for payload-level filtering
  match?: (event: ParsedEvent) => boolean
}

// Row 1: Static filters that group related hook subtypes.
// A filter can use subtypes, a match function, or both (OR'd).
export const STATIC_FILTERS: StaticFilter[] = [
  { label: 'Prompts', subtypes: ['UserPromptSubmit'] },
  {
    label: 'Tools',
    subtypes: ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'],
    // Exclude MCP tools — those are covered by the MCP filter
    match: (e) =>
      (e.subtype === 'PreToolUse' ||
        e.subtype === 'PostToolUse' ||
        e.subtype === 'PostToolUseFailure') &&
      !!e.toolName &&
      !e.toolName.startsWith('mcp__'),
  },
  {
    label: 'Agents',
    subtypes: ['SubagentStart', 'SubagentStop'],
    match: (e) => e.toolName === 'Agent',
  },
  { label: 'Tasks', subtypes: ['TaskCreated', 'TaskCompleted'] },
  { label: 'Session', subtypes: ['SessionStart', 'SessionEnd'] },
  {
    label: 'MCP',
    subtypes: ['Elicitation', 'ElicitationResult'],
    match: (e) => !!e.toolName?.startsWith('mcp__'),
  },
  { label: 'Permissions', subtypes: ['PermissionRequest'] },
  { label: 'Notifications', subtypes: ['Notification'] },
  { label: 'Stop', subtypes: ['Stop', 'StopFailure'] },
  { label: 'Compaction', subtypes: ['PreCompact', 'PostCompact'] },
  {
    label: 'Errors',
    match: (e) => {
      const payload = e.payload
      if (!payload) return false
      // Match events with a non-empty error field
      if (payload.error && payload.error !== '') return true
      // Also match tool failure subtypes
      if (e.subtype === 'PostToolUseFailure' || e.subtype === 'StopFailure') return true
      return false
    },
  },
]

// Subtypes that produce dynamic (row 2) tool-name filters.
const DYNAMIC_SUBTYPES = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure'])

// Normalize MCP tool names: mcp__chrome-devtools__click → mcp__chrome-devtools
function normalizeMcpName(name: string): string {
  const match = name.match(/^(mcp__[^_]+(?:_[^_]+)*?)__/)
  return match ? match[1] : name
}

// Extract dynamic filter names from events (tool names, etc.)
export function getDynamicFilterNames(events: ParsedEvent[]): string[] {
  const names = new Set<string>()
  for (const e of events) {
    if (e.subtype && DYNAMIC_SUBTYPES.has(e.subtype) && e.toolName) {
      const name = e.toolName.startsWith('mcp__') ? normalizeMcpName(e.toolName) : e.toolName
      names.add(name)
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
      if (filter.match && filter.match(e)) {
        matched.add(filter.label)
        break
      }
      if (filter.subtypes && e.subtype && filter.subtypes.includes(e.subtype)) {
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

  const matchesStatic =
    hasStaticFilters &&
    activeStaticLabels.some((label) => {
      const filter = FILTER_BY_LABEL.get(label)
      if (!filter) return false
      if (filter.match && filter.match(event)) return true
      if (filter.subtypes && event.subtype && filter.subtypes.includes(event.subtype)) return true
      return false
    })

  const matchesTool =
    hasToolFilters &&
    event.toolName != null &&
    activeToolNames.some((t) => {
      if (event.toolName === t) return true
      if (event.toolName?.startsWith(t + '__')) return true
      return false
    })

  if (hasStaticFilters && hasToolFilters) return matchesStatic || matchesTool
  if (hasStaticFilters) return matchesStatic
  if (hasToolFilters) return matchesTool
  return true
}
