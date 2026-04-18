import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { getSessionInfo } from '../../../../../hooks/scripts/lib/agents/claude-code.mjs'

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
  const dir = join(tmpdir(), `cc-getinfo-${Date.now()}-${Math.random()}`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'transcript.jsonl')
  writeFileSync(path, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'))
  return { path, dir }
}

describe('claude-code.getSessionInfo', () => {
  it('returns null when transcript_path is missing', () => {
    expect(getSessionInfo({}, { log: makeLog() })).toBeNull()
  })

  it('returns null when the transcript file cannot be read', () => {
    const log = makeLog()
    expect(getSessionInfo({ transcript_path: '/no/such/file' }, { log })).toBeNull()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('cannot read transcript'))
  })

  it('extracts slug and gitBranch from top-level fields', () => {
    const { path, dir } = writeTranscript([
      { type: 'system' },
      { slug: 'my-session', gitBranch: 'feat/foo', cwd: '/tmp' },
    ])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result).toEqual({
      slug: 'my-session',
      git: { branch: 'feat/foo', repository_url: null },
    })
    rmSync(dir, { recursive: true, force: true })
  })

  it('combines slug and gitBranch when they appear on different lines', () => {
    const { path, dir } = writeTranscript([
      { gitBranch: 'main', type: 'hook' },
      { type: 'assistant' },
      { slug: 'the-slug' },
    ])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result).toEqual({
      slug: 'the-slug',
      git: { branch: 'main', repository_url: null },
    })
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null fields when neither appears in the transcript', () => {
    const { path, dir } = writeTranscript([{ type: 'system' }, { type: 'user' }])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result).toEqual({
      slug: null,
      git: { branch: null, repository_url: null },
    })
    rmSync(dir, { recursive: true, force: true })
  })

  it('ignores malformed json lines', () => {
    const { path, dir } = writeTranscript([
      '{ not valid json',
      { slug: 'real-slug', gitBranch: 'real-branch' },
    ])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result.slug).toBe('real-slug')
    expect(result.git.branch).toBe('real-branch')
    rmSync(dir, { recursive: true, force: true })
  })

  it('ignores empty-string values', () => {
    const { path, dir } = writeTranscript([{ slug: '', gitBranch: '' }, { slug: 'ok' }])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result.slug).toBe('ok')
    expect(result.git.branch).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})
