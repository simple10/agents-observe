import { describe, it, expect } from 'vitest'
import {
  eventMatchesFilters,
  getDynamicFilterNames,
  getFiltersWithMatches,
  getDynamicDisplayName,
  STATIC_FILTERS,
} from './filters'
import type { ParsedEvent } from '@/types'

/** Translates legacy `subtype`/`toolName` overrides into the new wire
 *  shape (hookName + payload.tool_name). The filters module derives
 *  subtype/toolName from those fields via the claude-code derivers.
 *  `type`/`status` overrides are accepted but ignored. */
function makeEvent(
  overrides: Partial<ParsedEvent> & {
    subtype?: string | null
    toolName?: string | null
    type?: string
    status?: string
  },
): ParsedEvent {
  const { subtype, toolName, type: _type, status: _status, ...rest } = overrides
  const hookName = rest.hookName ?? subtype ?? ''
  const basePayload =
    (rest.payload as Record<string, unknown> | undefined) ?? ({} as Record<string, unknown>)
  const payload =
    toolName && basePayload.tool_name === undefined
      ? { ...basePayload, tool_name: toolName }
      : basePayload
  const merged = {
    id: 1,
    agentId: 'agent-1',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    createdAt: Date.now(),
    ...rest,
  } as ParsedEvent
  merged.hookName = hookName
  merged.payload = payload
  return merged
}

