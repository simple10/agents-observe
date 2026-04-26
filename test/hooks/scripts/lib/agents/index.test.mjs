import { describe, it, expect } from 'vitest'
import {
  AGENT_LIBS,
  DEFAULT_NOTIFICATION_EVENTS,
  getAgentClass,
  getAgentLib,
  isNotificationEvent,
} from '../../../../../hooks/scripts/lib/agents/index.mjs'

describe('agents registry', () => {
  it('registers claude-code, codex, and default', () => {
    expect(AGENT_LIBS['claude-code']).toBeDefined()
    expect(AGENT_LIBS.codex).toBeDefined()
    expect(AGENT_LIBS.default).toBeDefined()
  })
})

describe('getAgentClass', () => {
  it('returns the configured class when recognized', () => {
    expect(getAgentClass({ agentClass: 'claude-code' })).toBe('claude-code')
    expect(getAgentClass({ agentClass: 'codex' })).toBe('codex')
  })

  it('returns "default" for unrecognized classes', () => {
    expect(getAgentClass({ agentClass: 'made-up' })).toBe('default')
    expect(getAgentClass({ agentClass: '' })).toBe('default')
    expect(getAgentClass({})).toBe('default')
    expect(getAgentClass(null)).toBe('default')
  })
})

describe('getAgentLib', () => {
  it('resolves registered libs', () => {
    expect(getAgentLib('claude-code')).toBe(AGENT_LIBS['claude-code'])
    expect(getAgentLib('codex')).toBe(AGENT_LIBS.codex)
    expect(getAgentLib('default')).toBe(AGENT_LIBS.default)
  })

  it('falls back to the default lib for anything else', () => {
    expect(getAgentLib('what')).toBe(AGENT_LIBS.default)
    expect(getAgentLib(undefined)).toBe(AGENT_LIBS.default)
  })
})

describe('isNotificationEvent', () => {
  it('exports the default list', () => {
    expect(DEFAULT_NOTIFICATION_EVENTS).toEqual(['Notification'])
  })

  it('falls back to the default when config.notificationOnEvents is undefined', () => {
    const config = { notificationOnEvents: undefined }
    expect(isNotificationEvent(config, 'Notification')).toBe(true)
    expect(isNotificationEvent(config, 'Stop')).toBe(false)
    expect(isNotificationEvent(config, 'PreToolUse')).toBe(false)
  })

  it('returns false for every event when the list is explicitly empty', () => {
    const config = { notificationOnEvents: [] }
    expect(isNotificationEvent(config, 'Notification')).toBe(false)
    expect(isNotificationEvent(config, 'Stop')).toBe(false)
  })

  it('honors an explicit list', () => {
    const config = { notificationOnEvents: ['Notification', 'Stop'] }
    expect(isNotificationEvent(config, 'Notification')).toBe(true)
    expect(isNotificationEvent(config, 'Stop')).toBe(true)
    expect(isNotificationEvent(config, 'SubagentStop')).toBe(false)
    expect(isNotificationEvent(config, 'PreToolUse')).toBe(false)
  })

  it('treats null / missing config defensively (falls back to default)', () => {
    expect(isNotificationEvent(null, 'Notification')).toBe(true)
    expect(isNotificationEvent(undefined, 'Notification')).toBe(true)
    expect(isNotificationEvent({}, 'Notification')).toBe(true)
    expect(isNotificationEvent({}, 'Stop')).toBe(false)
  })
})
