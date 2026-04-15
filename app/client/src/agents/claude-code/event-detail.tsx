// Claude Code agent class — event detail component.
// Bridges the new EventProps interface to the existing EventDetail rendering.
// The internal rendering will be incrementally migrated to use dataApi directly.

import { useState, lazy, Suspense } from 'react'
import Markdown from 'react-markdown'
import { Copy, Check, Loader, FileText, Code } from 'lucide-react'

const ReactDiffViewer = lazy(() => import('react-diff-viewer-continued'))
import { getAgentDisplayName } from '@/lib/agent-utils'
import { getEventIcon } from './icons'
import { relativePath } from './helpers'
import type { EventProps, EnrichedEvent, FrameworkDataApi } from '../types'
import type { Agent } from '@/types'

// ── Markdown rendering config ──────────────────────────────

const MD_MAX_LENGTH = 50_000

function looksLikeMarkdown(s: string): boolean {
  if (s.length > MD_MAX_LENGTH) return false
  return /(?:^|\n)#{1,3} |\*\*|```|^\s*[-*] /m.test(s)
}

const mdComponents = {
  h1: ({ children, ...props }: any) => (
    <h3 className="text-xs font-bold mt-2 mb-0.5" {...props}>
      {children}
    </h3>
  ),
  h2: ({ children, ...props }: any) => (
    <h3 className="text-xs font-bold mt-2 mb-0.5" {...props}>
      {children}
    </h3>
  ),
  h3: ({ children, ...props }: any) => (
    <h4 className="text-xs font-semibold mt-1.5 mb-0.5" {...props}>
      {children}
    </h4>
  ),
  p: ({ children, ...props }: any) => (
    <p className="mb-1 last:mb-0 text-[11px]" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }: any) => (
    <ul className="list-disc pl-4 mb-1 text-[11px]" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: any) => (
    <ol className="list-decimal pl-4 mb-1 text-[11px]" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }: any) => (
    <li className="mb-0.5" {...props}>
      {children}
    </li>
  ),
  code: ({ children, className, ...props }: any) => {
    const isBlock = className?.includes('language-')
    if (isBlock) {
      return (
        <pre className="overflow-x-auto rounded bg-muted/70 p-1.5 font-mono text-[10px] leading-relaxed my-1">
          <code {...props}>{children}</code>
        </pre>
      )
    }
    return (
      <code className="rounded bg-muted/70 px-1 py-0.5 font-mono text-[10px]" {...props}>
        {children}
      </code>
    )
  },
  a: ({ children, href, ...props }: any) => (
    <a
      className="text-blue-600 dark:text-blue-400 hover:underline"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  blockquote: ({ children, ...props }: any) => (
    <blockquote
      className="border-l-2 border-muted-foreground/30 pl-2 my-1 text-muted-foreground"
      {...props}
    >
      {children}
    </blockquote>
  ),
}

// ── Main component ─────────────────────────────────────────

