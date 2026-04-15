// Default agent class — fallback for unknown agent types.
// Shows raw JSON payload and uses generic icons.

import { CircleDot } from 'lucide-react'
import { AgentRegistry } from '../registry'
import type { RawEvent, EnrichedEvent, ProcessingContext, ProcessEventResult, EventProps } from '../types'

function processEvent(raw: RawEvent, ctx: ProcessingContext): ProcessEventResult {
  const turnId = ctx.getCurrentTurn(raw.agentId)

  const enriched: EnrichedEvent = {
    id: raw.id,
    agentId: raw.agentId,
    sessionId: raw.sessionId,
    timestamp: raw.timestamp,
    createdAt: raw.createdAt,
    type: raw.type,
    subtype: raw.subtype,
    groupId: raw.toolUseId,
    turnId,
    displayEventStream: true,
    displayTimeline: true,
    label: raw.subtype || raw.type || 'Event',
    toolName: raw.toolName,
    toolUseId: raw.toolUseId,
    icon: null,
    iconColor: 'text-muted-foreground',
    dotColor: 'bg-muted-foreground',
    iconColorHex: null,
    status: 'completed',
    filterTags: { static: null, dynamic: raw.toolName ? [raw.toolName] : [] },
    searchText: [raw.subtype, raw.toolName, raw.type, JSON.stringify(raw.payload)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .slice(0, 500),
    payload: raw.payload,
    summary: raw.subtype || raw.type || '',
  }

  return { event: enriched }
}

function DefaultRowSummary({ event }: EventProps) {
  const summary = (event.summary as string) || ''
  return <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{summary}</span>
}

function DefaultEventDetail({ event }: EventProps) {
  return (
    <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed max-h-60 overflow-y-auto">
      {JSON.stringify(event.payload, null, 2)}
    </pre>
  )
}

function DefaultDotTooltip({ event }: { event: EnrichedEvent }) {
  return (
    <div>
      <div className="font-medium">{event.label}</div>
      {event.toolName && <div className="opacity-70">{event.toolName}</div>}
    </div>
  )
}

AgentRegistry.registerDefault({
  agentClass: 'default',
  displayName: 'Unknown Agent',
  Icon: CircleDot,
  processEvent,
  RowSummary: DefaultRowSummary,
  EventDetail: DefaultEventDetail,
  DotTooltip: DefaultDotTooltip,
})
