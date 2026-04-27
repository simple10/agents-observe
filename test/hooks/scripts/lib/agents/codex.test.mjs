import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  buildHookEvent,
  buildEnv,
  getSessionInfo,
} from '../../../../../hooks/scripts/lib/agents/codex.mjs'

function makeLog() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }
}

function writeTranscript(lines) {
  const dir = join(tmpdir(), `codex-getinfo-${Date.now()}-${Math.random()}`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'transcript.jsonl')
  writeFileSync(path, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'))
  return { path, dir }
}

describe('codex.getSessionInfo', () => {
  it('returns null when transcriptPath is missing', () => {
    expect(getSessionInfo({}, { log: makeLog() })).toBeNull()
  })

  it('returns null when the transcript file cannot be read', () => {
    const log = makeLog()
    expect(getSessionInfo({ transcriptPath: '/no/such/file' }, { log })).toBeNull()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('cannot read transcript'))
  })

  it('accepts the snake_case transcript_path alias', () => {
    const { path, dir } = writeTranscript([
      { payload: { git: { branch: 'feat/x', repository_url: 'git@ex:r.git' } } },
    ])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result.git.branch).toBe('feat/x')
    rmSync(dir, { recursive: true, force: true })
  })

  it('extracts git info from session_meta payload', () => {
    const { path, dir } = writeTranscript([
      {
        type: 'session_meta',
        payload: {
          git: {
            commit_hash: 'abc',
            branch: 'feat/agent-class-support',
            repository_url: 'git@github.com:simple10/agents-observe.git',
          },
        },
      },
    ])
    const result = getSessionInfo({ transcriptPath: path }, { log: makeLog() })
    expect(result).toEqual({
      slug: null,
      git: {
        branch: 'feat/agent-class-support',
        repository_url: 'git@github.com:simple10/agents-observe.git',
      },
    })
    rmSync(dir, { recursive: true, force: true })
  })

  it('also accepts git at the top level as a fallback shape', () => {
    const { path, dir } = writeTranscript([
      { type: 'other' },
      { git: { branch: 'main', repository_url: 'git@ex:r.git' } },
    ])
    const result = getSessionInfo({ transcriptPath: path }, { log: makeLog() })
    expect(result.git).toEqual({ branch: 'main', repository_url: 'git@ex:r.git' })
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null fields when no git info is present', () => {
    const { path, dir } = writeTranscript([{ type: 'session_meta', payload: {} }])
    const result = getSessionInfo({ transcriptPath: path }, { log: makeLog() })
    expect(result).toEqual({
      slug: null,
      git: { branch: null, repository_url: null },
    })
    rmSync(dir, { recursive: true, force: true })
  })

  it('slug is always null for codex', () => {
    const { path, dir } = writeTranscript([
      { payload: { git: { branch: 'x', repository_url: 'y' } } },
    ])
    const result = getSessionInfo({ transcriptPath: path }, { log: makeLog() })
    expect(result.slug).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('ignores malformed json lines', () => {
    const { path, dir } = writeTranscript([
      'not json { "git":',
      { payload: { git: { branch: 'ok' } } },
    ])
    const result = getSessionInfo({ transcriptPath: path }, { log: makeLog() })
    expect(result.git.branch).toBe('ok')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('codex.buildHookEvent', () => {
  const config = { agentClass: 'codex', projectSlug: 'cdx-proj' }

  it('builds a new-shape envelope with agentClass=codex', () => {
    const { envelope, hookEvent, toolName } = buildHookEvent(config, makeLog(), {
      hook_event_name: 'some-codex-event',
      session_id: 'cdx-1',
      tool_name: 'shell',
    })
    expect(envelope.agentClass).toBe('codex')
    expect(envelope.sessionId).toBe('cdx-1')
    expect(envelope.hookName).toBe('some-codex-event')
    expect(envelope._meta?.project?.slug).toBe('cdx-proj')
    expect(hookEvent).toBe('some-codex-event')
    expect(toolName).toBe('shell')
  })

  it('lifts identity fields from payload', () => {
    const { envelope } = buildHookEvent(config, makeLog(), {
      hook_event_name: 'codex-turn-end',
      session_id: 'cdx-sess-1',
      agent_id: 'cdx-sub-1',
      tool_name: 'shell',
      cwd: '/tmp/work',
      transcript_path: '/tmp/sess.jsonl',
    })
    expect(envelope.sessionId).toBe('cdx-sess-1')
    expect(envelope.agentId).toBe('cdx-sub-1')
    expect(envelope.cwd).toBe('/tmp/work')
    expect(envelope._meta?.session?.startCwd).toBe('/tmp/work')
    expect(envelope._meta?.session?.transcriptPath).toBe('/tmp/sess.jsonl')
  })

  it('preserves real Codex hook payload fields on the opaque payload', () => {
    const { envelope } = buildHookEvent(config, makeLog(), {
      session_id: 'cdx-sess-1',
      hook_event_name: 'PreToolUse',
      cwd: '/repo',
      model: 'gpt-5.5',
      turn_id: 'turn-1',
      tool_name: 'Bash',
      tool_use_id: 'tool-1',
      tool_input: { command: 'echo codex' },
      transcript_path: '/Users/me/.codex/sessions/2026/04/27/session.jsonl',
    })
    expect(envelope.agentClass).toBe('codex')
    expect(envelope.hookName).toBe('PreToolUse')
    expect(envelope.sessionId).toBe('cdx-sess-1')
    expect(envelope.agentId).toBe('cdx-sess-1')
    expect(envelope.payload.model).toBe('gpt-5.5')
    expect(envelope.payload.turn_id).toBe('turn-1')
    expect(envelope.payload.tool_name).toBe('Bash')
    expect(envelope.payload.tool_use_id).toBe('tool-1')
    expect(envelope._meta?.session?.transcriptPath).toBe(
      '/Users/me/.codex/sessions/2026/04/27/session.jsonl',
    )
  })

  it('does not set Claude-only flags (clearsNotification, stopsSession, resolveProject)', () => {
    for (const hook_event_name of [
      'UserPromptSubmit',
      'SessionEnd',
      'SessionStart',
      'some-other-event',
    ]) {
      const { envelope } = buildHookEvent(config, makeLog(), {
        hook_event_name,
        session_id: 'cdx-1',
      })
      expect(envelope.flags?.clearsNotification).toBeUndefined()
      expect(envelope.flags?.stopsSession).toBeUndefined()
      expect(envelope.flags?.resolveProject).toBeUndefined()
    }
  })

  it('does NOT mutate the input payload', () => {
    const payload = {
      hook_event_name: 'shell-call',
      session_id: 'cdx-1',
      tool_name: 'shell',
      cwd: '/x',
    }
    const snapshot = JSON.parse(JSON.stringify(payload))
    buildHookEvent(config, makeLog(), payload)
    expect(payload).toEqual(snapshot)
  })

  describe('notificationOnEvents opt-in', () => {
    it('default config: PermissionRequest fires startsNotification', () => {
      const { envelope } = buildHookEvent(config, makeLog(), {
        hook_event_name: 'PermissionRequest',
        session_id: 'cdx-1',
      })
      expect(envelope.flags?.startsNotification).toBe(true)
      expect(envelope.flags?.clearsNotification).toBeUndefined()
    })

    it('default config: Stop does not fire startsNotification', () => {
      const { envelope } = buildHookEvent(config, makeLog(), {
        hook_event_name: 'Stop',
        session_id: 'cdx-1',
      })
      expect(envelope.flags).toBeUndefined()
    })

    it('opting Stop into notificationOnEvents fires startsNotification on Stop', () => {
      const optIn = { ...config, notificationOnEvents: ['Stop'] }
      const { envelope } = buildHookEvent(optIn, makeLog(), {
        hook_event_name: 'Stop',
        session_id: 'cdx-1',
      })
      expect(envelope.flags?.startsNotification).toBe(true)
    })

    it('opt-in does not affect non-matching events', () => {
      const optIn = { ...config, notificationOnEvents: ['Stop'] }
      const { envelope } = buildHookEvent(optIn, makeLog(), {
        hook_event_name: 'some-other-event',
        session_id: 'cdx-1',
      })
      expect(envelope.flags?.startsNotification).toBeUndefined()
    })

    it('empty list suppresses startsNotification on PermissionRequest events', () => {
      const optOut = { ...config, notificationOnEvents: [] }
      const { envelope } = buildHookEvent(optOut, makeLog(), {
        hook_event_name: 'PermissionRequest',
        session_id: 'cdx-1',
      })
      expect(envelope.flags?.startsNotification).toBeUndefined()
    })
  })
})

describe('codex.buildEnv', () => {
  it('mirrors the default lib buildEnv', () => {
    expect(buildEnv({ projectSlug: 'p' })).toEqual({ AGENTS_OBSERVE_PROJECT_SLUG: 'p' })
    expect(buildEnv({})).toEqual({})
  })
})
