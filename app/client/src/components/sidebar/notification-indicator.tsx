import { useEffect, useRef } from 'react'
import { Bell } from 'lucide-react'
import { create } from 'zustand'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Notification store
//
// Tracks which sessions have a *pending* Notification event (i.e. the agent
// last emitted `subtype: 'Notification'` and hasn't done anything else
// since). Two sources of truth:
//   1. GET /api/notifications on mount — backfills current state.
//   2. WS 'notification' and 'notification_clear' messages — live updates.
//
// User dismissal is purely client-side and persisted to localStorage so the
// bell stays hidden across reloads. Dismissed IDs are trimmed on each fetch
// to any sessions still listed server-side (others have auto-cleared and
// their IDs would just accumulate forever).
// ---------------------------------------------------------------------------

const DISMISSED_KEY = 'agents-observe-notifications-dismissed'
const LAST_SEEN_KEY = 'agents-observe-notifications-last-seen-ts'

function readDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return new Set(parsed.filter((s) => typeof s === 'string'))
  } catch {}
  return new Set()
}
function writeDismissedIds(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]))
  } catch {}
}
function readLastSeenTs(): number {
  const raw = localStorage.getItem(LAST_SEEN_KEY)
  const n = raw ? Number(raw) : 0
  return Number.isFinite(n) && n >= 0 ? n : 0
}
function writeLastSeenTs(ts: number) {
  try {
    localStorage.setItem(LAST_SEEN_KEY, String(ts))
  } catch {}
}

interface PendingEntry {
  sessionId: string
  projectId: number
  ts: number
}

interface NotificationState {
  /** sessionId -> pending entry (most recent ts). */
  pending: Map<string, PendingEntry>
  /** sessionIds the user clicked the bell on; survives reload via localStorage. */
  dismissed: Set<string>
  /** max ts we've either rendered or dismissed; used as the `since` cursor. */
  lastSeenTs: number
  /**
   * Sessions whose own bell is currently rendered inline in the sidebar
   * (visible SessionItem). Lets the project-level indicator suppress
   * itself when every flagged session is already visible to the user.
   */
  visibleBellSessionIds: Set<string>
  /** Replace the pending list (used after a /api/notifications fetch). */
  replacePending: (entries: PendingEntry[]) => void
  /** Mark one session as pending (WS 'notification' message). */
  markPending: (entry: PendingEntry) => void
  /** Clear pending for one session (WS 'notification_clear' message). */
  clearPending: (sessionId: string, ts: number) => void
  /** Dismiss (hide the bell locally) for one session. */
  dismiss: (sessionId: string) => void
  /** Dismiss every flagged session in a given project. */
  dismissMany: (sessionIds: Array<string | null | undefined>) => void
  /** Called by a SessionItem when it renders its bell. */
  announceVisibleBell: (sessionId: string) => void
  /** Called by a SessionItem on unmount / bell hide. */
  unannounceVisibleBell: (sessionId: string) => void
}

