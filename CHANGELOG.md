# Changelog

## v0.9.1 — Configurable notifications and richer event handling

**BREAKING CHANGE:** This release adds claude's new `UserPromptExpansion` hook. Be sure to update `claude code` to to the latest version before upgrading the plugin.

This release introduces a new `AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS` env var that lets you choose which hook events trigger notifications across Claude, Codex, and fallback CLIs. The dashboard now renders `UserPromptExpansion` events, pairs `PreCompact`/`PostCompact` into a single row, and keeps expanded rows in view when filtering. Event descriptors are now CLI-stamped with a `hook_name` field, and several timeline and filter bugs have been fixed.

### Features

- Configurable notification events via the new `AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS` env var, honored by the Claude, Codex, and unknown-fallback hook libraries
- Example `hooks.json` now enables notifications on Codex `Stop` events
- Render claude `UserPromptExpansion` hook events in the dashboard timeline
- Pair `PreCompact` and `PostCompact` into a single combined event row
- Keep the last-expanded row in view when filters or search change
- CLI-stamped event descriptors: events now carry a `hook_name` field (replaces `tool_use_id`)
- Notification state is now driven by envelope flags, with trace logging for notification events

### Fixes

- Guard timeline-rewind and parser against poisoned timestamps
- Static `Agents` filter now includes `SubagentStop` events
- Resolve nested-button warning in the sidebar project row

### Other

- Enable `Notification` and `Stop` triggers in project settings and example configs
- Drop unused notification count and dedup-hook dead code; refresh post-refactor comments
- Add specs and implementation plans for configurable notifications, envelope flags, and CLI-stamped descriptors

## v0.9.0 — Multi-agent support with Codex, notifications, and session bookmarking

This release introduces a pluggable agent class registry with experimental Codex hook support, live notification indicators with an animated favicon and auto-dismiss, and session labels for cross-project bookmarking. Sessions now support forking, inline renaming from the sidebar, and browser back/forward navigation. Task events are grouped into a history view, MCP tool calls get distinct icon styling, and a new theme picker rounds out the settings modal.

### Breaking Changes

- The `getSessionInfo` callback is now agent-scoped and passes `agentClass`, `cwd`, and git metadata. The auto slug format changed to `<branch>:<uuidPrefix>:<agentShortName>` — integrators consuming the callback or parsing auto slugs will need to update to the new shape.

### Features

- Experimental Codex hook support and a new agent class registry that drives event rendering, filters, and UI hints per agent type
- `AGENTS_OBSERVE_AGENT_CLASS` env var to tag sessions from the CLI; distinct `agentClasses[]` surfaced in session tooltips
- Sidebar and main-panel notification indicators with auto-clear, auto-dismiss, and an animated favicon
- Session labels for pinning and bookmarking sessions across projects
- Fork command in the session modal details tab to resume a session as a new fork
- Theme picker (light/dark/system) in the Settings Display tab
- Dedup toggle in the Settings modal controlling event processing behavior
- Task history view grouping events by `taskId` with pending/completed status and per-step descriptions
- Double-click a session name in the sidebar to inline-rename it; click the name in the breadcrumb to copy the transcript path
- Browser back and forward buttons now navigate between sessions, with forward history preserved
- Bash tool call summaries show the parsed binary name as a distinct prefix
- GPU-animated spinner on the Live/Rewind button during mode transitions
- Projects are now resolved by `cwd`, with Codex date paths collapsed to `YYYY-MM-DD`

### Fixes

- Reliable auto-scroll to bottom and virtualizer reset when switching sessions
- Rewind mode now uses a frozen event snapshot, preventing memory leaks from the live stream
- Read events show file content and Edit events show the `structuredPatch` from the paired `PostToolUse`
- Agent tool results now render from the paired `PostToolUse` payload
- Icon and color customizations propagate immediately without triggering a re-render storm
- Bash binary parser handles subshells, shell keywords, and validates output
- Timeline dots no longer fail to appear mid-animation cycle, and re-scroll to bottom on tab visibility change when follow is on
- Filter, search, and event detail rendering restored under the new agent class registry
- Status icons now display correctly across all pending/running/completed/failed events, including task history
- Dedup toggle persists to `localStorage` and reloads to avoid OOM

### Other

- Client rewired end-to-end through the agent class registry (event stream, framework components, event rendering) with a default `claude-code` agent module
- Performance: incremental event processing, memoized rewind timeline, shared `EventStore` via React context, and icon resolution moved to render time
- Styling and tooling cleanup: tool names inherit icon color, swapped Live/Rewind button colors, improved `check-hooks` script with blacklist/flagged output, and minor client formatting passes

## v0.8.6 — Session stats and UI polish

This release introduces a new session stats tab showing sub-agent token usage and session metrics at a glance. It also adds convenient copy buttons for event details and improves overall UI responsiveness with smoother scrolling and better click interactions.

### Features

- New session stats tab displaying token usage breakdowns and agent results with color-coded names and click-to-scroll navigation
- Copy button on expanded event detail fields for quick clipboard access

### Fixes

- Sidebar clicks now always navigate to the selected session
- Docker image includes python3 and build tools required for better-sqlite3 native compilation

### Other

- Improved scroll performance for expanded rows in the virtualizer
- Refined UI interactions: cursor-pointer on session rows, fixed tooltip placement for timeline agents and dots