export function ClaudeCodeEventDetail({ event, dataApi }: EventProps) {
  const payload = event.payload as Record<string, any>

  // Load turn events for thread-style display
  const showThread = ['UserPromptSubmit', 'Stop', 'SubagentStart', 'SubagentStop'].includes(
    event.subtype || '',
  )
  const turnEvents = event.turnId ? dataApi.getTurnEvents(event.turnId) : []

  // Get grouped events (e.g., Pre + Post for tool calls)
  const groupedEvents = event.groupId ? dataApi.getGroupedEvents(event.groupId) : []
  const pairedEvent = groupedEvents.find((e) => e.id !== event.id) ?? null

  // Build agent map for name lookups
  const getAgent = (agentId: string) => dataApi.getAgent(agentId)
  const cwd = (event.cwd as string) || undefined

  return (
    <div className="space-y-1.5 text-xs">
      <EventContent
        event={event}
        paired={pairedEvent}
        turnEvents={turnEvents}
        getAgent={getAgent}
        dataApi={dataApi}
        cwd={cwd}
        payload={payload}
      />

      {/* Thread: conversation history for this turn */}
      {showThread && turnEvents.length > 1 && (
        <div className="mt-2 pt-1 border-t border-border/30">
          <div className="text-[10px] text-muted-foreground mb-1">Conversation thread:</div>
          <div className="space-y-0.5">
            {turnEvents.map((te) => {
              const Icon = te.icon || getEventIcon(te.subtype, te.toolName)
              return (
                <div key={te.id} className="flex items-center gap-1.5 text-[10px]">
                  <Icon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                  <span className="text-muted-foreground/60 shrink-0 w-8">{te.label}</span>
                  {te.displayEventStream && (
                    <span className="text-green-500 shrink-0">✓</span>
                  )}
                  {te.toolName && (
                    <span className="font-medium text-blue-700 dark:text-blue-400 shrink-0">
                      {te.toolName}
                    </span>
                  )}
                  <span className="truncate text-muted-foreground">
                    {(te.summary as string) || ''}
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

// ── Event-type-specific content ────────────────────────────

function EventContent({
  event,
  paired,
  turnEvents,
  getAgent,
  dataApi,
  cwd,
  payload,
}: {
  event: EnrichedEvent
  paired: EnrichedEvent | null
  turnEvents: EnrichedEvent[]
  getAgent: (id: string) => Agent | undefined
  dataApi: FrameworkDataApi
  cwd: string | undefined
  payload: Record<string, any>
}) {
  const ti = payload.tool_input || {}

  // ── Non-tool events ──────────────────────────────────

  if (event.subtype === 'UserPromptSubmit') {
    // Find the Stop event in the turn to show final assistant message
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
    const agent = getAgent(event.agentId)
    const assignedName = agent ? getAgentDisplayName(agent) : null
    return (
      <div className="space-y-1.5">
        <AgentIdentity assignedName={assignedName} rawName={payload.agent_name} agentId={event.agentId} />
        {payload.last_assistant_message && (
          <DetailCode label="Result" value={payload.last_assistant_message} />
        )}
      </div>
    )
  }

  if (event.subtype === 'SubagentStart') {
    const agent = getAgent(event.agentId)
    const assignedName = agent ? getAgentDisplayName(agent) : null
    // Find SubagentStop in turn events for the result
    const stopEvent = turnEvents.find((e) => e.subtype === 'SubagentStop')
    const agentResult = (stopEvent?.payload as any)?.last_assistant_message
    // Find spawn info from parent Agent tool call
    const parentAgentEvents = dataApi.getAgentEvents(event.agentId)
    const spawnEvent = parentAgentEvents.find(
      (e) => e.subtype === 'PreToolUse' && e.toolName === 'Agent',
    )
    const spawnPrompt = (spawnEvent?.payload as any)?.tool_input?.prompt
    const spawnDesc = (spawnEvent?.payload as any)?.tool_input?.description
    return (
      <div className="space-y-1.5">
        <AgentIdentity
          assignedName={assignedName}
          rawName={payload.agent_name}
          agentId={event.agentId}
        />
        {(spawnDesc || payload.description) && (
          <DetailRow label="Task" value={spawnDesc || payload.description} />
        )}
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

  if (event.subtype === 'PostToolUseFailure') {
    const errorMessage = typeof payload.error === 'string' ? payload.error : payload.error?.message
    return (
      <div className="space-y-1.5">
        {event.toolName && <DetailRow label="Tool" value={event.toolName} />}
        {ti.command && <DetailCode label="Command" value={ti.command} />}
        {errorMessage && <DetailCode label="Details" value={errorMessage} />}
      </div>
    )
  }

  if (event.subtype === 'PermissionRequest') {
    const permTi = payload.tool_input || {}
    return (
      <div className="space-y-1.5">
        {payload.tool_name && <DetailRow label="Tool" value={payload.tool_name} />}
        {permTi.command && <DetailCode label="Command" value={permTi.command} />}
        {permTi.file_path && (
          <DetailRow label="File" value={relativePath(permTi.file_path, cwd)} />
        )}
      </div>
    )
  }

  // ── Tool events ──────────────────────────────────────

  if (event.subtype === 'PreToolUse' || event.subtype === 'PostToolUse') {
    const result = paired ? extractResult((paired.payload as any)?.tool_response) : extractResult(payload.tool_response)
    return <ToolContent toolName={event.toolName} ti={ti} result={result} payload={payload} paired={paired} cwd={cwd} getAgent={getAgent} dataApi={dataApi} />
  }

  // ── Default: show basic info ─────────────────────────
  if (typeof payload.error === 'string' && payload.error) {
    return <DetailCode label="Error" value={payload.error} />
  }

  return null
}

// ── Tool-specific content ──────────────────────────────────

function ToolContent({
  toolName,
  ti,
  result,
  payload,
  paired,
  cwd,
  getAgent,
  dataApi,
}: {
  toolName: string | null
  ti: Record<string, any>
  result: string | null
  payload: Record<string, any>
  paired: EnrichedEvent | null
  cwd: string | undefined
  getAgent: (id: string) => Agent | undefined
  dataApi: FrameworkDataApi
}) {
  switch (toolName) {
    case 'Bash':
      return (
        <div className="space-y-1.5">
          {ti.command && <DetailCode label="Command" value={ti.command} />}
          {result && <DetailCode label="Result" value={formatResult(result)} diff={isDiff(result)} />}
        </div>
      )
    case 'Read':
      return (
        <div className="space-y-1.5">
          {ti.file_path && <DetailRow label="File" value={relativePath(ti.file_path, cwd)} />}
          {result && <DetailCode label="Content" value={formatResult(result)} />}
        </div>
      )
    case 'Write':
      return (
        <div className="space-y-1.5">
          {ti.file_path && <DetailRow label="File" value={relativePath(ti.file_path, cwd)} />}
          {result && <DetailCode label="Result" value={formatResult(result)} />}
        </div>
      )
    case 'Edit':
      return (
        <div className="space-y-1.5">
          {ti.file_path && <DetailRow label="File" value={relativePath(ti.file_path, cwd)} />}
          {ti.old_string && <DetailCode label="Old" value={ti.old_string} />}
          {ti.new_string && <DetailCode label="New" value={ti.new_string} />}
          {result && <DetailCode label="Result" value={formatResult(result)} />}
        </div>
      )
    case 'Grep':
    case 'Glob':
      return (
        <div className="space-y-1.5">
          {ti.pattern && <DetailRow label="Pattern" value={ti.pattern} />}
          {ti.path && <DetailRow label="Path" value={relativePath(ti.path, cwd)} />}
          {result && <DetailCode label="Result" value={formatResult(result)} />}
        </div>
      )
    case 'Agent': {
      const spawnedAgentId = payload.tool_response?.agentId as string | undefined
      const spawnedAgent = spawnedAgentId ? getAgent(spawnedAgentId) : undefined
      const agentAssignedName = spawnedAgent ? getAgentDisplayName(spawnedAgent) : null
      const agentResult = extractResult(payload.tool_response)
      return (
        <div className="space-y-1.5">
          <AgentIdentity
            assignedName={agentAssignedName}
            rawName={ti.name}
            agentId={spawnedAgentId}
          />
          {ti.description && <DetailRow label="Task" value={ti.description} />}
          {ti.prompt && <DetailCode label="Prompt" value={ti.prompt} />}
          {agentResult && <DetailCode label="Result" value={agentResult} />}
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

// ── Shared helper components ───────────────────────────────

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground shrink-0 w-20 text-right">{label}:</span>
      <span className="flex-1 min-w-0 truncate font-mono text-[10px]">{value}</span>
    </div>
  )
}

function DetailCode({ label, value, diff }: { label: string; value?: string; diff?: boolean }) {
  if (!value) return null
  const hasDiff = diff ?? false
  const hasMd = !hasDiff && looksLikeMarkdown(value)
  const [showRaw, setShowRaw] = useState(!hasMd && !hasDiff)
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground shrink-0 w-20 text-right">{label}:</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 mb-0.5">
          {(hasMd || hasDiff) && (
            <button
              type="button"
              className="flex items-center gap-1 text-[9px] text-muted-foreground/70 hover:text-muted-foreground transition-colors cursor-pointer"
              onClick={() => setShowRaw(!showRaw)}
            >
              {showRaw ? <Code className="h-2.5 w-2.5" /> : <FileText className="h-2.5 w-2.5" />}
              {showRaw ? 'raw' : hasDiff ? 'diff' : 'markdown'}
            </button>
          )}
          <button
            type="button"
            className="flex items-center gap-1 text-[9px] text-muted-foreground/70 hover:text-muted-foreground transition-colors cursor-pointer ml-auto"
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
        </div>
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

function DiffPre({ value }: { value: string }) {
  const lines = value.split('\n')
  const oldLines: string[] = []
  const newLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue
    if (line.startsWith('-')) {
      oldLines.push(line.slice(1))
    } else if (line.startsWith('+')) {
      newLines.push(line.slice(1))
    } else {
      oldLines.push(line.startsWith(' ') ? line.slice(1) : line)
      newLines.push(line.startsWith(' ') ? line.slice(1) : line)
    }
  }
  return (
    <div className="rounded bg-muted/50 overflow-hidden max-h-40 overflow-y-auto">
      <Suspense fallback={<Loader className="h-3 w-3 animate-spin m-2" />}>
        <ReactDiffViewer
          oldValue={oldLines.join('\n')}
          newValue={newLines.join('\n')}
          splitView={false}
          hideLineNumbers
          styles={{
            variables: {
              dark: {
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
              light: {
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
              contentText: { fontSize: '10px', lineHeight: '1.6' },
            },
          }}
        />
      </Suspense>
    </div>
  )
}

function AgentIdentity({
  assignedName,
  rawName,
  agentId,
}: {
  assignedName?: string | null
  rawName?: string | null
  agentId?: string | null
}) {
  const display = assignedName || rawName
  return (
    <div className="space-y-0.5">
      {display && <DetailRow label="Agent" value={display} />}
      {agentId && <DetailRow label="Agent ID" value={agentId} />}
      {assignedName && rawName && rawName !== assignedName && (
        <DetailRow label="Task" value={rawName} />
      )}
    </div>
  )
}

// ── Result extraction helpers ──────────────────────────────

function extractResult(toolResponse: any): string | null {
  if (!toolResponse) return null
  if (typeof toolResponse === 'string') return toolResponse
  if (toolResponse.stdout !== undefined) {
    const parts = []
    if (toolResponse.stdout) parts.push(toolResponse.stdout)
    if (toolResponse.stderr) parts.push(`stderr: ${toolResponse.stderr}`)
    return parts.join('\n') || null
  }
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
  if (Array.isArray(toolResponse.content)) {
    const text = toolResponse.content
      .map((r: any) => (r?.type === 'text' && r?.text ? r.text : ''))
      .filter(Boolean)
      .join('\n')
    if (text) return text
  }
  if (typeof toolResponse.content === 'string') return toolResponse.content
  return JSON.stringify(toolResponse, null, 2)
}

function formatResult(result: any): string {
  if (typeof result === 'string') return result
  return JSON.stringify(result, null, 2)
}

function isDiff(result: string): boolean {
  const lines = result.split('\n')
  if (lines.length < 3) return false
  let hasPlus = false
  let hasMinus = false
  for (const line of lines.slice(0, 20)) {
    if (line.startsWith('+') && !line.startsWith('+++')) hasPlus = true
    if (line.startsWith('-') && !line.startsWith('---')) hasMinus = true
    if (hasPlus && hasMinus) return true
  }
  return false
}
