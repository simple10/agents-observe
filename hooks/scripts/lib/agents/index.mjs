// hooks/scripts/lib/agents/index.mjs
// Central registry + dispatch helpers for agent-class-specific CLI code.
// Both the hook-send path and the callback dispatcher go through here.

import * as claudeCode from './claude-code.mjs'
import * as codex from './codex.mjs'
import * as defaultLib from './default.mjs'

export const AGENT_LIBS = {
  'claude-code': claudeCode,
  codex: codex,
  default: defaultLib,
}

/**
 * Default list of hook events that mark the session as awaiting-user
 * when AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS is unset.
 */
export const DEFAULT_NOTIFICATION_EVENTS = ['Notification']

/**
 * True if the given hook event should set `flags.startsNotification` on
 * the outgoing envelope. Agent libs call this from `buildHookEvent`.
 *
 * Consults `config.notificationOnEvents`:
 *   - undefined  → fall back to DEFAULT_NOTIFICATION_EVENTS
 *   - []         → no events ever set pending (explicit opt-out)
 *   - [names...] → any matching name triggers pending
 *
 * The `_hookPayload` argument is currently unused but included so future
 * payload-sniffing heuristics don't require a call-site migration.
 */
export function isNotificationEvent(config, hookEvent, _hookPayload) {
  const events = config?.notificationOnEvents ?? DEFAULT_NOTIFICATION_EVENTS
  return events.includes(hookEvent)
}

/**
 * Pick the agent class for an outgoing hook event. Today this simply
 * trusts `config.agentClass` (set via env var or project override) and
 * falls back to 'default' for anything we don't recognize. The signature
 * accepts `log` and `hookPayload` so a future heuristic can sniff the
 * payload shape without breaking callers.
 *
 * @returns {'claude-code'|'codex'|'default'}
 */
export function getAgentClass(config, _log, _hookPayload) {
  const configured = config?.agentClass
  if (configured && AGENT_LIBS[configured]) return configured
  return 'default'
}

/** Resolve the agent lib module, falling back to the default agent lib. */
export function getAgentLib(agentClass) {
  return AGENT_LIBS[agentClass] || AGENT_LIBS.default
}
