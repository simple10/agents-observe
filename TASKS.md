# TASKS

## QUEUED TASKS


## COMPLETED TASKS

- [x] Add transcript_path to agents table
- [x] Enhance events stream expanded summaries (description + Read file.content)
- [x] Show SubagentStop with the Stop filter
- [x] Add AGENTS_OBSERVE_SHUTDOWN_DELAY_MS env var, refactor isDev to config
- [x] Audit editable data auto-update (pinned sessions, breadcrumb, project names)

---

## FUTURE TASKS

Don't implement these yet. They're here for future reference.

- [ ] Add /observe config to change env vars including the auto shutdown? - good test of how plugins deal with env vars
- [ ] Implement timeline replay feature; see [spec-timeline-rewind.md](docs/plans/_queued/spec-timeline-rewind.md)
- [ ] Track token & context window usage per session and agent
  - On Stop hook, use two-way pattern: hook reads transcript JSONL, sums `usage` fields from all assistant messages, posts totals to `/api/sessions/:id/usage` callback
  - Subagent usage already available in PostToolUse:Agent `tool_response` (totalTokens, totalDurationMs, usage breakdown) — just need to surface in UI
  - Store session-level totals: total input/output tokens, cache read/creation, total duration
  - Show in sidebar (per session) and scope bar (per agent)
  - New `getSessionUsage` command for the two-way hook pattern
