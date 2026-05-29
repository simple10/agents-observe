import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type TranscriptStatsData } from '@/lib/api-client'
import { getServerHealth } from '@/lib/server-health'
import { useUIStore } from '@/stores/ui-store'
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/shared/loading-states'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Pencil,
  Trash2,
  Check,
  X,
  ArrowRightLeft,
  Eraser,
  Copy,
  Folder,
  Clock,
  CalendarDays,
  Hash,
  Terminal,
  Shield,
  ExternalLink,
} from 'lucide-react'
import { MoveSessionModal } from './project-modal'
import { CollapsibleSection } from './sections/collapsible-section'
import { TokenUsageSection } from './sections/token-usage-section'
import { useAgents } from '@/hooks/use-agents'
import type { Project, ParsedEvent } from '@/types'

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatAbsoluteTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

function shortenCwd(cwd: string): string {
  return cwd.replace(/^\/(?:Users|home)\/[^/]+/, '~')
}

export function SessionEditModal() {
  const queryClient = useQueryClient()
  const editingSessionId = useUIStore((s) => s.editingSessionId)
  const editingSessionTab = useUIStore((s) => s.editingSessionTab)
  const setEditingSessionId = useUIStore((s) => s.setEditingSessionId)
  const selectedSessionId = useUIStore((s) => s.selectedSessionId)
  const setSelectedSessionId = useUIStore((s) => s.setSelectedSessionId)
  const setSelectedProject = useUIStore((s) => s.setSelectedProject)
  const closeSettings = useUIStore((s) => s.closeSettings)

  const open = editingSessionId !== null

  const { data: session } = useQuery({
    queryKey: ['session', editingSessionId],
    queryFn: () => api.getSession(editingSessionId!),
    enabled: open,
  })

  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [confirmAction, setConfirmAction] = useState<'delete' | 'clear' | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'details' | 'stats' | 'labels'>(editingSessionTab)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Reset local state when modal opens/closes or session changes
  useEffect(() => {
    setIsRenaming(false)
    setRenameValue('')
    setConfirmAction(null)
    setMoveOpen(false)
    setCopiedField(null)
    setActiveTab(editingSessionTab)
  }, [open, editingSessionId, editingSessionTab])

  useEffect(() => {
    if (isRenaming) renameInputRef.current?.focus()
  }, [isRenaming])

  if (!open) return null

  const label = session?.slug || session?.id.slice(0, 8) || ''
  const cwd = typeof session?.metadata?.cwd === 'string' ? session.metadata.cwd : null
  const jsonlPath = session?.transcriptPath || null
  const permissionMode =
    typeof session?.metadata?.permission_mode === 'string'
      ? session.metadata.permission_mode
      : typeof session?.metadata?.permissionMode === 'string'
        ? session.metadata.permissionMode
        : null
  const permFlag = permissionMode ? ` --permission-mode ${permissionMode}` : ''
  const resumeCmd = session ? `claude --resume ${session.id}${permFlag}` : null
  const forkCmd = session ? `claude --fork-session --resume ${session.id}${permFlag}` : null

  function copyToClipboard(field: string, text: string) {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 1500)
  }

  function startRenaming() {
    if (!session) return
    setRenameValue(session.slug || session.id.slice(0, 8))
    setIsRenaming(true)
  }

  async function saveRename() {
    if (!session) return
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === label) {
      setIsRenaming(false)
      return
    }
    await api.updateSessionSlug(session.id, trimmed)
    await queryClient.invalidateQueries({ queryKey: ['session', session.id] })
    await queryClient.invalidateQueries({ queryKey: ['sessions'] })
    await queryClient.invalidateQueries({ queryKey: ['recent-sessions'] })
    await queryClient.invalidateQueries({ queryKey: ['unassigned-sessions'] })
    setIsRenaming(false)
  }

  async function handleDelete() {
    if (!session) return
    setBusy(true)
    try {
      await api.deleteSession(session.id)
      if (selectedSessionId === session.id) setSelectedSessionId(null)
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      await queryClient.invalidateQueries({ queryKey: ['recent-sessions'] })
      // Unassigned sessions live in their own query key; without this
      // invalidate the sidebar's Unassigned bucket keeps the deleted
      // row until the next mount / window focus.
      await queryClient.invalidateQueries({ queryKey: ['unassigned-sessions'] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      setConfirmAction(null)
      setEditingSessionId(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleClearLogs() {
    if (!session) return
    setBusy(true)
    try {
      await api.clearSessionEvents(session.id)
      await queryClient.invalidateQueries({ queryKey: ['events'] })
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      setConfirmAction(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleMoveSession(targetProject: Project) {
    if (!session) return
    setBusy(true)
    try {
      await api.moveSession(session.id, targetProject.id)
      await queryClient.invalidateQueries({ queryKey: ['session', session.id] })
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      await queryClient.invalidateQueries({ queryKey: ['recent-sessions'] })
      // Moving from / to the Unassigned bucket changes its contents.
      await queryClient.invalidateQueries({ queryKey: ['unassigned-sessions'] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      setMoveOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) setEditingSessionId(null)
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="w-[1200px] max-w-[95vw] max-h-[85vh] flex flex-col p-0"
        >
          {/* Header: session name + actions */}
          <div className="flex items-center gap-3 px-5 pt-5 pb-1">
            {isRenaming ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename()
                    if (e.key === 'Escape') setIsRenaming(false)
                  }}
                  className="h-8 text-sm"
                />
                <Button variant="ghost" size="icon-xs" onClick={saveRename}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon-xs" onClick={() => setIsRenaming(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <>
                <DialogTitle
                  className="flex-1 min-w-0 truncate cursor-pointer hover:underline"
                  onClick={startRenaming}
                >
                  {label || 'Loading...'}
                </DialogTitle>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0"
                  onClick={startRenaming}
                  disabled={!session}
                  title="Rename session"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {/* Navigate to the session in the main view. Real anchor
                    so cmd/middle-click opens in a new tab; plain click
                    closes both modals and selects the session in-app. */}
                {session && (
                  <a
                    href={`#/${session.projectSlug ?? ''}/${session.id}`}
                    onClick={(e) => {
                      const isModified =
                        e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
                      if (isModified) return
                      e.preventDefault()
                      if (session.projectSlug) {
                        setSelectedProject(session.projectId, session.projectSlug)
                      }
                      setTimeout(() => setSelectedSessionId(session.id), 0)
                      setEditingSessionId(null)
                      closeSettings()
                    }}
                    className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted text-muted-foreground cursor-pointer"
                    title="Open session (cmd/ctrl-click for new tab)"
                    aria-label="Open session"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                <DialogClose asChild>
                  <Button variant="ghost" size="icon-xs" className="shrink-0" title="Close">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </DialogClose>
              </>
            )}
          </div>

          {/* Status / project line */}
          {session && (
            <div className="px-5 pb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  session.status === 'active'
                    ? 'bg-green-500'
                    : 'bg-muted-foreground/60 dark:bg-muted-foreground/40'
                }`}
              />
              <span>{session.status === 'active' ? 'Active' : 'Ended'}</span>
              {session.projectName && (
                <>
                  <span>·</span>
                  <Folder className="h-3 w-3 shrink-0" />
                  <span className="truncate">{session.projectName}</span>
                </>
              )}
            </div>
          )}

          {/* Tabs */}
          {session && (
            <div className="border-t flex">
              {(['details', 'stats', 'labels'] as const).map((tab) => (
                <button
                  key={tab}
                  className={`flex-1 py-2 text-xs font-medium transition-colors cursor-pointer ${
                    activeTab === tab
                      ? 'text-foreground border-b-2 border-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'details' ? 'Details' : tab === 'stats' ? 'Stats' : 'Labels'}
                </button>
              ))}
            </div>
          )}

          {/* Details tab */}
          {session && activeTab === 'details' && (
            <div className="px-5 py-4 space-y-2.5 text-xs">
              {cwd && (
                <CopyRow
                  icon={<Folder className="h-3.5 w-3.5" />}
                  label="Working dir"
                  value={cwd}
                  display={shortenCwd(cwd)}
                  copied={copiedField === 'cwd'}
                  onCopy={() => copyToClipboard('cwd', cwd)}
                />
              )}
              {permissionMode && (
                <DetailRow icon={<Shield className="h-3.5 w-3.5" />} label="Permissions">
                  <span>{permissionMode}</span>
                </DetailRow>
              )}
              <CopyRow
                icon={<Hash className="h-3.5 w-3.5" />}
                label="Session ID"
                value={session.id}
                copied={copiedField === 'id'}
                onCopy={() => copyToClipboard('id', session.id)}
              />
              {/* Events / agents counts removed — denormalized session
                  fields are gone. Counts can be re-derived via
                  useAgents() if a future phase wants them back. */}
              <DetailRow icon={<CalendarDays className="h-3.5 w-3.5" />} label="Started">
                <span title={formatAbsoluteTime(session.startedAt)}>
                  {formatRelativeTime(session.startedAt)}
                </span>
              </DetailRow>
              {session.lastActivity && (
                <DetailRow icon={<Clock className="h-3.5 w-3.5" />} label="Last activity">
                  <span title={formatAbsoluteTime(session.lastActivity)}>
                    {formatRelativeTime(session.lastActivity)}
                  </span>
                </DetailRow>
              )}
              {jsonlPath && (
                <CopyRow
                  icon={<Copy className="h-3.5 w-3.5" />}
                  label="Transcript"
                  value={jsonlPath}
                  copied={copiedField === 'transcript'}
                  onCopy={() => copyToClipboard('transcript', jsonlPath)}
                />
              )}
              {resumeCmd && (
                <CopyRow
                  icon={<Terminal className="h-3.5 w-3.5" />}
                  label="Resume"
                  value={resumeCmd}
                  copied={copiedField === 'resume'}
                  onCopy={() => copyToClipboard('resume', resumeCmd)}
                  wrap
                />
              )}
              {forkCmd && (
                <CopyRow
                  icon={<Terminal className="h-3.5 w-3.5" />}
                  label="Fork"
                  value={forkCmd}
                  copied={copiedField === 'fork'}
                  onCopy={() => copyToClipboard('fork', forkCmd)}
                  wrap
                />
              )}
              <div className="pt-3 mt-2 border-t flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMoveOpen(true)}
                  disabled={busy}
                >
                  <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
                  Move to project
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmAction('clear')}
                  disabled={busy}
                >
                  <Eraser className="h-3.5 w-3.5 mr-1.5" />
                  Clear logs
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmAction('delete')}
                  disabled={busy}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete session
                </Button>
              </div>
            </div>
          )}

          {/* Stats tab */}
          {session && activeTab === 'stats' && <SessionStats sessionId={session.id} />}

          {/* Labels tab */}
          {session && activeTab === 'labels' && <SessionLabelsTab sessionId={session.id} />}
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog — delete/clear */}
      <AlertDialog open={confirmAction !== null} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === 'delete'
                ? `Delete session "${label}"?`
                : `Clear logs for "${label}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'delete'
                ? 'This will permanently delete this session and its Observe logs. Your original Claude session file is not modified.'
                : 'This will remove all events recorded for this session. Your original Claude session file is not modified.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (confirmAction === 'delete') handleDelete()
                else if (confirmAction === 'clear') handleClearLogs()
              }}
            >
              {busy ? 'Working...' : confirmAction === 'delete' ? 'Delete' : 'Clear'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Move session picker */}
      {session && (
        <MoveSessionModal
          open={moveOpen}
          currentProjectId={session.projectId}
          sessionCount={1}
          onSelect={handleMoveSession}
          onClose={() => setMoveOpen(false)}
        />
      )}
    </>
  )
}

/**
 * Per-subagent stats derived from `PostToolUse:Agent` events. Used as
 * the always-available baseline for the Agents table — augmented (but
 * not replaced) by transcript-stats data when that's available.
 *
 * `inputTokens` here is the **bundled** total (fresh + cache_read +
 * cache_create) to match the convention the transcript-parser uses.
 * Events do not split cache_create into 5m vs 1h — that distinction
 * only exists in the jsonl transcript.
 */
export interface AgentTokenUsage {
  agentId: string
  agentType: string | null
  description: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalDurationMs: number
  toolUseCount: number
}

export interface ToolStat {
  name: string
  count: number
  /** Duration stats from paired PreToolUse → PostToolUse events. null when no completion was captured. */
  minMs: number | null
  medianMs: number | null
  maxMs: number | null
}

interface SessionStatsData {
  duration: string
  totalEvents: number
  toolCalls: number
  subagentsSpawned: number
  userPrompts: number
  gitCommits: number
  permissionRequests: number
  permissionDenials: number
  toolSuccessRate: string
  /** All tools sorted by count desc, with duration stats per tool. */
  tools: ToolStat[]
  longestToolCall: { tool: string; durationMs: number; eventId: number } | null
  filesTouched: number
  filesRead: number
  filesEdited: number
  turns: number
  /** Events-derived prompt count, preserved for the Prompts card's
   *  discrepancy indicator when transcript data overrides userPrompts. */
  userPromptsFromEvents: number
  agentUsage: AgentTokenUsage[]
  totalTokens: { input: number; output: number; cacheRead: number; cacheCreation: number }
  /** Raw session duration in milliseconds (lastTs - firstTs). Used by
   *  the Agents table as the main agent's duration when transcript
   *  parsing isn't available. */
  sessionDurationMs: number
  /** Count of PreToolUse events emitted by the main session agent.
   *  Used as the main agent's tool count in the Agents table. */
  mainAgentToolCount: number
}

function computeStats(events: ParsedEvent[], sessionId: string): SessionStatsData {
  let toolCalls = 0
  let subagentsSpawned = 0
  let userPrompts = 0
  let gitCommits = 0
  let permissionRequests = 0
  let permissionDenials = 0
  let postToolUseCount = 0
  let postToolUseFailureCount = 0
  let turns = 0
  let mainAgentToolCount = 0

  const toolCounts = new Map<string, number>()
  const toolDurations = new Map<string, number[]>()
  const preToolTimestamps = new Map<string, { tool: string; timestamp: number; eventId: number }>()
  let longestToolCall: { tool: string; durationMs: number; eventId: number } | null = null
  const filesSet = new Set<string>()
  const filesReadSet = new Set<string>()
  const filesEditedSet = new Set<string>()

  const firstTs = events.length > 0 ? events[0].timestamp : 0
  const lastTs = events.length > 0 ? events[events.length - 1].timestamp : 0

  for (const e of events) {
    // Per the three-layer contract, the wire ParsedEvent has only
    // hookName + payload. For Claude Code, hookName === legacy subtype.
    const ePayload = e.payload as Record<string, unknown> | undefined
    const eToolName =
      typeof ePayload?.tool_name === 'string' ? (ePayload.tool_name as string) : null
    // Tool calls (deduped — count PreToolUse only)
    if (e.hookName === 'PreToolUse') {
      toolCalls++
      const tool = eToolName || 'unknown'
      toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1)
      // Track the main agent's own tool usage separately. Subagents
      // have their own agentId; the session root id == the main agent.
      if (e.agentId === sessionId) mainAgentToolCount++

      // tool_use_id lives in payload (Claude-Code-specific key) — used
      // to pair Pre/PostToolUse for duration computation.
      const input = e.payload as any
      const toolUseId = typeof input?.tool_use_id === 'string' ? input.tool_use_id : null
      if (toolUseId) {
        preToolTimestamps.set(toolUseId, { tool, timestamp: e.timestamp, eventId: e.id })
      }

      // Track files from tool inputs. Read tool → filesRead; Edit/Write → filesEdited.
      // The generic filesSet keeps backward compat for any callers that still read it.
      if (input?.tool_input) {
        const ti = input.tool_input
        if (typeof ti.file_path === 'string') {
          filesSet.add(ti.file_path)
          if (tool === 'Read') filesReadSet.add(ti.file_path)
          if (tool === 'Edit' || tool === 'Write') filesEditedSet.add(ti.file_path)
        }
        if (typeof ti.path === 'string') filesSet.add(ti.path)
        if (typeof ti.pattern === 'string' && ti.path) filesSet.add(ti.path)
      }
    }

    // Tool completion tracking
    if (e.hookName === 'PostToolUse') {
      postToolUseCount++
      const input = e.payload as any
      const toolUseId = typeof input?.tool_use_id === 'string' ? input.tool_use_id : null
      if (toolUseId) {
        const pre = preToolTimestamps.get(toolUseId)
        if (pre) {
          const duration = e.timestamp - pre.timestamp
          if (!longestToolCall || duration > longestToolCall.durationMs) {
            longestToolCall = { tool: pre.tool, durationMs: duration, eventId: pre.eventId }
          }
          // Track every duration per tool so we can compute min/median/max.
          const arr = toolDurations.get(pre.tool) ?? []
          arr.push(duration)
          toolDurations.set(pre.tool, arr)
        }
      }
    }
    if (e.hookName === 'PostToolUseFailure') postToolUseFailureCount++

    // Subagents
    if (e.hookName === 'SubagentStart') subagentsSpawned++

    // User prompts
    if (e.hookName === 'UserPromptSubmit') userPrompts++

    // Turns (prompt→stop cycles)
    if (e.hookName === 'Stop' || e.hookName === 'SessionEnd') turns++

    // Permissions
    if (e.hookName === 'PermissionRequest') permissionRequests++
    if (e.hookName === 'PermissionDenied') permissionDenials++

    // Git commits
    if (e.hookName === 'PreToolUse' && eToolName === 'Bash') {
      const cmd = (e.payload as any)?.tool_input?.command || ''
      if (/git\s+commit\b/.test(cmd)) gitCommits++
    }
  }

  // Agent token usage from PostToolUse:Agent events
  const agentUsage: AgentTokenUsage[] = []
  const totalTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }

  for (const e of events) {
    const ePayload = e.payload as Record<string, unknown> | undefined
    const eToolName =
      typeof ePayload?.tool_name === 'string' ? (ePayload.tool_name as string) : null
    if (
      (e.hookName === 'PostToolUse' || e.hookName === 'PostToolUseFailure') &&
      eToolName === 'Agent'
    ) {
      const resp = (e.payload as any)?.tool_response
      if (!resp) continue

      const usage = resp.usage
      const input = usage?.input_tokens ?? 0
      const output = usage?.output_tokens ?? 0
      const cacheRead = usage?.cache_read_input_tokens ?? 0
      const cacheCreation = usage?.cache_creation_input_tokens ?? 0

      totalTokens.input += input
      totalTokens.output += output
      totalTokens.cacheRead += cacheRead
      totalTokens.cacheCreation += cacheCreation

      const toolInput = (e.payload as any)?.tool_input
      // Bundled input matches the transcript-parser convention so the
      // events-and-transcripts merge in TokenUsageSection compares like
      // for like.
      const bundledInput = input + cacheRead + cacheCreation
      agentUsage.push({
        agentId: resp.agentId || 'unknown',
        agentType: typeof resp.agentType === 'string' ? resp.agentType : null,
        description: toolInput?.description || resp.agentType || 'Agent',
        inputTokens: bundledInput,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreation,
        totalDurationMs: resp.totalDurationMs ?? 0,
        toolUseCount: resp.totalToolUseCount ?? 0,
      })
    }
  }

  // Sort by duration desc — matches the events-only default sort in
  // the Agents table. Transcripts mode re-sorts by Est Cost on render.
  agentUsage.sort((a, b) => b.totalDurationMs - a.totalDurationMs)

  // Duration
  const durationMs = lastTs - firstTs
  const duration = formatStatsDuration(durationMs)

  // Tool success rate
  const totalCompleted = postToolUseCount + postToolUseFailureCount
  const toolSuccessRate =
    totalCompleted > 0 ? `${Math.round((postToolUseCount / totalCompleted) * 100)}%` : '—'

  // All tools sorted by count desc, with min/median/max durations
  // computed from paired Pre/Post events. Tools with no completion
  // captured have null duration fields.
  function median(sorted: number[]): number {
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
  }
  const tools: ToolStat[] = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => {
      const durs = (toolDurations.get(name) ?? []).slice().sort((a, b) => a - b)
      return {
        name,
        count,
        minMs: durs.length > 0 ? durs[0] : null,
        medianMs: durs.length > 0 ? median(durs) : null,
        maxMs: durs.length > 0 ? durs[durs.length - 1] : null,
      }
    })

  return {
    duration,
    totalEvents: events.length,
    toolCalls,
    subagentsSpawned,
    userPrompts,
    gitCommits,
    permissionRequests,
    permissionDenials,
    toolSuccessRate,
    tools,
    longestToolCall,
    filesTouched: filesSet.size,
    filesRead: filesReadSet.size,
    filesEdited: filesEditedSet.size,
    turns,
    userPromptsFromEvents: userPrompts,
    agentUsage,
    totalTokens,
    sessionDurationMs: durationMs,
    mainAgentToolCount,
  }
}

/**
 * Override events-derived counts with JSONL-authoritative values when
 * a transcript is available. The events-derived `stats` stays as the
 * fallback shape; we only swap the fields the transcript covers.
 *
 * The transcript's `toolStats` is preferred for the All Tools table —
 * it counts pre-plugin tool calls that events would miss. The
 * `longestToolCall` card stays events-derived because clicking it
 * needs an eventId to scroll to; the transcript has only tool_use_ids.
 */
function mergeStatsWithTranscript(
  base: SessionStatsData,
  transcript: TranscriptStatsData,
): SessionStatsData {
  const summary = transcript.summary
  const tools: ToolStat[] = summary.toolStats.length > 0 ? summary.toolStats : base.tools
  return {
    ...base,
    duration: summary.durationMs != null ? formatStatsDuration(summary.durationMs) : base.duration,
    sessionDurationMs: summary.durationMs ?? base.sessionDurationMs,
    toolCalls: summary.toolCalls || base.toolCalls,
    filesRead: summary.filesRead || base.filesRead,
    filesEdited: summary.filesEdited || base.filesEdited,
    gitCommits: summary.gitCommits || base.gitCommits,
    // JSONL-derived count (deduped by uuid, internal injects filtered).
    // Captures pre-plugin prompts on resumed sessions that events miss.
    userPrompts: summary.userPrompts || base.userPrompts,
    tools,
  }
}

/** Compact duration format for the Duration stat card (no seconds when >= 1m). */
function formatStatsDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000)
    const m = Math.round((ms % 3_600_000) / 60_000)
    return `${h}h ${m}m`
  }
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.round((ms % 3_600_000) / 60_000)
  return `${d}d ${h}h ${m}m`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000)
    const s = Math.round((ms % 60_000) / 1000)
    return s === 0 ? `${m}m` : `${m}m ${s}s`
  }
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000)
    const m = Math.round((ms % 3_600_000) / 60_000)
    return m === 0 ? `${h}h` : `${h}h ${m}m`
  }
  // Anything >= 24h: round to the nearest hour and drop minutes for a
  // more compact column display. Carry handles the case where
  // rounding bumps 23h up to a full day.
  const totalHours = Math.round(ms / 3_600_000)
  const d = Math.floor(totalHours / 24)
  const h = totalHours % 24
  return h === 0 ? `${d}d` : `${d}d ${h}h`
}

function SessionStats({ sessionId }: { sessionId: string }) {
  const setEditingSessionId = useUIStore((s) => s.setEditingSessionId)
  const setScrollToEventId = useUIStore((s) => s.setScrollToEventId)

  // Stats is a point-in-time snapshot — no benefit to refetching while
  // the user looks at numbers that won't change on this view. gcTime:0
  // mirrors useEvents' deliberate "drop large payloads as soon as
  // nothing is observing" policy, so closing the Stats tab doesn't
  // hold tens of MB of events in react-query's cache for 5 minutes.
  const { data: events, isLoading } = useQuery({
    queryKey: ['events', sessionId, 'stats'],
    queryFn: () => api.getEvents(sessionId),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })

  const agents = useAgents(sessionId, events)

  // Set of prompt texts the plugin captured a prompt event for. Lets the
  // prompts table render rows without a matching event (pre-plugin prompts
  // on resumed sessions) as muted/non-clickable. UserPromptExpansion
  // covers slash commands (`/cmd args`), whose transcript prompt is the
  // reconstructed command — both event types carry that same text.
  const eventPromptTexts = useMemo(() => {
    const s = new Set<string>()
    if (!events) return s
    for (const e of events) {
      if (e.hookName !== 'UserPromptSubmit' && e.hookName !== 'UserPromptExpansion') continue
      const p = (e.payload as any)?.prompt
      if (typeof p === 'string') s.add(p)
    }
    return s
  }, [events])

  // Transcript stats — same query key as TokenUsageSection so the
  // round-trip is deduped. When the server flag is off (or the
  // transcript file is missing) data is undefined and we render
  // events-only.
  const { data: health } = useQuery({
    queryKey: ['server-health'],
    queryFn: getServerHealth,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  const transcriptStatsEnabled = health?.transcriptStatsEnabled === true
  const { data: transcriptResponse } = useQuery({
    queryKey: ['transcript-stats', sessionId],
    queryFn: () => api.getTranscriptStats(sessionId),
    enabled: transcriptStatsEnabled,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  const transcript = transcriptResponse?.ok ? transcriptResponse.data : null

  const stats = useMemo(() => {
    if (!events) return null
    const base = computeStats(events, sessionId)
    if (!transcript) return base
    // JSONL is authoritative for tool / file / commit counts and
    // overall duration (events miss pre-plugin activity on resumed
    // sessions). Per-tool stats also come from the transcript; the
    // longest-tool card stays events-derived since it needs eventId
    // for navigation.
    return mergeStatsWithTranscript(base, transcript)
  }, [events, sessionId, transcript])

  // Click handlers for agent / prompt rows — close the modal and scroll
  // the event stream to the relevant event. useCallback so stable refs
  // don't bust TokenUsageSection's downstream useMemos every render.
  const scrollToAgent = useCallback(
    (agentId: string) => {
      if (!events) return
      const first = events.find((e) => e.agentId === agentId)
      if (!first) return
      setScrollToEventId(first.id)
      setEditingSessionId(null)
    },
    [events, setScrollToEventId, setEditingSessionId],
  )
  const scrollToPrompt = useCallback(
    (promptText: string, promptTimestamp: number) => {
      if (!events) return
      // Match by prompt text + closest timestamp. Falls back to text-only.
      // Slash commands fire UserPromptExpansion (and usually a sibling
      // UserPromptSubmit); accept either so `/cmd args` rows can scroll.
      const ups = events.filter(
        (e) =>
          (e.hookName === 'UserPromptSubmit' || e.hookName === 'UserPromptExpansion') &&
          (e.payload as any)?.prompt === promptText,
      )
      if (ups.length === 0) return
      const closest = ups.reduce((best, e) =>
        Math.abs(e.timestamp - promptTimestamp) < Math.abs(best.timestamp - promptTimestamp)
          ? e
          : best,
      )
      setScrollToEventId(closest.id)
      setEditingSessionId(null)
    },
    [events, setScrollToEventId, setEditingSessionId],
  )

  if (isLoading || !stats) {
    return (
      <div className="px-5 py-8">
        <Spinner label="Computing stats..." />
      </div>
    )
  }

  // Overview preview: 6 cards. Expanded adds the rest + Permissions.
  const overviewPreview = (
    <div className="grid grid-cols-6 gap-2">
      <StatCard label="Duration" value={stats.duration} />
      <StatCard label="Events" value={stats.totalEvents.toLocaleString()} />
      <StatCard label="Tool Calls" value={stats.toolCalls.toLocaleString()} />
      <StatCard
        label="Prompts"
        value={stats.userPrompts.toLocaleString()}
        secondary={
          stats.userPromptsFromEvents !== stats.userPrompts
            ? `/ ${stats.userPromptsFromEvents.toLocaleString()}`
            : undefined
        }
        tooltip={
          stats.userPromptsFromEvents !== stats.userPrompts ? (
            <div className="space-y-1.5">
              <div>
                <span className="font-medium">{stats.userPrompts.toLocaleString()}</span> prompts
                from the JSONL transcript.
              </div>
              <div>
                <span className="font-medium">{stats.userPromptsFromEvents.toLocaleString()}</span>{' '}
                captured UserPromptSubmit hook events.
              </div>
              <div className="text-muted-foreground">
                The difference can be prompts from other plugins that don't fire UserPromptSubmit,
                or prompts from before observe was capturing on a resumed session.
              </div>
            </div>
          ) : undefined
        }
      />
      <StatCard label="Subagents" value={stats.subagentsSpawned.toLocaleString()} />
      <StatCard label="Success" value={stats.toolSuccessRate} />
    </div>
  )
  const overviewDetails = (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Turns" value={stats.turns.toLocaleString()} />
        <StatCard label="Git Commits" value={stats.gitCommits.toLocaleString()} />
        <StatCard label="Files Read" value={stats.filesRead.toLocaleString()} />
        <StatCard label="Files Edited" value={stats.filesEdited.toLocaleString()} />
      </div>
      {(stats.permissionRequests > 0 || stats.permissionDenials > 0) && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
            Permissions
          </div>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Requests" value={stats.permissionRequests.toLocaleString()} />
            <StatCard label="Denials" value={stats.permissionDenials.toLocaleString()} />
          </div>
        </div>
      )}
    </div>
  )

  // Tool Usage preview: top 6 tools as bar chart + longest tool call.
  const toolUsagePreview = (
    <div className="space-y-2">
      {stats.tools.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
            Top Tools
          </div>
          <div className="space-y-1">
            {stats.tools.slice(0, 6).map(({ name, count }) => {
              const pct = stats.toolCalls > 0 ? (count / stats.toolCalls) * 100 : 0
              return (
                <div key={name} className="flex items-center gap-2">
                  <span className="w-24 truncate text-muted-foreground">{name}</span>
                  <div className="flex-1 h-3 rounded-full bg-muted/50 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/40"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-12 text-right text-muted-foreground/70 font-mono">
                    {count}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {stats.longestToolCall && (
        <div className="text-sm">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mr-2">
            Longest tool call:
          </span>
          <button
            type="button"
            onClick={() => {
              setScrollToEventId(stats.longestToolCall!.eventId)
              setEditingSessionId(null)
            }}
            className="cursor-pointer hover:underline"
          >
            {stats.longestToolCall.tool}
          </button>{' '}
          <span className="text-muted-foreground">
            ({formatDuration(stats.longestToolCall.durationMs)})
          </span>
        </div>
      )}
    </div>
  )
  // Expanded: full table with Graph | Count | Min | Median | Max for
  // every tool used in the session.
  const toolUsageDetails = (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
        All Tools
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b border-border">
            <th className="text-left font-normal py-1.5 px-2 whitespace-nowrap">Tool</th>
            <th className="text-left font-normal py-1.5 px-2 w-2/5 whitespace-nowrap">Graph</th>
            <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">Count</th>
            <th
              className="text-right font-normal py-1.5 px-2 border-l border-border/30 whitespace-nowrap"
              colSpan={3}
            >
              <span className="text-[9px] uppercase tracking-wide">Duration</span>
            </th>
          </tr>
          <tr className="text-muted-foreground/70 border-b border-border">
            <th></th>
            <th></th>
            <th></th>
            <th className="text-right font-normal text-[10px] py-1 px-2 border-l border-border/30">
              Min
            </th>
            <th className="text-right font-normal text-[10px] py-1 px-2">Median</th>
            <th className="text-right font-normal text-[10px] py-1 px-2">Max</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {stats.tools.map((t) => {
            const pct = stats.toolCalls > 0 ? (t.count / stats.toolCalls) * 100 : 0
            return (
              <tr key={t.name} className="border-b border-border/40">
                <td className="py-1 px-2 text-foreground truncate max-w-[140px]">{t.name}</td>
                <td className="py-1 px-2">
                  <div className="h-2.5 rounded-full bg-muted/50 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/40"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </td>
                <td className="py-1 px-2 text-right text-muted-foreground">{t.count}</td>
                <td className="py-1 px-2 text-right text-muted-foreground border-l border-border/30 whitespace-nowrap">
                  {t.minMs == null ? '—' : formatDuration(t.minMs)}
                </td>
                <td className="py-1 px-2 text-right text-muted-foreground whitespace-nowrap">
                  {t.medianMs == null ? '—' : formatDuration(t.medianMs)}
                </td>
                <td className="py-1 px-2 text-right text-muted-foreground whitespace-nowrap">
                  {t.maxMs == null ? '—' : formatDuration(t.maxMs)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="px-5 py-4 text-xs overflow-y-auto max-h-[60vh]">
      <CollapsibleSection title="Overview" preview={overviewPreview} details={overviewDetails} />
      <CollapsibleSection
        title="Tool Usage"
        preview={toolUsagePreview}
        details={toolUsageDetails}
      />
      <TokenUsageSection
        sessionId={sessionId}
        mainAgentId={sessionId}
        agents={agents}
        eventSubagents={stats.agentUsage}
        sessionDurationMs={stats.sessionDurationMs}
        mainAgentToolCount={stats.mainAgentToolCount}
        onAgentClick={scrollToAgent}
        onPromptClick={scrollToPrompt}
        eventPromptTexts={eventPromptTexts}
      />
    </div>
  )
}

function SessionLabelsTab({ sessionId }: { sessionId: string }) {
  const labels = useUIStore((s) => s.labels)
  const labelMemberships = useUIStore((s) => s.labelMemberships)
  const createLabel = useUIStore((s) => s.createLabel)
  const toggleSessionLabel = useUIStore((s) => s.toggleSessionLabel)
  const openLabelsModal = useUIStore((s) => s.openLabelsModal)
  const setEditingSessionId = useUIStore((s) => s.setEditingSessionId)

  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const sortedLabels = useMemo(
    () => [...labels].sort((a, b) => a.name.localeCompare(b.name)),
    [labels],
  )

  const addLabel = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    const lower = trimmed.toLowerCase()
    if (labels.some((l) => l.name.toLowerCase() === lower)) {
      setError('A label with that name already exists')
      return
    }
    const created = createLabel(trimmed)
    if (!created) {
      setError('Could not create label')
      return
    }
    toggleSessionLabel(created.id, sessionId)
    setInput('')
    setError(null)
  }

  return (
    <div className="px-5 py-4 text-xs overflow-y-auto max-h-[50vh]">
      {sortedLabels.length === 0 ? (
        <p className="text-muted-foreground mb-3">No labels yet. Create one below.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {sortedLabels.map((label) => {
            const selected = labelMemberships.get(label.id)?.has(sessionId) ?? false
            return (
              <div key={label.id} className="flex items-stretch rounded-md overflow-hidden border">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleSessionLabel(label.id, sessionId)}
                  className={`px-2 py-1 text-[11px] transition-colors cursor-pointer ${
                    selected
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground hover:bg-accent'
                  }`}
                >
                  {label.name}
                </button>
                <button
                  type="button"
                  aria-label={`Open "${label.name}" in Labels modal`}
                  title="Open in Labels modal"
                  onClick={() => {
                    setEditingSessionId(null)
                    openLabelsModal(label.id)
                  }}
                  className={`px-1.5 flex items-center border-l transition-colors cursor-pointer ${
                    selected
                      ? 'bg-primary/90 text-primary-foreground hover:bg-primary border-primary-foreground/20'
                      : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground border-border'
                  }`}
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addLabel()
            }
          }}
          placeholder="New label name..."
          className="h-8 text-xs"
        />
        <Button variant="outline" size="sm" onClick={addLabel} disabled={!input.trim()}>
          Add
        </Button>
      </div>
      {error && <p className="text-[11px] text-destructive mt-1.5">{error}</p>}
      <p className="text-[10px] text-muted-foreground/70 mt-3">
        Labels are saved in this browser only.
      </p>
    </div>
  )
}

function StatCard({
  label,
  value,
  secondary,
  tooltip,
}: {
  label: string
  value: string
  /** Optional muted suffix rendered after the main value (e.g. "/ 99"). */
  secondary?: string
  /** Radix tooltip content. When provided, the whole card becomes
   *  hoverable + cursor-help. */
  tooltip?: React.ReactNode
}) {
  const body = (
    <div className="rounded-md bg-muted/30 px-3 py-2">
      <div className="text-[10px] text-muted-foreground/70">{label}</div>
      <div className="text-sm font-medium">
        {value}
        {secondary && (
          <span className="ml-1 text-muted-foreground/50 text-[11px] font-normal">{secondary}</span>
        )}
      </div>
    </div>
  )
  if (!tooltip) return body
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-help">{body}</div>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="!bg-popover !text-popover-foreground border border-border max-w-xs p-3 text-xs leading-relaxed shadow-md"
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-muted-foreground/60 shrink-0">{icon}</span>
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <span className="flex-1 min-w-0 truncate">{children}</span>
      {/* spacer to keep alignment with CopyRow */}
      <span className="w-4 shrink-0" />
    </div>
  )
}

function CopyRow({
  icon,
  label,
  value,
  display,
  copied,
  onCopy,
  wrap,
}: {
  icon: React.ReactNode
  label: string
  value: string
  display?: string
  copied: boolean
  onCopy: () => void
  wrap?: boolean
}) {
  return (
    <div
      className="flex items-start gap-2 min-w-0 group/copy cursor-pointer hover:text-foreground transition-colors"
      onClick={onCopy}
      title={copied ? 'Copied!' : 'Click to copy'}
    >
      <span className="text-muted-foreground/60 shrink-0 mt-px">{icon}</span>
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <span
        className={`flex-1 min-w-0 font-mono text-[11px] ${wrap ? 'break-all' : 'truncate'}`}
        title={wrap ? undefined : value}
      >
        {display ?? value}
      </span>
      <span className="shrink-0 w-4 flex items-center justify-center text-muted-foreground/40 group-hover/copy:text-muted-foreground transition-colors mt-px">
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </span>
    </div>
  )
}
