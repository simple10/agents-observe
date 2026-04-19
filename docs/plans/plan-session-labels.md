# Implementation Plan: Session Labels

Companion to [spec-session-labels.md](./spec-session-labels.md). Read the spec first.

## Overview

Frontend-only feature, `localStorage`-backed. No server, API, or schema work. Three surfaces: zustand store (data + persistence), session modal Labels tab (per-session), Labels modal (cross-session browser), sidebar pill (entry point).

## Branch

`feat/session-labels` off `feat/agent-class-support`.

## File-by-file

### 1. Types — `app/client/src/types/index.ts`

Append:

```ts
export interface Label {
  id: string
  name: string
  createdAt: number
}
```

No change to `Session` / `RecentSession` — label membership lives in the store, not on the session record.

### 2. Store — `app/client/src/stores/ui-store.ts`

Mirror the pinned-sessions pattern. Add:

- Constants: `LABELS_STORAGE_KEY = 'agents-observe-labels'`, `LABEL_MEMBERSHIP_STORAGE_KEY = 'agents-observe-label-memberships'`.
- Loader helpers: `loadLabels(): Label[]`, `loadLabelMemberships(): Map<string, Set<string>>`, and matching `saveLabels` / `saveLabelMemberships`. Serialize memberships as `Record<string, string[]>`.
- State slice on `UIState`:
  ```ts
  labels: Label[]
  labelMemberships: Map<string, Set<string>>  // labelId → sessionIds
  createLabel: (name: string) => Label
  renameLabel: (id: string, name: string) => void
  deleteLabel: (id: string) => void
  toggleSessionLabel: (labelId: string, sessionId: string) => void
  getLabelsForSession: (sessionId: string) => Label[]
  // Modal
  labelsModalOpen: boolean
  openLabelsModal: () => void
  closeLabelsModal: () => void
  ```
- Case-insensitive uniqueness in `createLabel` / `renameLabel`: trim, lowercase-compare against existing names, return/throw (callers handle UX).
- Session modal tab union: extend from `'details' | 'stats'` to `'details' | 'stats' | 'labels'`. Update `editingSessionTab` type and `setEditingSessionId` tab arg.

### 3. Session modal — `app/client/src/components/settings/session-modal.tsx`

- Extend the `(['details', 'stats'] as const)` tuple to include `'labels'`. Add a label case in the render logic and to the `activeTab` state type.
- New subcomponent `SessionLabelsTab({ sessionId })`:
  - Reads `labels`, `labelMemberships`, `toggleSessionLabel`, `createLabel` from the store.
  - Renders all labels as pills (reuse `Badge`, but as `<button>` for interactivity). Selected = filled; unselected = `variant="outline"`.
  - Bottom row: `<Input>` + `<Button>Add</Button>`. Enter also submits. On submit: trim, bail on empty, check duplicate (case-insensitive) and show inline hint if dupe, otherwise `createLabel` + `toggleSessionLabel`.
  - Empty state: "No labels yet. Create one below."
- Place it where `SessionStats` is rendered (`{activeTab === 'labels' && <SessionLabelsTab ... />}`).

### 4. Labels modal — new file `app/client/src/components/labels/labels-modal.tsx`

Shell:
```
Dialog (wide: ~680px, like session modal but wider)
  Header: title "Labels" + close
  Row: search input + view-mode toggle (By Label / By CWD)
  Scrollable body: groups with headers + session rows
  Footer: small muted text "Labels are saved in this browser"
```

- View mode is component-local state (`useState<'label' | 'cwd'>`).
- Search is component-local state, debounced 250ms before applying.
- Session resolution: reuse `useRecentSessions(1000)` or similar — the hook already returns `RecentSession[]` with everything needed (`projectSlug`, `slug`, `metadata`, `transcriptPath` — **double-check transcriptPath is on RecentSession; if not, we either widen the recent-sessions query or call `useSessions` per project**). If transcriptPath isn't on RecentSession, extend the backend `/api/recent-sessions` response to include it (small change — it's already on `Session`).
- Build the view:
  1. Flatten `labelMemberships` into `Set<sessionId>` of all labeled ids.
  2. Filter available sessions by that set.
  3. Apply search filter (substring match on `slug`, `cwd`, `transcriptPath`).
  4. Group per view mode.
  5. Render groups; each group shows `header · count`; session rows reuse visual style from sidebar `SessionItem` but simplified (no inline edit, no pin — just name + cwd + time).
