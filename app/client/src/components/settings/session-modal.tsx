import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useUIStore } from '@/stores/ui-store'
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog'
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
  Activity,
  Clock,
  CalendarDays,
  Hash,
  Terminal,
  Shield,
} from 'lucide-react'
import { MoveSessionModal } from './project-modal'
import { AgentLabel } from '@/components/shared/agent-label'
import { buildAgentColorMap, getAgentColorById } from '@/lib/agent-utils'
import { useAgents } from '@/hooks/use-agents'
import { TooltipProvider } from '@/components/ui/tooltip'
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
  const [activeTab, setActiveTab] = useState<'details' | 'stats'>(editingSessionTab)
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
  const resumeCmd = session
    ? `claude --resume ${session.id}${permissionMode ? ` --permission-mode ${permissionMode}` : ''}`
    : null

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
    await queryClient.invalidateQueries({ queryKey: ['recentSessions'] })
    setIsRenaming(false)
  }

  async function handleDelete() {
    if (!session) return
    setBusy(true)
    try {
      await api.deleteSession(session.id)
      if (selectedSessionId === session.id) setSelectedSessionId(null)
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      await queryClient.invalidateQueries({ queryKey: ['recentSessions'] })
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
      await queryClient.invalidateQueries({ queryKey: ['recentSessions'] })
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
          className="w-[560px] max-w-[90vw] max-h-[80vh] flex flex-col p-0"
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
              {(['details', 'stats'] as const).map((tab) => (
                <button
                  key={tab}
                  className={`flex-1 py-2 text-xs font-medium transition-colors cursor-pointer ${
                    activeTab === tab
                      ? 'text-foreground border-b-2 border-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'details' ? 'Details' : 'Stats'}
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
              {session.eventCount != null && (
                <DetailRow icon={<Activity className="h-3.5 w-3.5" />} label="Events">
                  <span>
                    {session.eventCount}
                    {session.agentCount != null && (
                      <span className="text-muted-foreground/70">
                        {' '}
                        · {session.agentCount} agents
                      </span>
                    )}
                  </span>
                </DetailRow>
              )}
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
            </div>
          )}

          {/* Stats tab */}
          {session && activeTab === 'stats' && (
            <SessionStats sessionId={session.id} />
          )}

          {/* Action buttons */}
          {session && (
            <div className="border-t px-5 py-3 flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setMoveOpen(true)} disabled={busy}>
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
          )}
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

interface AgentTokenUsage {
  agentId: string
  description: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  totalDurationMs: number
  toolUseCount: number
  toolStats: {
    readCount: number
    editFileCount: number
    bashCount: number
    searchCount: number
    linesAdded: number
    linesRemoved: number
  } | null
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
  topTools: { name: string; count: number }[]
  longestToolCall: { tool: string; durationMs: number } | null
  filesTouched: number
  turns: number
  agentUsage: AgentTokenUsage[]
  totalTokens: { input: number; output: number; cacheRead: number; cacheCreation: number }
}

function computeStats(events: ParsedEvent[]): SessionStatsData {
  let toolCalls = 0
  let subagentsSpawned = 0
  let userPrompts = 0
  let gitCommits = 0
  let permissionRequests = 0
  let permissionDenials = 0
  let postToolUseCount = 0
  let postToolUseFailureCount = 0
  let turns = 0

  const toolCounts = new Map<string, number>()
  const preToolTimestamps = new Map<string, { tool: string; timestamp: number }>()
  let longestToolCall: { tool: string; durationMs: number } | null = null
  const filesSet = new Set<string>()

  const firstTs = events.length > 0 ? events[0].timestamp : 0
  const lastTs = events.length > 0 ? events[events.length - 1].timestamp : 0

  for (const e of events) {
    // Tool calls (deduped — count PreToolUse only)
    if (e.subtype === 'PreToolUse') {
      toolCalls++
      const tool = e.toolName || 'unknown'
      toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1)

      if (e.toolUseId) {
        preToolTimestamps.set(e.toolUseId, { tool, timestamp: e.timestamp })
      }

      // Track files from tool inputs
      const input = e.payload as any
      if (input?.tool_input) {
        const ti = input.tool_input
        if (typeof ti.file_path === 'string') filesSet.add(ti.file_path)
        if (typeof ti.path === 'string') filesSet.add(ti.path)
        if (typeof ti.pattern === 'string' && ti.path) filesSet.add(ti.path)
      }
    }

    // Tool completion tracking
    if (e.subtype === 'PostToolUse') {
      postToolUseCount++
      if (e.toolUseId) {
        const pre = preToolTimestamps.get(e.toolUseId)
        if (pre) {
          const duration = e.timestamp - pre.timestamp
          if (!longestToolCall || duration > longestToolCall.durationMs) {
            longestToolCall = { tool: pre.tool, durationMs: duration }
          }
        }
      }
    }
    if (e.subtype === 'PostToolUseFailure') postToolUseFailureCount++

    // Subagents
    if (e.subtype === 'SubagentStart') subagentsSpawned++

    // User prompts
    if (e.subtype === 'UserPromptSubmit') userPrompts++

    // Turns (prompt→stop cycles)
    if (e.subtype === 'Stop' || e.subtype === 'SessionEnd') turns++

    // Permissions
    if (e.subtype === 'PermissionRequest') permissionRequests++
    if (e.subtype === 'PermissionDenied') permissionDenials++

    // Git commits
    if (e.subtype === 'PreToolUse' && e.toolName === 'Bash') {
      const cmd = (e.payload as any)?.tool_input?.command || ''
      if (/git\s+commit\b/.test(cmd)) gitCommits++
    }
  }

  // Agent token usage from PostToolUse:Agent events
  const agentUsage: AgentTokenUsage[] = []
  const totalTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }

  for (const e of events) {
    if ((e.subtype === 'PostToolUse' || e.subtype === 'PostToolUseFailure') && e.toolName === 'Agent') {
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
      agentUsage.push({
        agentId: resp.agentId || 'unknown',
        description: toolInput?.description || resp.agentType || 'Agent',
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreation,
        totalTokens: resp.totalTokens ?? input + output,
        totalDurationMs: resp.totalDurationMs ?? 0,
        toolUseCount: resp.totalToolUseCount ?? 0,
        toolStats: resp.toolStats
          ? {
              readCount: resp.toolStats.readCount ?? 0,
              editFileCount: resp.toolStats.editFileCount ?? 0,
              bashCount: resp.toolStats.bashCount ?? 0,
              searchCount: resp.toolStats.searchCount ?? 0,
              linesAdded: resp.toolStats.linesAdded ?? 0,
              linesRemoved: resp.toolStats.linesRemoved ?? 0,
            }
          : null,
      })
    }
  }

  // Sort agents by total tokens descending
  agentUsage.sort((a, b) => b.totalTokens - a.totalTokens)

  // Duration
  const durationMs = lastTs - firstTs
  let duration: string
  if (durationMs < 60_000) duration = `${Math.round(durationMs / 1000)}s`
  else if (durationMs < 3_600_000) duration = `${Math.round(durationMs / 60_000)}m`
  else {
    const h = Math.floor(durationMs / 3_600_000)
    const m = Math.round((durationMs % 3_600_000) / 60_000)
    duration = `${h}h ${m}m`
  }

  // Tool success rate
  const totalCompleted = postToolUseCount + postToolUseFailureCount
  const toolSuccessRate =
    totalCompleted > 0
      ? `${Math.round((postToolUseCount / totalCompleted) * 100)}%`
      : '—'

  // Top tools sorted by count
  const topTools = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }))

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
    topTools,
    longestToolCall,
    filesTouched: filesSet.size,
    turns,
    agentUsage,
    totalTokens,
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60_000)}m`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function SessionStats({ sessionId }: { sessionId: string }) {
  const setEditingSessionId = useUIStore((s) => s.setEditingSessionId)
  const setScrollToEventId = useUIStore((s) => s.setScrollToEventId)

  const { data: events, isLoading } = useQuery({
    queryKey: ['events', sessionId, 'stats'],
    queryFn: () => api.getEvents(sessionId),
    staleTime: 0,
  })

  const agents = useAgents(sessionId, events)
  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])

  const stats = useMemo(() => (events ? computeStats(events) : null), [events])

  // Find first event for an agent (for scroll-to on click)
  const scrollToAgent = (agentId: string) => {
    if (!events) return
    const first = events.find((e) => e.agentId === agentId)
    if (first) {
      setScrollToEventId(first.id)
      setEditingSessionId(null) // close modal
    }
  }

  if (isLoading || !stats) {
    return (
      <div className="px-5 py-8">
        <Spinner label="Computing stats..." />
      </div>
    )
  }

  return (
    <div className="px-5 py-4 space-y-4 text-xs overflow-y-auto max-h-[50vh]">
      {/* Overview grid */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Duration" value={stats.duration} />
        <StatCard label="Events" value={stats.totalEvents.toLocaleString()} />
        <StatCard label="Tool Calls" value={stats.toolCalls.toLocaleString()} />
        <StatCard label="User Prompts" value={stats.userPrompts.toLocaleString()} />
        <StatCard label="Turns" value={stats.turns.toLocaleString()} />
        <StatCard label="Subagents" value={stats.subagentsSpawned.toLocaleString()} />
        <StatCard label="Git Commits" value={stats.gitCommits.toLocaleString()} />
        <StatCard label="Files Touched" value={stats.filesTouched.toLocaleString()} />
        <StatCard label="Success Rate" value={stats.toolSuccessRate} />
      </div>

      {/* Permissions */}
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

      {/* Top tools */}
      {stats.topTools.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
            Top Tools
          </div>
          <div className="space-y-1">
            {stats.topTools.map(({ name, count }) => {
              const pct = stats.toolCalls > 0 ? (count / stats.toolCalls) * 100 : 0
              return (
                <div key={name} className="flex items-center gap-2">
                  <span className="w-20 truncate text-muted-foreground">{name}</span>
                  <div className="flex-1 h-3 rounded-full bg-muted/50 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/40"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-muted-foreground/70">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Longest tool call */}
      {stats.longestToolCall && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
            Longest Tool Call
          </div>
          <div className="text-sm">
            {stats.longestToolCall.tool}{' '}
            <span className="text-muted-foreground">
              ({formatDuration(stats.longestToolCall.durationMs)})
            </span>
          </div>
        </div>
      )}

      {/* Token usage */}
      {(stats.totalTokens.input > 0 || stats.totalTokens.output > 0) && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
            Token Usage (Subagents)
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <StatCard
              label="Total Input"
              value={formatTokens(
                stats.totalTokens.input + stats.totalTokens.cacheRead + stats.totalTokens.cacheCreation,
              )}
            />
            <StatCard label="Total Output" value={formatTokens(stats.totalTokens.output)} />
            <StatCard
              label="Cache Hit Rate"
              value={
                stats.totalTokens.input + stats.totalTokens.cacheRead + stats.totalTokens.cacheCreation > 0
                  ? `${Math.round(
                      (stats.totalTokens.cacheRead /
                        (stats.totalTokens.input +
                          stats.totalTokens.cacheRead +
                          stats.totalTokens.cacheCreation)) *
                        100,
                    )}%`
                  : '—'
              }
            />
          </div>
          {stats.agentUsage.length > 0 && (
            <TooltipProvider>
            <div className="rounded-md border border-border/50 overflow-hidden">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="bg-muted/30 text-muted-foreground">
                    <th className="text-left px-2 py-1.5 font-medium">Agent</th>
                    <th className="text-right px-2 py-1.5 font-medium">Input</th>
                    <th className="text-right px-2 py-1.5 font-medium">Output</th>
                    <th className="text-right px-2 py-1.5 font-medium">Cache Hit</th>
                    <th className="text-right px-2 py-1.5 font-medium">Tools</th>
                    <th className="text-right px-2 py-1.5 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.agentUsage.map((agent) => {
                    const totalInput =
                      agent.inputTokens + agent.cacheReadTokens + agent.cacheCreationTokens
                    const cacheHitPct =
                      totalInput > 0
                        ? `${Math.round((agent.cacheReadTokens / totalInput) * 100)}%`
                        : '—'
                    const agentObj = agents.find((a) => a.id === agent.agentId)
                    const parentAgent = agentObj?.parentAgentId
                      ? agents.find((a) => a.id === agentObj.parentAgentId)
                      : null
                    const color = getAgentColorById(agent.agentId, agentColorMap)
                    return (
                      <tr key={agent.agentId} className="border-t border-border/30">
                        <td className="px-2 py-1.5 truncate max-w-[200px]">
                          {agentObj ? (
                            <button
                              className={`truncate cursor-pointer hover:underline ${color.textOnly}`}
                              onClick={() => scrollToAgent(agent.agentId)}
                            >
                              <AgentLabel agent={agentObj} parentAgent={parentAgent} />
                            </button>
                          ) : (
                            <span className="truncate" title={agent.description}>
                              {agent.description}
                            </span>
                          )}
                        </td>
                        <td className="text-right px-2 py-1.5 text-muted-foreground">
                          {formatTokens(totalInput)}
                        </td>
                        <td className="text-right px-2 py-1.5 text-muted-foreground">
                          {formatTokens(agent.outputTokens)}
                        </td>
                        <td className="text-right px-2 py-1.5 text-muted-foreground">
                          {cacheHitPct}
                        </td>
                        <td className="text-right px-2 py-1.5 text-muted-foreground">
                          {agent.toolUseCount}
                        </td>
                        <td className="text-right px-2 py-1.5 text-muted-foreground">
                          {formatDuration(agent.totalDurationMs)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            </TooltipProvider>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/30 px-3 py-2">
      <div className="text-[10px] text-muted-foreground/70">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
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
