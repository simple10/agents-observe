# Plan: Pluggable dashboard themes + Constellation home view

**Date:** 2026-05-28
**Branch:** `feat/dashboard-themes-constellation`

## Goal

Make the home page render through a **pluggable "dashboard theme" system** so the
default recent-sessions list and a new force-directed **Constellation** view are
interchangeable, and new whole-home-page visualizations can be added later by
dropping a folder and registering it. Ship the Constellation theme: a live
force-directed star map of all sessions with recency decay, subagent-hierarchy
orbits, needs-attention flares, drill-in subagent tree + event ticker, and
switchable visual palettes.

This is the productionization of `mockups/constellation.html`.

## Architecture

### New module: `app/client/src/dashboard/`

```
dashboard/
  types.ts                 DashboardTheme contract + DashboardThemeProps
  registry.tsx             registered themes (array) + lookup helpers
  dashboard-host.tsx       owns header (title + sort toggle + switcher), renders active theme
  theme-switcher.tsx       dropdown to pick the active dashboard theme
  themes/
    sessions-list/
      index.tsx            registers; Component wraps the existing <SessionList>
    constellation/
      index.tsx            registers; Component = <ConstellationView>
      constellation-view.tsx   nodes + rAF loop (imperative DOM mutation, no per-frame React state)
      physics.ts           PURE: force step, heat(), radius(), project well layout  [tested]
      palettes.ts          PURE: palette defs + tempColor lerp                       [tested]
      agent-tree.ts        PURE: buildAgentTree() + radial layout for drill-in       [tested]
      drill-in.tsx         focused session: viewBox zoom + subagent tree (lazy load)
      event-ticker.tsx     recent/near-live events for the focused session
      constellation.css    palette CSS vars + keyframes (pulse, flare, orbit spin)
      physics.test.ts / palettes.test.ts / agent-tree.test.ts
```

### Contract

```ts
interface DashboardThemeProps {
  sessions: RecentSession[]                 // sorted by host
  isLoading: boolean
  onOpenSession: (session: RecentSession) => void
}
interface DashboardTheme {
  id: string                                // persisted key
  name: string
  description?: string
  icon?: LucideIcon
  usesSort?: boolean                        // host hides the sort toggle when false
  Component: React.ComponentType<DashboardThemeProps>
}
```

### Integration points (verified against the codebase)

- **`home-page.tsx`** → renders `<DashboardHost />`. Host keeps the existing
  header markup (title + sort toggle), adds the theme switcher, owns sort
  (`sessionSortOrder` from UIStore), and provides `onOpenSession` =
  `setSelectedProject(...) → setSelectedSessionId(...)` (mirrors
  `session-list.tsx` `handleSessionClick`).
- **UIStore** (`stores/ui-store.ts`): add
  - `dashboardThemeId: string` + `setDashboardThemeId` (persist
    `agents-observe-dashboard-theme`, default `'sessions-list'`), following the
    existing `sessionSortOrder`/`sidebarTab` localStorage pattern.
  - `sessionActivityAt: Record<string, number>` stamped with `Date.now()` inside
    `pulseSession` (additive) — gives the constellation a live per-session
    last-activity timestamp for heat, read imperatively in the rAF loop.
- **Notifications**: `export` the existing `useNotificationStore` from
  `components/sidebar/notification-indicator.tsx` so the constellation can derive
  the set of flagged (pending && !dismissed) session ids → attention flares.
- **Real-time**: no new WS plumbing for the field. `activity`, `session_update`,
  `notification` are already `broadcastToAll`. The loop reads
  `useUIStore.getState().sessionActivityAt` + the notification store imperatively
  each frame (no React re-render per ping). The session *list* still updates via
  the existing `recent-sessions` query invalidation on `session_update`.
- **Drill-in data**: lazy `useEvents(sessionId)` → `useAgents(sessionId, events)`
  (both already query-based) mounted only while a session is focused.

### Rendering / perf

Mirror the timeline's compositor-friendly approach (see DEVELOPMENT.md "Timeline
rendering perf"): React renders the SVG *structure* (one `<g>` per session); a
single `requestAnimationFrame` loop mutates `transform`/`fill`/`opacity` via refs
— **no per-frame React state**. Pulse/flare/orbit are CSS animations; heat fades
them via a wrapper-group opacity so they don't fight the keyframes. Palette
colors are read once per palette change (cached RGB), not per frame.

### Decisions

- **No `d3-force` dependency.** The heat-driven radial force is custom; the
  mini-sim is small, controllable, and unit-tested. Keeps the bundle lean.
- **Palettes** (native / deep-space / bioluminescent) are a *constellation-internal*
  concern (its own localStorage key + floating control), not a global theme axis.
- **Decay** = continuous `heat = exp(-(now - lastActivity)/τ)` driving color,
  glow, pulse opacity, size, and a radial spring (hot → well center, cold → rim).
  τ default 90s, exposed as a small slider in the constellation control panel.
- **Click a star** → drill-in (in-place zoom + tree + ticker). **"Open session →"**
  in the drill-in calls `onOpenSession` to navigate to the real SessionView.
- Reduced motion: honor `@media (prefers-reduced-motion)` in CSS + a manual toggle.

## Steps

1. UIStore: `dashboardThemeId` + `sessionActivityAt` (+ stamp in `pulseSession`).
2. Export `useNotificationStore`.
3. `dashboard/` scaffolding: types, registry, host, switcher.
4. `sessions-list` theme (wraps `<SessionList>`; preserves current behavior exactly).
5. Constellation pure modules + tests: `palettes.ts`, `physics.ts`, `agent-tree.ts`.
6. `constellation.css`.
7. `constellation-view.tsx` (field + rAF loop), `drill-in.tsx`, `event-ticker.tsx`, `index.tsx`.
8. Swap `home-page.tsx` to `<DashboardHost />`.
9. `just check` (tests + fmt + client build/typecheck); run `just dev`; verify load.

## Out of scope (follow-ups)

- True live event streaming on drill-in (secondary WS subscription); v1 polls/refetches on ping.
- A `since`/`limit` param for the events endpoint to avoid full-session fetches on drill-in.
- Day/night ambient background; sound on attention.
