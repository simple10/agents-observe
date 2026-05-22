/**
 * Translate a host-side transcript path into the path the server can
 * read inside its runtime. In docker mode with the transcript-stats
 * feature enabled, we bind-mount `~/.claude/projects` (host) to
 * `/host/.claude/projects` (container). The transcript_path stored in
 * the DB is always the host path; this helper rewrites it for the
 * container.
 *
 * Trailing-slash precision matters: a path equal to the base or one
 * that starts with `${base}/` is translated; everything else passes
 * through. This rejects e.g. `/Users/joe/.claude/projects-other` from
 * matching `/Users/joe/.claude/projects`.
 *
 * Empty bases (local mode) short-circuit to the identity function.
 */
export function resolveTranscriptPath(
  hostPath: string,
  hostBase: string,
  containerBase: string,
): string {
  if (!hostBase || !containerBase) return hostPath
  if (hostPath === hostBase) return containerBase
  if (hostPath.startsWith(hostBase + '/')) {
    return containerBase + hostPath.slice(hostBase.length)
  }
  return hostPath
}
