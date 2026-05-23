import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import {
  api,
  type TranscriptStatsErrorCode,
  type TranscriptStatsByModel,
  type TranscriptStatsData,
  type TranscriptStatsModelPricing,
  type TranscriptStatsPrompt,
  type TranscriptStatsSubagent,
} from '@/lib/api-client'
import { AgentLabel } from '@/components/shared/agent-label'
import { getAgentColorById, buildAgentColorMap } from '@/lib/agent-utils'
import type { Agent } from '@/types'
import { useMemo } from 'react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { ModelBadge } from './model-badge'
import { SortableTable, type SortableColumn } from './sortable-table'
import type { AgentTokenUsage } from '../session-modal'
import { getServerHealth } from '@/lib/server-health'

function fmt(n: number): string {
  return n.toLocaleString()
}
function fmtCents(c: number | null): string {
  if (c == null) return '—'
  return `$${(c / 100).toFixed(2)}`
}
function fmtPct(r: number): string {
  return `${(r * 100).toFixed(1)}%`
}
function fmtUsd(n: number, decimals = 4): string {
  return `$${n.toFixed(decimals)}`
}

/**
 * Tooltip-wrapped cost cell. Two modes:
 *
 * - **Single-model** (one pricing object): renders a mini table with
 *   per-line cost computed at the model's rate.
 * - **Multi-model** (array of pricings): the per-line cost column is
 *   omitted (the bundled tokens can't be split cleanly across models);
 *   the Rate column shows a range (min–max across models). Total at
 *   the bottom is the server-computed total — accurate even though
 *   per-line is just an approximation.
 *
 * Falls back to the bare cost string when pricing is fully unknown.
 */
