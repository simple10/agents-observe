# Design Spec: Session Labels

## Problem

Sessions accumulate fast. Users have no way to mark a session for later review, group sessions across projects by purpose, or quickly retrieve a specific session after navigating away. The existing organizational primitives — **Project** (1 session → 1 project, server-owned) and **Pinned** (flat, single bucket) — don't cover the "I want to come back to these 3 sessions later" or "group everything I've investigated for the auth refactor" use cases.

## Goal

Add a **Label** primitive: user-defined, frontend-only tags that act like bookmarks. A session can have many labels; a label can have many sessions. Labels cross project boundaries. This is a first pass — storage is `localStorage`, interaction is modal-only, no server involvement.

## Non-goals

- **Server-side persistence.** Labels stay per-browser. If we later want cross-device sync or shared labels, that's a second pass with schema and API work — we don't want to design for it now.
- **Inline label UI** in the sidebar session rows or session header. The spec explicitly says "modals only for the first pass." The sidebar surfaces labels through *one* pill next to "Projects"; everything else lives in a modal.
- **Label-level actions** like delete-all-sessions-in-label, bulk rename, bulk move. Scope is view + organize, not bulk-operate.
- **Colors / icons per label.** Visual customization can come later. First pass uses plain text pills.
- **Filtering the sidebar session list by label.** That changes a lot of existing UI. Labels are browsed in their own modal.

## Concepts

### Label

```ts
type Label = {
  id: string          // uuid (locally generated)
  name: string        // user-visible, unique (case-insensitive) within the user's label set
  createdAt: number   // epoch ms
}
```

### Label membership

Many-to-many: a label holds a set of session IDs. Modeled as a mapping from `labelId → Set<sessionId>` rather than per-session, because the Labels modal asks "what's in this label?" far more often than "what labels does this session have?" Both directions need fast lookup, so we keep two derived views (see Storage).

### Scope

Labels are **global across projects.** A session's identity is its `sessionId` (UUID) — projects don't factor into label membership. This matches the bookmark model: "I want to keep this thing handy regardless of where it lives."

## User flows

### Adding labels to a session

1. User opens the session modal (existing flow — click the edit icon on a session row).
2. A new **Labels** tab sits beside Details and Stats.
3. The tab shows all existing labels as pills. Pills the session already belongs to are filled/selected; others are outlined/unselected. Click toggles membership.
4. A small input + "Add" button at the bottom creates a new label and adds the current session to it.
5. Changes apply immediately (no save button) — consistent with how pin/unpin works.

### Browsing labels

1. Sidebar shows a **Labels** pill, right-aligned, next to the "Projects" header (style matches the existing session-count badge on project rows). Pill text is the label count.
2. Clicking the pill opens the **Labels modal.**
3. The modal has:
   - A search input (top). Filters sessions by `slug`, `cwd`, or `transcriptPath`.
   - A view-mode toggle (segmented control): **By Label** (default) or **By CWD**.
   - A scrollable list of groups. Each group has a header (label name or cwd) with a session count, and the session rows beneath it.
   - Clicking a session row closes the modal and navigates to that session (same behavior as clicking a sidebar session row).
4. In **By Label** mode, labels are listed alphabetically (or creation order — see Open Question). Sessions appear under every label they belong to (a session in 2 labels appears twice, which is the correct mental model for "is this session in this label?"). A special **Unlabeled** section at the bottom collects sessions that the user interacted with labels on but subsequently removed — optional, may skip in v1.
5. In **By CWD** mode, the session set is the *same* (every session the user has touched via labels) but grouped by `metadata.cwd`. Headers are short-form cwd paths (`~/foo/bar`). This lets a user say "show me everything I've bookmarked from this project directory."

### The session set shown in the Labels modal

Only sessions that are a member of **at least one label** appear in the Labels modal. The modal is a view over "things I've bookmarked," not a general session browser. Rationale:

- Sidebar already shows all sessions grouped by project. Duplicating that view here adds no value.
- Users come to the Labels modal *because* they labeled something.
- Keeps the data set small and responsive, even if the user has thousands of sessions.

### Renaming / deleting a label

For v1, minimal affordances on the label group header in the Labels modal:
- Hover header → show a pencil (rename) and trash (delete) icon.
- Rename is inline. Delete removes the label but **does not delete the sessions it contained**; those sessions still exist in their projects, just no longer bookmarked under that label.

## Sidebar pill placement

