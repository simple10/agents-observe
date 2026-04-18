import { readFileSync } from 'node:fs'

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
 * @param {string} [args.transcript_path] Absolute path to the jsonl transcript.
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
export function getSessionInfo({ transcript_path, agentClass: _agentClass, cwd: _cwd }, { log }) {
  if (!transcript_path) {
    log.debug('codex.getSessionInfo: no transcript_path provided')
    return null
  }

  let content
  try {
    content = readFileSync(transcript_path, 'utf8')
  } catch (err) {
    log.warn(`codex.getSessionInfo: cannot read transcript ${transcript_path}: ${err.message}`)
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
    log.debug(`codex.getSessionInfo: no git info in ${transcript_path}`)
  } else {
    log.debug(`codex.getSessionInfo: branch=${branch} repo=${repository_url}`)
  }

  return {
    slug: null,
    git: { branch, repository_url },
  }
}
