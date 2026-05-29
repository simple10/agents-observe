// Hermes agent class registration (Nous Research Hermes Agent).
// Maps Hermes' lifecycle hooks onto existing icon-registry keys and renders
// nice per-hook summaries in the event stream + activity timeline.

import { Bot } from 'lucide-react'
import { AgentRegistry } from '../registry'
import { processEvent, deriveToolName, deriveStatus } from './process-event'
import { HermesRowSummary } from './row-summary'
import { HermesEventDetail } from './event-detail'
import { HermesDotTooltip } from './dot-tooltip'

AgentRegistry.register({
  agentClass: 'hermes',
  displayName: 'hermes',
  Icon: Bot,
  processEvent,
  deriveToolName,
  deriveStatus,
  RowSummary: HermesRowSummary,
  EventDetail: HermesEventDetail,
  DotTooltip: HermesDotTooltip,
})
