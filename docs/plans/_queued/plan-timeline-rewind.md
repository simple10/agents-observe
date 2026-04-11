# Implementation Plan: Timeline Rewind

Implementation plan for the rewind feature specified in [spec-timeline-rewind.md](./spec-timeline-rewind.md).

## Goal

Let users pause an active session's live event stream and scroll backward through historical events. The timeline becomes horizontally scrollable, showing all filtered session events as static dots positioned by timestamp. The event stream and timeline stay in sync — scrolling one moves the other.

## Key design decisions

1. **Two entirely separate timeline layouts.** Live mode keeps its existing percentage-based animated container. Rewind mode renders a new `TimelineRewind` component with static, pixel-positioned dots inside a horizontally scrollable container. React `key` includes both `rewindMode` and `timeRange` so switching modes or changing range forces a clean remount. No CSS state pollution between modes.

2. **Time-range buttons control dot density in rewind mode.** `pixelsPerMs = viewportWidth / rangeMs`. "1m" is dense, "60m" is sparse. Changing range in rewind mode preserves the leftmost-visible timestamp (capture before remount, restore `scrollLeft` after).

3. **Freeze events when entering rewind mode.** Snapshot the live event list into `frozenEvents` in the UI store. Both panes render from the snapshot while in rewind mode. React-query keeps updating the live cache in the background; exiting rewind mode drops the snapshot and re-reads live data (with all buffered events appearing at once). Auto-exit rewind on session change.

4. **Shared deduped + filtered event list.** Extract the dedup logic out of `event-stream.tsx` into a shared hook. Both the rewind timeline and event stream apply the same filters and render the same rows/dots, so scroll sync is 1:1.

5. **DOM-only scroll sync, bidirectional, lock-flag protected.** Module-level refs store `timelineScrollTo` and `eventStreamScrollTo` callbacks. Passive scroll listeners in each pane call the other's callback inside `requestAnimationFrame`. A shared `syncSource` flag prevents feedback loops. No React state updates in the scroll path.

6. **`offsetTop` for first-visible detection.** `getBoundingClientRect` triggers layout; `offsetTop` is cached. Iterate event row children looking for first one where `offsetTop + offsetHeight > container.scrollTop`. Bail at first match.

## Component/file layout

```
app/client/src/
├── lib/scroll-sync.ts                          [NEW]
│   Module-level refs + lock flag for cross-pane scroll sync
│
├── hooks/
│   ├── use-deduped-events.ts                   [NEW]
│   │   Extracted from event-stream.tsx; returns { deduped, spawnToolUseIds, spawnInfo, mergedIdMap }
│   └── use-effective-events.ts                 [NEW]
│       Returns frozenEvents in rewind mode, live events otherwise
│
├── stores/ui-store.ts                          [modified]
│   + rewindMode, frozenEvents, enterRewindMode(events), exitRewindMode()
│   + auto-exit on selectedSessionId change
│
├── components/timeline/
│   ├── activity-timeline.tsx                   [modified]
│   │   Conditionally renders TimelineRewind when rewindMode is true
│   │   Adds Live/Rewind toggle button
│   │   Keeps range buttons visible in both modes
│   └── timeline-rewind.tsx                     [NEW]
│       Horizontally scrollable container, sticky agent labels,
│       pixel-positioned dots, scroll sync registration
│
└── components/event-stream/
    ├── event-stream.tsx                        [modified]
    │   Uses useEffectiveEvents + useDedupedEvents hooks
    │   Adds rewind-mode scroll listener and registration
    └── event-row.tsx                           [modified]
        Adds data-event-row and data-timestamp attributes
```

## Implementation phases

### Phase 1: Extract shared dedup hook (~30 min)

**Goal:** Both timeline and event stream render the same deduped event list.

**Changes:**
- Create `app/client/src/hooks/use-deduped-events.ts`
- Move the `useMemo` block at `event-stream.tsx:43-86` into the hook
- Export `useDedupedEvents(events: ParsedEvent[] | undefined)` → `{ deduped, spawnToolUseIds, spawnInfo, mergedIdMap }`
- Update `event-stream.tsx` to import and use the hook

**Verification:** All existing event-stream tests pass. No visual change in live mode. Run `npm run check`.

### Phase 2: Add rewindMode state + freeze snapshot (~45 min)

**Goal:** UI store has rewind state; a shared hook gates events through the freeze.