```
┌──────────────────────────┐
│ PROJECTS        [●3]     │   ← existing "Projects" header row
│   ▸ Folder project-a  5  │
│   ▸ Folder project-b  2  │
└──────────────────────────┘
```

The new pill (`[●3]` above — a count of labels) sits to the right of the "Projects" text, using the same `Badge variant="secondary"` styling as project session counts. It is **not** part of the Projects section — it's a sibling control that happens to live on the same row to avoid adding vertical space. This is acceptable because:

- There is no "Labels" sub-tree to expand (unlike Projects).
- Clicking the pill always opens the modal. Its placement next to Projects doesn't imply nesting.

If this feels ambiguous in practice, the fallback is a dedicated "LABELS" header row above Projects with just the pill, matching the existing header style.

## Storage

Two localStorage keys, following the `agents-observe-*` prefix used by pinned sessions / dedup / notifications:

- `agents-observe-labels` — `Label[]` (array of label objects)
- `agents-observe-label-memberships` — `Record<labelId, sessionId[]>` (membership map, serializable)

Loaded eagerly on store init; written back on every mutation. Mirrors the `pinnedSessionIds` pattern in `ui-store.ts`.

A derived **reverse index** (`sessionId → labelId[]`) is computed lazily in-memory for the Session modal's Labels tab — no need to persist it.

### Sessions that no longer exist

A user might delete a session (or clear the database) while a label still references it. The modal needs to resolve each `sessionId` to a real session for display. Missing sessions are silently filtered out of the view — we don't proactively clean up membership data, because the session may reappear (e.g. after a database restore). A "clean up stale references" button on the modal is a future add.

## Search behavior

Single debounced input, 250ms. Matches against each session's `slug || id.slice(0,8)`, `metadata.cwd`, and `transcriptPath` — case-insensitive substring. Groups with zero matches are hidden. The view-mode toggle continues to work: search narrows *within* the current grouping.

## Performance notes

- Label counts ≤ ~50 in realistic use; no virtualization needed for the label list.
- Total labeled sessions ≤ a few hundred. Rendering in a plain scrollable list is fine.
- Session lookup needs the full list of sessions (across all projects) to resolve `sessionId → Session`. We can reuse `useRecentSessions(limit)` with a generous limit, or add a lightweight bulk-fetch endpoint if that turns out to be insufficient. See Open Question.

## Accessibility

- Labels pill in sidebar: `<button>` with `aria-label="Open labels"` and keyboard-activatable.
- Label tab in session modal: keyboard-navigable tab list (existing tab pattern is plain buttons, so we keep that for consistency).
- New label input: `Enter` submits, `Escape` blurs.
- Label pills in the session tab: `role="button"` with pressed state (`aria-pressed`).

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Users label sessions on one machine, expect to see them on another. | Be explicit in UI copy: "Labels are saved in this browser." Consider a small info tooltip on the Labels modal header. |
| Stale `sessionId` references bloat localStorage. | Accept it. v1 is lightweight — the data is tiny. Add cleanup later if it becomes a problem. |
| Label names collide (case difference). | Normalize comparisons to lowercase; reject duplicates in the "Add label" input with an inline hint. |
| Labels pill shoves the "Projects" header visually, confusing the eye. | Prototype both placements (inline with Projects vs. own header). Pick the one that reads clearly. |
| `useRecentSessions` doesn't return deep-enough history to resolve all labeled sessions. | Add a bulk endpoint that returns sessions by id (no pagination needed, batch size is small). Defer unless it's actually a problem. |

## Open questions

1. **Should the Labels modal show unlabeled sessions?** A "recently labeled but removed" bucket would help with "undo." Probably not worth v1.
2. **Do labels survive a `just db-reset`?** They would, because they're in the browser. This is probably fine — the user can clear their own `localStorage` — but worth calling out in the reset docs.
3. **Sort order for labels:** alphabetical vs. recency vs. manual drag? Start alphabetical; manual sort is a future nice-to-have.
4. **Should clicking a session row in the Labels modal navigate AND close the modal, or just navigate (keeping the modal open for multi-review)?** Default to closing — less ambiguous, matches the session-list behavior.
5. **Is there value in showing a session's labels on the row in the Labels modal itself (e.g. "also in: bugs, auth")?** Probably yes in By-CWD mode (where label grouping is hidden), no in By-Label mode (redundant). Include in By-CWD only.
6. **Should we expose a keyboard shortcut to open the Labels modal?** Nice-to-have. Skip for v1 unless trivial to wire up through existing keyboard infrastructure.