const useNotificationStore = create<NotificationState>((set) => ({
  pending: new Map(),
  dismissed: readDismissedIds(),
  lastSeenTs: readLastSeenTs(),
  visibleBellSessionIds: new Set(),

  replacePending: (entries) =>
    set((state) => {
      const pending = new Map<string, PendingEntry>()
      let maxTs = state.lastSeenTs
      for (const e of entries) {
        pending.set(e.sessionId, e)
        if (e.ts > maxTs) maxTs = e.ts
      }
      // GC dismissed — drop IDs that no longer appear server-side (auto-cleared).
      const activeIds = new Set(entries.map((e) => e.sessionId))
      const nextDismissed = new Set<string>()
      for (const id of state.dismissed) {
        if (activeIds.has(id)) nextDismissed.add(id)
      }
      writeDismissedIds(nextDismissed)
      writeLastSeenTs(maxTs)
      return { pending, dismissed: nextDismissed, lastSeenTs: maxTs }
    }),

  markPending: (entry) =>
    set((state) => {
      const pending = new Map(state.pending)
      pending.set(entry.sessionId, entry)
      const lastSeenTs = Math.max(state.lastSeenTs, entry.ts)
      writeLastSeenTs(lastSeenTs)
      return { pending, lastSeenTs }
    }),

  clearPending: (sessionId, ts) =>
    set((state) => {
      if (!state.pending.has(sessionId) && !state.dismissed.has(sessionId)) {
        return { lastSeenTs: Math.max(state.lastSeenTs, ts) }
      }
      const pending = new Map(state.pending)
      pending.delete(sessionId)
      const nextDismissed = new Set(state.dismissed)
      nextDismissed.delete(sessionId)
      writeDismissedIds(nextDismissed)
      const lastSeenTs = Math.max(state.lastSeenTs, ts)
      writeLastSeenTs(lastSeenTs)
      return { pending, dismissed: nextDismissed, lastSeenTs }
    }),

  dismiss: (sessionId) =>
    set((state) => {
      const next = new Set(state.dismissed)
      next.add(sessionId)
      writeDismissedIds(next)
      return { dismissed: next }
    }),

  dismissMany: (ids) =>
    set((state) => {
      const next = new Set(state.dismissed)
      for (const id of ids) {
        if (id) next.add(id)
      }
      writeDismissedIds(next)
      return { dismissed: next }
    }),

  announceVisibleBell: (sessionId) =>
    set((state) => {
      if (state.visibleBellSessionIds.has(sessionId)) return {}
      const next = new Set(state.visibleBellSessionIds)
      next.add(sessionId)
      return { visibleBellSessionIds: next }
    }),

  unannounceVisibleBell: (sessionId) =>
    set((state) => {
      if (!state.visibleBellSessionIds.has(sessionId)) return {}
      const next = new Set(state.visibleBellSessionIds)
      next.delete(sessionId)
      return { visibleBellSessionIds: next }
    }),
}))

// ---------------------------------------------------------------------------
// Public hooks
// ---------------------------------------------------------------------------

/** Does this session have an outstanding (non-dismissed) notification? */
export function useSessionHasNotification(sessionId: string | null | undefined): boolean {
  const enabled = useUIStore((s) => s.notificationsEnabled)
  const isPending = useNotificationStore((s) => (sessionId ? s.pending.has(sessionId) : false))
  const isDismissed = useNotificationStore((s) => (sessionId ? s.dismissed.has(sessionId) : false))
  if (!enabled || !sessionId) return false
  return isPending && !isDismissed
}

/** Do any of the provided sessions have an outstanding notification? */
export function useAnySessionHasNotification(
  sessionIds: Array<string | null | undefined>,
): boolean {
  const enabled = useUIStore((s) => s.notificationsEnabled)
  const pending = useNotificationStore((s) => s.pending)
  const dismissed = useNotificationStore((s) => s.dismissed)
  if (!enabled) return false
  return sessionIds.some((id) => !!id && pending.has(id) && !dismissed.has(id))
}

/**
 * Like {@link useAnySessionHasNotification} but only returns true when
 * the flagged session is NOT currently shown as a visible bell
 * elsewhere in the sidebar (Pinned list or expanded project). Used by
 * the project-level indicator so the folder bell is suppressed when
 * every flagged session already has its own bell on-screen.
 */
export function useAnyHiddenFlaggedSession(sessionIds: Array<string | null | undefined>): boolean {
  const enabled = useUIStore((s) => s.notificationsEnabled)
  const pending = useNotificationStore((s) => s.pending)
  const dismissed = useNotificationStore((s) => s.dismissed)
  const visible = useNotificationStore((s) => s.visibleBellSessionIds)
  if (!enabled) return false
  return sessionIds.some((id) => !!id && pending.has(id) && !dismissed.has(id) && !visible.has(id))
}

/**
 * Project-scoped variant. Returns true when the project has at least
 * one pending+undismissed notification whose session bell isn't already
 * visible inline. Reads directly from the global pending map (each
 * entry carries projectId), so the sidebar doesn't need to fetch the
 * project's session list to decide whether to show the folder bell.
 */
