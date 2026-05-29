import { describe, test, expect } from 'vitest'
import { processEvent } from './process-event'
import { compileFilters } from '@/lib/filters/compile'
import type { Filter } from '@/types'
import type { ProcessingContext } from '../types'

const ALL_FILTER: Filter = {
  id: 'default-all',
  name: 'All',
  pillName: 'All',
  display: 'primary',
  combinator: 'and',
  patterns: [{ target: 'hook', regex: '^PostToolBatch$', negate: true }],
  kind: 'default',
  enabled: true,
  config: { role: 'all-exclusions' },
  createdAt: 0,
  updatedAt: 0,
}

function createCtx(filters: Filter[] = [ALL_FILTER]): ProcessingContext {
  return {
    dedupEnabled: true,
    compiledFilters: compileFilters(filters),
    getAgent: () => undefined,
    getGroupedEvents: () => [],
    getAgentEvents: () => [],
    getCurrentTurn: () => null,
    setCurrentTurn: () => {},
    clearCurrentTurn: () => {},
    getPendingGroup: () => null,
    setPendingGroup: () => {},
    clearPendingGroup: () => {},
    stashPendingAgentMeta: () => {},
    consumePendingAgentMeta: () => null,
    updateEvent: () => {},
  }
}

describe('claude-code processEvent — All filter gating', () => {
  test('hides PostToolBatch events from timeline and event stream when default-all is enabled', () => {
    const raw = {
      id: 1,
      agentId: 'a',
      hookName: 'PostToolBatch',
      timestamp: 0,
      payload: {},
    }
    const { event } = processEvent(raw, createCtx())
    expect(event.displayEventStream).toBe(false)
    expect(event.displayTimeline).toBe(false)
  })

  test('shows PostToolBatch events when default-all is disabled', () => {
    const raw = {
      id: 1,
      agentId: 'a',
      hookName: 'PostToolBatch',
      timestamp: 0,
      payload: {},
    }
    const { event } = processEvent(raw, createCtx([{ ...ALL_FILTER, enabled: false }]))
    expect(event.displayEventStream).toBe(true)
    expect(event.displayTimeline).toBe(true)
  })

  test('shows non-excluded events with default-all enabled', () => {
    const raw = {
      id: 1,
      agentId: 'a',
      hookName: 'UserPromptSubmit',
      timestamp: 0,
      payload: { prompt: 'hi' },
    }
    const { event } = processEvent(raw, createCtx())
    expect(event.displayEventStream).toBe(true)
    expect(event.displayTimeline).toBe(true)
  })
})

describe('claude-code processEvent — tool Pre/Post pairing', () => {
  test('Workflow Pre/Post pair groups by tool_use_id despite a taskId in the response', () => {
    // Regression: the Workflow tool_response carries a background `taskId`,
    // which used to hijack the Post event into a `task-<id>` group while
    // the Pre event grouped by tool_use_id — so the pair never merged and
    // both rows showed. They must share the tool_use_id group, and the
    // Post must fold into the Pre (hidden, marks it completed).
    const tuid = 'toolu_wf1'
    const pre = {
      id: 1,
      agentId: 'a',
      hookName: 'PreToolUse',
      timestamp: 0,
      payload: {
        tool_name: 'Workflow',
        tool_use_id: tuid,
        tool_input: { name: 'deep-research', args: 'q' },
      },
    }
    const preResult = processEvent(pre, createCtx())
    expect(preResult.event.groupId).toBe(tuid)

    const updates: Array<{ id: number; patch: Record<string, unknown> }> = []
    const ctx: ProcessingContext = {
      ...createCtx(),
      getGroupedEvents: (gid: string) => (gid === tuid ? [preResult.event] : []),
      updateEvent: (id, patch) => updates.push({ id: id as number, patch }),
    }
    const post = {
      id: 2,
      agentId: 'a',
      hookName: 'PostToolUse',
      timestamp: 1,
      payload: {
        tool_name: 'Workflow',
        tool_use_id: tuid,
        tool_input: { name: 'deep-research' },
        tool_response: { status: 'async_launched', taskId: 'wykxbl4m6', runId: 'wf_x' },
      },
    }
    const postResult = processEvent(post, ctx)
    expect(postResult.event.groupId).toBe(tuid)
    // Post folds into the Pre row.
    expect(postResult.event.displayEventStream).toBe(false)
    expect(postResult.event.displayTimeline).toBe(false)
    expect(updates.find((u) => u.id === 1)?.patch.status).toBe('completed')
  })
})
