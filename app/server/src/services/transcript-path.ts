export interface BindMountBase {
  host: string
  container: string
}

/**
 * Translate a host-side transcript path into the path the server can
 * read inside its runtime. In docker mode with the transcript-stats
 * feature enabled we bind-mount each agent class's session dir into
 * the container (e.g. `~/.claude/projects` → `/host/.claude/projects`,
 * `~/.codex/sessions` → `/host/.codex/sessions`). The transcript_path
 * stored in the DB is always the host path; this helper rewrites it
 * for the container by trying each configured base in order.
 *
 * Trailing-slash precision matters: a path equal to a base or one
 * that starts with `${base}/` is translated; everything else passes
 * through. This rejects e.g. `/Users/joe/.claude/projects-other`
 * from matching `/Users/joe/.claude/projects`.
 *
 * Empty / missing bases (local mode) short-circuit to the identity
 * function. Bases with one side empty are skipped (defensive against
 * partial config).
 */
export function resolveTranscriptPath(hostPath: string, bases: BindMountBase[]): string {
  for (const { host, container } of bases) {
    if (!host || !container) continue
    if (hostPath === host) return container
    if (hostPath.startsWith(host + '/')) {
      return container + hostPath.slice(host.length)
    }
  }
  return hostPath
}
