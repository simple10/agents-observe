// Claude Code agent class registration.
// Registers processEvent, rendering components, and metadata with the AgentRegistry.

import { Bot } from 'lucide-react'
import { AgentRegistry } from '../registry'
import { processEvent } from './process-event'
import { getEventIcon, getEventColor } from './icons'
import { ClaudeCodeRowSummary } from './row-summary'
import { ClaudeCodeEventDetail } from './event-detail'
import { ClaudeCodeDotTooltip } from './dot-tooltip'
import { deriveSubtype, deriveToolName, deriveStatus } from './derivers'

AgentRegistry.register({
  agentClass: 'claude-code',
  displayName: 'claude',
  Icon: Bot,
  processEvent,
  deriveSubtype,
  deriveToolName,
  deriveStatus,
  getEventIcon: (event) => getEventIcon(event.subtype, event.toolName),
  getEventColor: (event) => getEventColor(event.subtype, event.toolName),
  RowSummary: ClaudeCodeRowSummary,
  EventDetail: ClaudeCodeEventDetail,
  DotTooltip: ClaudeCodeDotTooltip,
})
