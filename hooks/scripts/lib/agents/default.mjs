// hooks/scripts/lib/agents/unknown.mjs
// Fallback agent lib used when the CLI is invoked with an agent class
// that doesn't have a dedicated module. Builds a pass-through envelope
// with no class-specific categorization — so unrecognized agents
// silently work but never produce bells unless the user explicitly
// opts specific hook events into AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS.

import { isNotificationEvent } from './index.mjs'

function buildEnv(config) {
  const env = {}
  if (config?.projectSlug) {
    env.AGENTS_OBSERVE_PROJECT_SLUG = config.projectSlug
  }
  return env
}

/**
 * @returns {{ envelope: object, hookEvent: string, toolName: string }}
 */
export function buildHookEvent(config, _log, hookPayload) {
  const hookName = hookPayload?.hook_event_name || 'unknown'
  const toolName = hookPayload?.tool_name || hookPayload?.tool?.name || null
  const sessionId = hookPayload?.session_id || undefined
  const agentId = hookPayload?.agent_id || null

  const flags = {}
  if (isNotificationEvent(config, hookName, hookPayload)) {
    flags.isNotification = true
  }

  const envelope = {
    hook_payload: hookPayload,
    meta: {
      agentClass: config?.agentClass || 'unknown',
      env: buildEnv(config),
      hookName,
      // type / subtype left null — unknown agents have no class-specific
      // categorization; server stores null and the client treats them
      // as uncategorized.
      toolName,
      sessionId,
      agentId,
      ...flags,
    },
  }
  return { envelope, hookEvent: hookName, toolName: toolName || '' }
}

/** No-op session-info handler. The callbacks dispatcher skips gracefully. */
export function getSessionInfo() {
  return null
}