export function useAnyHiddenFlaggedInProject(projectId: number | null | undefined): {
  hasHidden: boolean
  sessionIds: string[]
} {
  const enabled = useUIStore((s) => s.notificationsEnabled)
  const pending = useNotificationStore((s) => s.pending)
  const dismissed = useNotificationStore((s) => s.dismissed)
  const visible = useNotificationStore((s) => s.visibleBellSessionIds)
  if (!enabled || projectId == null) return { hasHidden: false, sessionIds: [] }
  const sessionIds: string[] = []
  let hasHidden = false
  for (const entry of pending.values()) {
    if (entry.projectId !== projectId) continue
    if (dismissed.has(entry.sessionId)) continue
    sessionIds.push(entry.sessionId)
    if (!visible.has(entry.sessionId)) hasHidden = true
  }
  return { hasHidden, sessionIds }
}

/** Project-scoped variant of {@link useAnySessionHasNotification}. */
export function useAnyFlaggedInProject(projectId: number | null | undefined): {
  any: boolean
  sessionIds: string[]
} {
  const enabled = useUIStore((s) => s.notificationsEnabled)
  const pending = useNotificationStore((s) => s.pending)
  const dismissed = useNotificationStore((s) => s.dismissed)
  if (!enabled || projectId == null) return { any: false, sessionIds: [] }
  const sessionIds: string[] = []
  for (const entry of pending.values()) {
    if (entry.projectId !== projectId) continue
    if (dismissed.has(entry.sessionId)) continue
    sessionIds.push(entry.sessionId)
  }
  return { any: sessionIds.length > 0, sessionIds }
}

/**
 * Hook used by SessionItem to announce that its bell is on-screen while
 * rendered. Announces on mount (and when needsAttention flips true),
 * unannounces on unmount / when needsAttention flips false.
 */
export function useAnnounceVisibleBell(sessionId: string | null | undefined, visible: boolean) {
  const announce = useNotificationStore((s) => s.announceVisibleBell)
  const unannounce = useNotificationStore((s) => s.unannounceVisibleBell)
  useEffect(() => {
    if (!sessionId || !visible) return
    announce(sessionId)
    return () => unannounce(sessionId)
  }, [sessionId, visible, announce, unannounce])
}

// ---------------------------------------------------------------------------
// Imperative helpers — used by the bell click handlers.
// ---------------------------------------------------------------------------

export function dismissNotification(sessionId: string) {
  useNotificationStore.getState().dismiss(sessionId)
}
export function dismissNotifications(sessionIds: Array<string | null | undefined>) {
  useNotificationStore.getState().dismissMany(sessionIds)
}

// ---------------------------------------------------------------------------
// Wiring: export the store actions so the WS + fetch bootstrap can feed it.
// Kept in this module so all notification plumbing lives in one file.
// ---------------------------------------------------------------------------

/** Called by the WS handler on 'notification' messages. */
export function pushNotification(entry: PendingEntry) {
  useNotificationStore.getState().markPending(entry)
}
/** Called by the WS handler on 'notification_clear' messages. */
export function clearNotification(sessionId: string, ts: number) {
  useNotificationStore.getState().clearPending(sessionId, ts)
}

/**
 * App-level controller. Mount once (from the root layout) to:
 *   - backfill pending notifications from the server on initial load
 *   - refetch whenever the feature is toggled back on
 *   - auto-dismiss bells for the actively-viewed session (see below)
 *   - keep the browser favicon in sync with the pending state
 * No-ops while the user has alerts disabled.
 */
export function useNotificationsController() {
  const enabled = useUIStore((s) => s.notificationsEnabled)

  // Route the backfill through react-query so StrictMode's double-effect
  // and any future re-mounts don't double-fetch. The cache key is
  // global (no consumer, the side effect lives in onSuccess via the
  // useEffect below).
  const { data } = useQuery({
    queryKey: ['notifications-pending'],
    queryFn: () => api.getPendingNotifications(useNotificationStore.getState().lastSeenTs),
    enabled,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!data) return
    useNotificationStore.getState().replacePending(
      data.map((r) => ({
        sessionId: r.sessionId,
        projectId: r.projectId,
        ts: r.latestNotificationTs,
      })),
    )
  }, [data])

  useActiveSessionAutoDismiss()
  useFaviconAlert()
}