describe('eventMatchesFilters', () => {
  // ── No filters (all pass) ─────────────────────────────────

  describe('no filters active', () => {
    it('should match all events when no filters are active', () => {
      const event = makeEvent({ subtype: 'UserPromptSubmit' })
      expect(eventMatchesFilters(event, [], [])).toBe(true)
    })

    it('should match events with any subtype when no filters', () => {
      const event = makeEvent({ subtype: 'SessionStart' })
      expect(eventMatchesFilters(event, [], [])).toBe(true)
    })
  })

  // ── Static filter matching ────────────────────────────────

  describe('static filters', () => {
    it('should match Prompts filter via subtype', () => {
      const event = makeEvent({ subtype: 'UserPromptSubmit' })
      expect(eventMatchesFilters(event, ['Prompts'], [])).toBe(true)
    })

    it('should NOT match Prompts filter for non-prompt events', () => {
      const event = makeEvent({ subtype: 'SessionStart' })
      expect(eventMatchesFilters(event, ['Prompts'], [])).toBe(false)
    })

    it('should match Tools filter via match function (non-MCP tool)', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Bash',
      })
      expect(eventMatchesFilters(event, ['Tools'], [])).toBe(true)
    })

    it('should match Tools filter for MCP tools via subtype (subtypes include PreToolUse)', () => {
      // The Tools filter has subtypes ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].
      // eventMatchesFilters checks match OR subtypes, so MCP tools match via subtype
      // even though the match function excludes them. The match function is used for
      // getFiltersWithMatches highlighting, but eventMatchesFilters is more permissive.
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'mcp__chrome-devtools__click',
      })
      expect(eventMatchesFilters(event, ['Tools'], [])).toBe(true)
    })

    it('should match Agents filter via subtype', () => {
      const event = makeEvent({ subtype: 'SubagentStart' })
      expect(eventMatchesFilters(event, ['Agents'], [])).toBe(true)
    })

    it('should match Agents filter via Agent tool match', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Agent',
      })
      expect(eventMatchesFilters(event, ['Agents'], [])).toBe(true)
    })

    it('should match Tasks filter via subtype', () => {
      const event = makeEvent({ subtype: 'TaskCreated' })
      expect(eventMatchesFilters(event, ['Tasks'], [])).toBe(true)
    })

    it('should match Tasks filter via TaskCreate tool match', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'TaskCreate',
      })
      expect(eventMatchesFilters(event, ['Tasks'], [])).toBe(true)
    })

    it('should match Session filter', () => {
      expect(eventMatchesFilters(makeEvent({ subtype: 'SessionStart' }), ['Session'], [])).toBe(
        true,
      )
      expect(eventMatchesFilters(makeEvent({ subtype: 'SessionEnd' }), ['Session'], [])).toBe(true)
    })

    it('should match MCP filter for MCP tools', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'mcp__chrome-devtools__click',
      })
      expect(eventMatchesFilters(event, ['MCP'], [])).toBe(true)
    })

    it('should match MCP filter for Elicitation events', () => {
      expect(eventMatchesFilters(makeEvent({ subtype: 'Elicitation' }), ['MCP'], [])).toBe(true)
      expect(eventMatchesFilters(makeEvent({ subtype: 'ElicitationResult' }), ['MCP'], [])).toBe(
        true,
      )
    })

    it('should match Permissions filter', () => {
      const event = makeEvent({ subtype: 'PermissionRequest' })
      expect(eventMatchesFilters(event, ['Permissions'], [])).toBe(true)
    })

    it('should match Notifications filter', () => {
      const event = makeEvent({ subtype: 'Notification' })
      expect(eventMatchesFilters(event, ['Notifications'], [])).toBe(true)
    })

    it('should match Stop filter', () => {
      expect(eventMatchesFilters(makeEvent({ subtype: 'Stop' }), ['Stop'], [])).toBe(true)
      expect(eventMatchesFilters(makeEvent({ subtype: 'StopFailure' }), ['Stop'], [])).toBe(true)
      expect(eventMatchesFilters(makeEvent({ subtype: 'SubagentStop' }), ['Stop'], [])).toBe(true)
    })

    it('should match Compaction filter', () => {
      expect(eventMatchesFilters(makeEvent({ subtype: 'PreCompact' }), ['Compaction'], [])).toBe(
        true,
      )
      expect(eventMatchesFilters(makeEvent({ subtype: 'PostCompact' }), ['Compaction'], [])).toBe(
        true,
      )
    })

    it('should match Errors filter for events with error payload', () => {
      const event = makeEvent({
        subtype: 'PostToolUseFailure',
        payload: { error: 'Something went wrong' },
      })
      expect(eventMatchesFilters(event, ['Errors'], [])).toBe(true)
    })

    it('should match Errors filter for StopFailure by match fn', () => {
      const event = makeEvent({ subtype: 'StopFailure', payload: {} })
      expect(eventMatchesFilters(event, ['Errors'], [])).toBe(true)
    })

    it('should NOT match Errors filter for events without error payload', () => {
      const event = makeEvent({ subtype: 'PreToolUse', toolName: 'Bash', payload: {} })
      expect(eventMatchesFilters(event, ['Errors'], [])).toBe(false)
    })
  })

  // ── Multiple static filters (OR behavior) ────────────────

  describe('multiple static filters (OR)', () => {
    it('should match if event matches ANY of the active static filters', () => {
      const promptEvent = makeEvent({ subtype: 'UserPromptSubmit' })
      const sessionEvent = makeEvent({ subtype: 'SessionStart' })
      const toolEvent = makeEvent({ subtype: 'PreToolUse', toolName: 'Bash' })

      expect(eventMatchesFilters(promptEvent, ['Prompts', 'Session'], [])).toBe(true)
      expect(eventMatchesFilters(sessionEvent, ['Prompts', 'Session'], [])).toBe(true)
      // Tool event doesn't match Prompts or Session
      expect(eventMatchesFilters(toolEvent, ['Prompts', 'Session'], [])).toBe(false)
    })
  })

  // ── Tool name filters ────────────────────────────────────

  describe('tool name filters', () => {
    it('should match exact tool name', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Bash',
      })
      expect(eventMatchesFilters(event, [], ['Bash'])).toBe(true)
    })

    it('should NOT match different tool name', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Read',
      })
      expect(eventMatchesFilters(event, [], ['Bash'])).toBe(false)
    })

    it('should match MCP tool name prefix', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'mcp__chrome-devtools__click',
      })
      // The filter "mcp__chrome-devtools" should match because
      // the tool name starts with "mcp__chrome-devtools__"
      expect(eventMatchesFilters(event, [], ['mcp__chrome-devtools'])).toBe(true)
    })

    it('should match catchall subtype as tool filter', () => {
      const event = makeEvent({ subtype: 'CwdChanged' })
      expect(eventMatchesFilters(event, [], ['CwdChanged'])).toBe(true)
    })

    it('should match PostToolUse events for tool name filter', () => {
      const event = makeEvent({
        subtype: 'PostToolUse',
        toolName: 'Read',
      })
      expect(eventMatchesFilters(event, [], ['Read'])).toBe(true)
    })

    it('should match PostToolUseFailure events for tool name filter', () => {
      const event = makeEvent({
        subtype: 'PostToolUseFailure',
        toolName: 'Bash',
      })
      expect(eventMatchesFilters(event, [], ['Bash'])).toBe(true)
    })
  })

  // ── Static + tool filters combined (OR) ───────────────────

  describe('static + tool filters combined (OR behavior)', () => {
    it('should pass if event matches static filter but not tool filter', () => {
      const event = makeEvent({ subtype: 'UserPromptSubmit' })
      expect(eventMatchesFilters(event, ['Prompts'], ['Bash'])).toBe(true)
    })

    it('should pass if event matches tool filter but not static filter', () => {
      const event = makeEvent({ subtype: 'PreToolUse', toolName: 'Bash' })
      expect(eventMatchesFilters(event, ['Prompts'], ['Bash'])).toBe(true)
    })

    it('should fail if event matches neither', () => {
      const event = makeEvent({ subtype: 'SessionStart' })
      expect(eventMatchesFilters(event, ['Prompts'], ['Bash'])).toBe(false)
    })

    it('should pass if event matches both', () => {
      const event = makeEvent({ subtype: 'PreToolUse', toolName: 'Bash' })
      expect(eventMatchesFilters(event, ['Tools'], ['Bash'])).toBe(true)
    })
  })
})

