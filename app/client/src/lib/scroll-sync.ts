// Module-level scroll sync between the timeline and event stream in rewind mode.
// Callbacks are stored as refs (not Zustand state) so calling them never triggers
// React re-renders — the sync path is pure DOM.

type SyncSource = 'timeline' | 'event-stream'

let timelineScrollTo: ((timestamp: number) => void) | null = null
let eventStreamScrollTo: ((eventId: number) => void) | null = null
let syncSource: SyncSource | null = null
let syncRafId: number | null = null

export function registerTimelineScroll(fn: ((timestamp: number) => void) | null) {
  timelineScrollTo = fn
}

export function registerEventStreamScroll(fn: ((eventId: number) => void) | null) {
  eventStreamScrollTo = fn
}

export function getTimelineScrollTo() {
  return timelineScrollTo
}

export function getEventStreamScrollTo() {
  return eventStreamScrollTo
}

/**
 * Run a sync operation as the given source. If the other source is currently
 * driving, this call is ignored (prevents feedback loops). The lock clears on
 * the next animation frame.
 */
export function withSyncLock(source: SyncSource, fn: () => void) {
  if (syncSource && syncSource !== source) return
  syncSource = source
  fn()
  if (syncRafId !== null) cancelAnimationFrame(syncRafId)
  syncRafId = requestAnimationFrame(() => {
    syncSource = null
    syncRafId = null
  })
}
