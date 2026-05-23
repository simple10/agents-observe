import { describe, test, expect } from 'vitest'
import { resolveTranscriptPath } from './transcript-path'

const CLAUDE = { host: '/Users/joe/.claude/projects', container: '/host/.claude/projects' }
const CODEX = { host: '/Users/joe/.codex/sessions', container: '/host/.codex/sessions' }

describe('resolveTranscriptPath', () => {
  test('returns input unchanged when no bases configured (local mode)', () => {
    expect(resolveTranscriptPath('/Users/joe/.claude/projects/foo/bar.jsonl', [])).toBe(
      '/Users/joe/.claude/projects/foo/bar.jsonl',
    )
  })

  test('skips bases with empty host or container (partial config)', () => {
    expect(
      resolveTranscriptPath('/Users/joe/.claude/projects/foo/bar.jsonl', [
        { host: '/Users/joe/.claude/projects', container: '' },
      ]),
    ).toBe('/Users/joe/.claude/projects/foo/bar.jsonl')
  })

  test('replaces host base prefix with container base', () => {
    expect(resolveTranscriptPath('/Users/joe/.claude/projects/foo/bar.jsonl', [CLAUDE])).toBe(
      '/host/.claude/projects/foo/bar.jsonl',
    )
  })

  test('exact host-base match maps cleanly', () => {
    expect(resolveTranscriptPath('/Users/joe/.claude/projects', [CLAUDE])).toBe(
      '/host/.claude/projects',
    )
  })

  test('adjacent-prefix safety: projects-other not translated', () => {
    expect(resolveTranscriptPath('/Users/joe/.claude/projects-other/foo.jsonl', [CLAUDE])).toBe(
      '/Users/joe/.claude/projects-other/foo.jsonl',
    )
  })

  test('path that does not match any base is returned unchanged', () => {
    expect(resolveTranscriptPath('/tmp/foo.jsonl', [CLAUDE, CODEX])).toBe('/tmp/foo.jsonl')
  })

  test('multi-base: claude path resolves via claude base', () => {
    expect(
      resolveTranscriptPath('/Users/joe/.claude/projects/abc/session.jsonl', [CLAUDE, CODEX]),
    ).toBe('/host/.claude/projects/abc/session.jsonl')
  })

  test('multi-base: codex path resolves via codex base', () => {
    expect(
      resolveTranscriptPath('/Users/joe/.codex/sessions/2026/04/17/rollout-x.jsonl', [
        CLAUDE,
        CODEX,
      ]),
    ).toBe('/host/.codex/sessions/2026/04/17/rollout-x.jsonl')
  })

  test('first matching base wins (no second-pass translation)', () => {
    // Defensive: even if a second base could also match (overlapping
    // hosts — unusual but possible), we don't double-translate.
    const result = resolveTranscriptPath('/host/.claude/projects/x.jsonl', [
      CLAUDE,
      { host: '/host/.claude/projects', container: '/other/path' },
    ])
    // First match was CLAUDE — but its host is '/Users/joe/.claude/projects',
    // which our input doesn't start with. So the SECOND base matches.
    expect(result).toBe('/other/path/x.jsonl')
  })
})
