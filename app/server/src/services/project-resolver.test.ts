import { describe, test, expect, beforeEach } from 'vitest'
import { SqliteAdapter } from '../storage/sqlite-adapter'
import { resolveProject } from './project-resolver'

let store: SqliteAdapter

beforeEach(() => {
  store = new SqliteAdapter(':memory:')
})

// Phase 2: project-resolver is reduced to an explicit-slug-only stub.
// The full algorithm (sibling matching, cwd-derived slugs, transcript
// basedir matching) is reintroduced in Phase 3. Tests for that behavior
// are skipped here with TODO markers.

describe('resolveProject (Phase 2 stub)', () => {
  test('creates new project from slug when no project exists', async () => {
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: 'my-project',
    })
    expect(result.projectId).not.toBeNull()
    expect(result.projectId).toBeGreaterThan(0)
    expect(result.projectSlug).toBe('my-project')
    expect(result.created).toBe(true)
  })

  test('returns existing project when slug matches', async () => {
    const existingId = await store.createProject('my-project', 'my-project')
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: 'my-project',
    })
    expect(result.projectId).toBe(existingId)
    expect(result.created).toBe(false)
  })

  test('returns null projectId when no slug provided', async () => {
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: null,
    })
    expect(result.projectId).toBeNull()
    expect(result.created).toBe(false)
  })

  // TODO(phase-3): re-enable after route rewrite + new resolver algorithm
  test.skip('matches project by transcript_path when no slug provided', async () => {})
  test.skip('creates project from transcript_path when no match exists', async () => {})
  test.skip('handles slug collision when deriving from transcript_path', async () => {})
  test.skip('falls back to unknown project when no slug or transcript_path', async () => {})
  test.skip('reuses existing unknown project on second call', async () => {})
  test.skip('matches existing project by cwd before falling through to transcript_path', async () => {})
  test.skip('creates new project with cwd-derived slug', async () => {})
  test.skip('normalizes trailing slashes on cwd for matching', async () => {})
  test.skip('cwd match takes precedence over transcript_path match', async () => {})
  test.skip('slug collision when deriving from cwd appends suffix', async () => {})
  test.skip('backfills cwd on a pre-existing project when matched by slug', async () => {})
  test.skip('does not overwrite an existing cwd when matched by slug', async () => {})
  test.skip('falls through to transcript_path when cwd does not match an existing project', async () => {})
  test.skip('slug override takes priority over transcript_path', async () => {})
})
