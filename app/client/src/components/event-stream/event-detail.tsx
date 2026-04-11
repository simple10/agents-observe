import { useState, useEffect, lazy, Suspense } from 'react'
import Markdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import { Copy, Check, ChevronDown, ChevronRight, Loader, FileText, Code } from 'lucide-react'

const ReactDiffViewer = lazy(() => import('react-diff-viewer-continued'))
import { api } from '@/lib/api-client'
import { getEventIcon } from '@/config/event-icons'
import { getEventSummary } from '@/lib/event-summary'
import { cn } from '@/lib/utils'
import { getAgentDisplayName } from '@/lib/agent-utils'
import type { ParsedEvent, Agent } from '@/types'
import type { SpawnInfo } from './event-row'
import type { PairedPayloads } from '@/hooks/use-deduped-events'

interface EventDetailProps {
  event: ParsedEvent
  agentMap: Map<string, Agent>
  spawnInfo?: SpawnInfo
  pairedPayloads?: PairedPayloads
}

const THREAD_SUBTYPES = ['UserPromptSubmit', 'Stop', 'SubagentStart', 'SubagentStop']

export function EventDetail({ event, agentMap, spawnInfo, pairedPayloads }: EventDetailProps) {
  const [thread, setThread] = useState<ParsedEvent[] | null>(null)
  const [loadingThread, setLoadingThread] = useState(false)

  const showThread = THREAD_SUBTYPES.includes(event.subtype || '')

  useEffect(() => {
    if (!showThread) return
    setLoadingThread(true)
    api
      .getThread(event.id)
      .then(setThread)
      .catch(() => setThread(null))
      .finally(() => setLoadingThread(false))
  }, [event.id, showThread])

  const p = event.payload as Record<string, any>
  const cwd = p.cwd as string | undefined

  return (
    <div className="px-4 py-2 bg-muted/30 border-t border-border text-xs space-y-2">
      {/* Per-event-type rich detail */}
      <ToolDetail
        event={event}
        payload={p}
        cwd={cwd}
        thread={thread}
        agentMap={agentMap}
        spawnInfo={spawnInfo}
      />

      {/* Error from payload (shown for any event type with an error field) */}
      {typeof p.error === 'string' && p.error && <DetailCode label="Error" value={p.error} />}

      {/* Conversation thread for UserPrompt / Stop / SubagentStop events */}
      {showThread && (
        <div>
          <div className="text-muted-foreground mb-1.5 font-medium">Conversation thread:</div>
          {loadingThread && (
            <div className="text-muted-foreground/80 dark:text-muted-foreground/60 py-2">
              Loading thread...
            </div>
          )}
          {thread && thread.length > 0 && (
            <div className="space-y-0.5 rounded border border-border/50 bg-muted/20 p-1.5">
              {dedupeThread(thread).map((e) => (
                <ThreadEvent key={e.id} event={e} isCurrentEvent={e.id === event.id} />
              ))}
            </div>
          )}
          {thread && thread.length === 0 && (
            <div className="text-muted-foreground/80 dark:text-muted-foreground/60 py-1">
              No thread events found
            </div>
          )}
        </div>
      )}

      {/* Raw payload section(s) — two for merged tool rows, one otherwise */}
      {pairedPayloads ? (
        <>
          <RawPayloadSection
            label={pairedPayloads.pre.subtype}
            timestamp={pairedPayloads.pre.timestamp}
            payload={pairedPayloads.pre.payload}
          />
          {pairedPayloads.post ? (
            <RawPayloadSection
              label={pairedPayloads.post.subtype}
              timestamp={pairedPayloads.post.timestamp}
              payload={pairedPayloads.post.payload}
            />
          ) : (
            <div className="flex items-center gap-1 text-muted-foreground/60">
              <ChevronRight className="h-3 w-3" />
              <span>PostToolUse</span>
              <span className="ml-2 text-[10px] italic">pending</span>
            </div>
          )}
        </>
      ) : (
        <RawPayloadSection label="Raw payload" timestamp={event.timestamp} payload={event.payload} />
      )}
    </div>
  )
}

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
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 ml-1"
          onClick={(e) => {
            e.stopPropagation()
            handleCopy()
          }}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>
      {open && (
        <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed mt-1">
          {payloadStr}
        </pre>
      )}
    </div>
  )
}

// ── Rich per-tool detail ──────────────────────────────────────

