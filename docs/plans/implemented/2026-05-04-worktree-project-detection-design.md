# Worktree-Aware Project Detection — Design

Date: 2026-05-04
Status: Draft (awaiting user review)

## Problem

When a Claude Code (or Codex) session runs from a git worktree, the
session's `cwd` points at the worktree subdir (e.g. `…/my-app/.worktrees/feat-foo`).
The project resolver derives a project slug from `basename(start_cwd)`,
so every worktree session lands in a brand-new project named after the
worktree branch (`feat-foo`) instead of joining the parent repo's
project (`my-app`). Users have to manually move sessions back to the
right project after the fact.

## Goal

New sessions opened inside a worktree directory should auto-join an
existing project for the parent repo when one is found. When no
matching project exists, behavior is unchanged — a new project is
created from the worktree dir's basename, exactly as today.

## Non-goals

- **No backfill.** Existing sessions and projects are untouched. Once a
  user has seen a session under a given project, the assignment is
  considered observed and is not safe to silently re-route. This
  change only affects sessions that have not yet been assigned a
  project.
- **No git CLI.** Detection is purely path-based. The server runs in
  Docker and does not have host-git access. (A git-aware variant via
  the existing `getSessionInfo` callback was considered and rejected
  as more machinery than the convention warrants.)
- **No new config or UI.** Default-on. No opt-out.

## Detection rule

A new helper, inline in `app/server/src/services/project-resolver.ts`:

```ts
function findExistingWorktreeProjectSlug(startCwd: string | null): string | null
```

Algorithm:

1. If `startCwd` is null/empty → return `null`.
2. Split `startCwd` into segments (drop empties).
3. Scan right → left for the deepest segment matching `/^\.?worktrees?$/`
   (matches `worktree`, `worktrees`, `.worktree`, `.worktrees`).
4. If no match → return `null`.
5. Walk further leftward, **skipping** segments whose name starts with
   `.` (handles `.claude/worktrees`, `.codex/worktrees`).
6. Return `deriveSlugFromPath(firstNonDotAncestor)`. If no non-dot
   ancestor exists → return `null`.

The returned slug is normalized through the existing
`deriveSlugFromPath()` so it matches the form auto-created project
slugs were stored as.

### Trace examples

| `start_cwd` | Worktree segment | Walk-up candidate slug |
|---|---|---|
| `/Users/joe/dev/my-app/.worktrees/feat-foo` | `.worktrees` | `my-app` |
| `/Users/joe/dev/my-app/.claude/worktrees/feat-foo` | `worktrees` | skip `.claude` → `my-app` |
| `/Users/joe/dev/my-app/.codex/worktrees/feat` | `worktrees` | skip `.codex` → `my-app` |
| `/Users/joe/dev/my-app/worktrees/feat` | `worktrees` | `my-app` |
| `/Users/joe/worktrees/feat` (orphan worktree) | `worktrees` | `joe` (typically no match → fall through) |
| `/Users/joe/dev/my-app/src` (no worktree) | — | `null` |
| `/home/joe/.dev/my-app/.worktrees/x` (repo root in dotfile dir) | `.worktrees` | every ancestor is `.dev` / `joe` / `home` → no non-dot match → `null` |

## Resolver integration

In the existing `flags.resolveProject` block of `resolveProject()`, the
order becomes:

1. Existing: sibling match by `start_cwd` / `transcript_basedir`.
2. **New: worktree match (existing project only).**
3. Existing: derive slug from `start_cwd` basename and find-or-create.

The new step:

```ts
const worktreeSlug = findExistingWorktreeProjectSlug(input.startCwd)
if (worktreeSlug) {
  const existing = await store.findProjectBySlug(worktreeSlug)
  if (existing) return existing.id
}
```

It is **match-only** — it never calls `findOrCreateProjectBySlug`.
That is the safety the user asked for: an unrelated walk-up ancestor
(e.g. `joe`, `Development`) cannot accidentally become a new project.
When the lookup misses, control falls through to the existing
basename-of-`start_cwd` branch and behavior is unchanged.

## Storage change

Add a read-only method to `EventStore` and the SQLite adapter:

```ts
findProjectBySlug(slug: string): Promise<Project | null>
```

Implementation: `SELECT id, slug, name, created_at, updated_at FROM projects WHERE slug = ? LIMIT 1`.
This is a strict subset of the existing `findOrCreateProjectBySlug`.
Both helpers can share the same `SELECT` once factored.

## Tests

**Unit — `findExistingWorktreeProjectSlug`**, covering each row of the
trace table plus:

- `null` / empty input.
- Trailing slash on `start_cwd`.
- A path where the only "worktree" segment is itself nested inside
  another worktree (deepest match wins).

**Integration — `project-resolver.test.ts`:**

1. Seed a project with slug `my-app`. Ingest a `SessionStart` envelope
   with `start_cwd = /Users/joe/dev/my-app/.worktrees/feat-foo`.
   Assert the session's `project_id` equals the seeded project's id
   and that no `feat-foo` project was created.
2. Same path, **no** seeded project. Assert a new project with slug
   `feat-foo` is created (current behavior preserved).
3. `.claude/worktrees/...` variant — same expectations as (1).
4. Path with no worktree segment — falls through to existing basename
   behavior (regression guard).

## Risks

- **Dotfile repo root** (e.g. `/home/joe/.dev/repo/.worktrees/x`): the
  walk-up skips every dot ancestor and returns `null`, so worktree
  sessions in this layout still create per-branch projects. Documented
  as a known limitation; uncommon in practice.
- **False positive on a real directory literally named `worktrees`**
  inside an unrelated tree — e.g. `/srv/worktrees/active/foo`. The
  candidate (`srv`) almost never matches an existing project slug, so
  the match-only guard converts the false positive into the existing
  behavior. Safe.

## Out-of-scope follow-ups

- Reconciling already-orphaned worktree projects (explicitly declined
  by the user — sessions already shown to the user under those projects
  are considered observed and immutable).
- A richer worktree-origin signal in the UI (e.g. labeling a session
  with its worktree branch). Tracked separately if/when desired.