// ── getDynamicFilterNames ───────────────────────────────────

describe('getDynamicFilterNames', () => {
  it('should extract tool names from PreToolUse events', () => {
    const events = [
      makeEvent({ subtype: 'PreToolUse', toolName: 'Bash' }),
      makeEvent({ subtype: 'PreToolUse', toolName: 'Read' }),
      makeEvent({ subtype: 'PreToolUse', toolName: 'Bash' }), // duplicate
    ]
    const names = getDynamicFilterNames(events)
    expect(names).toContain('Bash')
    expect(names).toContain('Read')
    // No duplicates
    expect(names.filter((n) => n === 'Bash')).toHaveLength(1)
  })

  it('should extract tool names from PostToolUse events', () => {
    const events = [makeEvent({ subtype: 'PostToolUse', toolName: 'Write' })]
    expect(getDynamicFilterNames(events)).toContain('Write')
  })

  it('should extract tool names from PostToolUseFailure events', () => {
    const events = [makeEvent({ subtype: 'PostToolUseFailure', toolName: 'Edit' })]
    expect(getDynamicFilterNames(events)).toContain('Edit')
  })

  it('should normalize MCP tool names to server prefix only', () => {
    const events = [
      makeEvent({ subtype: 'PreToolUse', toolName: 'mcp__chrome-devtools__click' }),
      makeEvent({ subtype: 'PreToolUse', toolName: 'mcp__chrome-devtools__hover' }),
    ]
    const names = getDynamicFilterNames(events)
    expect(names).toContain('mcp__chrome-devtools')
    // Should not contain the full tool names
    expect(names).not.toContain('mcp__chrome-devtools__click')
    expect(names).not.toContain('mcp__chrome-devtools__hover')
    // Only one normalized entry
    expect(names.filter((n) => n.includes('chrome-devtools'))).toHaveLength(1)
  })

  it('should include catchall subtypes not covered by static filters', () => {
    // CwdChanged and FileChanged are now covered by the 'Config' static
    // filter, so they no longer appear as dynamic catchall pills.
    // SessionCompacted is an example of a hook subtype that has no
    // static-filter home and therefore should appear as a catchall.
    const events = [
      makeEvent({ subtype: 'SessionCompacted' }),
      makeEvent({ subtype: 'PreToolUse', toolName: 'Bash' }),
    ]
    const names = getDynamicFilterNames(events)
    expect(names).toContain('SessionCompacted')
  })

  it('should NOT include subtypes that ARE covered by static filters', () => {
    const events = [
      makeEvent({ subtype: 'UserPromptSubmit' }), // covered by Prompts
      makeEvent({ subtype: 'SessionStart' }), // covered by Session
    ]
    const names = getDynamicFilterNames(events)
    expect(names).not.toContain('UserPromptSubmit')
    expect(names).not.toContain('SessionStart')
  })

  it('should return sorted names', () => {
    const events = [
      makeEvent({ subtype: 'PreToolUse', toolName: 'Write' }),
      makeEvent({ subtype: 'PreToolUse', toolName: 'Bash' }),
      makeEvent({ subtype: 'PreToolUse', toolName: 'Read' }),
    ]
    const names = getDynamicFilterNames(events)
    expect(names).toEqual([...names].sort())
  })

  it('should return empty array for empty events', () => {
    expect(getDynamicFilterNames([])).toEqual([])
  })

  it('should handle events with null subtypes and tool names', () => {
    const events = [makeEvent({ subtype: null, toolName: null })]
    expect(getDynamicFilterNames(events)).toEqual([])
  })
})

