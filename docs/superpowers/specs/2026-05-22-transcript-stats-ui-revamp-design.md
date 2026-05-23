# Transcript Stats UI Revamp + Subagents + Pricing — Design Spec

**Status:** Draft
**Date:** 2026-05-22
**Branch:** `feat/transcript-token-stats` (extending the existing v1)
**Supersedes (extends):** `docs/superpowers/specs/2026-05-22-transcript-token-stats-design.md`

## Summary

The v1 transcript-stats endpoint and `TokenUsageCard` ship today, but the Stats tab is cramped, the card duplicates "Input" with cache columns instead of bundling them, subagent transcripts aren't parsed (so models other than the main agent's never show), and pricing isn't computed. This spec turns the Stats tab into three collapsible sections (Overview, Tool Usage, Token Usage) with preview→expand drill-downs, expands the transcript parser to be agent-class-aware and to scan subagent jsonls, and adds pricing computed from cached `models.dev` data.

The session modal is widened to ~1100px so the tables fit without horizontal scroll.

## Goals

- Restructure the Stats tab as three sections (Overview, Tool Usage, Token Usage). Each section shows a compact preview and a `View details ▾` row at the bottom that expands it in place.
- Bundle cache reads + writes into a unified `Input` column for clarity. Keep `Cache read` and `Cache write` as raw breakdown columns to the right (muted).
- Add per-prompt and per-subagent drill-downs to the Token Usage section, with sortable column headers (default `Est Cost ▾`).
- Parse subagent transcripts at `~/.claude/projects/<cwd>/<sessionId>/subagents/agent-<agentId>.jsonl` and aggregate per-subagent usage + model.
- Fetch model pricing from <https://models.dev/api.json>, cache it on the server, and use it for both per-model and per-prompt/per-subagent cost rows. Tooltip on the model badge surfaces full model id, reasoning effort, and the pricing breakdown.
- Make the server agent-class-aware: dispatch a per-agent-class transcript reader; aggregate results across all of the session's agents.
- Render incrementally: event-derived stats (Overview, Tool Usage) appear instantly; jsonl-derived cells/columns show inline spinners that get replaced when their data resolves.
- Degrade gracefully when the feature is off, the transcript is missing, parsing fails, or the agent class isn't supported — a soft banner at the top of the Token Usage section explains why and the rest of the tab still works.

## Non-goals

- Persisting any token / cost data to SQLite. Still parsed on demand.
- WebSocket-pushed live token deltas. Modal close/reopen is the refresh.
- Pricing for non-`models.dev` providers. If a model isn't in the response, the cost cell shows `—` and the tooltip says "Pricing not available for this model."
- Reasoning-effort-aware pricing (some models charge differently per effort tier). v1.1 of pricing — if `models.dev` exposes per-tier rates we'll layer it in; otherwise we use the flat rates returned.
- A separate "By Tool" cost breakdown. Cost lives at the model / prompt / subagent grain in v1.1.

## User experience

### Stats tab structure

Three vertically stacked sections, each in its own bordered panel:

```
┌─ Overview ──────────────────────────────────────────┐
│ 6 cards: Duration · Events · Tool Calls · Prompts   │
│         · Subagents · Success                       │
│                                                     │
│              View details ▾                         │
└─────────────────────────────────────────────────────┘
┌─ Tool Usage ────────────────────────────────────────┐
│ Top Tools bar chart (top 6) · Longest Tool Call     │
│                                                     │
│              View details ▾                         │
└─────────────────────────────────────────────────────┘
┌─ Token Usage ───────────────────────────────────────┐
│ 5 metric cards · By Model table                     │
│                                                     │
│              View details ▾                         │
└─────────────────────────────────────────────────────┘
```

Section header is just the section name (top-left, uppercase muted). Expand affordance is a full-width row at the bottom of each section: muted gray text + `▾`, hover-tinted amber. Once expanded, the row flips to `Hide details ▴` and the section grows in place.

### Section: Overview

**Preview cards:** Duration · Events · Tool Calls · Prompts · Subagents · Success Rate (6 cards in a 6-column grid).

**Expanded view adds:** Turns · Git Commits · Files Touched · Permissions (Requests / Denials shown as their existing card pair).

All values come from the in-memory event store. No network. Renders instantly.

### Section: Tool Usage