**Changes:**
- `ui-store.ts`:
  - Add `rewindMode: boolean` (default `false`)
  - Add `frozenEvents: ParsedEvent[] | null` (default `null`)
  - Add `enterRewindMode(events: ParsedEvent[])` action
  - Add `exitRewindMode()` action
  - In `setSelectedSessionId`, if rewindMode is true and session is changing, call `exitRewindMode()` first
- Create `app/client/src/hooks/use-effective-events.ts`:
  ```typescript
  export function useEffectiveEvents(sessionId: string | null) {
    const { data: liveEvents } = useEvents(sessionId)
    const rewindMode = useUIStore((s) => s.rewindMode)
    const frozenEvents = useUIStore((s) => s.frozenEvents)
    return rewindMode ? frozenEvents : liveEvents
  }
  ```
- Update `event-stream.tsx` to use `useEffectiveEvents` instead of `useEvents`
- Update `activity-timeline.tsx` to use `useEffectiveEvents` instead of `useEvents`

**Verification:** Add unit test for `useEffectiveEvents` covering freeze/unfreeze and session-change auto-exit. Existing tests pass.

### Phase 3: Build TimelineRewind component (static, no sync) (~2 hours)

**Goal:** Working rewind view renders all filtered events as static dots. No scroll sync yet.

**Changes:**
- Create `app/client/src/components/timeline/timeline-rewind.tsx`:
  - Reads events via `useEffectiveEvents` and deduplicates via `useDedupedEvents`
  - Computes `sessionStart`, `sessionEnd`, `pixelsPerMs = viewportWidth / rangeMs`, `totalWidth = (sessionEnd - sessionStart) * pixelsPerMs`
  - Horizontally scrollable outer `<div>` with `overflow-x: auto`
  - Fixed tick marks at top (outside scrollable area)
  - Per-agent lanes inside, each with:
    - Sticky agent label: `position: sticky; left: 0; z-index: 10; bg-background`
    - Dot container: `position: relative; width: totalWidthpx`
    - Dots: `position: absolute; left: ${(timestamp - sessionStart) * pixelsPerMs}px`
  - Click on dot → `setScrollToEventId` (existing mechanism)
  - Handle empty/single-event sessions (show placeholder, use `max(1, ...)` for width)
- Modify `activity-timeline.tsx`:
  - Add Live/Rewind toggle button (replace or augment existing UI — keep range buttons visible in both modes)
  - When toggle flips to rewind: read current events from the query cache and call `enterRewindMode(events)`
  - When toggle flips to live: call `exitRewindMode()`
  - Conditionally render `<TimelineRewind />` when `rewindMode` is true
  - Use a React `key` combining `rewindMode` and `timeRange` on the timeline root so mode/range changes force remount

**Verification:** Manual test. Toggle rewind on — see all session events as static dots in agent lanes. Click a dot — event stream scrolls to that row. Change time range — dots re-space. Scroll horizontally — dots scroll, labels stay pinned.

### Phase 4: One-way sync — event stream → timeline (~1.5 hours)

**Goal:** Scrolling the event stream scrolls the timeline to match.

**Changes:**
- Create `app/client/src/lib/scroll-sync.ts`:
  ```typescript
  let timelineScrollTo: ((ts: number) => void) | null = null
  let eventStreamScrollTo: ((eventId: number) => void) | null = null
  let syncSource: 'timeline' | 'event-stream' | null = null
  let syncRafId: number | null = null

  export function registerTimelineScroll(fn: typeof timelineScrollTo) { timelineScrollTo = fn }
  export function registerEventStreamScroll(fn: typeof eventStreamScrollTo) { eventStreamScrollTo = fn }
  export function getTimelineScrollTo() { return timelineScrollTo }
  export function getEventStreamScrollTo() { return eventStreamScrollTo }

  export function withSyncLock(source: 'timeline' | 'event-stream', fn: () => void) {
    if (syncSource && syncSource !== source) return
    syncSource = source
    fn()
    if (syncRafId) cancelAnimationFrame(syncRafId)
    syncRafId = requestAnimationFrame(() => { syncSource = null })
  }
  ```
- Modify `event-row.tsx`: add `data-event-row` and `data-timestamp={event.timestamp}` attributes to the root `<div>`.
- Modify `event-stream.tsx`:
  - `useEffect` that runs when `rewindMode` is true: attach passive scroll listener to `scrollRef.current`
  - In the handler: iterate `container.children` with `[data-event-row]`, find first where `offsetTop + offsetHeight > container.scrollTop`, read its `data-timestamp`, call `getTimelineScrollTo()?.(Number(ts))` wrapped in `withSyncLock('event-stream', ...)`
  - Initial sync via `useLayoutEffect` watching `rewindMode`: on transition to true, use `requestAnimationFrame` to wait for timeline mount, then trigger the same handler once
