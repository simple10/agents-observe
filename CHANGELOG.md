# Changelog

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