function CostCell({
  costCents,
  pricings,
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheCreate5mTokens,
  cacheCreate1hTokens,
}: {
  costCents: number | null
  /** One pricing for single-model rows, multiple for multi-model (prompts). */
  pricings: TranscriptStatsModelPricing[]
  /** Bundled input (fresh + cache_read + cache_write). */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
}) {
  if (costCents == null || pricings.length === 0) {
    return <span className="text-amber-500">{fmtCents(costCents)}</span>
  }
  const fresh = Math.max(
    0,
    inputTokens - cacheReadTokens - cacheCreate5mTokens - cacheCreate1hTokens,
  )
  const multi = pricings.length > 1

  // For single-model: rate is a single number. For multi-model: format as a range.
  function fmtRate(values: number[]): string {
    if (values.length === 0) return '—'
    const min = Math.min(...values)
    const max = Math.max(...values)
    if (min === max) return `$${min.toFixed(2)}`
    return `$${min.toFixed(2)}–$${max.toFixed(2)}`
  }

  const lines: Array<{
    label: string
    tokens: number
    rates: number[]
    /** Per-line cost in $ — only meaningful for single-model. */
    cost: number
  }> = [
    {
      label: 'Input',
      tokens: fresh,
      rates: pricings.map((p) => p.inputPerM),
      cost: (fresh * pricings[0].inputPerM) / 1_000_000,
    },
    {
      label: 'Output',
      tokens: outputTokens,
      rates: pricings.map((p) => p.outputPerM),
      cost: (outputTokens * pricings[0].outputPerM) / 1_000_000,
    },
    {
      label: 'Cache read',
      tokens: cacheReadTokens,
      rates: pricings.map((p) => p.cacheReadPerM),
      cost: (cacheReadTokens * pricings[0].cacheReadPerM) / 1_000_000,
    },
    {
      label: 'Cache write (5m)',
      tokens: cacheCreate5mTokens,
      rates: pricings.map((p) => p.cacheCreate5mPerM),
      cost: (cacheCreate5mTokens * pricings[0].cacheCreate5mPerM) / 1_000_000,
    },
    {
      label: 'Cache write (1h)',
      tokens: cacheCreate1hTokens,
      rates: pricings.map((p) => p.cacheCreate1hPerM),
      cost: (cacheCreate1hTokens * pricings[0].cacheCreate1hPerM) / 1_000_000,
    },
  ]
  const total = costCents / 100
  // Column count for the Total row's colSpan.
  const totalColSpan = multi ? 2 : 3
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-amber-500 cursor-help">{fmtCents(costCents)}</span>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          align="start"
          className="!bg-popover !text-popover-foreground border border-amber-500 max-w-md p-3 shadow-md"
        >
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-2">
            Cost breakdown{multi && ' · multiple models'}
          </div>
          <table className="font-mono text-[11px] border-separate" style={{ borderSpacing: '0 0' }}>
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-normal pb-1.5 pr-4">Item</th>
                <th className="text-right font-normal pb-1.5 px-4">Tokens</th>
                <th className="text-right font-normal pb-1.5 px-4">Rate ($/M)</th>
                {!multi && <th className="text-right font-normal pb-1.5 pl-4">Cost</th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.label}>
                  <td className="py-0.5 pr-4 text-muted-foreground">{l.label}</td>
                  <td className="py-0.5 px-4 text-right">{l.tokens.toLocaleString()}</td>
                  <td className="py-0.5 px-4 text-right text-muted-foreground">
                    {fmtRate(l.rates)}
                  </td>
                  {!multi && <td className="py-0.5 pl-4 text-right">{fmtUsd(l.cost)}</td>}
                </tr>
              ))}
              <tr className="border-t border-border/40">
                <td
                  className="pt-2 text-muted-foreground uppercase text-[9px] pr-4"
                  colSpan={totalColSpan}
                >
                  Total
                </td>
                <td
                  className={`pt-2 text-right text-amber-500 font-medium ${multi ? 'px-4' : 'pl-4'}`}
                >
                  {fmtUsd(total, 2)}
                </td>
              </tr>
            </tbody>
          </table>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
  }
  if (ms < 86_400_000) {
    return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`
  }
  // Anything >= 24h: round to the nearest hour and drop minutes for a
  // more compact display. "1d 10h 51m" → "1d 11h". Carry handles the
  // edge case where rounding bumps 23h up to 24h.
  const totalHours = Math.round(ms / 3_600_000)
  const d = Math.floor(totalHours / 24)
  const h = totalHours % 24
  return h === 0 ? `${d}d` : `${d}d ${h}h`
}

const ERROR_MESSAGES: Record<TranscriptStatsErrorCode, string> = {
  disabled:
    'Session transcript parsing is disabled — unset AGENTS_OBSERVE_TRANSCRIPT_STATS (or remove the =0 override) to see models and token usage.',
  no_transcript:
    'Session transcript not available — models and token usage info not available for this session.',
  file_not_found: 'Session transcript file not found — models and token usage info not available.',
  file_unreadable:
    "Session transcript exists but isn't readable by the server — check the bind-mount permissions.",
  file_too_large: 'Session transcript exceeds the 100 MB safety cap — token stats skipped.',
  parse_error: "Couldn't parse this session's transcript — token usage info isn't available.",
  unknown: 'Token usage info is unavailable for this session.',
}

function SectionShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border mb-5 overflow-hidden">
      <div className="px-4 py-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          {title}
        </div>
        {children}
      </div>
    </div>
  )
}

function Card({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm ${valueClass ?? 'text-foreground'}`}>{value}</div>
    </div>
  )
}

/**
 * Renders an agent name with the existing AgentLabel (tooltip + color)
 * wrapped in a button that closes the modal and scrolls the event
 * stream to the agent's first event.
 */
function AgentNameCell({
  agentId,
  agents,
  agentColorMap,
  onClick,
}: {
  agentId: string
  agents: Agent[]
  agentColorMap: Map<string, number>
  onClick: (agentId: string) => void
}) {
  const agent = agents.find((a) => a.id === agentId)
  if (!agent) {
    return <span className="font-mono text-muted-foreground">{agentId.slice(0, 12)}</span>
  }
  const parentAgent = agent.parentAgentId
    ? (agents.find((a) => a.id === agent.parentAgentId) ?? null)
    : null
  const color = getAgentColorById(agentId, agentColorMap)
  return (
    <button
      type="button"
      className={`cursor-pointer hover:underline ${color.textOnly}`}
      onClick={() => onClick(agentId)}
    >
      <AgentLabel agent={agent} parentAgent={parentAgent} />
    </button>
  )
}

