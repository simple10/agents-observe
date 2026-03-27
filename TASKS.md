# TASKS

## QUEUED TASKS

- [x] Debug why filter buttons are super lagging in some cases (2215ms → 500ms)
  - Root cause: 700+ EventRow components re-rendered on every filter toggle
  - Fix: React.memo on EventRow, useDeferredValue for filter state, removed allEvents prop
  - Also: pre-built lookup map for filter matching (O(1) vs O(n) per event)
- [ ] Fix the expand sidebar button in collapsed mode - it's currently overlapping with "Filters:"
  - use devtools to debug - discuss options if shadcn doesn't already offer a standard UX pattern for solving this
- [ ] Add a loader (spinner) element to the Logs modal - it should immediately open and then show loading state
  - Currently, there's a lot of lag when the Logs modal is opened in a session with 1000+ events
- [ ] Add a settings gear icon in bottom of sidebar
  - Opens modal that lists all projects and has delete buttons to delete all logs per project
  - Also have a button to delete all logs
  - Confirmation modal should be used for the delete buttons
- [ ] Filter state should reset to All when switching sessions or should be preserved per session
  - Currently, the filter state is preserved while switch but each session has different events, leading to possible user confusion
- [ ] Add the corresponding Tool: Agent to the stream when filtering by agent chip
  - We want to show the tool call that spawned the agent since that's what has the prompt that was passed to the sub-agent
  - the agentId is in the tool_reponse

## COMPLETED TASKS

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

- [ ] Improve the light mode colors - currently, a lot of the text and labels are very difficult to read in light mode
- [ ] Track token & context window usage per session and agent
  - On Stop hook, use two-way pattern: hook reads transcript JSONL, sums `usage` fields from all assistant messages, posts totals to `/api/sessions/:id/usage` callback
  - Subagent usage already available in PostToolUse:Agent `tool_response` (totalTokens, totalDurationMs, usage breakdown) — just need to surface in UI
  - Store session-level totals: total input/output tokens, cache read/creation, total duration
  - Show in sidebar (per session) and scope bar (per agent)
  - New `getSessionUsage` command for the two-way hook pattern
- [ ] Add a toggle icon in top right of Top Nav for a Logs view
  - Logs view should just show the raw events and payloads for the selected project or session
  - User can toggle between the "normal" view and raw logs
  - Logs should still have a bit of formatting to clearly show the raw event name "PreToolUse", etc. but then have the payloads auto expanded - no summary, no timeline, no deduping, just raw events and payloads
