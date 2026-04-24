// Claude Code agent class — event detail component.
// Faithfully ports the rendering logic from the original
// components/event-stream/event-detail.tsx, adapted for the new
// EventProps / EnrichedEvent / FrameworkDataApi interface.

import { useState, lazy, Suspense } from 'react'
import Markdown from 'react-markdown'
import {
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Loader,
  FileText,
  Code,
  CircleDot,
} from 'lucide-react'

const ReactDiffViewer = lazy(() => import('react-diff-viewer-continued'))
import { cn } from '@/lib/utils'
import { getAgentDisplayName } from '@/lib/agent-utils'
import { getEventIcon } from './icons'
import { getEventSummary, relativePath } from './helpers'
import { computeRuntimeMs, formatRuntime } from './runtime'
import type { EventProps, EnrichedEvent, FrameworkDataApi } from '../types'
import type { Agent } from '@/types'

// ── Markdown rendering config ──────────────────────────────
//
// Uses the ORIGINAL styling from event-detail.tsx (better than simplified version).

const MAX_MARKDOWN_SIZE = 50_000

/** Heuristic: does the text contain enough markdown signals to render? */
function looksLikeMarkdown(s: string): boolean {
  if (s.length > MAX_MARKDOWN_SIZE) return false
  const trimmed = s.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false

  const markers = [
    /^#{1,6}\s/m, // headings
    /\*\*.+?\*\*/, // bold
    /^[-*]\s/m, // unordered list
    /^\d+\.\s/m, // ordered list
    /```/, // code fence
    /`[^`]+`/, // inline code
    /\[.+?\]\(.+?\)/, // links
    /^\s*>/m, // blockquote
  ]
  let hits = 0
  for (const re of markers) {
    if (re.test(s)) hits++
    if (hits >= 2) return true
  }
  return false
}

const mdComponents = {
  h1: ({ children, ...props }: React.ComponentProps<'h1'>) => (
    <h1 className="text-xs font-bold mt-3 first:mt-0 mb-1.5 text-foreground" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.ComponentProps<'h2'>) => (
    <h2 className="text-xs font-bold mt-3 first:mt-0 mb-1.5 text-foreground" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.ComponentProps<'h3'>) => (
    <h3 className="text-[11px] font-semibold mt-2 first:mt-0 mb-1" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }: React.ComponentProps<'p'>) => (
    <p className="mb-1.5 last:mb-0 leading-relaxed" {...props}>
      {children}
    </p>
  ),
  strong: ({ children, ...props }: React.ComponentProps<'strong'>) => (
    <strong className="font-semibold text-foreground" {...props}>
      {children}
    </strong>
  ),
  ul: ({ children, ...props }: React.ComponentProps<'ul'>) => (
    <ul className="list-disc pl-4 space-y-1 mb-1.5" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.ComponentProps<'ol'>) => (
    <ol className="list-decimal pl-4 space-y-1 mb-1.5" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }: React.ComponentProps<'li'>) => (
    <li className="leading-relaxed" {...props}>
      {children}
    </li>
  ),
  code: ({ children, className, ...props }: React.ComponentProps<'code'>) => {
    const isBlock = className?.includes('language-')
    if (isBlock) {
      return (
        <code
          className="block bg-black/20 dark:bg-white/10 border border-border/50 rounded p-1.5 font-mono text-[10px] leading-relaxed overflow-x-auto my-1.5"
          {...props}
        >
          {children}
        </code>
      )
    }
    return (
      <code
        className="bg-black/10 dark:bg-white/10 border border-border/40 rounded px-1 py-0.5 font-mono text-[10px] text-amber-700 dark:text-amber-400"
        {...props}
      >
        {children}
      </code>
    )
  },
  pre: ({ children, ...props }: React.ComponentProps<'pre'>) => (
    <pre className="overflow-x-auto my-1.5" {...props}>
      {children}
    </pre>
  ),
  blockquote: ({ children, ...props }: React.ComponentProps<'blockquote'>) => (
    <blockquote
      className="border-l-2 border-primary/40 pl-2.5 text-muted-foreground italic my-1.5"
      {...props}
    >
      {children}
    </blockquote>
  ),
  a: ({ children, ...props }: React.ComponentProps<'a'>) => (
    <a
      className="text-blue-600 dark:text-blue-400 underline underline-offset-2 decoration-blue-600/30 dark:decoration-blue-400/30 hover:decoration-blue-600 dark:hover:decoration-blue-400"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  hr: (props: React.ComponentProps<'hr'>) => <hr className="my-2 border-border/50" {...props} />,
}

// ── Thread deduplication ──────────────────────────────────

// Merge PostToolUse into PreToolUse by toolUseId (same as main stream).
// Only show PreToolUse if there's no matching PostToolUse (failed tool).
function dedupeThread(events: EnrichedEvent[]): EnrichedEvent[] {
  const result: EnrichedEvent[] = []
  const toolUseMap = new Map<string, number>()

  for (const e of events) {
    if (e.subtype === 'PreToolUse' && e.toolUseId) {
      toolUseMap.set(e.toolUseId, result.length)
      result.push({ ...e })
    } else if (e.subtype === 'PostToolUse' && e.toolUseId && toolUseMap.has(e.toolUseId)) {
      const idx = toolUseMap.get(e.toolUseId)!
      result[idx] = { ...result[idx], status: 'completed' }
    } else {
      result.push(e)
    }
  }
  return result
}