function ToolDetail({
  event,
  payload,
  cwd,
  thread,
  agentMap,
  spawnInfo,
}: {
  event: ParsedEvent
  payload: Record<string, any>
  cwd?: string
  thread?: ParsedEvent[] | null
  agentMap: Map<string, Agent>
  spawnInfo?: SpawnInfo
}) {
  const ti = payload.tool_input || {}
  const result = extractResult(payload.tool_response)

  // For non-tool events, show basic info
  if (event.subtype === 'UserPromptSubmit') {
    // Find the Stop event in the thread to get the final assistant message
    const stopEvent = thread?.find((e) => e.subtype === 'Stop' || e.subtype === 'stop_hook_summary')
    const finalMessage = (stopEvent?.payload as any)?.last_assistant_message
    return (
      <div className="space-y-1.5">
        <DetailCode label="Prompt" value={payload.prompt} />
        {finalMessage && <DetailCode label="Result" value={finalMessage} />}
      </div>
    )
  }

  if (event.subtype === 'Stop') {
    // Find the prompt from the thread (if loaded) or payload
    const promptFromThread = thread?.find((e) => e.subtype === 'UserPromptSubmit')
    const promptText = promptFromThread
      ? (promptFromThread.payload as any)?.prompt ||
        (promptFromThread.payload as any)?.message?.content
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
    const subAgent = agentMap.get(event.agentId)
    const assignedName = subAgent ? getAgentDisplayName(subAgent) : null
    const rawName = payload.agent_name as string | undefined
    return (
      <div className="space-y-1.5">
        <AgentIdentity assignedName={assignedName} rawName={rawName} agentId={event.agentId} />
        {spawnInfo?.description && <DetailRow label="Task" value={spawnInfo.description} />}
        {spawnInfo?.prompt && <DetailCode label="Prompt" value={spawnInfo.prompt} />}
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
        // Strip leading status code (e.g. "400 {..." → "{...")
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
    const subAgent = agentMap.get(event.agentId)
    const assignedName = subAgent ? getAgentDisplayName(subAgent) : null
    const rawName = payload.agent_name as string | undefined
    return (
      <div className="space-y-1.5">
        <AgentIdentity assignedName={assignedName} rawName={rawName} agentId={event.agentId} />
        {(spawnInfo?.description || payload.description) && (
          <DetailRow label="Task" value={spawnInfo?.description || payload.description} />
        )}
        {spawnInfo?.prompt && <DetailCode label="Prompt" value={spawnInfo.prompt} />}
      </div>
    )
  }

  if (event.subtype === 'PostToolUseFailure') {
    const ti = payload.tool_input || {}
    return (
      <div className="space-y-1.5">
        {event.toolName && <DetailRow label="Tool" value={event.toolName} />}
        {ti.command && <DetailCode label="Command" value={ti.command} />}
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
    return (
      <div className="space-y-1">
        {payload.description && <DetailRow label="Task" value={payload.description as string} />}
        {payload.task_description && (
          <DetailRow label="Task" value={payload.task_description as string} />
        )}
        {payload.status && <DetailRow label="Status" value={payload.status as string} />}
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
          <DetailRow label="File" value={relPath(payload.file_path as string, cwd)} />
        )}
      </div>
    )
  }

  if (event.subtype === 'ConfigChange') {
    return (
      <div className="space-y-1">
        {payload.file_path && (
          <DetailRow label="File" value={relPath(payload.file_path as string, cwd)} />
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
          <DetailRow label="File" value={relPath(payload.file_path as string, cwd)} />
        )}
      </div>
    )
  }

  if (event.subtype === 'PreCompact' || event.subtype === 'PostCompact') {
    return (
      <div className="space-y-1">
        <DetailRow
          label="Status"
          value={event.subtype === 'PreCompact' ? 'Compacting...' : 'Compacted'}
        />
        {payload.tokens_before && (
          <DetailRow label="Tokens before" value={String(payload.tokens_before)} />
        )}
        {payload.tokens_after && (
          <DetailRow label="Tokens after" value={String(payload.tokens_after)} />
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

  // Tool events
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
      const readResponse = payload.tool_response as Record<string, any> | undefined
      const fileContent = readResponse?.file?.content ?? readResponse?.content
      const fileType = readResponse?.type as string | undefined
      const displayContent = typeof fileContent === 'string' ? fileContent : result
      return (
        <div className="space-y-1.5">
          <DetailRow label="File" value={relPath(ti.file_path, cwd)} />
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
          <DetailRow label="File" value={relPath(ti.file_path, cwd)} />
          {result && <DetailCode label="Result" value={formatResult(result)} />}
        </div>
      )
    case 'Edit':
      return (
        <div className="space-y-1.5">
          <DetailRow label="File" value={relPath(ti.file_path, cwd)} />
          {ti.old_string && ti.new_string ? (
            <DetailDiff oldValue={ti.old_string} newValue={ti.new_string} />
          ) : (
            <>
              {ti.old_string && <DetailCode label="Old" value={ti.old_string} />}
              {ti.new_string && <DetailCode label="New" value={ti.new_string} />}
            </>
          )}
          {result && <DetailCode label="Result" value={formatResult(result)} />}
        </div>
      )
    case 'Grep':
      return (
        <div className="space-y-1.5">
          <DetailRow label="Pattern" value={`/${ti.pattern}/`} />
          {ti.path && <DetailRow label="Path" value={relPath(ti.path, cwd)} />}
          {ti.glob && <DetailRow label="Glob" value={ti.glob} />}
          {result && <DetailCode label="Result" value={formatResult(result)} />}
        </div>
      )
    case 'Glob':
      return (
        <div className="space-y-1.5">
          <DetailRow label="Pattern" value={ti.pattern} />
          {ti.path && <DetailRow label="Path" value={relPath(ti.path, cwd)} />}
          {result && <DetailCode label="Result" value={formatResult(result)} />}
        </div>
      )
    case 'Agent': {
      const spawnedAgentId = payload.tool_response?.agentId as string | undefined
      const spawnedAgent = spawnedAgentId ? agentMap.get(spawnedAgentId) : undefined
      const agentAssignedName = spawnedAgent ? getAgentDisplayName(spawnedAgent) : null
      const agentRawName = ti.name as string | undefined
      return (
        <div className="space-y-1.5">
          <AgentIdentity
            assignedName={agentAssignedName}
            rawName={agentRawName}
            agentId={spawnedAgentId}
          />
          {ti.description && <DetailRow label="Task" value={ti.description} />}
          {ti.prompt && <DetailCode label="Prompt" value={ti.prompt} />}
        </div>
      )
    }
    default:
      return (
        <div className="space-y-1.5">
          {ti.description && <DetailRow label="Description" value={ti.description} />}
          {result && <DetailCode label="Result" value={formatResult(result)} />}
        </div>
      )
  }
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

/** Heuristic: does the text contain enough markdown signals to render? */
function looksLikeMarkdown(s: string): boolean {
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

function DetailCode({ label, value, diff }: { label: string; value?: string; diff?: boolean }) {
  if (!value) return null
  const hasDiff = diff ?? false
  const hasMd = !hasDiff && looksLikeMarkdown(value)
  const [showRaw, setShowRaw] = useState(!hasMd && !hasDiff)

  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground shrink-0 w-20 text-right">{label}:</span>
      <div className="flex-1 min-w-0">
        {(hasMd || hasDiff) && (
          <button
            type="button"
            className="flex items-center gap-1 text-[9px] text-muted-foreground/70 hover:text-muted-foreground mb-0.5 transition-colors"
            onClick={() => setShowRaw(!showRaw)}
          >
            {showRaw ? <Code className="h-2.5 w-2.5" /> : <FileText className="h-2.5 w-2.5" />}
            {showRaw ? 'raw' : hasDiff ? 'diff' : 'markdown'}
          </button>
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
  )
}

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

function relPath(fp: string | undefined, cwd: string | undefined): string {
  if (!fp) return ''
  if (cwd && fp.startsWith(cwd)) {
    const rel = fp.slice(cwd.length)
    return rel.startsWith('/') ? rel.slice(1) : rel
  }
  return fp
}

// ── Thread deduplication ──────────────────────────────────

// Merge PostToolUse into PreToolUse by toolUseId (same as main stream).
// Only show PreToolUse if there's no matching PostToolUse (failed tool).
function dedupeThread(events: ParsedEvent[]): ParsedEvent[] {
  const result: ParsedEvent[] = []
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

// ── Thread event (for conversation view) ──────────────────

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

function ThreadEvent({ event, isCurrentEvent }: { event: ParsedEvent; isCurrentEvent: boolean }) {
  const Icon = getEventIcon(event.subtype, event.toolName)
  const isTool = event.subtype === 'PreToolUse' || event.subtype === 'PostToolUse'
  const isCompleted = event.status === 'completed'
  const rawLabel = event.subtype || event.type
  const displayLabel = LABEL_MAP[rawLabel] || rawLabel
  const summary = getEventSummary(event)

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