export function TokenUsageSection({
  sessionId,
  mainAgentId,
  agents,
  eventSubagents,
  sessionDurationMs,
  mainAgentToolCount,
  onAgentClick,
  onPromptClick,
}: {
  sessionId: string
  /** Agent id of the main session agent (== session id for claude-code). */
  mainAgentId: string
  agents: Agent[]
  /** Per-subagent stats derived from PostToolUse:Agent events. The
   *  always-available baseline for the Agents table. */
  eventSubagents: AgentTokenUsage[]
  /** Session-wide duration (last event − first event). Used as the
   *  main agent's duration in the Agents table. */
  sessionDurationMs: number
  /** Count of PreToolUse events emitted directly by the main agent
   *  (excluding subagent tool use). */
  mainAgentToolCount: number
  onAgentClick: (agentId: string) => void
  onPromptClick: (text: string, timestamp: number) => void
}) {
  // Server-side feature flag. The transcript-stats endpoint costs a
  // jsonl walk; skipping the round-trip entirely when disabled keeps
  // the modal cheap. `getServerHealth` is module-memoized so the
  // /api/health fetch is shared with the version footer + WS sniffer.
  const { data: health } = useQuery({
    queryKey: ['server-health'],
    queryFn: getServerHealth,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  const transcriptStatsEnabled = health?.transcriptStatsEnabled === true

  const { data, isLoading } = useQuery({
    queryKey: ['transcript-stats', sessionId],
    queryFn: () => api.getTranscriptStats(sessionId),
    // Only fetch transcripts when the server flag is on. If the flag
    // is off we render the events-only view without ever hitting the
    // endpoint.
    enabled: transcriptStatsEnabled,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })

  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])

  // Transcript stats are an *augmentation* layer. The Agents table
  // always renders from event data; transcripts add Model + Est Cost
  // columns and the per-prompt/per-model tables when available.
  const transcript: TranscriptStatsData | null = data?.ok ? data.data : null
  const transcriptError = data && !data.ok ? data : null
  // Distinct from `transcriptError` — the flag isn't an error, it's a
  // deliberate "off" state from the server. Wait until health resolves
  // before deciding either way (avoids flashing the disabled note).
  const transcriptDisabledByFlag = health !== undefined && !transcriptStatsEnabled

  const { agentRows, agentTotals } = buildAgentsTable({
    mainAgentId,
    sessionDurationMs,
    mainAgentToolCount,
    eventSubagents,
    transcript,
  })

  const hasTranscript = transcript !== null

  // ── By Model (transcripts only) ───────────────────────────────
  const byModelCols: SortableColumn<TranscriptStatsByModel>[] = transcript
    ? [
        {
          key: 'model',
          label: 'Model',
          sortType: 'string',
          render: (r) => (
            <ModelBadge modelId={r.model} pricing={transcript.models[r.model]?.pricing} />
          ),
          sortValue: (r) => r.model,
        },
        {
          key: 'calls',
          label: 'Requests',
          sortType: 'number',
          align: 'right',
          render: (r) => fmt(r.calls),
          sortValue: (r) => r.calls,
        },
        {
          key: 'input',
          label: 'Input',
          sortType: 'number',
          align: 'right',
          render: (r) => fmt(r.inputTokens),
          sortValue: (r) => r.inputTokens,
        },
        {
          key: 'output',
          label: 'Output',
          sortType: 'number',
          align: 'right',
          render: (r) => fmt(r.outputTokens),
          sortValue: (r) => r.outputTokens,
        },
        {
          key: 'cachePct',
          label: 'Cache %',
          sortType: 'number',
          align: 'right',
          render: (r) =>
            r.inputTokens > 0 ? (
              <span className="text-green-500">{fmtPct(r.cacheReadTokens / r.inputTokens)}</span>
            ) : (
              '—'
            ),
          sortValue: (r) => (r.inputTokens > 0 ? r.cacheReadTokens / r.inputTokens : 0),
        },
        {
          key: 'cacheRead',
          label: 'Cache read',
          sortType: 'number',
          align: 'right',
          render: (r) => <span className="text-muted-foreground">{fmt(r.cacheReadTokens)}</span>,
          sortValue: (r) => r.cacheReadTokens,
          className: 'border-l border-border/30',
        },
        {
          key: 'cacheWrite',
          label: 'Cache write',
          sortType: 'number',
          align: 'right',
          render: (r) => (
            <span className="text-muted-foreground">
              {fmt(r.cacheCreate5mTokens + r.cacheCreate1hTokens)}
            </span>
          ),
          sortValue: (r) => r.cacheCreate5mTokens + r.cacheCreate1hTokens,
        },
        {
          key: 'cost',
          label: 'Est Cost',
          sortType: 'number',
          align: 'right',
          render: (r) => {
            const p = transcript.models[r.model]?.pricing
            return (
              <CostCell
                costCents={r.costCents}
                pricings={p ? [p] : []}
                inputTokens={r.inputTokens}
                outputTokens={r.outputTokens}
                cacheReadTokens={r.cacheReadTokens}
                cacheCreate5mTokens={r.cacheCreate5mTokens}
                cacheCreate1hTokens={r.cacheCreate1hTokens}
              />
            )
          },
          sortValue: (r) => r.costCents ?? 0,
          className: 'border-l border-border/30',
        },
      ]
    : []

  // ── By Prompt (transcripts only) ──────────────────────────────
  const promptCols: SortableColumn<TranscriptStatsPrompt>[] = transcript
    ? [
        {
          key: 'prompt',
          label: 'Prompt',
          sortType: 'string',
          render: (r) => (
            <button
              type="button"
              onClick={() => onPromptClick(r.text, r.timestamp)}
              className="block truncate max-w-[400px] text-left cursor-pointer hover:underline"
              title={r.text}
            >
              {r.text}
            </button>
          ),
          sortValue: (r) => r.text,
        },
        {
          key: 'duration',
          label: 'Duration',
          sortType: 'number',
          align: 'right',
          render: (r) => (r.durationMs == null ? '—' : fmtMs(r.durationMs)),
          sortValue: (r) => r.durationMs ?? 0,
          className: 'whitespace-nowrap',
        },
        {
          key: 'tools',
          label: 'Tools',
          sortType: 'number',
          align: 'right',
          render: (r) => fmt(r.toolCount),
          sortValue: (r) => r.toolCount,
        },
        {
          key: 'requests',
          label: 'Requests',
          sortType: 'number',
          align: 'right',
          render: (r) => fmt(r.requests),
          sortValue: (r) => r.requests,
        },
        {
          key: 'input',
          label: 'Input',
          sortType: 'number',
          align: 'right',
          render: (r) => fmt(r.inputTokens),
          sortValue: (r) => r.inputTokens,
        },
        {
          key: 'output',
          label: 'Output',
          sortType: 'number',
          align: 'right',
          render: (r) => fmt(r.outputTokens),
          sortValue: (r) => r.outputTokens,
        },
        {
          key: 'models',
          label: 'Model',
          sortType: 'string',
          render: (r) => (
            <span className="flex flex-wrap gap-1">
              {r.models.map((m) => (
                <ModelBadge key={m} modelId={m} pricing={transcript.models[m]?.pricing} />
              ))}
            </span>
          ),
          sortValue: (r) => r.models.join(','),
        },
        {
          key: 'cost',
          label: 'Est Cost',
          sortType: 'number',
          align: 'right',
          render: (r) => {
            const pricings = r.models
              .map((m) => transcript.models[m]?.pricing)
              .filter((p): p is NonNullable<typeof p> => !!p)
            return (
              <CostCell
                costCents={r.costCents}
                pricings={pricings}
                inputTokens={r.inputTokens}
                outputTokens={r.outputTokens}
                cacheReadTokens={r.cacheReadTokens}
                cacheCreate5mTokens={r.cacheCreate5mTokens}
                cacheCreate1hTokens={r.cacheCreate1hTokens}
              />
            )
          },
          sortValue: (r) => r.costCents ?? 0,
        },
      ]
    : []

  const promptTotals = transcript
    ? {
        durationMs: transcript.prompts.reduce((s, p) => s + (p.durationMs ?? 0), 0),
        toolCount: transcript.prompts.reduce((s, p) => s + p.toolCount, 0),
        requests: transcript.prompts.reduce((s, p) => s + p.requests, 0),
        inputTokens: transcript.prompts.reduce((s, p) => s + p.inputTokens, 0),
        outputTokens: transcript.prompts.reduce((s, p) => s + p.outputTokens, 0),
        costCents: transcript.prompts.some((p) => p.costCents == null)
          ? null
          : transcript.prompts.reduce((s, p) => s + (p.costCents ?? 0), 0),
      }
    : null

  // ── Agents table columns ──────────────────────────────────────
  // The Model + Est Cost columns only render when transcript data is
  // available — events don't carry model id or pricing.
  const agentCols: SortableColumn<AgentRow>[] = [
    {
      key: 'agent',
      label: 'Agent',
      sortType: 'string',
      render: (r) =>
        r.isMain ? (
          <span className="font-mono">main</span>
        ) : (
          <AgentNameCell
            agentId={r.agentId}
            agents={agents}
            agentColorMap={agentColorMap}
            onClick={onAgentClick}
          />
        ),
      sortValue: (r) => (r.isMain ? '' : r.agentId),
    },
    {
      key: 'type',
      label: 'Type',
      sortType: 'string',
      render: (r) => <span className="text-blue-300">{r.agentType ?? '—'}</span>,
      sortValue: (r) => r.agentType ?? '',
    },
    {
      key: 'duration',
      label: 'Duration',
      sortType: 'number',
      align: 'right',
      render: (r) => (r.durationMs > 0 ? fmtMs(r.durationMs) : '—'),
      sortValue: (r) => r.durationMs,
      className: 'whitespace-nowrap',
    },
    {
      key: 'tools',
      label: 'Tools',
      sortType: 'number',
      align: 'right',
      render: (r) => (r.toolCount > 0 ? fmt(r.toolCount) : '—'),
      sortValue: (r) => r.toolCount,
    },
    {
      key: 'requests',
      label: 'Requests',
      sortType: 'number',
      align: 'right',
      render: (r) => (r.requests == null ? '—' : fmt(r.requests)),
      sortValue: (r) => r.requests ?? 0,
    },
    {
      key: 'input',
      label: 'Input',
      sortType: 'number',
      align: 'right',
      render: (r) => (r.inputTokens == null ? '—' : fmt(r.inputTokens)),
      sortValue: (r) => r.inputTokens ?? 0,
    },
    {
      key: 'output',
      label: 'Output',
      sortType: 'number',
      align: 'right',
      render: (r) => (r.outputTokens == null ? '—' : fmt(r.outputTokens)),
      sortValue: (r) => r.outputTokens ?? 0,
    },
    ...(hasTranscript
      ? ([
          {
            key: 'model',
            label: 'Model',
            sortType: 'string',
            render: (r) =>
              r.model && transcript ? (
                <ModelBadge modelId={r.model} pricing={transcript.models[r.model]?.pricing} />
              ) : (
                '—'
              ),
            sortValue: (r) => r.model ?? '',
          },
          {
            key: 'cost',
            label: 'Est Cost',
            sortType: 'number',
            align: 'right',
            render: (r) => {
              const p = r.model && transcript ? transcript.models[r.model]?.pricing : null
              return (
                <CostCell
                  costCents={r.costCents}
                  pricings={p ? [p] : []}
                  inputTokens={r.inputTokens ?? 0}
                  outputTokens={r.outputTokens ?? 0}
                  cacheReadTokens={r.cacheReadTokens ?? 0}
                  cacheCreate5mTokens={r.cacheCreate5mTokens ?? 0}
                  cacheCreate1hTokens={r.cacheCreate1hTokens ?? 0}
                />
              )
            },
            sortValue: (r) => r.costCents ?? 0,
          },
        ] as SortableColumn<AgentRow>[])
      : []),
  ]

  // Default sort: Est Cost desc when transcripts available (gives the
  // most useful info up top), otherwise Duration desc — the only
  // ordering that's meaningful when we don't have cost data.
  const defaultSort = hasTranscript
    ? ({ key: 'cost', dir: 'desc' } as const)
    : ({ key: 'duration', dir: 'desc' } as const)

  const agentFooter = hasTranscript
    ? [
        <span className="uppercase text-[9px] tracking-wide">Total</span>,
        null,
        agentTotals.durationMs > 0 ? fmtMs(agentTotals.durationMs) : '—',
        fmt(agentTotals.toolCount),
        agentTotals.requests == null ? '—' : fmt(agentTotals.requests),
        agentTotals.inputTokens == null ? '—' : fmt(agentTotals.inputTokens),
        agentTotals.outputTokens == null ? '—' : fmt(agentTotals.outputTokens),
        null,
        <span className="text-amber-500">{fmtCents(agentTotals.costCents)}</span>,
      ]
    : [
        <span className="uppercase text-[9px] tracking-wide">Total</span>,
        null,
        agentTotals.durationMs > 0 ? fmtMs(agentTotals.durationMs) : '—',
        fmt(agentTotals.toolCount),
        agentTotals.requests == null ? '—' : fmt(agentTotals.requests),
        agentTotals.inputTokens == null ? '—' : fmt(agentTotals.inputTokens),
        agentTotals.outputTokens == null ? '—' : fmt(agentTotals.outputTokens),
      ]

  // ── Summary cards ─────────────────────────────────────────────
  // When transcripts are available, all five cards have data. Without
  // transcripts, totals are derived from event-subagent data only —
  // the main agent's token usage isn't recoverable from events alone.
  const summaryCards = transcript ? (
    <div className="grid grid-cols-5 gap-2">
      <Card label="Requests" value={fmt(transcript.summary.totalCalls)} />
      <Card label="Total Input" value={fmt(transcript.summary.inputTotal)} />
      <Card label="Total Output" value={fmt(transcript.summary.outputTotal)} />
      <Card
        label="Cache Hit"
        value={fmtPct(transcript.summary.cacheHitRate)}
        valueClass="text-green-500"
      />
      <Card
        label="Est Cost"
        value={fmtCents(transcript.summary.costTotalCents)}
        valueClass="text-amber-500"
      />
    </div>
  ) : (
    (() => {
      // Subagent-only totals from events.
      const inputTotal = eventSubagents.reduce((s, a) => s + a.inputTokens, 0)
      const outputTotal = eventSubagents.reduce((s, a) => s + a.outputTokens, 0)
      const cacheRead = eventSubagents.reduce((s, a) => s + a.cacheReadTokens, 0)
      const cacheHitRate = inputTotal > 0 ? cacheRead / inputTotal : 0
      return (
        <div className="grid grid-cols-3 gap-2">
          <Card label="Total Input" value={fmt(inputTotal)} />
          <Card label="Total Output" value={fmt(outputTotal)} />
          <Card label="Cache Hit" value={fmtPct(cacheHitRate)} valueClass="text-green-500" />
        </div>
      )
    })()
  )

  return (
    <SectionShell title={hasTranscript ? 'Token Usage' : 'Token Usage (Sub-agents Only)'}>
      <div className="space-y-6">
        {summaryCards}

        {transcript && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              By Model
            </div>
            <SortableTable
              rows={transcript.byModel}
              columns={byModelCols}
              defaultSort={{ key: 'cost', dir: 'desc' }}
            />
          </div>
        )}

        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
            By Agent
          </div>
          <SortableTable
            // Remount when transcript/no-transcript mode flips so the
            // default sort actually applies — SortableTable holds its
            // sort state in useState and only honors `defaultSort` at
            // mount time.
            key={hasTranscript ? 'with-transcript' : 'events-only'}
            rows={agentRows}
            columns={agentCols}
            defaultSort={defaultSort}
            footer={agentFooter}
          />
        </div>

        {transcript && promptTotals && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              By Prompt
            </div>
            {transcript.prompts.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">
                No prompts in this session.
              </div>
            ) : (
              <SortableTable
                rows={transcript.prompts}
                columns={promptCols}
                defaultSort={{ key: 'cost', dir: 'desc' }}
                footer={[
                  <span className="uppercase text-[9px] tracking-wide">Total</span>,
                  fmtMs(promptTotals.durationMs),
                  fmt(promptTotals.toolCount),
                  fmt(promptTotals.requests),
                  fmt(promptTotals.inputTokens),
                  fmt(promptTotals.outputTokens),
                  null,
                  <span className="text-amber-500">{fmtCents(promptTotals.costCents)}</span>,
                ]}
              />
            )}
          </div>
        )}

        {/* Non-blocking diagnostic when transcript parsing isn't
            available — the agents table still rendered above, this
            just tells the user why it isn't showing model + cost. */}
        {transcriptDisabledByFlag && (
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground/70 italic">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{ERROR_MESSAGES.disabled}</span>
          </div>
        )}
        {transcriptError && (
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground/70 italic">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{ERROR_MESSAGES[transcriptError.error] ?? transcriptError.message}</span>
          </div>
        )}
        {transcriptStatsEnabled && isLoading && !transcript && !transcriptError && (
          <div className="text-[11px] text-muted-foreground/70 italic">
            Loading model + cost data…
          </div>
        )}
      </div>
    </SectionShell>
  )
}

