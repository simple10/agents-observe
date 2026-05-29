import { describe, it, expect } from 'vitest'
import {
  hermesIconId,
  hermesLabel,
  hermesStatus,
  hermesSummary,
  hermesToolName,
  HERMES_ICON_BY_HOOK,
} from './helpers'

describe('hermes icon mapping', () => {
  it('maps every known hook onto an existing icon key (no new icons)', () => {
    // These keys all exist in lib/event-icon-registry.ts.
    expect(HERMES_ICON_BY_HOOK).toMatchObject({
      on_session_start: 'SessionStart',
      pre_llm_call: 'UserPromptSubmit',
      post_llm_call: 'ToolAgent',
      pre_api_request: 'ToolWebFetch',
      post_api_request: 'ToolWebFetch',
      transform_llm_output: 'Notification',
      post_tool_call: 'ToolDefault',
      transform_tool_result: 'ToolDefault',
      on_session_end: 'SessionEnd',
      on_session_finalize: 'stop_hook_summary',
    })
  })

  it('falls back to Default for an unknown hook', () => {
    expect(hermesIconId('some_future_hook')).toBe('Default')
    expect(hermesLabel('some_future_hook')).toBe('some_future_hook')
  })
})

describe('hermes summaries', () => {
  it('on_session_start → model · platform', () => {
    expect(hermesSummary('on_session_start', { model: 'chatgpt/gpt-5.5', platform: 'cli' })).toBe(
      'chatgpt/gpt-5.5 · cli',
    )
  })

  it('pre_llm_call → the user message (single line)', () => {
    expect(hermesSummary('pre_llm_call', { user_message: 'hello\n again' })).toBe('hello again')
  })

  it('post_api_request → finish_reason · tokens · duration', () => {
    expect(
      hermesSummary('post_api_request', {
        finish_reason: 'stop',
        usage: { total_tokens: 22162 },
        api_duration: 2.528952,
      }),
    ).toBe('stop · 22k tok · 2.5s')
  })

  it('pre_api_request → model · counts · approx tokens', () => {
    expect(
      hermesSummary('pre_api_request', {
        model: 'chatgpt/gpt-5.5',
        message_count: 2,
        tool_count: 39,
        approx_input_tokens: 9612,
      }),
    ).toBe('chatgpt/gpt-5.5 · 2 msg · 39 tools · ~9.6k tok')
  })

  it('transform_tool_result → tool · args · duration', () => {
    expect(
      hermesSummary('transform_tool_result', {
        tool_name: 'skill_view',
        args: { name: 'hermes-agent' },
        duration_ms: 57,
      }),
    ).toBe('skill_view name=hermes-agent · 57ms')
  })

  it('on_session_end reflects completion / interruption', () => {
    expect(hermesSummary('on_session_end', { completed: true, interrupted: false })).toBe(
      'Completed',
    )
    expect(hermesSummary('on_session_end', { completed: false, interrupted: true })).toBe(
      'Interrupted',
    )
  })
})

describe('hermes status', () => {
  it('is completed by default', () => {
    expect(hermesStatus('post_api_request', {})).toBe('completed')
  })
  it('is failed for an interrupted session', () => {
    expect(hermesStatus('on_session_end', { interrupted: true })).toBe('failed')
  })
})

describe('hermes tool name', () => {
  it('reads payload.tool_name', () => {
    expect(hermesToolName({ tool_name: 'skill_view' })).toBe('skill_view')
    expect(hermesToolName({})).toBeNull()
  })
})