**Preview:** "Top Tools" horizontal bar chart, top 6 tools by call count (existing visual treatment from current Stats tab — labels left, bar middle, count right). Then a single line: "Longest tool call: `<tool>` (`<duration>`)".

**Expanded view adds:** full sortable tool table with columns `Tool · Calls · Min · Median · Max · Total time` (durations computed from PreToolUse → PostToolUse pairs). Sortable headers default to `Calls ▾`.

All values come from the in-memory event store. No network. Renders instantly.

### Section: Token Usage

**Preview:**

- 5 metric cards: `Requests · Total Input · Total Output · Cache Hit Rate · Est Cost`. All five metrics aggregate across main + subagents — they represent the total cost / throughput of the session, not just the main agent. (The headline Stats card "Subagents: N" is preserved as a separate count in the Overview section.)
  - `Total Input` = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` (bundled per the spec direction).
  - `Cache Hit Rate` = `sum(cache_read_input_tokens) / sum(total_input)` across all calls (main + subagents). Subagents typically don't use cache, so this naturally weights toward the main agent's behavior.
  - `Est Cost` summed across all rows (main + subagents).
- **By Model** table — columns:
  - `Model · Requests · Input · Output · Cache % · Cache read · Cache write · Est Cost`
  - `Input` is the bundled value. `Cache read` / `Cache write` are muted (#999) with a left divider — explicitly the "breakdown" columns.
  - One row per `model` aggregated across main + all subagent jsonls.
  - Default sort: `Est Cost ▾`. All columns sortable, toggling direction on the active column.

**Expanded view adds:**

- A "soft banner" placeholder slot at the top of the section's expanded content (used for the degradation messages — see "Graceful degradation").
- **By Prompt** table — columns: `Prompt · Duration · Tools · Requests · Input · Output · Model · Est Cost`.
  - `Prompt` truncated with ellipsis; click row to expand the full prompt inline.
  - `Duration` = `nextPrompt.timestamp − thisPrompt.timestamp` (last prompt = session end).
  - `Tools` = count of `PreToolUse` events between this prompt and the next, attributed to the main agent only. This includes the `Agent` (Task) tool call that spawns a subagent — that's a main-agent tool call — but does NOT include the subagent's own internal tool calls (those count in the subagent's row).
  - `Model` is a chip list — main-agent model first, plus a chip for each subagent model spawned during this prompt.
  - Default sort: `Est Cost ▾`. All columns sortable.
- **Subagents** table — columns: `Agent · Type · Duration · Tools · Requests · Input · Output · Model · Est Cost`.
  - `Agent` rendered with the existing `AgentLabel` component (slug + per-agent color).
  - `Type` = `agentType` from the subagent's `.meta.json` file (e.g., `general-purpose`, `Explore`, `Plan`), in blue chip color.
  - `Duration` = `lastEvent.timestamp − firstEvent.timestamp` within the subagent's jsonl.
  - `Tools` = count of `tool_use` content blocks across the subagent's assistant lines.
  - `Model` is a single chip (each subagent uses one model).
  - Default sort: `Est Cost ▾`. All columns sortable.

The metric cards + `By Model` table from the preview stay visible at the top of the expanded view (don't replace, augment).

### Model badge

`<model> <effort>` where `<model>` is the API id with `claude-` stripped and version dashes converted to dots, with any trailing `-YYYYMMDD` date suffix removed. Examples:

- `claude-opus-4-7` → `opus-4.7`
- `claude-haiku-4-5-20251001` → `haiku-4.5`

Effort suffix uses color `#cbd5e1` (slate-300) at 9px — visible but secondary. Omit the effort suffix when no effort is captured for the row's agent.

**Hover tooltip** (Radix tooltip, ~300ms delay):

```
claude-opus-4-7
Reasoning effort: xhigh
──────────────────────────────────────
PRICING · PER MILLION TOKENS
Input             $15.00
Output            $75.00
Cache read         $1.50
Cache write (5m)  $18.75
Cache write (1h)  $30.00
──────────────────────────────────────
Pricing from models.dev · refreshed daily
```

If a model isn't in models.dev, the tooltip shows the id + effort then a single line: "Pricing not available for this model."

### Progressive rendering

- Section panels render their layout immediately on tab open (no full-tab spinner).
- Event-derived content (Overview, Tool Usage) populates from the in-memory event store synchronously.
- Token Usage section: metric cards and table headers render with skeleton cells while the jsonl parsing request is in flight; each cell flips to its real value as the response arrives.
- A single in-flight request per session — no per-card requests.

