// Default agent class — fallback for unknown agent types.
// Shows raw JSON payload and uses generic icons.

import { CircleDot } from 'lucide-react'
import { AgentRegistry } from '../registry'
import type {
  RawEvent,
  EnrichedEvent,
  EventStatus,
  ProcessingContext,
  FrameworkDataApi,
} from '../types'

/** Default tool-name derivation: read `payload.tool_name` if present. */
function deriveToolName(event: RawEvent): string | null {
  const p = event.payload as Record<string, unknown> | undefined
  const tn = p?.tool_name
  return typeof tn === 'string' ? tn : null
}

/** Default status: no per-class derivation. */
function deriveStatus(_event: RawEvent, _grouped: RawEvent[]): EventStatus | null {
  return null
}

export function processEvent(raw: RawEvent, ctx: ProcessingContext): { event: EnrichedEvent } {
  const payload = raw.payload as Record<string, unknown>
  const payloadTurnId = payload.turn_id
  const turnId = typeof payloadTurnId === 'string' ? payloadTurnId : ctx.getCurrentTurn(raw.agentId)
  // Some agent classes carry tool_use_id on the payload under that exact
  // key; the default processor surfaces it as the groupId for Pre/Post
  // pairing. Reads from payload rather than a top-level field because the
  // server no longer promotes tool_use_id to a column.
  const payloadToolUseId = payload.tool_use_id
  const toolUseId = typeof payloadToolUseId === 'string' ? payloadToolUseId : null

  const toolName = deriveToolName(raw)
  const hookName = raw.hookName

  const enriched: EnrichedEvent = {
    id: raw.id,
    agentId: raw.agentId,
    hookName,
    timestamp: raw.timestamp,
    toolName,
    groupId: toolUseId,
    turnId,
    displayEventStream: true,
    displayTimeline: true,
    label: hookName || 'Event',
    labelTooltip: hookName,
    iconId: 'Default',
    dedupMode: ctx.dedupEnabled,
    status: 'completed',
    filterTags: { static: null, dynamic: toolName ? [toolName] : [] },
    searchText: [hookName, toolName, JSON.stringify(raw.payload)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .slice(0, 500),
    payload: raw.payload,
    summary: hookName || '',
  }

  return { event: enriched }
}

export function DefaultRowSummary({ event }: { event: EnrichedEvent; dataApi: FrameworkDataApi }) {
  return (
    <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{event.summary}</span>
  )
}

export function DefaultEventDetail({ event }: { event: EnrichedEvent; dataApi: FrameworkDataApi }) {
  return (
    <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed max-h-60 overflow-y-auto">
      {JSON.stringify(event.payload, null, 2)}
    </pre>
  )
}

export function DefaultDotTooltip({ event }: { event: EnrichedEvent }) {
  return (
    <div>
      <div className="font-medium">{event.label}</div>
      {event.toolName && <div className="opacity-70">{event.toolName}</div>}
    </div>
  )
}

AgentRegistry.registerDefault({
  agentClass: 'default',
  displayName: 'unknown',
  Icon: CircleDot,
  processEvent,
  deriveToolName,
  deriveStatus,
  RowSummary: DefaultRowSummary,
  EventDetail: DefaultEventDetail,
  DotTooltip: DefaultDotTooltip,
})
