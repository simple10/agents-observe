import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useUIStore } from '@/stores/ui-store'
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
} from 'lucide-react'
import { MoveSessionModal } from './project-modal'
import type { Project } from '@/types'

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
  const [copied, setCopied] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Reset local state when modal opens/closes or session changes
  useEffect(() => {
    setIsRenaming(false)
    setRenameValue('')
    setConfirmAction(null)
    setMoveOpen(false)
    setCopied(false)
  }, [open, editingSessionId])

  useEffect(() => {
    if (isRenaming) renameInputRef.current?.focus()
  }, [isRenaming])

  if (!open) return null

  const label = session?.slug || session?.id.slice(0, 8) || ''
  const cwd = typeof session?.metadata?.cwd === 'string' ? session.metadata.cwd : null
  const jsonlPath = session?.transcriptPath || null

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

          {/* Details */}
          {session && (
            <div className="border-t px-5 py-4 space-y-2.5 text-xs">
              {cwd && (
                <DetailRow icon={<Folder className="h-3.5 w-3.5" />} label="Working dir">
                  <span className="truncate font-mono text-[11px]" title={cwd}>
                    {shortenCwd(cwd)}
                  </span>
                </DetailRow>
              )}
              <DetailRow icon={<Hash className="h-3.5 w-3.5" />} label="Session ID">
                <span className="truncate font-mono text-[11px]" title={session.id}>
                  {session.id}
                </span>
              </DetailRow>
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
                <DetailRow icon={<Copy className="h-3.5 w-3.5" />} label="Transcript">
                  <button
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground cursor-pointer min-w-0"
                    onClick={() => {
                      navigator.clipboard.writeText(jsonlPath)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    }}
                    title={copied ? 'Copied!' : 'Copy path'}
                  >
                    <span className="truncate font-mono text-[11px]">{jsonlPath}</span>
                    {copied ? (
                      <Check className="h-3 w-3 shrink-0 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3 shrink-0" />
                    )}
                  </button>
                </DetailRow>
              )}
            </div>
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
    </div>
  )
}