// ── Thread event label map ────────────────────────────────

const LABEL_MAP: Record<string, string> = {
  UserPromptSubmit: 'Prompt',
  PreToolUse: 'Tool',
  PostToolUse: 'Tool',
  PostToolUseFailure: 'ToolErr',
  stop_hook_summary: 'Stop',
  StopFailure: 'Error',
  SubagentStart: 'SubStart',
  SubagentStop: 'SubStop',
  SessionStart: 'Session',
  SessionEnd: 'Session',
}

// ── Main component ─────────────────────────────────────────

const THREAD_SUBTYPES = ['UserPromptSubmit', 'Stop', 'SubagentStart', 'SubagentStop']

export function ClaudeCodeEventDetail({ event, dataApi }: EventProps) {
  const payload = event.payload as Record<string, any>
  const cwd = (event.cwd as string) || undefined

  const showThread = THREAD_SUBTYPES.includes(event.subtype || '')

  // Load turn events for thread-style display
  const turnEvents = event.turnId ? dataApi.getTurnEvents(event.turnId) : []

  // Get grouped events (e.g., Pre + Post for tool calls)
  const groupedEvents = event.groupId ? dataApi.getGroupedEvents(event.groupId) : []
  const pairedEvent = groupedEvents.find((e) => e.id !== event.id) ?? null

  // Agent lookup helper
  const getAgent = (agentId: string) => dataApi.getAgent(agentId)

  return (
    <div className="space-y-2 text-xs">
      {/* Show hook name when dedup is off */}
      {!event.dedupMode && event.subtype && <DetailRow label="Hook" value={event.subtype} />}

      {/* Per-event-type rich detail */}
      <ToolDetail
        event={event}
        payload={payload}
        cwd={cwd}
        turnEvents={turnEvents}
        getAgent={getAgent}
        dataApi={dataApi}
        pairedEvent={pairedEvent}
      />

      {/* Error from payload (shown for any event type with an error field,
          unless handled by ToolDetail already) */}
      {event.subtype !== 'PostToolUseFailure' &&
        event.subtype !== 'StopFailure' &&
        typeof payload.error === 'string' &&
        payload.error && <DetailCode label="Error" value={payload.error} />}

      {/* Runtime — elapsed time between an event and its paired end.
          - Pre/Post pairs (tool use, compact) via groupId
          - UserPromptSubmit → Stop (or stop_hook_summary) via turnEvents
          - SubagentStart → SubagentStop via turnEvents */}
      {(() => {
        const ms = computeRuntimeMs(event, pairedEvent, turnEvents)
        return ms != null ? <DetailRow label="Runtime" value={formatRuntime(ms)} /> : null
      })()}

      {/* Conversation thread for UserPrompt / Stop / Subagent events */}
      {showThread && (
        <div>
          <div className="text-muted-foreground mb-1.5 font-medium">Conversation thread:</div>
          {turnEvents.length > 0 ? (
            <div className="space-y-0.5 rounded border border-border/50 bg-muted/20 p-1.5">
              {dedupeThread(turnEvents).map((e) => (
                <ThreadEvent key={e.id} event={e} isCurrentEvent={e.id === event.id} />
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground/80 dark:text-muted-foreground/60 py-1">
              No thread events found
            </div>
          )}
        </div>
      )}

      {/* Raw payload section(s) — two for paired tool rows, one otherwise */}
      {pairedEvent ? (
        <>
          <RawPayloadSection
            label={event.subtype || 'PreToolUse'}
            timestamp={event.timestamp}
            payload={event.payload as Record<string, unknown>}
          />
          <RawPayloadSection
            label={pairedEvent.subtype || 'PostToolUse'}
            timestamp={pairedEvent.timestamp}
            payload={pairedEvent.payload as Record<string, unknown>}
          />
        </>
      ) : (
        <RawPayloadSection
          label="Raw payload"
          timestamp={event.timestamp}
          payload={event.payload as Record<string, unknown>}
        />
      )}
    </div>
  )
}

// ── Raw payload collapsible section ───────────────────────

function formatTimeOfDay(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function RawPayloadSection({
  label,
  timestamp,
  payload,
}: {
  label: string
  timestamp: number
  payload: Record<string, unknown>
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const payloadStr = JSON.stringify(payload, null, 2)

  const handleCopy = () => {
    navigator.clipboard.writeText(payloadStr)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <div
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        onClick={() => setOpen(!open)}
        role="button"
        tabIndex={0}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>{label}</span>
        <span className="ml-2 text-[10px] text-muted-foreground/70 dark:text-muted-foreground/60 tabular-nums">
          {formatTimeOfDay(timestamp)}
        </span>
        <button
          type="button"
          className="h-5 w-5 ml-1 inline-flex items-center justify-center rounded-sm hover:bg-accent hover:text-accent-foreground"
          onClick={(e) => {
            e.stopPropagation()
            handleCopy()
          }}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      {open && (
        <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed mt-1">
          {payloadStr}
        </pre>
      )}
    </div>
  )
}

// ── Rich per-event-type detail ────────────────────────────

function ToolDetail({
  event,
  payload,
  cwd,
  turnEvents,
  getAgent,
  dataApi,
  pairedEvent,
}: {
  event: EnrichedEvent
  payload: Record<string, any>
  cwd?: string
  turnEvents: EnrichedEvent[]
  getAgent: (id: string) => Agent | undefined
  dataApi: FrameworkDataApi
  pairedEvent: EnrichedEvent | null
}) {
  const ti = payload.tool_input || {}
  const result = pairedEvent
    ? extractResult((pairedEvent.payload as any)?.tool_response)
    : extractResult(payload.tool_response)

  // ── Non-tool events ──────────────────────────────────

  if (event.subtype === 'UserPromptSubmit') {
    // Find the Stop event in the turn to show the final assistant message
    const stopEvent = turnEvents.find(
      (e) => e.subtype === 'Stop' || e.subtype === 'stop_hook_summary',
    )
    const finalMessage = (stopEvent?.payload as any)?.last_assistant_message
    return (
      <div className="space-y-1.5">
        <DetailCode label="Prompt" value={payload.prompt} />
        {finalMessage && <DetailCode label="Result" value={finalMessage} />}
      </div>
    )
  }

  if (event.subtype === 'Stop') {
    // Find the prompt from the turn events or payload
    const promptEvent = turnEvents.find((e) => e.subtype === 'UserPromptSubmit')
    const promptText = promptEvent
      ? (promptEvent.payload as any)?.prompt || (promptEvent.payload as any)?.message?.content
      : null

    return (
      <div className="space-y-1.5">
        {promptText && <DetailCode label="Prompt" value={promptText} />}
        {payload.last_assistant_message && (
          <DetailCode label="Final" value={payload.last_assistant_message} />
        )}
      </div>
    )
  }

  if (event.subtype === 'SubagentStop') {
    const agentResult = payload.last_assistant_message
    const subAgent = getAgent(event.agentId)
    const assignedName = subAgent ? getAgentDisplayName(subAgent) : null
    const rawName = payload.agent_name as string | undefined
    // Find spawn info from parent Agent tool call
    const parentAgentEvents = dataApi.getAgentEvents(event.agentId)
    const spawnEvent = parentAgentEvents.find(
      (e) => e.subtype === 'PreToolUse' && e.toolName === 'Agent',
    )
    const spawnDesc = (spawnEvent?.payload as any)?.tool_input?.description
    const spawnPrompt = (spawnEvent?.payload as any)?.tool_input?.prompt
    return (
      <div className="space-y-1.5">
        <AgentIdentity assignedName={assignedName} rawName={rawName} agentId={event.agentId} />
        {spawnDesc && <DetailRow label="Task" value={spawnDesc} />}
        {spawnPrompt && <DetailCode label="Prompt" value={spawnPrompt} />}
        {agentResult && <DetailCode label="Result" value={agentResult} />}
      </div>
    )
  }

  if (event.subtype === 'SessionStart') {
    return (
      <div className="space-y-1">
        <DetailRow label="Source" value={payload.source || 'new'} />
        {cwd && <DetailRow label="Working dir" value={cwd} />}
        {payload.version && <DetailRow label="Version" value={payload.version} />}
        {payload.permissionMode && <DetailRow label="Permissions" value={payload.permissionMode} />}
      </div>
    )
  }

  if (event.subtype === 'SessionEnd') {
    return (
      <div className="space-y-1">
        <DetailRow label="Status" value="Session ended" />
      </div>
    )
  }

  if (event.subtype === 'StopFailure') {
    let errorType = payload.error as string | undefined
    let errorMessage = payload.error_message as string | undefined
    if (payload.error_details) {
      try {
        const raw = typeof payload.error_details === 'string' ? payload.error_details : ''
        // Strip leading status code (e.g. "400 {..." -> "{...")
        const jsonStr = raw.replace(/^\d+\s*/, '')
        const details = jsonStr ? JSON.parse(jsonStr) : payload.error_details
        if (!errorType) errorType = details?.error?.type
        if (!errorMessage) errorMessage = details?.error?.message || details?.message
      } catch {
        // ignore parse errors
      }
    }
    return (
      <div className="space-y-1.5">
        {payload.last_assistant_message && (
          <DetailRow label="Message" value={payload.last_assistant_message as string} />
        )}
        {errorType && <DetailRow label="Error" value={errorType} />}
        {errorMessage && <DetailCode label="Details" value={errorMessage} />}
      </div>
    )
  }

  if (event.subtype === 'SubagentStart') {
    const subAgent = getAgent(event.agentId)
    const assignedName = subAgent ? getAgentDisplayName(subAgent) : null
    const rawName = payload.agent_name as string | undefined
    // Pull result from SubagentStop in the turn events
    const stopEvent = turnEvents.find((e) => e.subtype === 'SubagentStop')
    const agentResult = (stopEvent?.payload as any)?.last_assistant_message
    // Find spawn info from parent Agent tool call
    const parentAgentEvents = dataApi.getAgentEvents(event.agentId)
    const spawnEvent = parentAgentEvents.find(
      (e) => e.subtype === 'PreToolUse' && e.toolName === 'Agent',
    )
    const spawnDesc = (spawnEvent?.payload as any)?.tool_input?.description
    const spawnPrompt = (spawnEvent?.payload as any)?.tool_input?.prompt
    return (
      <div className="space-y-1.5">
        <AgentIdentity assignedName={assignedName} rawName={rawName} agentId={event.agentId} />
        {(spawnDesc || payload.description) && (
          <DetailRow label="Task" value={spawnDesc || payload.description} />
        )}
        {spawnPrompt && <DetailCode label="Prompt" value={spawnPrompt} />}
        {agentResult && <DetailCode label="Result" value={agentResult} />}
      </div>
    )
  }

  if (event.subtype === 'PostToolUseFailure') {
    const failTi = payload.tool_input || {}
    return (
      <div className="space-y-1.5">
        {event.toolName && <DetailRow label="Tool" value={event.toolName} />}
        {failTi.command && <DetailCode label="Command" value={failTi.command} />}
        {payload.error && (
          <DetailCode
            label="Error"
            value={
              typeof payload.error === 'string'
                ? payload.error
                : JSON.stringify(payload.error, null, 2)
            }
          />
        )}
      </div>
    )
  }

  if (event.subtype === 'PermissionRequest') {
    const permTi = payload.tool_input as Record<string, any> | undefined
    return (
      <div className="space-y-1.5">
        {payload.tool_name && <DetailRow label="Tool" value={payload.tool_name as string} />}
        {permTi?.command && <DetailCode label="Command" value={permTi.command} />}
        {permTi?.description && <DetailRow label="Description" value={permTi.description} />}
        {permTi?.file_path && (
          <DetailRow label="File" value={relativePath(permTi.file_path, cwd)} />
        )}
        {payload.ruleContent && <DetailRow label="Rule" value={payload.ruleContent as string} />}
        {payload.permission_suggestions && (
          <DetailCode
            label="Permissions"
            value={
              typeof payload.permission_suggestions === 'string'
                ? payload.permission_suggestions
                : JSON.stringify(payload.permission_suggestions, null, 2)
            }
          />
        )}
      </div>
    )
  }

  if (event.subtype === 'TaskCreated' || event.subtype === 'TaskCompleted') {
    const subject = payload.task_subject as string | undefined
    const description = (payload.task_description || payload.description) as string | undefined
    const taskGrouped = event.groupId ? dataApi.getGroupedEvents(event.groupId) : []
    return (
      <div className="space-y-1.5">
        {subject && <DetailRow label="Subject" value={subject} />}
        {payload.task_id && <DetailRow label="Task ID" value={String(payload.task_id)} />}
        {description && <DetailCode label="Description" value={description} />}
        {taskGrouped.length > 1 && (
          <div>
            <div className="text-muted-foreground mb-1 font-medium">Task history:</div>
            <div className="space-y-0.5 rounded border border-border/50 bg-muted/20 p-1.5">
              {taskGrouped.map((e) => {
                const ep = e.payload as Record<string, any>
                const ti = ep.tool_input || {}
                const statusChange = ep.tool_response?.statusChange
                const statusTo = statusChange?.to || ti.status
                const activeForm = ti.activeForm as string | undefined
                const desc = (ti.description || ti.subject || ep.task_description) as
                  | string
                  | undefined
                const label =
                  e.subtype === 'TaskCreated'
                    ? 'Created'
                    : e.subtype === 'TaskCompleted'
                      ? 'Completed'
                      : e.toolName === 'TaskUpdate'
                        ? `Updated → ${statusTo || '?'}`
                        : e.label || e.subtype || 'Event'
                const detail = activeForm || desc
                return (
                  <div
                    key={e.id}
                    className={cn(
                      'flex items-center gap-2 px-2 py-0.5 rounded text-[11px]',
                      e.id === event.id ? 'bg-primary/10 font-medium' : 'text-muted-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'shrink-0',
                        statusTo === 'completed'
                          ? 'text-green-600 dark:text-green-500'
                          : statusTo === 'in_progress'
                            ? 'text-yellow-600 dark:text-yellow-500/70'
                            : e.subtype === 'TaskCompleted'
                              ? 'text-green-600 dark:text-green-500'
                              : 'text-muted-foreground/50',
                      )}
                    >
                      {statusTo === 'completed' || e.subtype === 'TaskCompleted' ? (
                        <Check className="h-3 w-3" />
                      ) : statusTo === 'in_progress' ? (
                        <Loader className="h-3 w-3" />
                      ) : (
                        <CircleDot className="h-3 w-3" />
                      )}
                    </span>
                    <span className="shrink-0">{label}</span>
                    {detail && (
                      <span className="truncate flex-1 min-w-0 text-[10px] text-muted-foreground/60">
                        {detail}
                      </span>
                    )}
                    <span className="text-[9px] text-muted-foreground/70 tabular-nums shrink-0 ml-auto">
                      {new Date(e.timestamp).toLocaleTimeString('en-US', {
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (event.subtype === 'TeammateIdle') {
    return (
      <div className="space-y-1">
        {payload.teammate_name && (
          <DetailRow label="Teammate" value={payload.teammate_name as string} />
        )}
      </div>
    )
  }

  if (event.subtype === 'InstructionsLoaded') {
    return (
      <div className="space-y-1">
        {payload.file_path && (
          <DetailRow label="File" value={relativePath(payload.file_path as string, cwd)} />
        )}
      </div>
    )
  }

  if (event.subtype === 'ConfigChange') {
    return (
      <div className="space-y-1">
        {payload.file_path && (
          <DetailRow label="File" value={relativePath(payload.file_path as string, cwd)} />
        )}
      </div>
    )
  }

  if (event.subtype === 'CwdChanged') {
    return (
      <div className="space-y-1">
        {payload.old_cwd && <DetailRow label="From" value={payload.old_cwd as string} />}
        <DetailRow label="To" value={(payload.new_cwd || payload.cwd || '') as string} />
      </div>
    )
  }

  if (event.subtype === 'FileChanged') {
    return (
      <div className="space-y-1">
        {payload.file_path && (
          <DetailRow label="File" value={relativePath(payload.file_path as string, cwd)} />
        )}
      </div>
    )
  }

  if (event.subtype === 'UserPromptExpansion') {
    const expansionType = payload.expansion_type as string | undefined
    const commandName = payload.command_name as string | undefined
    const commandArgs = payload.command_args as string | undefined
    const commandSource = payload.command_source as string | undefined
    const prompt = payload.prompt as string | undefined
    return (
      <div className="space-y-1.5">
        {expansionType && <DetailRow label="Expansion" value={expansionType} />}
        {commandName && <DetailRow label="Command" value={commandName} />}
        {commandArgs && <DetailRow label="Args" value={commandArgs} />}
        {commandSource && <DetailRow label="Source" value={commandSource} />}
        {prompt && <DetailCode label="Prompt" value={prompt} />}
      </div>
    )
  }

  if (event.subtype === 'PreCompact' || event.subtype === 'PostCompact') {
    // After pairing, a PreCompact row's payload is merged with PostCompact's,
    // so the fields below coexist and we render them together. When dedup is
    // disabled, each event renders only its own fields. The row's spinner /
    // checkmark conveys status, so there's no explicit Status line here.
    const customInstructions = payload.custom_instructions
    return (
      <div className="space-y-1.5">
        {payload.trigger && <DetailRow label="Trigger" value={String(payload.trigger)} />}
        {customInstructions ? (
          <DetailCode label="Custom instructions" value={String(customInstructions)} />
        ) : (
          <DetailRow label="Custom instructions" value="—" />
        )}
        {payload.tokens_before && (
          <DetailRow label="Tokens before" value={String(payload.tokens_before)} />
        )}
        {payload.tokens_after && (
          <DetailRow label="Tokens after" value={String(payload.tokens_after)} />
        )}
        {payload.compact_summary && (
          <DetailCode label="Summary" value={String(payload.compact_summary)} />
        )}
      </div>
    )
  }

  if (event.subtype === 'Elicitation') {
    return (
      <div className="space-y-1.5">
        {payload.message && <DetailCode label="Question" value={payload.message as string} />}
        {payload.question && <DetailCode label="Question" value={payload.question as string} />}
      </div>
    )
  }

  if (event.subtype === 'ElicitationResult') {
    return (
      <div className="space-y-1.5">
        {payload.response && <DetailCode label="Response" value={payload.response as string} />}
        {payload.result && <DetailCode label="Result" value={payload.result as string} />}
      </div>
    )
  }

  if (event.subtype === 'WorktreeCreate' || event.subtype === 'WorktreeRemove') {
    return (
      <div className="space-y-1">
        {payload.path && <DetailRow label="Path" value={payload.path as string} />}
        {payload.branch && <DetailRow label="Branch" value={payload.branch as string} />}
      </div>
    )
  }

  // ── Tool events ──────────────────────────────────────

  if (event.subtype !== 'PreToolUse' && event.subtype !== 'PostToolUse') return null

  switch (event.toolName) {
    case 'Bash': {
      const isDiff = /\bdiff\b/.test(ti.command || '')
      return (
        <div className="space-y-1.5">
          {ti.description && <DetailRow label="Description" value={ti.description} />}
          {ti.command && <DetailCode label="Command" value={ti.command} />}
          {cwd && <DetailRow label="CWD" value={cwd} />}
          {result && <DetailCode label="Result" value={formatResult(result)} diff={isDiff} />}
        </div>
      )
    }
    case 'Read': {
      const postPayload = (pairedEvent?.payload || payload) as Record<string, any>
      const readResponse = postPayload.tool_response as Record<string, any> | undefined
      const fileContent = readResponse?.file?.content ?? readResponse?.content
      const fileType = readResponse?.type as string | undefined
      const displayContent = typeof fileContent === 'string' ? fileContent : result
      return (
        <div className="space-y-1.5">
          <DetailRow label="File" value={relativePath(ti.file_path, cwd)} />
          {ti.offset && (
            <DetailRow
              label="Range"
              value={`line ${ti.offset}${ti.limit ? `, limit ${ti.limit}` : ''}`}
            />
          )}
          {fileType && fileType !== 'text' && <DetailRow label="Type" value={fileType} />}
          {displayContent && <DetailCode label="Content" value={formatResult(displayContent)} />}
        </div>
      )
    }
    case 'Write':
      return (
        <div className="space-y-1.5">
          <DetailRow label="File" value={relativePath(ti.file_path, cwd)} />
          {result && <DetailCode label="Result" value={formatResult(result)} />}
        </div>
      )
    case 'Edit': {
      const editPostPayload = (pairedEvent?.payload || payload) as Record<string, any>
      const editResponse = editPostPayload.tool_response as Record<string, any> | undefined
      const patchLines = editResponse?.structuredPatch?.lines as string | undefined
      const editResult = patchLines || result
      return (
        <div className="space-y-1.5">
          <DetailRow label="File" value={relativePath(ti.file_path, cwd)} />
          {ti.old_string && ti.new_string ? (
            <DetailDiff oldValue={ti.old_string} newValue={ti.new_string} />
          ) : (
            <>
              {ti.old_string && <DetailCode label="Old" value={ti.old_string} />}
              {ti.new_string && <DetailCode label="New" value={ti.new_string} />}
            </>
          )}
          {editResult && (
            <DetailCode label="Result" value={formatResult(editResult)} diff={!!patchLines} />
          )}
        </div>
      )
    }
    case 'Grep':
      return (
        <div className="space-y-1.5">
          <DetailRow label="Pattern" value={`/${ti.pattern}/`} />
          {ti.path && <DetailRow label="Path" value={relativePath(ti.path, cwd)} />}
          {ti.glob && <DetailRow label="Glob" value={ti.glob} />}
          {result && <DetailCode label="Result" value={formatResult(result)} />}
        </div>
      )
    case 'Glob':
      return (
        <div className="space-y-1.5">
          <DetailRow label="Pattern" value={ti.pattern} />
          {ti.path && <DetailRow label="Path" value={relativePath(ti.path, cwd)} />}
          {result && <DetailCode label="Result" value={formatResult(result)} />}
        </div>
      )
    case 'Agent': {
      const postPayload = pairedEvent?.payload as Record<string, any> | undefined
      const toolResponse = postPayload?.tool_response || payload.tool_response
      const spawnedAgentId = (toolResponse?.agentId || postPayload?.tool_response?.agentId) as
        | string
        | undefined
      const spawnedAgent = spawnedAgentId ? getAgent(spawnedAgentId) : undefined
      const agentAssignedName = spawnedAgent ? getAgentDisplayName(spawnedAgent) : null
      const agentRawName = ti.name as string | undefined
      const agentResult = extractResult(toolResponse)
      return (
        <div className="space-y-1.5">
          <AgentIdentity
            assignedName={agentAssignedName}
            rawName={agentRawName}
            agentId={spawnedAgentId}
          />
          {ti.description && <DetailRow label="Task" value={ti.description} />}
          {ti.prompt && <DetailCode label="Prompt" value={ti.prompt} />}
          {agentResult && <DetailCode label="Result" value={agentResult} />}
        </div>
      )
    }
    default: {
      // Extract any base64 images from the tool_response so MCP tools
      // that return screenshots (chrome-devtools take_screenshot,
      // etc.) render their images inline. `data.length > 100` guards
      // against both empty strings and the "[REDACTED]" sentinel
      // stamped by the hook CLI's stripLargeImageData.
      const rawResponse =
        (pairedEvent?.payload as Record<string, unknown> | undefined)?.tool_response ??
        payload.tool_response
      const images = extractBase64Images(rawResponse)
      return (
        <div className="space-y-1.5">
          {ti.description && <DetailRow label="Description" value={ti.description} />}
          {result && <DetailCode label="Result" value={formatResult(result)} />}
          {images.map((img, i) => (
            // Matches DetailRow's layout: fixed-width label on the
            // left, value on the right. Keeps the image visually
            // aligned with the Description / Result rows above.
            <div key={i} className="flex gap-2">
              <span className="text-muted-foreground shrink-0 w-20 text-right">
                {images.length > 1 ? `Image ${i + 1}:` : 'Image:'}
              </span>
              <div className="min-w-0 rounded-md border overflow-hidden bg-muted/30 flex items-center justify-center p-2">
                <img
                  src={`data:${img.mediaType};base64,${img.data}`}
                  alt="Tool response image"
                  className="max-w-full max-h-[480px] object-contain"
                />
              </div>
            </div>
          ))}
        </div>
      )
    }
  }
}

function extractBase64Images(resp: unknown): { mediaType: string; data: string }[] {
  if (!Array.isArray(resp)) return []
  const out: { mediaType: string; data: string }[] = []
  for (const item of resp) {
    if (!item || typeof item !== 'object') continue
    const typed = item as Record<string, unknown>
    if (typed.type !== 'image') continue
    const src = typed.source as Record<string, unknown> | undefined
    if (!src || typeof src !== 'object') continue
    if (src.type !== 'base64') continue
    const data = src.data
    if (typeof data !== 'string' || data.length <= 100) continue
    const mediaType = typeof src.media_type === 'string' ? src.media_type : 'image/png'
    out.push({ mediaType, data })
  }
  return out
}

// ── Helper components ──────────────────────────────────────

function AgentIdentity({
  assignedName,
  rawName,
  agentId,
}: {
  assignedName?: string | null
  rawName?: string | null
  agentId?: string | null
}) {
  const displayName = assignedName || rawName || null
  const showRawName = rawName && assignedName && rawName !== assignedName
  const showId = agentId && agentId !== displayName

  return (
    <>
      {displayName && (
        <div className="flex gap-2">
          <span className="text-muted-foreground shrink-0 w-20 text-right">Agent:</span>
          <span className="truncate">
            {displayName}
            {showRawName && (
              <span className="text-muted-foreground/80 dark:text-muted-foreground/60 ml-1.5">
                ({rawName})
              </span>
            )}
          </span>
        </div>
      )}
      {showId && (
        <div className="flex gap-2">
          <span className="text-muted-foreground shrink-0 w-20 text-right">Agent ID:</span>
          <span className="truncate font-mono text-muted-foreground/80 dark:text-muted-foreground/60">
            {agentId}
          </span>
        </div>
      )}
    </>
  )
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground shrink-0 w-20 text-right">{label}:</span>
      <span className="truncate">{value}</span>
    </div>
  )
}

function DetailCode({ label, value, diff }: { label: string; value?: string; diff?: boolean }) {
  if (!value) return null
  const hasDiff = diff ?? false
  const hasMd = !hasDiff && looksLikeMarkdown(value)
  const [showRaw, setShowRaw] = useState(!hasMd && !hasDiff)
  const [copied, setCopied] = useState(false)

  const copyButton = (
    <button
      type="button"
      className="flex items-center gap-1 text-[9px] text-muted-foreground/70 hover:text-muted-foreground transition-colors cursor-pointer"
      onClick={() => {
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? (
        <>
          Copied <Check className="h-2.5 w-2.5 text-green-500" />
        </>
      ) : (
        <>
          Copy <Copy className="h-2.5 w-2.5" />
        </>
      )}
    </button>
  )

  // Only render the header row when there's a format toggle (markdown
  // or diff). For plain-text values the toggle is absent and the old
  // header bar was an empty row that visually "pushed down" the
  // content. Copy moves into a hover-revealed overlay instead.
  const showHeaderRow = hasMd || hasDiff

  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground shrink-0 w-20 text-right">{label}:</span>
      <div className="flex-1 min-w-0">
        {showHeaderRow && (
          <div className="flex items-center gap-1 mb-0.5">
            <button
              type="button"
              className="flex items-center gap-1 text-[9px] text-muted-foreground/70 hover:text-muted-foreground transition-colors cursor-pointer"
              onClick={() => setShowRaw(!showRaw)}
            >
              {showRaw ? <Code className="h-2.5 w-2.5" /> : <FileText className="h-2.5 w-2.5" />}
              {showRaw ? 'raw' : hasDiff ? 'diff' : 'markdown'}
            </button>
            <div className="ml-auto">{copyButton}</div>
          </div>
        )}
        <div className="relative group">
          {!showHeaderRow && (
            <div className="absolute right-1 top-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-muted/80 rounded px-1 py-0.5">
              {copyButton}
            </div>
          )}
          {showRaw ? (
            <pre className="overflow-x-auto rounded bg-muted/50 p-1.5 font-mono text-[10px] leading-relaxed max-h-40 overflow-y-auto">
              {value}
            </pre>
          ) : hasDiff ? (
            <DiffPre value={value} />
          ) : (
            <div className="overflow-y-auto max-h-40 rounded bg-muted/50 p-1.5 text-[11px] leading-relaxed prose-sm">
              <Markdown components={mdComponents}>{value}</Markdown>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Renders unified diff text with colored +/- lines */
function DiffPre({ value }: { value: string }) {
  const lines = value.split('\n')
  return (
    <pre className="overflow-x-auto rounded bg-muted/50 p-1.5 font-mono text-[10px] leading-relaxed max-h-40 overflow-y-auto">
      {lines.map((line, i) => {
        let cls = ''
        if (line.startsWith('+') && !line.startsWith('+++')) {
          cls = 'text-green-600 dark:text-green-400 bg-green-500/10'
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          cls = 'text-red-600 dark:text-red-400 bg-red-500/10'
        } else if (line.startsWith('@@')) {
          cls = 'text-blue-600 dark:text-blue-400'
        }
        return (
          <div key={i} className={cls}>
            {line}
          </div>
        )
      })}
    </pre>
  )
}

/** Side-by-side diff for Edit tool old/new strings */
function DetailDiff({ oldValue, newValue }: { oldValue: string; newValue: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground shrink-0 w-20 text-right">Diff:</span>
      <div className="flex-1 min-w-0 overflow-x-auto rounded bg-muted/50 max-h-60 overflow-y-auto [&_table]:!bg-transparent text-[10px]">
        <Suspense
          fallback={
            <pre className="p-1.5 font-mono text-[10px] leading-relaxed">Loading diff...</pre>
          }
        >
          <ReactDiffViewer
            oldValue={oldValue}
            newValue={newValue}
            splitView={false}
            useDarkTheme
            hideLineNumbers
            codeFoldMessageRenderer={() => <span />}
            extraLinesSurroundingDiff={Infinity}
            styles={{
              variables: {
                dark: {
                  diffViewerBackground: 'transparent',
                  addedBackground: 'rgba(34,197,94,0.1)',
                  removedBackground: 'rgba(239,68,68,0.1)',
                  addedColor: '#4ade80',
                  removedColor: '#f87171',
                  wordAddedBackground: 'rgba(34,197,94,0.25)',
                  wordRemovedBackground: 'rgba(239,68,68,0.25)',
                  emptyLineBackground: 'transparent',
                  gutterBackground: 'transparent',
                  codeFoldBackground: 'transparent',
                  codeFoldGutterBackground: 'transparent',
                },
              },
              contentText: { fontSize: '10px', lineHeight: '1.6' },
            }}
          />
        </Suspense>
      </div>
    </div>
  )
}

// ── Thread event (for conversation view) ──────────────────

function ThreadEvent({ event, isCurrentEvent }: { event: EnrichedEvent; isCurrentEvent: boolean }) {
  const Icon = event.icon || getEventIcon(event.subtype, event.toolName)
  const isTool = event.subtype === 'PreToolUse' || event.subtype === 'PostToolUse'
  const isCompleted = event.status === 'completed'
  const rawLabel = event.subtype || event.type
  const displayLabel = LABEL_MAP[rawLabel] || rawLabel
  const summary = (event.summary as string) || getEventSummary(event as any)

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-0.5 rounded text-[11px]',
        isCurrentEvent ? 'bg-primary/10 font-medium' : 'text-muted-foreground',
      )}
    >
      <span className="shrink-0 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="w-14 shrink-0 truncate">{displayLabel}</span>
      {isTool && (
        <span
          className={cn(
            'shrink-0',
            isCompleted
              ? 'text-green-600 dark:text-green-500'
              : 'text-yellow-600 dark:text-yellow-500/70',
          )}
        >
          {isCompleted ? <Check className="h-3 w-3" /> : <Loader className="h-3 w-3" />}
        </span>
      )}
      {isTool && event.toolName && (
        <span className="text-xs font-medium text-blue-700 dark:text-blue-400 shrink-0">
          {event.toolName}
        </span>
      )}
      <span className="truncate flex-1 text-[10px]">{summary}</span>
      <span className="text-[9px] text-muted-foreground/70 dark:text-muted-foreground/50 tabular-nums shrink-0">
        {new Date(event.timestamp).toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </span>
    </div>
  )
}

// ── Result extraction helpers ──────────────────────────────

// Extract a display string from tool_response, handling different formats:
// - Bash: { stdout, stderr }
// - MCP tools: [{ type: 'text', text: '...' }]
// - String: direct text
function extractResult(toolResponse: any): string | null {
  if (!toolResponse) return null
  if (typeof toolResponse === 'string') return toolResponse

  // Bash format: { stdout, stderr }
  if (toolResponse.stdout !== undefined) {
    const parts = []
    if (toolResponse.stdout) parts.push(toolResponse.stdout)
    if (toolResponse.stderr) parts.push(`stderr: ${toolResponse.stderr}`)
    return parts.join('\n') || null
  }

  // MCP format: array of content blocks [{ type: 'text', text: '...' }]
  if (Array.isArray(toolResponse)) {
    const text = toolResponse
      .map((r: any) => {
        if (typeof r === 'string') return r
        if (r?.type === 'text' && r?.text) return r.text
        return JSON.stringify(r)
      })
      .join('\n')
    return text || null
  }

  // Agent/structured format: { content: [{type:'text', text:'...'}], status, ... }
  if (Array.isArray(toolResponse.content)) {
    const text = toolResponse.content
      .map((r: any) => (r?.type === 'text' && r?.text ? r.text : ''))
      .filter(Boolean)
      .join('\n')
    if (text) return text
  }

  // Plain content string
  if (typeof toolResponse.content === 'string') return toolResponse.content

  return JSON.stringify(toolResponse, null, 2)
}

function formatResult(result: any): string {
  if (typeof result === 'string') return result
  return JSON.stringify(result, null, 2)
}