- Clicking a session row: call `setSelectedProject`/`setSelectedSessionId` (same logic as `SessionList` click handler), then `closeLabelsModal`.
- Group header actions (By-Label only): hover shows pencil/trash icons; pencil toggles an inline rename input; trash opens an `AlertDialog` with "Delete label" confirmation.

### 5. Sidebar pill — `app/client/src/components/sidebar/project-list.tsx`

Minimal change: replace the `<div>Projects</div>` header with a flex row that has "Projects" on the left and a clickable `Badge` on the right. The badge shows `labels.length` and opens the modal.

```tsx
<div className="flex items-center px-2 py-1">
  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Projects</span>
  <button
    className="ml-auto cursor-pointer"
    onClick={openLabelsModal}
  >
    <Badge variant="secondary" className="text-[10px] h-4 px-1">
      {labels.length} labels
    </Badge>
  </button>
</div>
```

If the spec's fallback layout (separate LABELS header row) turns out to read better during manual testing, swap to that — purely a copy/layout change, no store work.

Collapsed-sidebar state: hide the pill (or render as an icon-only button later). v1 skips collapsed-mode support for the pill.

### 6. Modal mounting — `app/client/src/components/sidebar/sidebar.tsx`

Near `<SettingsModal />`, add `<LabelsModal />` so it's always mounted and reacts to the store's `labelsModalOpen`.

### 7. Tests

Follow existing patterns (`*.test.ts[x]` next to source). Tests to add:

- `ui-store.test.ts` — new cases for `createLabel` (dedupe, trim), `toggleSessionLabel` (add/remove), `deleteLabel` (removes membership), `renameLabel` (dedupe), persistence round-trip via `localStorage` mock.
- `labels-modal.test.tsx` — render with fake labels + sessions; toggle view mode; search filter hides non-matching groups; clicking a row navigates and closes the modal; delete/rename label flows.
- Session-modal tab test (extend existing `session-modal` tests if present, otherwise skip) — labels tab renders, create-label flow, toggle flow.

## Phasing

Keep PRs small and reviewable. One PR per phase.

### Phase 1 — Store + persistence
- Types, constants, loaders, store slice, unit tests for store.
- No UI changes yet. Manual verification: open devtools, poke at `useUIStore.getState().createLabel('foo')`.

### Phase 2 — Session modal Labels tab
- Extend tab union, add `SessionLabelsTab` component, wire it up.
- Manual test: open a session, create labels, toggle, confirm localStorage reflects.

### Phase 3 — Labels modal
- Build modal, wire store open/close, implement By-Label grouping first, then By-CWD, then search.
- Mount in sidebar so the modal is reachable.

### Phase 4 — Sidebar pill
- Add the pill next to Projects. Hook `onClick` → `openLabelsModal`.

### Phase 5 — Rename/delete in Labels modal
- Group-header actions + AlertDialog confirmation.

### Phase 6 — Polish
- Empty states, a11y pass, info tooltip about localStorage scoping, address open-question decisions from the spec after manual testing.

## Risks

- **`RecentSession` missing `transcriptPath`.** Fix upstream (small server + client-type change) or fall back to `useSessions(projectId)` per project. Check first; don't speculate.
- **Session IDs that no longer exist.** Filter silently in Labels modal view; don't crash. The store's `labelMemberships` keeps them so they come back if the session returns.
- **Tab union change is a small breaking touch point.** Any caller of `setEditingSessionId(id, tab)` needs to still type-check. Grep for it before merging Phase 2.
- **Badge click inside the Projects header.** The Projects header is inside a `<div>`, not a button. Adding a nested `<button>` is clean. If the header ever becomes clickable, revisit to avoid nested-interactive elements.

## Out of scope for this plan

- Server persistence (future spec if needed).
- Bulk operations (move all, delete all in label).
- Label colors / icons.
- Sidebar filtering by label.
- Keyboard shortcut to open the Labels modal.

## Done criteria

- `just check` passes.
- Creating, renaming, deleting a label round-trips through localStorage.
- Toggling a label on a session persists and shows up across browser reloads.
- Labels modal opens from the sidebar pill, groups by label and by cwd, search filters correctly, clicking a session navigates.
- Labels tab in the session modal can create and toggle labels.
- No regressions in existing Projects / Pinned / Sessions sidebar flows.
