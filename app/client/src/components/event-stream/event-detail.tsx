import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Copy, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api-client'
import { getEventIcon } from '@/config/event-icons'
import { getEventSummary } from '@/lib/event-summary'
import { cn } from '@/lib/utils'
import type { ParsedEvent } from '@/types'

interface EventDetailProps {
  event: ParsedEvent
}

const THREAD_SUBTYPES = ['UserPromptSubmit', 'Stop', 'SubagentStop']

export function EventDetail({ event }: EventDetailProps) {
  const [copied, setCopied] = useState(false)
  const [showPayload, setShowPayload] = useState(false)
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

  const postPayloadObj = (event as any)._postPayload as Record<string, any> | undefined
  const fullPayload = postPayloadObj
    ? { request: event.payload, response: postPayloadObj }
    : event.payload
  const payloadStr = JSON.stringify(fullPayload, null, 2)

  const handleCopy = () => {
    navigator.clipboard.writeText(payloadStr)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const p = event.payload as Record<string, any>
  const postPayload = (event as any)._postPayload as Record<string, any> | undefined
  const cwd = p.cwd as string | undefined

  return (
    <div className="px-4 py-2 bg-muted/30 border-t border-border text-xs space-y-2">
      {/* Per-event-type rich detail */}
      <ToolDetail event={event} payload={p} postPayload={postPayload} cwd={cwd} />

      {/* Conversation thread for UserPrompt / Stop events */}
      {showThread && (
        <div>
          <div className="text-muted-foreground mb-1.5 font-medium">Conversation thread:</div>
          {loadingThread && <div className="text-muted-foreground/60 py-2">Loading thread...</div>}
          {thread && thread.length > 0 && (
            <div className="space-y-0.5 rounded border border-border/50 bg-muted/20 p-1.5">
              {thread.map((e) => (
                <ThreadEvent key={e.id} event={e} isCurrentEvent={e.id === event.id} />
              ))}
            </div>
          )}
          {thread && thread.length === 0 && (
            <div className="text-muted-foreground/60 py-1">No thread events found</div>
          )}
        </div>
      )}

      {/* Collapsible raw payload */}
      <div>
        <button
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowPayload(!showPayload)}
        >
          {showPayload ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span>Raw payload</span>
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
        </button>
        {showPayload && (
          <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed mt-1">
            {payloadStr}
          </pre>
        )}
      </div>
    </div>
  )
}

// ── Rich per-tool detail ──────────────────────────────────────

function ToolDetail({
  event,
  payload,
  postPayload,
  cwd,
}: {
  event: ParsedEvent
  payload: Record<string, any>
  postPayload?: Record<string, any>
  cwd?: string
}) {
  const ti = payload.tool_input || {}
  const toolResponse = postPayload?.tool_response
  const result = extractResult(toolResponse)

  // For non-tool events, show basic info
  if (event.subtype === 'UserPromptSubmit') {
    return (
      <div className="space-y-1.5">
        <DetailCode label="Prompt" value={payload.prompt} />
      </div>
    )
  }

  if (event.subtype === 'Stop') {
    return (
      <div className="space-y-1.5">
        {payload.last_assistant_message && (
          <DetailCode label="Final" value={stripMarkdown(payload.last_assistant_message)} />
        )}
      </div>
    )
  }

  if (event.subtype === 'SessionStart') {
    return (
      <div className="space-y-1">
        <DetailRow label="Source" value={payload.source || 'new'} />
        {cwd && <DetailRow label="Working dir" value={cwd} />}
      </div>
    )
  }

  // Tool events
  if (event.subtype !== 'PreToolUse' && event.subtype !== 'PostToolUse') return null

  switch (event.toolName) {
    case 'Bash':
      return (
        <div className="space-y-1.5">
          {ti.command && <DetailCode label="Command" value={ti.command} />}
          {result && <DetailCode label="Result" value={formatResult(result)} />}
        </div>
      )
    case 'Read':
      return (
        <div className="space-y-1.5">
          <DetailRow label="File" value={relPath(ti.file_path, cwd)} />
          {ti.offset && (
            <DetailRow
              label="Range"
              value={`line ${ti.offset}${ti.limit ? `, limit ${ti.limit}` : ''}`}
            />
          )}
          {result && <DetailCode label="Content" value={formatResult(result)} />}
        </div>
      )
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
          {ti.old_string && <DetailCode label="Old" value={ti.old_string} />}
          {ti.new_string && <DetailCode label="New" value={ti.new_string} />}
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
    case 'Agent':
      return (
        <div className="space-y-1.5">
          {ti.description && <DetailRow label="Task" value={ti.description} />}
          {ti.prompt && <DetailCode label="Prompt" value={ti.prompt} />}
          {result && <DetailCode label="Result" value={formatResult(result)} />}
        </div>
      )
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

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground shrink-0 w-20 text-right">{label}:</span>
      <span className="truncate">{value}</span>
    </div>
  )
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.*?)\*\*/g, '$1') // **bold** → bold
    .replace(/`([^`]+)`/g, '$1') // `code` → code
    .replace(/^[-*] /gm, '• ') // list items
    .trim()
}

function DetailCode({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground shrink-0 w-20 text-right">{label}:</span>
      <pre className="overflow-x-auto rounded bg-muted/50 p-1.5 font-mono text-[10px] leading-relaxed max-h-40 overflow-y-auto flex-1 min-w-0">
        {value}
      </pre>
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

// ── Thread event (for conversation view) ──────────────────

const LABEL_MAP: Record<string, string> = {
  UserPromptSubmit: 'Prompt',
  PreToolUse: 'Tool',
  PostToolUse: 'Tool',
  stop_hook_summary: 'Stop',
  SubagentStop: 'SubStop',
  SessionStart: 'Session',
}

function ThreadEvent({ event, isCurrentEvent }: { event: ParsedEvent; isCurrentEvent: boolean }) {
  const icon = getEventIcon(event.subtype, event.toolName)
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
      <span className="text-xs shrink-0">{icon}</span>
      <span className="w-14 shrink-0 truncate">{displayLabel}</span>
      {isTool && (
        <span
          className={cn(
            'text-[10px] shrink-0 w-3',
            isCompleted ? 'text-green-500' : 'text-yellow-500/70',
          )}
        >
          {isCompleted ? '✓' : '…'}
        </span>
      )}
      {isTool && event.toolName && (
        <span className="text-xs font-medium text-blue-400 shrink-0">{event.toolName}</span>
      )}
      <span className="truncate flex-1 text-[10px]">{summary}</span>
      <span className="text-[9px] text-muted-foreground/50 tabular-nums shrink-0">
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
