// Runtime derivation for Claude Code events.
//
// Works for three kinds of "paired" events:
// - groupId-paired Pre/Post tool or compact events (pairedEvent is set)
// - UserPromptSubmit turns, ending at Stop / stop_hook_summary
// - SubagentStart turns, ending at SubagentStop

import type { EnrichedEvent } from '../types'

/** Derive runtime for an event by finding its matching end event.
 *  Returns null when no end is known yet (e.g. in-flight tool, unfinished turn). */
export function computeRuntimeMs(
  event: EnrichedEvent,
  pairedEvent: EnrichedEvent | null,
  turnEvents: EnrichedEvent[],
): number | null {
  if (pairedEvent) return Math.abs(pairedEvent.timestamp - event.timestamp)
  if (event.hookName === 'UserPromptSubmit') {
    const end = turnEvents.find((e) => e.hookName === 'Stop' || e.hookName === 'stop_hook_summary')
    if (end) return Math.abs(end.timestamp - event.timestamp)
  }
  if (event.hookName === 'SubagentStart') {
    const end = turnEvents.find((e) => e.hookName === 'SubagentStop')
    if (end) return Math.abs(end.timestamp - event.timestamp)
  }
  if (event.hookName === 'Stop' || event.hookName === 'stop_hook_summary') {
    const start = turnEvents.find((e) => e.hookName === 'UserPromptSubmit')
    if (start) return Math.abs(event.timestamp - start.timestamp)
  }
  if (event.hookName === 'SubagentStop') {
    const start = turnEvents.find((e) => e.hookName === 'SubagentStart')
    if (start) return Math.abs(event.timestamp - start.timestamp)
  }
  return null
}

/** Format a duration in ms as a compact runtime string:
 *  <1s → "500ms", <60s → "5.2s", <60m → "1m 3s", ≥60m → "1h 23m". */
export function formatRuntime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec < 10 ? totalSec.toFixed(1) : Math.round(totalSec)}s`
  const totalMin = Math.floor(totalSec / 60)
  const sec = Math.round(totalSec - totalMin * 60)
  if (totalMin < 60) return `${totalMin}m ${sec}s`
  const hr = Math.floor(totalMin / 60)
  const min = totalMin - hr * 60
  return `${hr}h ${min}m`
}