// ── Agent rows: events as baseline, transcripts as augmentation ────

export interface AgentRow {
  agentId: string
  agentType: string | null
  isMain: boolean
  /** Always populated. Main agent uses session duration; subagents use
   *  `tool_response.totalDurationMs` from the PostToolUse:Agent event. */
  durationMs: number
  /** Always populated. Main agent: count of own PreToolUse events;
   *  subagents: `tool_response.totalToolUseCount`. */
  toolCount: number
  /** Token / model / cost fields are null when no source has data for
   *  them. Events never carry model or per-call request counts; the
   *  main agent's token totals only exist in transcripts. */
  requests: number | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreate5mTokens: number | null
  cacheCreate1hTokens: number | null
  model: string | null
  costCents: number | null
}

export interface AgentTotals {
  durationMs: number
  toolCount: number
  requests: number | null
  inputTokens: number | null
  outputTokens: number | null
  costCents: number | null
}

/**
 * Build the Agents table rows from events (always) and merge in
 * transcript-parser data when available. Transcripts only patch
 * fields they actually have data for — empty transcript fields leave
 * the events-derived values in place.
 */
export function buildAgentsTable({
  mainAgentId,
  sessionDurationMs,
  mainAgentToolCount,
  eventSubagents,
  transcript,
}: {
  mainAgentId: string
  sessionDurationMs: number
  mainAgentToolCount: number
  eventSubagents: AgentTokenUsage[]
  transcript: TranscriptStatsData | null
}): { agentRows: AgentRow[]; agentTotals: AgentTotals } {
  // Base rows from events: main + one row per subagent that emitted a
  // PostToolUse:Agent event in the parent's stream.
  const rowsById = new Map<string, AgentRow>()
  rowsById.set(mainAgentId, {
    agentId: mainAgentId,
    agentType: 'main',
    isMain: true,
    durationMs: sessionDurationMs,
    toolCount: mainAgentToolCount,
    requests: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    // All cache-creation tokens land in the 5m bucket for events-only
    // rows; cache_write pricing is identical across 5m/1h so totals and
    // cost remain correct regardless of split.
    cacheCreate5mTokens: null,
    cacheCreate1hTokens: null,
    model: null,
    costCents: null,
  })
  for (const e of eventSubagents) {
    rowsById.set(e.agentId, {
      agentId: e.agentId,
      agentType: e.agentType,
      isMain: false,
      durationMs: e.totalDurationMs,
      toolCount: e.toolUseCount,
      requests: null,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      cacheReadTokens: e.cacheReadTokens,
      cacheCreate5mTokens: e.cacheCreationTokens,
      cacheCreate1hTokens: 0,
      model: null,
      costCents: null,
    })
  }

  if (transcript) {
    // Subagents from transcripts: patch existing rows in place; add
    // rows for any agent the events stream didn't capture.
    for (const s of transcript.subagents) {
      const existing = rowsById.get(s.agentId)
      if (existing) {
        rowsById.set(s.agentId, mergeFromTranscriptSubagent(existing, s))
      } else {
        rowsById.set(s.agentId, transcriptSubagentToRow(s))
      }
    }
    // Main agent: derive token totals by subtracting subagent
    // contributions from byModel. Events have nothing for the main
    // agent's LLM usage, so this is the only source.
    const main = rowsById.get(mainAgentId)
    if (main) {
      rowsById.set(mainAgentId, applyMainAgentFromTranscript(main, transcript))
    }
  }

  const agentRows = [...rowsById.values()]
  const agentTotals = computeAgentTotals(agentRows)
  return { agentRows, agentTotals }
}

