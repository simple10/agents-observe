// Claude Code agent class registration.
// Registers processEvent, rendering components, and metadata with the AgentRegistry.

import { Bot } from 'lucide-react'
import { AgentRegistry } from '../registry'
import type { AgentClassRegistration } from '../types'
import type { ClaudeCodeEnrichedEvent } from './types'
import { processEvent } from './process-event'
import { getEventIcon, getEventColor } from './icons'
import { ClaudeCodeRowSummary } from './row-summary'
import { ClaudeCodeEventDetail } from './event-detail'
import { ClaudeCodeDotTooltip } from './dot-tooltip'
import { deriveToolName, deriveStatus } from './derivers'

const registration: AgentClassRegistration<ClaudeCodeEnrichedEvent> = {
  agentClass: 'claude-code',
  displayName: 'claude',
  Icon: Bot,
  processEvent,
  deriveToolName,
  deriveStatus,
  getEventIcon: (event) => getEventIcon(event.hookName, event.toolName),
  getEventColor: (event) => getEventColor(event.hookName, event.toolName),
  RowSummary: ClaudeCodeRowSummary,
  EventDetail: ClaudeCodeEventDetail,
  DotTooltip: ClaudeCodeDotTooltip,
}

AgentRegistry.register(registration)
