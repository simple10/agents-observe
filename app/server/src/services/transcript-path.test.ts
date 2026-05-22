import { describe, test, expect } from 'vitest'
import { resolveTranscriptPath } from './transcript-path'

describe('resolveTranscriptPath', () => {
  test('returns input unchanged when both bases empty (local mode)', () => {
    expect(resolveTranscriptPath('/Users/joe/.claude/projects/foo/bar.jsonl', '', '')).toBe(
      '/Users/joe/.claude/projects/foo/bar.jsonl',
    )
  })

  test('returns input unchanged when only one base set', () => {
    expect(
      resolveTranscriptPath(
        '/Users/joe/.claude/projects/foo/bar.jsonl',
        '/Users/joe/.claude/projects',
        '',
      ),
    ).toBe('/Users/joe/.claude/projects/foo/bar.jsonl')
  })

  test('replaces host base prefix with container base', () => {
    expect(
      resolveTranscriptPath(
        '/Users/joe/.claude/projects/foo/bar.jsonl',
        '/Users/joe/.claude/projects',
        '/host/.claude/projects',
      ),
    ).toBe('/host/.claude/projects/foo/bar.jsonl')
  })

  test('exact host-base match maps cleanly', () => {
    expect(
      resolveTranscriptPath(
        '/Users/joe/.claude/projects',
        '/Users/joe/.claude/projects',
        '/host/.claude/projects',
      ),
    ).toBe('/host/.claude/projects')
  })

  test('adjacent-prefix safety: projects-other not translated', () => {
    expect(
      resolveTranscriptPath(
        '/Users/joe/.claude/projects-other/foo.jsonl',
        '/Users/joe/.claude/projects',
        '/host/.claude/projects',
      ),
    ).toBe('/Users/joe/.claude/projects-other/foo.jsonl')
  })

  test('path that does not start with host base is returned unchanged', () => {
    expect(
      resolveTranscriptPath(
        '/tmp/foo.jsonl',
        '/Users/joe/.claude/projects',
        '/host/.claude/projects',
      ),
    ).toBe('/tmp/foo.jsonl')
  })
})