// ---------------------------------------------------------------------------
// Auto-dismiss for the currently-viewed session.
//
// Two rules combined:
//   1. Navigate to a session that already has a pending bell → dismiss
//      immediately (the user is looking at it; no need to keep nagging).
//   2. New notification arrives while the user is already viewing the
//      session → dismiss 5 seconds later, but only while the tab is
//      actually visible. If the tab is backgrounded, hold the bell so
//      the user sees it when they come back.
// ---------------------------------------------------------------------------
const AUTO_DISMISS_MS = 5000

function useActiveSessionAutoDismiss() {
  const enabled = useUIStore((s) => s.notificationsEnabled)
  const selectedSessionId = useUIStore((s) => s.selectedSessionId)
  // We subscribe to the specific ts (not the whole Map) so the effect
  // only re-runs when the active session's notification changes.
  const pendingTs = useNotificationStore((s) =>
    selectedSessionId ? (s.pending.get(selectedSessionId)?.ts ?? null) : null,
  )
  const isDismissed = useNotificationStore((s) =>
    selectedSessionId ? s.dismissed.has(selectedSessionId) : false,
  )
  // Remember the session we were last on so we can detect a real
  // navigation vs. a notification arriving for the current session.
  const prevSessionRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !selectedSessionId || pendingTs === null || isDismissed) {
      prevSessionRef.current = selectedSessionId
      return
    }

    const isNavigation = prevSessionRef.current !== selectedSessionId
    prevSessionRef.current = selectedSessionId

    if (isNavigation) {
      // Rule 1 — user just arrived on a flagged session.
      dismissNotification(selectedSessionId)
      return
    }

    // Rule 2 — notification arrived (or re-arrived) while viewing.
    // Start a 5s dismiss timer gated on tab visibility.
    let timer: ReturnType<typeof setTimeout> | null = null
    const start = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        dismissNotification(selectedSessionId)
      }, AUTO_DISMISS_MS)
    }
    const stop = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, selectedSessionId, pendingTs, isDismissed])
}

// ---------------------------------------------------------------------------
// Favicon alerting. Swaps the tab icon to an animated amber bell
// whenever at least one non-dismissed notification is pending.
// ---------------------------------------------------------------------------
const FAVICON_DEFAULT = '/favicon.svg'
const FAVICON_ALERT = '/favicon-alert.svg'

function useFaviconAlert() {
  const enabled = useUIStore((s) => s.notificationsEnabled)
  const pending = useNotificationStore((s) => s.pending)
  const dismissed = useNotificationStore((s) => s.dismissed)
  const hasAnyAlert = enabled && [...pending.keys()].some((id) => !dismissed.has(id))

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) return
    const next = hasAnyAlert ? FAVICON_ALERT : FAVICON_DEFAULT
    if (link.getAttribute('href') !== next) {
      link.setAttribute('href', next)
    }
  }, [hasAnyAlert])
}

// ---------------------------------------------------------------------------
// Bell UI
// ---------------------------------------------------------------------------

interface NotificationIndicatorProps {
  className?: string
  compact?: boolean
  onClick?: (e: React.MouseEvent) => void
  title?: string
}

export function NotificationIndicator({
  className,
  compact = false,
  onClick,
  title,
}: NotificationIndicatorProps) {
  const size = compact ? 'h-3 w-3' : 'h-3.5 w-3.5'
  const resolvedTitle = title ?? (onClick ? 'Click to dismiss' : 'Waiting for your input')
  const body = (
    <>
      <span
        className={cn(
          'absolute inset-0 rounded-full bg-amber-400/40 dark:bg-amber-300/30 animate-ping',
        )}
      />
      <Bell className={cn(size, 'relative text-amber-500 dark:text-amber-400')} />
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        className={cn(
          'relative inline-flex items-center justify-center shrink-0 cursor-pointer hover:scale-110 transition-transform',
          size,
          className,
        )}
        title={resolvedTitle}
        aria-label={resolvedTitle}
        onClick={onClick}
      >
        {body}
      </button>
    )
  }
  return (
    <span
      className={cn('relative inline-flex items-center justify-center shrink-0', size, className)}
      title={resolvedTitle}
      aria-label={resolvedTitle}
    >
      {body}
    </span>
  )
}