## v0.8.5 — Performance fixes and API overhaul

Removed WorktreeCreate hook from the plugin to prevent plugin from blocking worktree creation. Major performance improvements eliminate CPU spikes on large sessions. The REST API has been restructured with standardized error responses. New features include permission mode detection and a resume command in the session modal.

### Breaking Changes

- API error responses now use a standardized format — 3rd party clients parsing error bodies will need to update to the new shape
- Project and agent endpoints have been restructured with new paths

### Features

- Permission mode detection with automatic client-side backfill for older sessions
- Resume command and copy-to-clipboard in the session modal
- `AGENTS_OBSERVE_ALLOW_DB_RESET` env var to guard the DELETE /data endpoint

### Fixes

- Removed WorktreeCreate hook and added safety checks to hook validation
- Fixed WebSocket invalidation cascade causing 100%+ CPU on large sessions
- Fixed timeline CPU usage and spinner freeze on large sessions
- Timeline dots no longer disappear after returning from an inactive browser tab
- Slug and name PATCH endpoints now validate non-empty strings

### Other

- Standardized API types, query param naming, and decoupled callbacks from REST session endpoints
- Cleaned up legacy server API support

## v0.8.2 — Timeline rewind, performance overhaul, and session editing

This release introduces timeline rewind mode for replaying agent sessions, a session edit modal for inline renaming, and toast-based API error surfacing. Major performance work virtualizes the event stream, reduces memory retention, and eliminates expand lag — making the dashboard significantly snappier with large sessions.

### Features

- Timeline rewind mode for stepping through agent sessions frame by frame
- Session edit modal for renaming sessions and projects inline
- API errors now surface as toast notifications
- Orphan repair and foreign-key auto-recovery for database integrity
- Virtualized event stream for large sessions using `@tanstack/react-virtual`
- Reduced memory retention for sessions with many events

### Fixes

- Pinned sessions, breadcrumbs, and project names now auto-update on rename
- Fixed timeline CPU usage from unnecessary re-renders

## v0.8.1 — Session management and richer event details

This release adds the ability to move sessions between projects, edit session names inline, and copy transcript paths — all from a new session action column. Event details now render markdown and diffs, and Bash/Read tool expansions show more context. The client bundle was also cut nearly in half.

### Features

- Move sessions between projects via a new action column with drag-and-drop support
- Copy JSONL transcript path button in session actions
- Open project modal directly from the sidebar edit button
- Session breadcrumb showing project, session name, and working directory
- Markdown and diff rendering in expanded event details
- Improved rendering for Bash, Read StopFailure, PostToolUseFailure, and PermissionRequest events
- Configurable shutdown delay via `AGENTS_OBSERVE_SHUTDOWN_DELAY_MS`
- Reduced client bundle from 1.27 MB to 749 KB with dynamic icon imports

### Fixes

- SubagentStop events now included in the Stop filter
- Database migration dropping unused `events.summary` and `events.status` columns

### Other

- Sidebar polish: projects sorted alphabetically, improved session row UX, footer icons stack vertically when collapsed; sticky select-all bar and better changelog modal headings in the project modal
- Cached event count, agent count, and last activity on the sessions table for faster queries

## v0.8.0 — Session pinning, sorting, and CLI tooling

This release adds several dashboard UI enhancements like session pinning and sort controls, making it easier to organize and find sessions. The CLI gains new commands like hook-sync and hook-autostart, and the `/observe` skill was enhanced with more subcommands and debugging tools. The plugin now checks server health during SessionStart events, sends a status message visible in claude, and auto repairs stopped servers.

### Features

- Pin sessions to the sidebar for quick access, with green indicators for active sessions
- Sort sessions by recent activity or creation date in the sidebar, home page, and project page
- Auto-collapse sidebar session groups when they exceed 10 items
- In-app changelog modal with version checking
- `observe logs` and `observe debug` CLI commands for troubleshooting
- `hook-sync` and `hook-autostart` commands with fast container restart
- Unified `/observe` skill with argument hints (merged observe and observe-status)
- `db-reset` CLI command for clearing the database

### Fixes

- Resolve project slug from URL hash on page refresh
- Prevent premature server exit with a 30-second shutdown delay
- Reduce memory usage from event data retention
- Suppress Radix DialogContent aria-describedby warning on all modals
- Upgrade Vite to address security vulnerability

### Other

- Centralized configuration and extracted shared libraries (hooks, fs, docker env)
- Reorganized tests and added CLI and MCP server test coverage
- Updated documentation, release scripts, and developer tooling

## v0.7.5 — Search polish, timeline fixes, and release tooling

No breaking changes. This version is just cosmetic improvements.

### Features

- Improved search UI with input debouncing, highlighted active border, clear button, and whitespace-only filtering
- Added cursor pointer to clickable elements in the sidebar and stream list
- Display plugin version in the sidebar and redesigned the Settings > Projects view

### Fixes

- Fixed timeline dot positioning to align correctly with trace events
- Fixed timeline animation so dots animate smoothly as a group instead of individually

### Other

- Added fresh install test harness with integration into the release workflow
- Improved release script with dry-run flag, skip-build option, and Claude-generated changelogs
- Updated contributor documentation and formatting configuration