/** Patch only fields where transcript actually has data — preserves
 *  the events-based baseline otherwise. */
function mergeFromTranscriptSubagent(base: AgentRow, s: TranscriptStatsSubagent): AgentRow {
  return {
    ...base,
    agentType: s.agentType ?? base.agentType,
    durationMs: s.durationMs > 0 ? s.durationMs : base.durationMs,
    toolCount: s.toolCount > 0 ? s.toolCount : base.toolCount,
    requests: s.requests > 0 ? s.requests : base.requests,
    inputTokens: s.inputTokens > 0 ? s.inputTokens : base.inputTokens,
    outputTokens: s.outputTokens > 0 ? s.outputTokens : base.outputTokens,
    cacheReadTokens: s.cacheReadTokens > 0 ? s.cacheReadTokens : base.cacheReadTokens,
    // Cache split only meaningful from transcripts. If transcript has
    // any cache-write data, use its 5m/1h split (overwriting the
    // events-derived value that lumped everything into 5m).
    cacheCreate5mTokens:
      s.cacheCreate5mTokens + s.cacheCreate1hTokens > 0
        ? s.cacheCreate5mTokens
        : base.cacheCreate5mTokens,
    cacheCreate1hTokens:
      s.cacheCreate5mTokens + s.cacheCreate1hTokens > 0
        ? s.cacheCreate1hTokens
        : base.cacheCreate1hTokens,
    model: s.model || base.model,
    costCents: s.costCents ?? base.costCents,
  }
}

