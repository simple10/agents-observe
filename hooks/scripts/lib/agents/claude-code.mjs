// hooks/scripts/lib/agents/claude-code.mjs
// Claude-Code-specific hook lib. Composes default.mjs and overrides
// agentClass + adds Claude-specific lifecycle flags
// (clearsNotification, stopsSession, resolveProject) per the three-layer
// contract spec.

import { readFileSync } from 'node:fs'
import { defaultLib } from './default.mjs'

// Hooks that should explicitly clear pending notifications
// (Claude-Code-specific naming).
const CLEARS_NOTIFICATION = new Set(['UserPromptSubmit'])
// Hooks that mark the session as terminally stopped.
const STOPS_SESSION = new Set(['SessionEnd'])

export function buildEnv(config) {
  return defaultLib.buildEnv(config)
}

/**
 * Build the event envelope for a Claude Code hook payload. Composes the
 * default lib then overrides agentClass and adds Claude-specific flags.
 *
 * @param {object} config
 * @param {object} log
 * @param {object} payload Raw hook payload from Claude Code.
 * @returns {{ envelope: object, hookEvent: string, toolName: string }}
 */
export function buildHookEvent(config, log, payload) {
  const result = defaultLib.buildHookEvent(config, log, payload)
  result.envelope.agentClass = 'claude-code'

  const flags = result.envelope.flags ?? {}
  const hookName = result.envelope.hookName
  if (CLEARS_NOTIFICATION.has(hookName)) flags.clearsNotification = true
  if (STOPS_SESSION.has(hookName)) flags.stopsSession = true
  // SessionStart re-resolves project lazily (cwd may newly be available).
  if (hookName === 'SessionStart') flags.resolveProject = true

  if (Object.keys(flags).length > 0) result.envelope.flags = flags
  return result
}

/**
 * Scan a Claude Code transcript jsonl for the session slug and the
 * git branch. Both fields are top-level on hook entries (e.g.
 * `{ "slug": "...", "gitBranch": "...", ... }`), so we read line-by-line
 * and extract either one as soon as we see it. Returns as soon as both
 * are found; the slug takes priority for the response but both are
 * surfaced to the server so it can fall back to git.branch.
 *
 * Shape returned matches the shared getSessionInfo contract:
 *   { slug: string|null, git: { branch: string|null, repository_url: null } }
 *
 * `repository_url` is always null for Claude Code since the transcripts
 * don't carry the remote origin.
 *
 * @param {object} args
 * @param {string} [args.transcriptPath] Absolute path to the jsonl transcript.
 * @param {string} [args.transcript_path] Snake-case alias accepted for
 *   back-compat with older callers.
 * @param {string} [args.agentClass] The session's agent class — always
 *   "claude-code" by the time this handler is dispatched, but kept in
 *   the arg signature for symmetry with other agents.
 * @param {string|null} [args.cwd] Working dir of the session when the
 *   callback was requested. Currently unused; reserved for future
 *   heuristics (e.g. git-repo discovery via `git -C <cwd>`).
 * @param {object} ctx
 * @param {object} ctx.log Logger with debug/warn/etc.
 */
/**
 * Scan a Claude Code transcript jsonl for cumulative token usage.
 * Each assistant message includes a `usage` block with input_tokens,
 * output_tokens, cache_read_input_tokens, cache_creation_input_tokens.
 * We sum all of them to produce the root agent's total token consumption.
 *
 * @param {object} args
 * @param {string} [args.transcriptPath] Absolute path to the jsonl transcript.
 * @param {string} [args.transcript_path] Snake-case alias.
 * @param {object} ctx
 * @param {object} ctx.log Logger.
 */
export function getSessionUsage(args, { log }) {
  const transcriptPath = args?.transcriptPath ?? args?.transcript_path
  if (!transcriptPath) {
    log.debug('claude-code.getSessionUsage: no transcriptPath provided')
    return null
  }

  let content
  try {
    content = readFileSync(transcriptPath, 'utf8')
  } catch (err) {
    log.warn(`claude-code.getSessionUsage: cannot read transcript ${transcriptPath}: ${err.message}`)
    return null
  }

  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheCreation = 0

  let pos = 0
  while (pos < content.length) {
    const nextNewline = content.indexOf('\n', pos)
    const end = nextNewline === -1 ? content.length : nextNewline
    const line = content.slice(pos, end).trim()
    pos = end + 1
    if (!line || !line.includes('"usage"')) continue

    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const usage = entry?.message?.usage ?? entry?.usage
    if (!usage || typeof usage !== 'object') continue

    input += usage.input_tokens ?? 0
    output += usage.output_tokens ?? 0
    cacheRead += usage.cache_read_input_tokens ?? 0
    cacheCreation += usage.cache_creation_input_tokens ?? 0
  }

  if (input === 0 && output === 0) {
    log.debug(`claude-code.getSessionUsage: no usage data in ${transcriptPath}`)
    return null
  }

  log.debug(
    `claude-code.getSessionUsage: input=${input} output=${output} cacheRead=${cacheRead} cacheCreation=${cacheCreation}`,
  )

  return { input, output, cacheRead, cacheCreation }
}

export function getSessionInfo(args, { log }) {
  const transcriptPath = args?.transcriptPath ?? args?.transcript_path
  if (!transcriptPath) {
    log.debug('claude-code.getSessionInfo: no transcriptPath provided')
    return null
  }

  let content
  try {
    content = readFileSync(transcriptPath, 'utf8')
  } catch (err) {
    log.warn(`claude-code.getSessionInfo: cannot read transcript ${transcriptPath}: ${err.message}`)
    return null
  }

  let slug = null
  let branch = null

  let pos = 0
  while (pos < content.length) {
    const nextNewline = content.indexOf('\n', pos)
    const end = nextNewline === -1 ? content.length : nextNewline
    const line = content.slice(pos, end).trim()
    pos = end + 1
    if (!line) continue
    // Cheap pre-check: only parse lines that could contain what we want.
    const hasSlug = slug === null && line.includes('"slug"')
    const hasBranch = branch === null && line.includes('"gitBranch"')
    if (!hasSlug && !hasBranch) continue

    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (slug === null && typeof entry.slug === 'string' && entry.slug) {
      slug = entry.slug
    }
    if (branch === null && typeof entry.gitBranch === 'string' && entry.gitBranch) {
      branch = entry.gitBranch
    }
    if (slug !== null && branch !== null) break
  }

  if (slug === null && branch === null) {
    log.debug(`claude-code.getSessionInfo: no slug or gitBranch in ${transcriptPath}`)
  } else {
    log.debug(`claude-code.getSessionInfo: slug=${slug} branch=${branch}`)
  }

  return {
    slug,
    git: { branch, repository_url: null },
  }
}