### Graceful degradation

A soft informational banner sits at the top of the Token Usage section in both preview and expanded states when jsonl parsing isn't usable. The metric cards + tables are hidden when the banner is showing — there's nothing to render in them. Banner is muted gray + info icon, never red.

Wording per case:

| Case | Wording |
|---|---|
| Feature flag off | "Session transcript parsing isn't enabled — set `AGENTS_OBSERVE_TRANSCRIPT_STATS=1` to see models and token usage." |
| No transcript path on session | "Session transcript not available — models and token usage info not available for this session." |
| Transcript file missing on disk | "Session transcript file not found — models and token usage info not available." |
| Transcript exists but unreadable (EACCES) | "Session transcript exists but isn't readable by the server — check the bind-mount permissions." |
| Transcript file too large | "Session transcript exceeds the 100 MB safety cap — token stats skipped." |
| Parse failure | "Couldn't parse this session's transcript — token usage info isn't available." |
| Non-supported agent class | "Token usage parsing isn't supported for this agent class yet." |

The rest of the Stats tab (Overview, Tool Usage) renders normally in all of these cases.

### Wider session modal

Modal max-width bumps from current `max-w-3xl`(~768px) to `max-w-6xl` (~1152px). Below the breakpoint, the modal caps at viewport width and the tables horizontally scroll — they don't reflow.

## Backend architecture

### Directory restructure

The current single-file `app/server/src/services/transcript-parser.ts` becomes a directory:

```
app/server/src/transcript-parser/
  index.ts                # parseSessionTranscripts(sessionId) entry point
  types.ts                # shared types (TranscriptStats, etc.)
  models-pricing.ts       # models.dev fetch + cache + lookup
  agents/
    base.ts               # shared per-call/per-prompt helpers
    claude.ts             # claude-code parser (main jsonl + subagent jsonls)
```

The existing `services/transcript-path.ts` stays where it is (still a pure helper, used by all parsers).

### Entry point

```ts
// transcript-parser/index.ts
export async function parseSessionTranscripts(
  sessionId: string,
  store: EventStore,
): Promise<TranscriptStats>
```

Steps:

1. Load the session row → host transcript path + start_cwd.
2. Translate host path → container path via existing `resolveTranscriptPath`.
3. Stat the file. Bail with the right error code per the existing route handler.
4. Look up agents for the session (`store.getAgentsForSession(sessionId)`).
5. Dispatch by `agent_class`. For v1: `claude-code`. Unknown classes contribute zero data but are reported in `errors`.
6. Each agent class parser returns:
   - `calls[]` — per-API-call usage (deduped by message id)
   - `prompts[]` — per-user-prompt aggregates
   - `subagents[]` — per-subagent aggregates (each subagent jsonl parsed)
   - `errors[]` — any partial failures (missing subagent jsonl, parse errors)
7. Merge across agents. Compute `byModel` summary and `summary` totals (main-agent only for `summary.totalCalls`, but `byModel` aggregates across main + subagents since we want to see which models were used).
8. Attach pricing for every distinct model touched: look up in the models-pricing cache; compute `costCents` per row.
9. Return `TranscriptStats`.

### Claude-code agent parser

`transcript-parser/agents/claude.ts` exports:

```ts
export async function parseClaudeSession(
  hostTranscriptPath: string,
  containerTranscriptPath: string,
  startCwd: string,
  agentIds: string[],
): Promise<AgentParseResult>
```

Behavior:

1. Streaming parse the main jsonl (existing logic from `transcript-parser.ts`).
2. For each subagent agent_id in `agentIds`, derive its expected path:
   `<container-base>/<encoded-cwd>/<session-id>/subagents/agent-<agentId>.jsonl`