function transcriptSubagentToRow(s: TranscriptStatsSubagent): AgentRow {
  return {
    agentId: s.agentId,
    agentType: s.agentType,
    isMain: false,
    durationMs: s.durationMs,
    toolCount: s.toolCount,
    requests: s.requests,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    cacheReadTokens: s.cacheReadTokens,
    cacheCreate5mTokens: s.cacheCreate5mTokens,
    cacheCreate1hTokens: s.cacheCreate1hTokens,
    model: s.model || null,
    costCents: s.costCents,
  }
}

/** Derive the main agent's token / model / cost data from
 *  transcript.byModel minus subagent contributions. Mirrors the
 *  original `mainAgentRow` computation but never overwrites the
 *  events-derived duration / toolCount. */
function applyMainAgentFromTranscript(base: AgentRow, t: TranscriptStatsData): AgentRow {
  let model = ''
  let cacheReadTokens = 0
  let cacheCreate5mTokens = 0
  let cacheCreate1hTokens = 0
  let inputTokens = 0
  let outputTokens = 0
  let requests = 0
  let costCents: number | null = 0
  for (const m of t.byModel) {
    const subForModel = t.subagents.filter((s) => s.model === m.model)
    const subRequests = subForModel.reduce((s, x) => s + x.requests, 0)
    const subInput = subForModel.reduce((s, x) => s + x.inputTokens, 0)
    const subOutput = subForModel.reduce((s, x) => s + x.outputTokens, 0)
    const subCacheRead = subForModel.reduce((s, x) => s + x.cacheReadTokens, 0)
    const subCache5m = subForModel.reduce((s, x) => s + x.cacheCreate5mTokens, 0)
    const subCache1h = subForModel.reduce((s, x) => s + x.cacheCreate1hTokens, 0)
    const subCost = subForModel.reduce<number | null>((acc, x) => {
      if (acc == null || x.costCents == null) return null
      return acc + x.costCents
    }, 0)

    const mainCalls = m.calls - subRequests
    if (mainCalls <= 0) continue
    requests += mainCalls
    inputTokens += m.inputTokens - subInput
    outputTokens += m.outputTokens - subOutput
    cacheReadTokens += m.cacheReadTokens - subCacheRead
    cacheCreate5mTokens += m.cacheCreate5mTokens - subCache5m
    cacheCreate1hTokens += m.cacheCreate1hTokens - subCache1h
    if (!model) model = m.model
    if (costCents == null || m.costCents == null) {
      costCents = null
    } else {
      const cost = subCost == null ? null : m.costCents - subCost
      if (cost == null) costCents = null
      else costCents += cost
    }
  }
  // Only patch if we found any main-agent data in the transcript.
  if (requests === 0) return base
  return {
    ...base,
    requests,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreate5mTokens,
    cacheCreate1hTokens,
    model: model || base.model,
    costCents,
  }
}

function computeAgentTotals(rows: AgentRow[]): AgentTotals {
  const anyMissingRequests = rows.some((a) => a.requests == null)
  const anyMissingInput = rows.some((a) => a.inputTokens == null)
  const anyMissingOutput = rows.some((a) => a.outputTokens == null)
  const anyMissingCost = rows.some((a) => a.costCents == null)
  return {
    durationMs: rows.reduce((s, a) => s + a.durationMs, 0),
    toolCount: rows.reduce((s, a) => s + a.toolCount, 0),
    requests: anyMissingRequests ? null : rows.reduce((s, a) => s + (a.requests ?? 0), 0),
    inputTokens: anyMissingInput ? null : rows.reduce((s, a) => s + (a.inputTokens ?? 0), 0),
    outputTokens: anyMissingOutput ? null : rows.reduce((s, a) => s + (a.outputTokens ?? 0), 0),
    costCents: anyMissingCost ? null : rows.reduce((s, a) => s + (a.costCents ?? 0), 0),
  }
}
