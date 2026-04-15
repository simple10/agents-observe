// Claude Code agent class registration.
// Registers processEvent, rendering components, and metadata with the AgentRegistry.

import { Bot } from 'lucide-react'
import { AgentRegistry } from '../registry'
import { processEvent } from './process-event'
import { ClaudeCodeRowSummary } from './row-summary'
import { ClaudeCodeEventDetail } from './event-detail'
import { ClaudeCodeDotTooltip } from './dot-tooltip'

AgentRegistry.register({
  agentClass: 'claude-code',
  displayName: 'Claude Code',
  Icon: Bot,
  processEvent,
  RowSummary: ClaudeCodeRowSummary,
  EventDetail: ClaudeCodeEventDetail,
  DotTooltip: ClaudeCodeDotTooltip,
})
