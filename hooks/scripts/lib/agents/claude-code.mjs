import { readFileSync } from 'node:fs'

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
 * @param {string} [args.transcript_path] Absolute path to the jsonl transcript.
 * @param {string} [args.agentClass] The session's agent class — always
 *   "claude-code" by the time this handler is dispatched, but kept in
 *   the arg signature for symmetry with other agents.
 * @param {string|null} [args.cwd] Working dir of the session when the
 *   callback was requested. Currently unused; reserved for future
 *   heuristics (e.g. git-repo discovery via `git -C <cwd>`).
 * @param {object} ctx
 * @param {object} ctx.log Logger with debug/warn/etc.
 */
export function getSessionInfo({ transcript_path, agentClass: _agentClass, cwd: _cwd }, { log }) {
  if (!transcript_path) {
    log.debug('claude-code.getSessionInfo: no transcript_path provided')
    return null
  }

  let content
  try {
    content = readFileSync(transcript_path, 'utf8')
  } catch (err) {
    log.warn(
      `claude-code.getSessionInfo: cannot read transcript ${transcript_path}: ${err.message}`,
    )
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
    log.debug(`claude-code.getSessionInfo: no slug or gitBranch in ${transcript_path}`)
  } else {
    log.debug(`claude-code.getSessionInfo: slug=${slug} branch=${branch}`)
  }

  return {
    slug,
    git: { branch, repository_url: null },
  }
}
