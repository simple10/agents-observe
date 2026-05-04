# Worktree-Aware Project Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route new sessions opened inside a git worktree directory into the parent repo's existing project, instead of auto-creating a project named after the worktree-branch directory.

**Architecture:** A small path-only helper inside `project-resolver.ts` detects a `.?worktrees?` segment in `start_cwd`, walks up past dotfile ancestors, and looks up an existing project by the first non-dot ancestor's normalized slug. The helper is **match-only** — when no project exists for the candidate slug, control falls through to the current behavior (create from `basename(start_cwd)`). No storage changes; the resolver uses the existing `store.getProjectBySlug()`.

**Tech Stack:** TypeScript, vitest, better-sqlite3 (in-memory adapter for tests).

**Spec:** [`docs/plans/2026-05-04-worktree-project-detection-design.md`](./2026-05-04-worktree-project-detection-design.md)

---

## File Structure

- **Modify:** `app/server/src/services/project-resolver.ts`
  - Add an exported helper `findExistingWorktreeProjectSlug(startCwd: string | null): string | null` near the top of the file (above `resolveProject`).
  - Insert a new branch inside `resolveProject()`'s `flags.resolveProject` block, between the existing sibling match and the existing slug-derivation fallback.
- **Modify:** `app/server/src/services/project-resolver.test.ts`
  - Add a new `describe('findExistingWorktreeProjectSlug', ...)` block of unit tests for the helper.
  - Add three integration tests inside the existing `describe('resolveProject', ...)` block.

No other files change. The spec called for a new `findProjectBySlug` storage method, but the store already exposes `getProjectBySlug(slug)` (`app/server/src/storage/types.ts:49`, implementation at `app/server/src/storage/sqlite-adapter.ts:404`), which has the exact semantics we need. We use that and skip the new method.

---

### Task 1: Add `findExistingWorktreeProjectSlug` helper (TDD)

**Files:**
- Modify: `app/server/src/services/project-resolver.test.ts` (add new `describe` block at end of file)
- Modify: `app/server/src/services/project-resolver.ts:1-23` (imports + new helper)

- [ ] **Step 1: Write the failing unit tests**

Add to the bottom of `app/server/src/services/project-resolver.test.ts`:

```ts
import { findExistingWorktreeProjectSlug } from './project-resolver'

describe('findExistingWorktreeProjectSlug', () => {
  test('returns null for null cwd', () => {
    expect(findExistingWorktreeProjectSlug(null)).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(findExistingWorktreeProjectSlug('')).toBeNull()
  })

  test('returns null when no worktree segment is present', () => {
    expect(findExistingWorktreeProjectSlug('/Users/joe/dev/my-app/src')).toBeNull()
  })

  test('matches `.worktrees` and returns parent dir slug', () => {
    expect(
      findExistingWorktreeProjectSlug('/Users/joe/dev/my-app/.worktrees/feat-foo'),
    ).toBe('my-app')
  })

  test('matches `.claude/worktrees` and skips `.claude` dotfile ancestor', () => {
    expect(
      findExistingWorktreeProjectSlug('/Users/joe/dev/my-app/.claude/worktrees/feat-foo'),
    ).toBe('my-app')
  })

  test('matches `.codex/worktrees` and skips `.codex` dotfile ancestor', () => {
    expect(
      findExistingWorktreeProjectSlug('/Users/joe/dev/my-app/.codex/worktrees/feat'),
    ).toBe('my-app')
  })

  test('matches plain `worktrees` (no leading dot)', () => {
    expect(
      findExistingWorktreeProjectSlug('/Users/joe/dev/my-app/worktrees/feat'),
    ).toBe('my-app')
  })

  test('matches singular `worktree`', () => {
    expect(
      findExistingWorktreeProjectSlug('/Users/joe/dev/my-app/worktree/feat'),
    ).toBe('my-app')
  })

  test('returns null when every ancestor is a dotfile dir', () => {
    expect(findExistingWorktreeProjectSlug('/.dev/.repo/.worktrees/x')).toBeNull()
  })

  test('tolerates a trailing slash on cwd', () => {
    expect(
      findExistingWorktreeProjectSlug('/Users/joe/dev/my-app/.worktrees/feat-foo/'),
    ).toBe('my-app')
  })

  test('returns null when worktree segment has no non-dot ancestor', () => {
    expect(findExistingWorktreeProjectSlug('/.worktrees/feat')).toBeNull()
  })

  test('normalizes the candidate slug through deriveSlugFromPath', () => {
    expect(
      findExistingWorktreeProjectSlug('/Users/joe/dev/My_App!/.worktrees/feat'),
    ).toBe('my-app')
  })
})
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `npx vitest run app/server/src/services/project-resolver.test.ts -t "findExistingWorktreeProjectSlug"`

Expected: every test fails (or the import errors out) because `findExistingWorktreeProjectSlug` is not yet exported from `project-resolver.ts`.

- [ ] **Step 3: Implement the helper**

Edit `app/server/src/services/project-resolver.ts`. Update the imports near the top of the file (currently lines 20–23) and add the helper just below the imports, above `ResolveProjectInput`.

Replace:

```ts
import { dirname } from 'node:path'
import type { EventStore } from '../storage/types'
import type { EventEnvelopeCreationHints, EventEnvelopeFlags } from '../types'
import { deriveSlugFromPath } from '../utils/slug'
```

with:

```ts
import { dirname } from 'node:path'
import type { EventStore } from '../storage/types'
import type { EventEnvelopeCreationHints, EventEnvelopeFlags } from '../types'
import { deriveSlugFromPath } from '../utils/slug'