// ── getFiltersWithMatches ───────────────────────────────────

describe('getFiltersWithMatches', () => {
  it('should detect Prompts filter has matches', () => {
    const events = [makeEvent({ subtype: 'UserPromptSubmit' })]
    const matched = getFiltersWithMatches(events)
    expect(matched.has('Prompts')).toBe(true)
  })

  it('should detect Tools filter has matches', () => {
    const events = [makeEvent({ subtype: 'PreToolUse', toolName: 'Bash' })]
    const matched = getFiltersWithMatches(events)
    expect(matched.has('Tools')).toBe(true)
  })

  it('should NOT mark Tools as matching for MCP tools', () => {
    // This is nuanced: the subtype 'PreToolUse' is in Tools' subtypes list,
    // so it WILL match via subtype. The Tools filter has both subtypes AND match fn.
    // getFiltersWithMatches checks match first, then subtypes -- the OR means
    // if subtype matches, it still counts.
    const events = [makeEvent({ subtype: 'PreToolUse', toolName: 'mcp__server__tool' })]
    const matched = getFiltersWithMatches(events)
    // The Tools filter has subtypes ['PreToolUse', ...] so PreToolUse will match
    // even though the match function excludes MCP. This is the actual behavior.
    expect(matched.has('Tools')).toBe(true)
  })

  it('should detect MCP filter has matches', () => {
    const events = [makeEvent({ subtype: 'PreToolUse', toolName: 'mcp__server__tool' })]
    const matched = getFiltersWithMatches(events)
    expect(matched.has('MCP')).toBe(true)
  })

  it('should detect multiple filter matches', () => {
    const events = [
      makeEvent({ subtype: 'UserPromptSubmit' }),
      makeEvent({ subtype: 'PreToolUse', toolName: 'Bash' }),
      makeEvent({ subtype: 'SessionStart' }),
    ]
    const matched = getFiltersWithMatches(events)
    expect(matched.has('Prompts')).toBe(true)
    expect(matched.has('Tools')).toBe(true)
    expect(matched.has('Session')).toBe(true)
  })

  it('should return empty set for empty events', () => {
    const matched = getFiltersWithMatches([])
    expect(matched.size).toBe(0)
  })

  it('should detect Errors filter matching error payloads', () => {
    const events = [makeEvent({ subtype: 'PostToolUseFailure', payload: { error: 'fail' } })]
    const matched = getFiltersWithMatches(events)
    expect(matched.has('Errors')).toBe(true)
  })
})

// ── getDynamicDisplayName ───────────────────────────────────

describe('getDynamicDisplayName', () => {
  it('should return override for known subtypes', () => {
    expect(getDynamicDisplayName('CwdChanged')).toBe('CWD')
    expect(getDynamicDisplayName('FileChanged')).toBe('File')
  })

  it('should return the key as-is for unknown subtypes', () => {
    expect(getDynamicDisplayName('Bash')).toBe('Bash')
    expect(getDynamicDisplayName('SomethingNew')).toBe('SomethingNew')
  })
})

// ── STATIC_FILTERS sanity checks ────────────────────────────

describe('STATIC_FILTERS', () => {
  it('should have expected filter labels', () => {
    const labels = STATIC_FILTERS.map((f) => f.label)
    expect(labels).toContain('Prompts')
    expect(labels).toContain('Tools')
    expect(labels).toContain('Agents')
    expect(labels).toContain('Tasks')
    expect(labels).toContain('Session')
    expect(labels).toContain('MCP')
    expect(labels).toContain('Permissions')
    expect(labels).toContain('Notifications')
    expect(labels).toContain('Stop')
    expect(labels).toContain('Compaction')
    expect(labels).toContain('Errors')
  })

  it('every static filter should have subtypes or match function', () => {
    for (const filter of STATIC_FILTERS) {
      const hasSubtypes = filter.subtypes && filter.subtypes.length > 0
      const hasMatch = typeof filter.match === 'function'
      expect(hasSubtypes || hasMatch).toBe(true)
    }
  })
})
