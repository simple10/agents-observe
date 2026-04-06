# TASKS

## QUEUED TASKS

- [ ] Review PR #5 <https://github.com/simple10/agents-observe/pull/5>
  - We currently rely on claude to start the mcp server which starts the docker container
  - Investigate the need for SessionStart to also trigger auto start
    - This would break the model where user intentionally stopped the mcp server, but might be needed when server auto shuts down due to timeout in activity? MCP server should be keeping the server alive already.
  - We need a better way of testing fresh installs before pushing new releases

## COMPLETED TASKS

- [x] Add CSS for cursor pointers to clickable elements in sidebar & activity stream
  - Added cursor-pointer to Button component base class (all Button instances)
  - Added cursor-pointer to project buttons, session buttons, and event rows
- [x] Improve search UI
  - Highlight border + ring on search input when query is active
  - Search icon turns primary color when active
  - X button to clear the search
  - Subtle background tint when query has leading/trailing spaces
  - Spaces-only queries are ignored (don't trim — just skip filtering)
- [x] Fix timeline animation bugs (per spec-timeline-animation-bugs.md)
  - Replaced per-dot CSS transitions with single container Web Animation
  - All dots share one translateX animation — same speed, can't diverge
  - React re-renders don't disrupt the running animation
  - Zero-discontinuity re-anchor on animation finish

- [x] Show the version next to the "connected" message in the bottom of sidebar
- [x] Modify the Settings > Projects tab to enable per project deleting of sessions
- [x] Detect plugin version & server version mismatches & add skill support to restart the server
- [x] In Agent Label tooltip, don't show the description if it's the same as the name
  - Also in agents combo box - skip description line if it matches the agent display name

- [x] Add an edit icon to change session slug name in sidebar — inline pencil icon, Enter/blur saves, Escape cancels
- [x] Add an edit icon in sidebar to change project name — added display_name column, POST /projects/:id/metadata endpoint, inline edit UI

- [x] Add Result (final message) to Prompt expanded summary — finds Stop event in thread, shows last_assistant_message
- [x] Add clarifying message to delete confirmation modals (only deletes Observe logs, not Claude session files)
- [x] Improve performance of activity pane and sidebar resizing (direct DOM updates during drag, commit on mouseUp)
- [x] Add Tool:TaskCreate and Tool:TaskUpdate to the Tasks static filter

- [x] Fix Icons modal in Settings - needs to be scrollable
- [x] Add a color wheel picker option to the color pallette
- [x] Sync the agent colors in Activity, agent dropdown, and event stream
- [x] In Activity Timeline:
  - [x] Add new agents directly underneath Main agent
  - [x] Make agent name clickable: scroll down to first agent event in stream
- [x] Add a concept of "selected" row to the events stream - preserve scroll to selected row when filters change
- [x] Fix the dynamic filter bar logic to include any hook that doesn't match one of the static filters
- [x] Add a settings gear icon in bottom of sidebar: Projects & Icons settings
- [x] Change agent chips to a custom dropdown menu
- [x] Show Agent ID and Agent Name in Tool:Agent expanded summary instead of results JSON
  - Added AgentIdentity component showing assigned name, dimmed raw name if different, and agent ID
  - Applied to SubagentStart, SubagentStop, and Tool:Agent expanded views
- [x] Fix the expand sidebar button overlapping with "Filters:" in collapsed mode
  - Header layout stacks vertically when collapsed, hiding logo/spacer so only the expand button shows
- [x] Add a loader (spinner) to the Logs modal
  - Modal opens immediately with spinner, heavy event list deferred via useTransition
- [x] Preserve filter state per session (in-memory)
  - Map<sessionId, filterState> in Zustand store, saves/restores on session switch, defaults to "All"
- [x] Fix sub-agent naming race condition
  - Root cause: pendingAgentNames keyed by sessionId instead of toolUseId, causing overwrites on concurrent spawns
  - Fixed with toolUseId-keyed map, per-session FIFO queue, and named-agents tracking set
- [x] Add 60m option to Activity Timeline
- [x] Group sidebar sessions by relative date (Today, Yesterday, This Week, Last Week, then by month)
- [x] Add home page at root path showing recent sessions across all projects
  - Full stack: GET /sessions/recent API endpoint, React Query hook, HomePage component
- [x] Switch from emojis to lucide-react icons with color coding by event category
  - 32 icon mappings, color-coded: tools=blue, user=green, session=yellow, agents=purple, etc.
  - Timeline dots use solid colored circles with white icon lines
- [x] Improve light mode color contrast
  - Adjusted CSS variables and 12 component files, all using dark: prefix to preserve dark mode
- [x] Add the corresponding Tool: Agent to the stream when filtering by agent chip
- [x] Debug why filter buttons are super lagging in some cases (2215ms → 500ms)
  - Root cause: 700+ EventRow components re-rendered on every filter toggle
  - Fix: React.memo on EventRow, useDeferredValue for filter state, removed allEvents prop
  - Also: pre-built lookup map for filter matching (O(1) vs O(n) per event)
- [x] Add Events status bar above the events stream
- [x] Add a "Filters:" label before the static filters - similar to "Agents:" and "Activity:" labels
- [x] Add Tool "Agent" to the Agents static filter - i.e. shows SubAgentStart/Stop and Tool -> Agent so we can see how the agent was started
- [x] If possible (easy?) add a highlight border color to static filters that match any of the events
- [x] Show number of matching events in small font in agent chip
- [x] Add a Logs button to top right
- [x] Add summary & expanded summary for all 25 hooks in the UI
- [x] Update the dynamic filter bar (row 2) when an agent is selected
- [x] Create a new file that maps hook names to filters, e.g.:
- [x] In the filter bar, split the filters into two rows (static & dynamic)
- [x] Add support for selecting multiple filters
- [x] Make agent chips clickable to filter by agent
- [x] Show the cwd for the session underneath the session in the sidebar
- [x] Make the Activity Timeline pane vertically resizable
- [x] Fix the conversation (chat) thread view with proper tool display
- [x] Apply the .prettierrc linting to all app/* files
- [x] Re-order agent chips to always show the active ones on the left
- [x] Add tooltips to agent names in Activity Timeline to show the full name
- [x] Add URL hash routing for project and session selection
- [x] Order agent chips: Main first, then by most recent activity
- [x] Auto scroll to bottom on session select
- [x] Add bottom padding to event stream
- [x] Chat thread deduping (Pre/PostToolUse merged client-side)
- [x] Stop event shows user prompt above Final message
- [x] SubAgentStop expanded summary with Agent command and results
- [x] Replace CLAUDE_OBSERVE_PORT with CLAUDE_OBSERVE_EVENTS_ENDPOINT
- [x] Auto-follow toggle + clear session button in nav
- [x] DELETE /api/sessions/:id/events endpoint (removed insecure DELETE /api/data)

---

## FUTURE TASKS

Don't implement these yet. They're here for future reference.

- [ ] Implement timeline replay feature; see [spec-timeline-rewind.md](docs/plans/_queued/spec-timeline-rewind.md)
- [ ] Track token & context window usage per session and agent
  - On Stop hook, use two-way pattern: hook reads transcript JSONL, sums `usage` fields from all assistant messages, posts totals to `/api/sessions/:id/usage` callback
  - Subagent usage already available in PostToolUse:Agent `tool_response` (totalTokens, totalDurationMs, usage breakdown) — just need to surface in UI
  - Store session-level totals: total input/output tokens, cache read/creation, total duration
  - Show in sidebar (per session) and scope bar (per agent)
  - New `getSessionUsage` command for the two-way hook pattern