const WORKTREE_SEGMENT_RE = /^\.?worktrees?$/

/**
 * Detects a worktree-style cwd and returns the slug of the most likely
 * parent-repo project for a *match-only* lookup. Walks the path from
 * right to left for a `worktree` / `worktrees` / `.worktree` /
 * `.worktrees` segment, then continues leftward past any dotfile
 * directory (e.g. `.claude`, `.codex`) to the first non-dot ancestor.
 * Returns `null` when no worktree segment is found, when the worktree
 * segment is at the root, or when every ancestor is a dotfile dir.
 *
 * The returned slug is normalized via `deriveSlugFromPath` so it can
 * be compared directly against `projects.slug` values.
 */
export function findExistingWorktreeProjectSlug(startCwd: string | null): string | null {
  if (!startCwd) return null
  const parts = startCwd.split('/').filter(Boolean)
  let worktreeIdx = -1
  for (let i = parts.length - 1; i >= 0; i--) {
    if (WORKTREE_SEGMENT_RE.test(parts[i])) {
      worktreeIdx = i
      break
    }
  }
  if (worktreeIdx <= 0) return null
  for (let i = worktreeIdx - 1; i >= 0; i--) {
    if (!parts[i].startsWith('.')) {
      return deriveSlugFromPath(parts[i])
    }
  }
  return null
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npx vitest run app/server/src/services/project-resolver.test.ts -t "findExistingWorktreeProjectSlug"`

Expected: all 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/src/services/project-resolver.ts app/server/src/services/project-resolver.test.ts
git commit -m "feat(server): add findExistingWorktreeProjectSlug helper"
```

---

### Task 2: Wire the helper into `resolveProject` (TDD)

**Files:**
- Modify: `app/server/src/services/project-resolver.test.ts` (add three integration tests inside the existing `describe('resolveProject', ...)` block)
- Modify: `app/server/src/services/project-resolver.ts:60-75` (insert worktree-match branch between sibling match and basename fallback)

- [ ] **Step 1: Write the failing integration tests**

Append these three tests inside the existing `describe('resolveProject', ...)` block in `app/server/src/services/project-resolver.test.ts` (e.g. just before the closing `})` of that block, after the existing `'flags.resolveProject — no signal → returns null'` test):

```ts
  test('flags.resolveProject — worktree path joins existing parent project', async () => {
    const proj = await store.findOrCreateProjectBySlug('my-app')
    const result = await resolveProject(store, {
      sessionId: 'wt-sess',
      flags: { resolveProject: true },
      currentProjectId: null,
      startCwd: '/Users/joe/dev/my-app/.worktrees/feat-foo',
      transcriptPath: null,
    })
    expect(result).toBe(proj.id)
    // The worktree-branch slug must NOT have been auto-created.
    const featProj = await store.getProjectBySlug('feat-foo')
    expect(featProj).toBeNull()
  })

  test('flags.resolveProject — .claude/worktrees variant joins existing parent', async () => {
    const proj = await store.findOrCreateProjectBySlug('my-app')
    const result = await resolveProject(store, {
      sessionId: 'wt-sess',
      flags: { resolveProject: true },
      currentProjectId: null,
      startCwd: '/Users/joe/dev/my-app/.claude/worktrees/feat-foo',
      transcriptPath: null,
    })
    expect(result).toBe(proj.id)
  })

  test('flags.resolveProject — worktree path with no matching parent project creates branch-name project (regression guard)', async () => {
    // No `my-app` project seeded. Behavior must match the pre-change
    // baseline: create a project named after the worktree-branch dir.
    const result = await resolveProject(store, {
      sessionId: 'wt-sess',
      flags: { resolveProject: true },
      currentProjectId: null,
      startCwd: '/Users/joe/dev/my-app/.worktrees/feat-foo',
      transcriptPath: null,
    })
    expect(result).not.toBeNull()
    const proj = await store.getProjectById(result!)
    expect(proj.slug).toBe('feat-foo')
  })
```

- [ ] **Step 2: Run the integration tests to verify they fail**

Run: `npx vitest run app/server/src/services/project-resolver.test.ts -t "worktree"`

Expected:
- "worktree path joins existing parent project" → FAIL (returns the id of a new `feat-foo` project, not `my-app`).
- ".claude/worktrees variant joins existing parent" → FAIL (same reason).
- "creates branch-name project (regression guard)" → PASS already (current behavior).

- [ ] **Step 3: Insert the worktree-match branch into `resolveProject`**

Edit `app/server/src/services/project-resolver.ts`. The existing `if (input.flags?.resolveProject)` block is at lines 60–75:

```ts
  // Sibling matching only fires on explicit flag.
  if (input.flags?.resolveProject) {
    const transcriptBasedir = input.transcriptPath ? dirname(input.transcriptPath) : null
    const sibling = await store.findSiblingSessionWithProject({
      startCwd: input.startCwd,
      transcriptBasedir,
      excludeSessionId: input.sessionId,
    })
    if (sibling) return sibling.projectId

    const slugSource = input.startCwd ?? transcriptBasedir
    if (slugSource) {
      const slug = deriveSlugFromPath(slugSource)
      const result = await store.findOrCreateProjectBySlug(slug)
      return result.id
    }
  }
```

Replace it with:

```ts
  // Sibling matching only fires on explicit flag.
  if (input.flags?.resolveProject) {
    const transcriptBasedir = input.transcriptPath ? dirname(input.transcriptPath) : null
    const sibling = await store.findSiblingSessionWithProject({
      startCwd: input.startCwd,
      transcriptBasedir,
      excludeSessionId: input.sessionId,
    })
    if (sibling) return sibling.projectId

    // Worktree-aware match against an EXISTING project. Match-only —
    // never creates from the walk-up candidate, so unrelated ancestor
    // dirs (e.g. `Development`, `joe`) cannot become projects.
    const worktreeSlug = findExistingWorktreeProjectSlug(input.startCwd)
    if (worktreeSlug) {
      const existing = await store.getProjectBySlug(worktreeSlug)
      if (existing) return existing.id
    }

    const slugSource = input.startCwd ?? transcriptBasedir
    if (slugSource) {
      const slug = deriveSlugFromPath(slugSource)
      const result = await store.findOrCreateProjectBySlug(slug)
      return result.id
    }
  }
```

- [ ] **Step 4: Run the full resolver test file to verify all tests pass**

Run: `npx vitest run app/server/src/services/project-resolver.test.ts`

Expected: every test passes — the existing 11+ tests, the 12 new helper unit tests, and the 3 new integration tests.

- [ ] **Step 5: Run `just check` to catch formatting / type / cross-suite regressions**

Run: `just check`

Expected: all checks pass. If formatting flags either modified file, accept the formatter's output and re-run.

- [ ] **Step 6: Commit**

```bash
git add app/server/src/services/project-resolver.ts app/server/src/services/project-resolver.test.ts
git commit -m "feat(server): route worktree sessions into existing parent project

When a session's start_cwd contains a .?worktrees? segment, the
resolver now matches the first non-dot ancestor against existing
project slugs. If a project exists, the session joins it; otherwise
the existing basename behavior creates a project from the
worktree-branch dir name."
```

---

## Self-Review Checklist

Run through these before handing the plan off:

1. **Spec coverage.** Spec sections covered:
   - Detection rule (algorithm + trace table) → Task 1 helper + unit tests covering each row of the table.
   - Resolver integration (order: sibling → worktree match → basename) → Task 2 step 3.
   - Storage change → not needed; existing `getProjectBySlug` covers it. Documented above.
   - Tests (unit + integration) → Task 1 step 1 (unit) + Task 2 step 1 (integration).
   - Risks (dotfile repo root, false positive on `srv/worktrees`) → exercised by "all ancestors are dotfiles" unit test and the regression-guard integration test.
2. **Placeholder scan.** No "TBD", "TODO", "implement later", or vague-error-handling stubs. Every step shows the exact code or the exact command + expected output.
3. **Type consistency.** The helper's signature, the import path (`./project-resolver`), and the symbol name `findExistingWorktreeProjectSlug` are identical across Task 1 and Task 2. The new resolver branch uses `getProjectBySlug` (already on the store) and matches its existing return shape (`row | null`).
4. **Out-of-scope items honored.** No backfill of orphaned worktree projects. No git CLI use. No new config or UI.
