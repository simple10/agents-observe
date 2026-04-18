import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Pin, Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AgentClassIcon, agentClassDisplayName } from '@/components/shared/agent-class-icon'
import type { Session } from '@/types'

interface SessionItemProps {
  session: Session
  isSelected: boolean
  isPinned: boolean
  onSelect: () => void
  onTogglePin: () => void
  onRename: (id: string, name: string) => Promise<void>
  /** Click handler for the pencil/edit icon. Defaults to inline rename. */
  onEdit?: () => void
  eventCountOverride?: number
  relativeTime?: string
  cwd?: string | null
  /** Show the cwd line below the session name. Defaults to true. */
  showCwd?: boolean
}

function shortenCwd(cwd: string): string {
  return cwd.replace(/^\/(?:Users|home)\/[^/]+/, '~')
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function SessionItem({
  session,
  isSelected,
  isPinned,
  onSelect,
  onTogglePin,
  onRename,
  onEdit,
  eventCountOverride,
  relativeTime,
  cwd,
  showCwd = true,
}: SessionItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const label = session.slug || session.id.slice(0, 8)

  const startEditing = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setIsEditing(true)
      setEditValue(label)
    },
    [label],
  )

  const cancelEditing = useCallback(() => {
    setIsEditing(false)
    setEditValue('')
  }, [])

  const saveSlug = useCallback(async () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== label) {
      await onRename(session.id, trimmed)
    }
    setIsEditing(false)
    setEditValue('')
  }, [editValue, label, session.id, onRename])

  const statusLabel = session.status === 'active' ? 'Active' : 'Ended'
  const eventCount = eventCountOverride ?? session.eventCount
  const lastActivityTs = session.lastActivity ?? session.startedAt

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            'group rounded-md px-2 py-1 transition-colors cursor-pointer',
            isSelected
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
          onClick={() => !isEditing && onSelect()}
        >
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className="relative h-3 w-3 shrink-0 flex items-center justify-center"
              onClick={(e) => {
                e.stopPropagation()
                onTogglePin()
              }}
            >
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  isPinned ? 'hidden' : 'group-hover:hidden',
                  session.status === 'active'
                    ? 'bg-green-500'
                    : 'bg-muted-foreground/60 dark:bg-muted-foreground/40',
                )}
              />
              <Pin
                fill={isPinned ? 'currentColor' : 'none'}
                className={cn(
                  'h-3 w-3 absolute inset-0 cursor-pointer transition-opacity',
                  isPinned
                    ? session.status === 'active'
                      ? 'opacity-80 text-green-500 hover:fill-none'
                      : 'opacity-60 text-primary hover:fill-none'
                    : 'opacity-0 group-hover:opacity-100',
                  !isPinned &&
                    (session.status === 'active'
                      ? 'text-green-500/60 hover:text-green-500'
                      : 'text-muted-foreground/50 hover:text-muted-foreground'),
                )}
              />
            </span>
            {isEditing ? (
              <input
                ref={inputRef}
                className="truncate bg-transparent border border-border rounded px-0.5 text-xs outline-none w-full min-w-0"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    saveSlug()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelEditing()
                  }
                }}
                onBlur={() => saveSlug()}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="truncate"
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  startEditing(e)
                }}
              >
                {label}
              </span>
            )}
            {!isEditing && relativeTime && (
              <span className="text-[10px] text-muted-foreground/60 dark:text-muted-foreground/40 ml-auto shrink-0 hidden @[275px]:inline group-hover:!hidden">
                {relativeTime}
              </span>
            )}
            {!isEditing && eventCount != null && (
              <Badge
                variant="outline"
                className={cn(
                  'text-[9px] h-3.5 px-1 shrink-0 hidden @[200px]:inline-flex group-hover:!hidden',
                  'text-muted-foreground/60',
                  relativeTime ? 'ml-auto @[275px]:ml-0' : 'ml-auto',
                )}
              >
                {eventCount}
              </Badge>
            )}
            {!isEditing && (
              <Pencil
                data-testid={`edit-session-${session.id}`}
                className="h-3 w-3 shrink-0 ml-auto hidden group-hover:block text-muted-foreground/50 hover:text-muted-foreground transition-opacity cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  if (onEdit) {
                    onEdit()
                  } else {
                    startEditing(e)
                  }
                }}
              />
            )}
          </div>
          {cwd && showCwd && (
            <div
              className="pl-[18px] pb-0.5 text-[10px] text-muted-foreground/30 dark:text-muted-foreground/20 group-hover:text-muted-foreground/70 dark:group-hover:text-muted-foreground/50 transition-colors truncate"
              dir="rtl"
            >
              <span dir="ltr">{shortenCwd(cwd)}</span>
            </div>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs space-y-0.5 max-w-xs">
        <div className="truncate font-medium">{label}</div>
        {cwd && <div className="truncate">{shortenCwd(cwd)}</div>}
        {session.agentClasses.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap opacity-80">
            <span>Agents:</span>
            {session.agentClasses.map((cls, i) => (
              <span key={cls} className="flex items-center gap-0.5">
                <AgentClassIcon agentClass={cls} />
                <span>
                  {agentClassDisplayName(cls)}
                  {i < session.agentClasses.length - 1 ? ',' : ''}
                </span>
              </span>
            ))}
          </div>
        )}
        <div className="opacity-80">
          {statusLabel}: {formatRelativeTime(lastActivityTs)} - Created:{' '}
          {formatRelativeTime(session.startedAt)}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
