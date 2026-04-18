import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { getSessionInfo } from '../../../../../hooks/scripts/lib/agents/codex.mjs'

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
  it('returns null when transcript_path is missing', () => {
    expect(getSessionInfo({}, { log: makeLog() })).toBeNull()
  })

  it('returns null when the transcript file cannot be read', () => {
    const log = makeLog()
    expect(getSessionInfo({ transcript_path: '/no/such/file' }, { log })).toBeNull()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('cannot read transcript'))
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
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
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
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result.git).toEqual({ branch: 'main', repository_url: 'git@ex:r.git' })
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null fields when no git info is present', () => {
    const { path, dir } = writeTranscript([{ type: 'session_meta', payload: {} }])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
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
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result.slug).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('ignores malformed json lines', () => {
    const { path, dir } = writeTranscript([
      'not json { "git":',
      { payload: { git: { branch: 'ok' } } },
    ])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result.git.branch).toBe('ok')
    rmSync(dir, { recursive: true, force: true })
  })
})
