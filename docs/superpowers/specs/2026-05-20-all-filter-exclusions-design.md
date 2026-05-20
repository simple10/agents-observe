# "All" Filter Exclusions — Design Spec

**Status:** Draft
**Date:** 2026-05-20
**Branch:** `feat/all-filter-exclusions`

## Summary

Today the "All" button in the filter bar is a UI-only concept — it just clears all active pill filters, falling back to "show every event". This spec turns "All" into a real filter row (`id: 'default-all'`) whose patterns express which events to **hide** from the timeline and event stream. The immediate goal is to hide `PostToolBatch` events by default — they collide visually with their underlying tool-call events in the timeline and clutter the event stream.

Events excluded by the All filter remain in the server database and the client event store. They're suppressed at render time only, by forcing `displayEventStream = false` and `displayTimeline = false` in `processEvent`. The raw-events logs modal (which queries the server directly) is unaffected.

## Goals

- Hide `PostToolBatch` events from both the timeline and the event stream by default.
- Make the exclusion list user-configurable through Settings > Filters, using existing UI primitives.
- Apply exclusions to the timeline regardless of which pill the user has selected in the event stream — the timeline always reflects the All filter only.
- Preserve full event capture: the server stores everything, the client store retains everything, and the logs modal continues to display every event the server received.

## Non-goals (v1)

- Memory optimization (dropping excluded events from the client store entirely). Possible follow-up.
- A new dedicated editor for the All filter. The existing `FilterEditor` is reused with minor changes.
- Server-side filtering. All exclusion logic stays client-side.
- Migrating the existing "All" button behavior. The button still calls `clearAllFilters()` — it's a separate concern from the new All filter row.

## Data model

No schema change. One new row is added by `seed-filters.ts`:

```ts
{
  id: 'default-all',
  name: 'All',
  pillName: 'All',
  display: 'primary',
  combinator: 'and',
  patterns: [{ target: 'hook', regex: '^PostToolBatch$', negate: true }],
  kind: 'default',
  enabled: 1,
  config: { role: 'all-exclusions' },
}
```

Conventions:

- **Stable id `default-all`** — the client looks the filter up by this id when gating events.
- **`config.role: 'all-exclusions'`** — marker the client uses for special handling: suppress in pill bar, route Settings UI to a tailored editor preset, exclude from `applyFilters()` pill results.
- **Pattern semantics** — `combinator: 'and'` + all-negated patterns means "event matches All iff none of the exclusion patterns match its hook/tool/payload". The default is one negated `hook` pattern matching `^PostToolBatch$`.
- **Idempotent seed** — `seed-filters.ts` already preserves `enabled` and `patterns` across container restarts for default filters. The All filter follows the same rule, so user customizations survive restarts.

## Architecture

The All filter is evaluated at one place: inside each agent class's `processEvent` implementation, after the existing `applyFilters(...)` call. A new shared helper `passesAllFilter(raw, toolName, compiledFilters)` returns `true` if the event should be visible. When it returns `false`, both `displayEventStream` and `displayTimeline` are forced to `false` on the returned enriched event.

Helper contract (in `app/client/src/lib/filters/all-filter.ts`):

```ts
export function passesAllFilter(
  raw: RawEvent,
  toolName: string | null,
  compiledFilters: readonly CompiledFilter[],
): boolean
```

Behavior:

1. Find the compiled filter with `id === 'default-all'`. If absent or `enabled === false`, return `true` (no exclusions; preserves today's behavior when the user disables or deletes the filter).
2. Run the same `combinator` + per-pattern test logic the existing matcher uses, but only against this one filter. Return the boolean result.

Why a separate helper instead of folding into `applyFilters`:

- `applyFilters` returns pill names for *display* in the event stream's filter bar. The All filter never contributes a pill (per `config.role`), so it doesn't belong in the pill-name results.
- Keeping the All evaluation in its own function makes the call sites obvious and lets the helper short-circuit when the filter is absent.

### Call site

In `app/client/src/agents/claude-code/process-event.ts`, near the existing `applyFilters(...)` call (line ~372):

```ts
const filters = applyFilters(raw, toolName, ctx.compiledFilters)
const passesAll = passesAllFilter(raw, toolName, ctx.compiledFilters)

return {
  event: {
    ...,
    displayEventStream: passesAll && displayEventStream,
    displayTimeline:   passesAll && displayTimeline,
    filters,
    ...,
  },
}
```

When `processEvent` recomputes filters mid-flow (the line-311 refresh path for batch updates), `passesAllFilter` is also re-run so deferred mutations honor the latest setting.

Other agent classes (`codex/`, `default/`) get the same one-line change. The Codex and default agents have their own `processEvent` and `applyFilters` calls — applying the same pattern keeps every agent class consistent.

## Filter matching

The compiled filter already provides per-pattern regex matchers (one `RE2JS.Pattern` per pattern). The helper:

1. For each pattern in the All filter, compute its target string: `raw.hookName` for `target: 'hook'`, `toolName ?? ''` for `target: 'tool'`, or `JSON.stringify(raw.payload)` for `target: 'payload'`.
2. Test the pattern against the target string. If `negate` is true, invert the result.
3. Combine pattern results using `combinator`:
   - `and`: every pattern's match (post-negation) must be true.
   - `or`: at least one pattern's match (post-negation) must be true.
4. Return the combined boolean.

This mirrors the same logic `lib/filters/matcher.ts` runs today. We accept the small (~15-line) duplication of the per-pattern loop rather than refactoring `applyFilters` to share its inner loop — the matcher is hot code and changing its shape has broader risk than is justified by the duplication.

## Settings UI

`filters-tab.tsx` already renders all filters in a list with `FilterEditor` for the selected row. Minimal changes:

1. **Sort `default-all` first** in the filter list (currently user filters come first, then defaults sorted by name). Add a tiebreak that puts `id === 'default-all'` at the very top.
2. **Section label** — render a small caption above the All row: "Hides events from the timeline and event stream. Excluded events still appear in raw logs."
3. **Editor presets when editing the All filter:**
   - When the user clicks "+ Add pattern" on this filter, the new pattern row is initialized with `negate: true` (instead of `negate: undefined`). Other filters keep their current behavior.
   - Hide the "Display" toggle (primary/secondary) and the color picker — neither applies to a filter that never produces a pill.
   - Hide the "Combinator" picker; the stored value stays `and` from the seed. The helper still respects whatever combinator is stored (forward-compatible), but the UI doesn't expose it because `and` is the natural semantics for exclusion patterns.
4. **Delete behavior** — the All filter is deletable like any default; the existing default-delete confirmation copy is unchanged. Users restore it via the existing "Reload defaults" action.

The existing pattern editor (with target, regex, `negate`, case-insensitive flags) is reused as-is. No new UI components.

## Pill bar

The pill bar's `primaryNames` / `secondaryNames` arrays are computed from each event's `filters.primary` / `filters.secondary`. Because `applyFilters` skips the All filter (per its `config.role`), no event ever lists "All" as a matching pill — so the pill bar is unaffected. The static "All" button at the start of the bar (which clears active pills) is unchanged.

## Unaffected paths

These code paths are explicitly untouched:

- **Server.** The `events` table, `hooks/` capture pipeline, WebSocket broadcasts, and `/events` REST endpoint stay the same. Every event the server receives is still stored and broadcast.
- **Logs modal** (`components/main-panel/logs-modal.tsx`). It uses `useEvents(sessionId)` → `api.getEvents(sessionId)`, which hits `/events` directly. The All filter never touches this path.
- **`EventStore`** (`app/client/src/agents/event-store.ts`). All events still enter the store; no admission gating. Indexes (`groupIndex`, `turnIndex`, `agentIndex`) remain complete, and deferred `ctx.updateEvent(...)` mutations continue to work for excluded events.
- **The static "All" button** in `event-filter-bar.tsx`. Still calls `clearAllFilters()`.

## Testing

New tests:

1. **`lib/filters/all-filter.test.ts`** — unit tests for `passesAllFilter`:
   - Returns `true` when no `default-all` filter exists in compiled set.
   - Returns `true` when the filter exists but is disabled.
   - Returns `false` for events whose hook matches a negated pattern.
   - Returns `true` for events whose hook doesn't match any pattern.
   - Honors `combinator: 'and'` correctly across multiple patterns.

2. **`agents/claude-code/process-event.test.ts`** (extend) — integration:
   - With default-all enabled, a `PostToolBatch` raw event produces an enriched event with `displayEventStream: false` and `displayTimeline: false`.
   - With default-all disabled or deleted, the same event produces an enriched event with both flags `true` (existing behavior).
   - A non-excluded event (e.g., `PreToolUse`) is unaffected by default-all settings.

3. **`storage/seed-filters.test.ts`** (extend) — seed behavior:
   - On first seed, the `default-all` row is inserted with the default `PostToolBatch` exclusion.
   - On re-seed, an existing user-edited `default-all` row keeps its `enabled` and `patterns` values.
   - `Reset to defaults` restores `default-all` to the canonical seed.

4. **`components/settings/filters-tab.test.tsx`** (extend) — UI:
   - `default-all` is sorted to the top of the filter list.
   - Editing `default-all` shows the section caption and hides the Display / Combinator / Color controls.
   - Clicking "+ Add pattern" inside `default-all` creates a row with `negate: true` checked.

5. **`components/event-stream/event-stream.test.tsx`** (extend):
   - `PostToolBatch` events are not rendered when the default-all filter is enabled (and present).
   - They render when the filter is disabled.

6. **`components/timeline/activity-timeline.test.ts`** (extend):
   - Equivalent for the timeline: `PostToolBatch` rows / dots are absent when default-all is enabled.

## Migration

No DB schema change. But the existing `runSeedDefaults()` only fires when the `filters` table is being created for the first time — by design, so that user-customized defaults aren't overwritten on every boot. That means a brand-new default like `default-all` would never land for users who already have a filters table.

The fix is a new `installMissingSeedDefaults()` pass that runs on every init when the table already exists. It uses `INSERT OR IGNORE` so it only adds rows whose `id` isn't already present; existing rows (including user customizations to other defaults) are untouched. This is purely additive — any new seed added in a future release will likewise land automatically on the next boot without disturbing anything else.

Existing `PostToolBatch` events already in the database immediately disappear from the timeline and event stream the next time the client reprocesses (which happens on filter compile change, triggered by the WebSocket `filter:created` broadcast).

## Open questions

None. The user has signed off on Approach A (display-flag gating) and is treating the memory-optimization variant (admission drop) as a possible follow-up.

## Out of scope / possible follow-ups

- Admission-time drop in `EventStore.processOne` for memory savings.
- A dedicated "exclusions" editor with checkboxes for common hook names. The current `FilterEditor` reuse is sufficient for v1.
- Curated list of "safe-to-exclude" hook names with warnings for structurally load-bearing types (e.g., `PreToolUse`). Today the user can technically add destructive exclusions; if this becomes a real problem we can layer warnings on later.
