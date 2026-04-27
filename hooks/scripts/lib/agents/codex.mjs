// hooks/scripts/lib/agents/codex.mjs
// Codex hook lib. Composes default.mjs, overrides agentClass, and uses
// PermissionRequest as Codex's default notification event. Codex hook
// payloads use the same identity-field shape as Claude (session_id,
// agent_id, hook_event_name, cwd, transcript_path), so the default lib's
// extraction works without further overrides.

import { readFileSync } from 'node:fs'
import { defaultLib } from './default.mjs'

const CODEX_DEFAULT_NOTIFICATION_EVENTS = ['PermissionRequest']

function codexNotificationConfig(config) {
  if (config?.notificationOnEvents !== undefined) return config
  return { ...config, notificationOnEvents: CODEX_DEFAULT_NOTIFICATION_EVENTS }
}

export function buildEnv(config) {
  return defaultLib.buildEnv(config)
}

/**
 * Build the event envelope for a Codex hook payload.
 *
 * Notification semantics: Codex's PermissionRequest is the point where
 * the agent is blocked on user approval, so it is the default dashboard
 * notification event. Users can override this with
 * AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS.
 *
 * Codex does not have Claude's UserPromptSubmit/SessionEnd hooks, so this
 * adapter does not set flags.clearsNotification or flags.stopsSession.
 *
 * @param {object} config
 * @param {object} log
 * @param {object} payload
 * @returns {{ envelope: object, hookEvent: string, toolName: string }}
 */
export function buildHookEvent(config, log, payload) {
  const result = defaultLib.buildHookEvent(codexNotificationConfig(config), log, payload)
  result.envelope.agentClass = 'codex'
  return result
}

/**
 * Scan a Codex transcript jsonl for session_meta git info. Example:
 *
 *   {
 *     "type": "session_meta",
 *     "payload": {
 *       "git": {
 *         "branch": "feat/foo",
 *         "repository_url": "git@github.com:..."
 *       }
 *     }
 *   }
 *
 * Codex transcripts do not carry a human-friendly slug of their own, so
 * the server falls back to git.branch for the session label.
 *
 * Shape returned matches the shared getSessionInfo contract:
 *   { slug: null, git: { branch: string|null, repository_url: string|null } }
 *
 * @param {object} args
 * @param {string} [args.transcriptPath] Absolute path to the jsonl transcript.
 * @param {string} [args.transcript_path] Snake-case alias accepted for
 *   back-compat with older callers.
 * @param {string} [args.agentClass] The session's agent class — always
 *   "codex" by the time this handler is dispatched, but kept in the arg
 *   signature for symmetry with other agents.
 * @param {string|null} [args.cwd] Working dir of the session when the
 *   callback was requested. Currently unused; reserved for future
 *   heuristics (e.g. reading git info directly via `git -C <cwd>` when
 *   the transcript hasn't been written yet).
 * @param {object} ctx
 * @param {object} ctx.log Logger with debug/warn/etc.
 */
export function getSessionInfo(args, { log }) {
  const transcriptPath = args?.transcriptPath ?? args?.transcript_path
  if (!transcriptPath) {
    log.debug('codex.getSessionInfo: no transcriptPath provided')
    return null
  }

  let content
  try {
    content = readFileSync(transcriptPath, 'utf8')
  } catch (err) {
    log.warn(`codex.getSessionInfo: cannot read transcript ${transcriptPath}: ${err.message}`)
    return null
  }

  let branch = null
  let repository_url = null

  let pos = 0
  while (pos < content.length) {
    const nextNewline = content.indexOf('\n', pos)
    const end = nextNewline === -1 ? content.length : nextNewline
    const line = content.slice(pos, end).trim()
    pos = end + 1
    if (!line || !line.includes('"git"')) continue

    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    // session_meta carries git under payload.git; tolerate git at the
    // top level too in case the transcript shape drifts in the future.
    const git = entry?.payload?.git ?? entry?.git
    if (!git || typeof git !== 'object') continue

    if (branch === null && typeof git.branch === 'string' && git.branch) {
      branch = git.branch
    }
    if (repository_url === null && typeof git.repository_url === 'string' && git.repository_url) {
      repository_url = git.repository_url
    }
    if (branch !== null && repository_url !== null) break
  }

  if (branch === null && repository_url === null) {
    log.debug(`codex.getSessionInfo: no git info in ${transcriptPath}`)
  } else {
    log.debug(`codex.getSessionInfo: branch=${branch} repo=${repository_url}`)
  }

  return {
    slug: null,
    git: { branch, repository_url },
  }
}