3. Stream-parse each subagent jsonl. Aggregate per-subagent usage + duration + tool count.
4. Read the sibling `.meta.json` for each subagent jsonl to get `agentType`, `description`, `toolUseId`.
5. **Subagent model resolution** per the user's direction: if the main session's events already include a model attribution for that agent_id (we'd see it in subagent assistant lines), use that. Otherwise, the subagent jsonl's own assistant lines provide the model. In practice the subagent jsonl is always the authoritative source; the "scan main first" hint is implicitly satisfied by parsing both jsonls.
6. If a subagent jsonl is missing or unparseable, push an entry to `errors[]` and skip that subagent — don't fail the whole request.

### Models pricing

`transcript-parser/models-pricing.ts` exports:

```ts
export async function getModelsPricing(): Promise<Record<string, ModelPricing>>
```

Behavior:

- First call: `fetch('https://models.dev/api.json')`. Parse the response.
- Filter to Anthropic / Claude models we care about (anything with `id` starting with `claude-`).
- Extract per-million-token rates: input, output, cache read, cache write 5m (a.k.a. `5m` or `5_min`), cache write 1h.
- Cache the resulting map in module-scope memory with a 24-hour TTL.
- Subsequent calls: return cached map; fetch in the background if older than TTL.
- Fetch failures (network down, schema change): log + return whatever is cached; if cache is empty, return `{}`. The UI then shows `—` for cost and the "Pricing not available" tooltip.
- No persistence to disk in v1 — the cache lives only in the running server process. (v1.1 could persist for cold-start, but v1 accepts a few hundred-ms first-fetch latency.)

The `ModelPricing` type:

```ts
interface ModelPricing {
  inputPerM: number          // dollars per million tokens
  outputPerM: number
  cacheReadPerM: number
  cacheCreate5mPerM: number
  cacheCreate1hPerM: number
}
```

The route handler computes per-call costs using these rates (multiply by usage / 1_000_000). Models not in the map get `cost: null` on their row, and the response's `models` map omits them.

### API response

```ts
{
  source: "jsonl",
  summary: {
    totalCalls: number,                       // main + subagents
    inputTotal: number,                       // bundled, main + subagents
    outputTotal: number,                      // main + subagents
    cacheHitRate: number,                     // 0..1, across main + subagents
    costTotalCents: number | null,            // null if any row's model lacks pricing
  },
  byModel: Array<{
    model: string,
    calls: number,
    inputTokens: number,                      // bundled
    outputTokens: number,
    cacheReadTokens: number,
    cacheCreate5mTokens: number,
    cacheCreate1hTokens: number,
    costCents: number | null,
  }>,
  prompts: Array<{
    promptId: string,
    text: string,
    timestamp: number,
    durationMs: number | null,                // null for the last prompt if session still active
    toolCount: number,                        // main agent only
    requests: number,
    inputTokens: number,                      // bundled
    outputTokens: number,
    models: string[],                         // distinct models touched in this prompt (incl. subagents)
    costCents: number | null,
  }>,
  subagents: Array<{
    agentId: string,
    agentType: string | null,                 // from .meta.json, null if missing
    description: string | null,
    toolUseId: string | null,                 // links to the spawning PreToolUse:Agent event
    model: string,
    requests: number,
    inputTokens: number,                      // bundled
    outputTokens: number,
    cacheReadTokens: number,
    cacheCreate5mTokens: number,
    cacheCreate1hTokens: number,
    durationMs: number,
    toolCount: number,
    costCents: number | null,
  }>,
  models: Record<string, {
    pricing: ModelPricing | null,             // null = pricing not available for this model
  }>,
  errors: Array<{
    scope: "main" | "subagent",
    agentId?: string,
    code: "missing" | "unreadable" | "parse_error",
    message: string,
  }>,
}
```

Existing error responses (404 `disabled`, `no_transcript`, `file_not_found`, 403 `file_unreadable`, 413 `file_too_large`, 500 `parse_error`) stay the same shape for the main-transcript failure path. Subagent-level failures are NOT a request-level failure — they're surfaced in the `errors[]` array.

### Cost computation

For each row (call / prompt / subagent / byModel):

```
cents = round(
  (inputTokens          × pricing.inputPerM
  + outputTokens        × pricing.outputPerM
  + cacheReadTokens     × pricing.cacheReadPerM
  + cacheCreate5mTokens × pricing.cacheCreate5mPerM
  + cacheCreate1hTokens × pricing.cacheCreate1hPerM)
  / 1_000_000 × 100
)
```

Server returns cents as integers (avoids float drift). UI divides by 100 for display.

For aggregated rows (byModel, summary): sum the per-call cents if pricing is known for every call's model. If any constituent model lacks pricing, the aggregated `costCents` is `null` and the UI shows `—`.

## UI implementation

### Component tree

```
SessionStats (existing, restructure into 3 sections)
  ├── OverviewSection
  │     ├── (preview: 6 stat cards)
  │     └── (expanded: + 4 more cards + Permissions pair)
  ├── ToolUsageSection
  │     ├── (preview: Top Tools bar chart + Longest Tool Call)
  │     └── (expanded: + full sortable tool table with durations)
  └── TokenUsageSection
        ├── (always: 5 metric cards + By Model table)
        └── (expanded: + Soft banner (if applicable) + By Prompt table + Subagents table)
```

Each section uses a shared `<CollapsibleSection title="..." defaultExpanded={false}>` component. Internal expand state stored in component state — no global store.

### New components

- `app/client/src/components/settings/sections/overview-section.tsx`
- `app/client/src/components/settings/sections/tool-usage-section.tsx`
- `app/client/src/components/settings/sections/token-usage-section.tsx`
- `app/client/src/components/settings/sections/collapsible-section.tsx` — shared shell with the `View details ▾` row.
- `app/client/src/components/settings/sections/model-badge.tsx` — the badge + tooltip; reusable wherever a model is shown.
- `app/client/src/components/settings/sections/sortable-table.tsx` — thin wrapper that owns sort state and renders `▾`/`▴` indicators. Generic over column definitions.

Existing `token-usage-card.tsx` is deleted (its job moves into `TokenUsageSection`).

### Sortable table behavior

- First click on a header → activates it, default direction (`desc` for numeric / cost / duration, `asc` for string).
- Second click on the same header → toggles direction.
- Third click on a different header → moves the sort there, default direction.
- Active header gets amber color + `▾` or `▴` glyph.
- Sort state is per-table, in component state. Closing the modal resets it.

### Sub-agent name rendering

The `Agent` column uses the existing `AgentLabel` component imported from `@/components/shared/agent-label`. The Subagents table maps each row's `agentId` to its Agent record (already in the agents store) and passes it to `AgentLabel`. If the agent isn't in the store (deleted), fall back to the raw id with no color.

### Progressive rendering implementation

The Stats tab opens with the existing `useEvents` query (in-memory event store). That populates Overview and Tool Usage immediately.

A second query — `useQuery({ queryKey: ['transcript-stats', sessionId], ... })` — fetches the transcript stats. The Token Usage section reads from this query:

- While `isLoading`: render the metric card containers + table headers with skeleton placeholders (1ch-wide grey blocks pulsing). Don't show a full-section spinner.
- When `data && !data.ok`: render the soft banner with case-specific wording. Hide the cards/tables (banner replaces them).
- When `data && data.ok`: render cards + tables normally.

Query options (mirroring `SessionStats`'s existing query):

```ts
{
  staleTime: Infinity,
  gcTime: 0,
  refetchOnWindowFocus: false,
}
```

## Modal width change

In `app/client/src/components/settings/session-modal.tsx`, find the `<DialogContent>` and change its width class from the current value to `max-w-6xl`. Test in the browser at narrower viewports (the modal caps at viewport width and the existing tables get horizontal scroll via overflow-x-auto on the table container).

## Testing

### Server

1. `transcript-parser/models-pricing.test.ts`:
   - Cache hit on second call (no second fetch).
   - Fetch failure with empty cache → returns `{}`, no throw.
   - Fetch failure with stale cache → returns stale data.
   - Models with `id` not starting with `claude-` are filtered out.
   - Per-million rates extracted correctly from a fixture matching the real models.dev shape.
2. `transcript-parser/agents/claude.test.ts`:
   - Main-jsonl parsing identical to existing parser tests (move/copy them).
   - Subagent jsonl discovery: given `agentIds`, opens the right files.
   - Missing subagent jsonl pushes to `errors[]` without failing the whole parse.
   - Subagent without `.meta.json` still parses but `agentType` / `description` are `null`.
   - Subagent's `model`, `durationMs`, `toolCount`, `requests`, usage all computed correctly from a hand-rolled subagent fixture.
3. `transcript-parser/index.test.ts`:
   - Aggregates byModel across main + subagents.
   - Summary.totalCalls counts main-only.
   - Cost computed correctly when pricing is available; `null` when missing.
   - Unsupported agent class → request succeeds but contributes nothing + an entry in `errors[]`.
4. `routes/transcript-stats.test.ts` (extend):
   - Response shape includes all new fields (`prompts`, `subagents`, `models`, `errors`).
   - Per-row `costCents` is integer cents.

### Client

5. `model-badge.test.tsx`:
   - Renders model without effort.
   - Renders model with effort.
   - Date suffix stripped from display, full id in tooltip.
   - Tooltip renders pricing rows when available.
   - Tooltip renders "Pricing not available" line when pricing is null.
6. `token-usage-section.test.tsx`:
   - Skeleton renders while query is loading.
   - Soft banner renders with case-specific text per error code.
   - Tables render after data resolves.
   - Click column header toggles sort direction; first click activates default direction.
   - Default sort is `Est Cost ▾` on both prompts and subagents tables.
   - Subagent name uses `AgentLabel` (asserted via test selector / props).
7. `tool-usage-section.test.tsx`:
   - Preview renders bar chart + longest call.
   - Expanded view renders sortable duration table.
8. `overview-section.test.tsx`:
   - Preview renders 6 cards.
   - Expanded view renders additional cards + Permissions pair.

## Migration / compat

- The existing `TokenUsageCard` component is deleted in this change. Anything importing it (only `session-modal.tsx`) is updated to use the new `TokenUsageSection`.
- The existing event-derived "Token Usage (Subagents)" block in `SessionStats` (session-modal.tsx around line 813) is also deleted. The new Token Usage section is strictly more comprehensive — it covers subagents per row from jsonl, with model attribution the old block couldn't provide. When the jsonl feature is disabled the new section's soft banner explains how to enable it; we don't keep the old block as a fallback because that would be two sources of truth for the same number.
- The existing `app/server/src/services/transcript-parser.ts` is moved into `app/server/src/transcript-parser/agents/claude.ts` (and renamed/restructured). Its public `parseTranscriptFile` export is replaced by `parseClaudeSession` with a different signature; route handler is updated.
- `routes/transcript-stats.ts` calls the new `parseSessionTranscripts` entry point.
- The route's success response shape changes: previously returned `{source, summary, calls, prompts}`; now returns `{source, summary, byModel, prompts, subagents, models, errors}`. The `calls[]` array is dropped — its data is preserved via the `byModel` aggregation and the per-prompt rollups. No external consumer relied on `calls[]` (v1 UI only consumed `summary`).
- `summary.totalCalls` semantics change from main-agent only (v1) to main + subagents (new). The new mockups already reflect this.
- No DB schema change (still parses on demand).
- `getSessionTranscriptPath` storage method (added in v1) stays as is; new code also uses `getAgentsForSession`.

## Risks and mitigations

- **models.dev outage at server cold start.** Mitigated by: pricing fetch happens lazily on the first transcript-stats request, never blocking server startup. If the fetch fails, costs render as `—` until the next attempt. Server keeps trying on each request (subject to a short retry-backoff to avoid hammering when down).
- **models.dev schema drift.** Mitigated by: defensive parsing in `models-pricing.ts`. Each rate is `Number(value)` with a fallback to `0`; missing keys → model has incomplete pricing → `costCents: null`.
- **Subagent jsonl growth.** Some subagents (general-purpose reviewers) can produce >1 MB of jsonl each. Parsing is still streaming; we apply the same 100 MB per-file cap as the main transcript. Cumulative session limit isn't enforced — if a session has 100 subagents each at 50 MB, we'd parse 5 GB. Realistic sessions don't get there. Documented; can add cumulative cap if needed.
- **Cost precision.** Integer cents avoid float drift but lose sub-cent precision. For a single $0.0001 call that becomes $0.00. Mitigated by: cents is fine for the headline display; an optional finer unit (millicents) is a v1.1 thing if anyone complains.
- **Click-row-to-expand-prompt** (long prompts) interacts with the row-click navigation hinted in the v1 spec (click prompt → scroll event stream). We resolve by: row click expands inline; a small "→" icon on the right of the row navigates. Documented.

## Out of scope / follow-ups

- Persist aggregate token / cost columns on the `sessions` table for cost-per-session in the Projects list. v1.1+.
- Per-effort-tier pricing if models.dev grows it.
- Codex / non-Claude agent class parsers. The directory structure supports adding `agents/codex.ts`; v1 surfaces the "not supported" banner.
- Cumulative session size cap (sum across main + all subagent jsonls).
- Live WebSocket push of token deltas while a session is active.
- Sub-cent precision in cost display.
