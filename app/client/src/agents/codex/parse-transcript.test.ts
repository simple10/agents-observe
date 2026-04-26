// Codex transcript parser tests. Ported from the deleted server
// `parser.test.ts` legacy-format cases (see git
// `7d54cfe^:app/server/src/parser.test.ts`).

import { describe, it, expect } from 'vitest'
import { parseTranscriptEvent } from './parse-transcript'

describe('parseTranscriptEvent', () => {
  it('returns nulls for an empty / non-object payload', () => {
    expect(parseTranscriptEvent(undefined)).toEqual({
      subtype: null,
      toolName: null,
      subAgentId: null,
      subAgentName: null,
      subAgentDescription: null,
    })
    expect(parseTranscriptEvent(null)).toEqual({
      subtype: null,
      toolName: null,
      subAgentId: null,
      subAgentName: null,
      subAgentDescription: null,
    })
  })

  it('passes through a top-level subtype', () => {
    const r = parseTranscriptEvent({ type: 'progress', subtype: 'manual_subtype' })
    expect(r.subtype).toBe('manual_subtype')
  })

  it('extracts subtype + toolName from hook_progress data', () => {
    const r = parseTranscriptEvent({
      type: 'progress',
      data: {
        type: 'hook_progress',
        hookEvent: 'PreToolUse',
        hookName: 'PreToolUse:Bash',
      },
    })
    expect(r.subtype).toBe('PreToolUse')
    expect(r.toolName).toBe('Bash')
  })

  it('joins multi-segment hookName tail back together', () => {
    const r = parseTranscriptEvent({
      type: 'progress',
      data: {
        type: 'hook_progress',
        hookEvent: 'PreToolUse',
        hookName: 'PreToolUse:mcp__server__tool',
      },
    })
    expect(r.toolName).toBe('mcp__server__tool')
  })

  it('marks agent_progress and lifts agentId + nested toolName', () => {
    const r = parseTranscriptEvent({
      type: 'progress',
      data: {
        type: 'agent_progress',
        agentId: 'sub-agent-1',
        message: {
          message: {
            content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/x' } }],
          },
        },
      },
    })
    expect(r.subtype).toBe('agent_progress')
    expect(r.subAgentId).toBe('sub-agent-1')
    expect(r.toolName).toBe('Read')
  })

  it('extracts toolName from an assistant message tool_use', () => {
    const r = parseTranscriptEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }],
      },
    })
    expect(r.toolName).toBe('Bash')
  })

  it('lifts subagent name + description from an Agent tool_use input', () => {
    const r = parseTranscriptEvent({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Agent',
            input: { name: 'researcher', description: 'gathers context' },
          },
        ],
      },
    })
    expect(r.toolName).toBe('Agent')
    expect(r.subAgentName).toBe('researcher')
    expect(r.subAgentDescription).toBe('gathers context')
  })

  it('reads spawned agentId from toolUseResult', () => {
    const r = parseTranscriptEvent({
      type: 'assistant',
      toolUseResult: { agentId: 'spawned-1' },
    })
    expect(r.subAgentId).toBe('spawned-1')
  })

  it('ignores malformed content arrays without throwing', () => {
    const r = parseTranscriptEvent({
      type: 'assistant',
      message: { content: 'not an array' },
    })
    expect(r.toolName).toBeNull()
  })
})