- Modify `timeline-rewind.tsx`:
  - On mount: `registerTimelineScroll((ts) => { ... })` — handler computes `scrollLeft = max(0, (ts - sessionStart) * pixelsPerMs - STICKY_LABEL_WIDTH - 20)` and sets `container.scrollLeft` directly
  - On unmount: `registerTimelineScroll(null)`

**Verification:** Manual. Enable rewind. Scroll event stream — timeline scrolls horizontally to match. Cross-check timestamps. Add a temporary `console.log` of first-visible event to confirm the detection logic is correct.

### Phase 5: Reverse sync — timeline → event stream (~1 hour)

**Goal:** Scrolling the timeline scrolls the event stream to match.

**Changes:**
- Modify `timeline-rewind.tsx`:
  - Add passive scroll listener on the scrollable container
  - In the handler: compute `leftmostTs = sessionStart + (scrollLeft + STICKY_LABEL_WIDTH) / pixelsPerMs`
  - Binary search the deduped event list for first event with `timestamp >= leftmostTs`
  - Call `getEventStreamScrollTo()?.(events[idx].id)` wrapped in `withSyncLock('timeline', ...)`
- Modify `event-stream.tsx`:
  - On mount (in rewind mode): `registerEventStreamScroll((eventId) => { ... })` — handler uses `querySelector('[data-event-row][data-event-id="${eventId}"]')`, sets `container.scrollTop = row.offsetTop`
  - Add `data-event-id={event.id}` to event-row root (in Phase 4 edit, include this attribute)
  - Unregister on unmount

**Verification:** Scrolling either pane moves the other. Lock flag prevents feedback jitter. Test rapid scrolling in both directions.

### Phase 6: Time range + filter change handling (~45 min)

**Goal:** Range changes in rewind mode preserve scroll position; filter changes re-sync.

**Changes:**
- `timeline-rewind.tsx`:
  - Before unmount (triggered by key change): capture current leftmost timestamp into a module-level ref or Zustand transient state
  - After remount with new `pixelsPerMs`: `useLayoutEffect` restores `scrollLeft` from captured timestamp, before paint
- `event-stream.tsx`:
  - Add a `filterVersion` counter (bumps when filters change in rewind mode)
  - On `filterVersion` change in rewind mode, re-trigger initial sync

**Verification:** While in rewind, change time range — left edge stays at same timestamp. Change filters — panes re-align.

### Phase 7: Polish + edge cases (~1 hour)

- `autoFollow` auto-disables when entering rewind mode; restore previous value on exit
- Verify session-change auto-exit works (Phase 2)
- Empty session (0 events) — show "No events" placeholder
- Single-event session — handle `sessionEnd === sessionStart`
- Filters reducing events to 0 in rewind mode — empty state
- Visual indicator that rewind is active (dim timeline border, badge, or similar)
- Agent label `bg-background` is fully opaque (verify dots don't bleed through)
- Optional: keyboard shortcut `r` to toggle rewind
- Clean up any temporary debug logging

### Phase 8: Tests (~1 hour)

- Unit test `use-deduped-events` (port assertions from existing event-stream tests if any)
- Unit test `useEffectiveEvents`: freeze/unfreeze transitions, session-change auto-exit
- Unit test the binary search in `timeline-rewind`
- Integration test: render `TimelineRewind` with mock events, verify dot positions
- Integration test: verify `data-event-row` / `data-timestamp` / `data-event-id` attributes on event rows
- Skip automated testing of actual scroll sync — JSDOM doesn't simulate scroll layout. Manual verification acceptable.

## Merge back

Standard worktree merge flow from DEVELOPMENT.md:
1. In the worktree: `git merge main`
2. `just check` — all tests pass
3. Switch to main: `git merge --squash feat/timeline-rewind`
4. Single squashed commit: `feat: add timeline rewind mode`
5. Remove worktree and branch

## Estimated effort

~8 hours focused work. Phases 1-4 are the critical path (one-way working rewind). Phases 5-8 are polish.

## Biggest risk

Phase 4's scroll sync — `offsetTop`-based first-visible detection must be robust across expanded rows, group headers, and varying row heights. Add a temporary `console.log` during development to verify correctness before moving to Phase 5.
