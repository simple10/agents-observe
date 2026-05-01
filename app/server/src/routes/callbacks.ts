import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import { apiError } from '../errors'
import { config } from '../config'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

const LOG_LEVEL = config.logLevel

const router = new Hono<Env>()

interface GitInfoPayload {
  branch?: string | null
  repository_url?: string | null
}

interface SessionInfoPayload {
  slug?: string | null
  git?: GitInfoPayload | null
  // Mirrored back from the original request by the hook dispatcher so
  // the server uses exactly what was sent (not a later DB lookup).
  agentClass?: string | null
  cwd?: string | null
}

// POST /callbacks/session-info/:sessionId
//
// Called by the hook after it has read the transcript for slug + git.
// The hook's agent-specific lib returns
//   { slug: string|null, git: { branch: string|null, repository_url: string|null } }
// and we:
//   - merge any non-null git fields into session metadata
//   - set the session slug to data.slug, or fall back to git.branch when
//     no explicit slug was extracted.
router.post('/callbacks/session-info/:sessionId', async (c) => {
  const store = c.get('store')
  const broadcastToAll = c.get('broadcastToAll')

  try {
    const sessionId = decodeURIComponent(c.req.param('sessionId'))
    const data = (await c.req.json()) as SessionInfoPayload

    const gitBranch =
      data.git && typeof data.git.branch === 'string' && data.git.branch.trim()
        ? data.git.branch.trim()
        : null
    const gitRepo =
      data.git && typeof data.git.repository_url === 'string' && data.git.repository_url.trim()
        ? data.git.repository_url.trim()
        : null

    const explicitSlug = typeof data.slug === 'string' && data.slug.trim() ? data.slug.trim() : null

    // Nothing useful — reject. Matches the old behavior where missing
    // slug returned 400; callers get an actionable error.
    if (!explicitSlug && !gitBranch && !gitRepo) {
      return apiError(c, 400, 'Missing slug and git info')
    }

    // Merge git info into session metadata. Only include keys we
    // actually got so we don't overwrite existing values with null.
    if (gitBranch || gitRepo) {
      const gitPatch: Record<string, unknown> = {}
      if (gitBranch) gitPatch.branch = gitBranch
      if (gitRepo) gitPatch.repository_url = gitRepo
      await store.patchSessionMetadata(sessionId, { git: gitPatch })
    }

    // Auto-name the session. If the agent lib returned an explicit slug,
    // use it verbatim (future use — most agents return null today).
    // Otherwise build a slug in the shape:
    //   "<branch>:<uuidPrefix>:<agentShortName>"
    // Branch first because most users work on one agent (claude) and
    // the branch is the most useful identifier to eyeball. The first
    // UUID segment keeps two sessions on the same branch distinct;
    // the trailing agent short name (e.g. "claude-code" -> "claude")
    // calls out non-default agents. When agentClass is missing the
    // trailing segment is dropped: "<branch>:<uuidPrefix>".
    // Leaving slug null lets the next event re-trigger the callback.
    const uuidPrefix = sessionId.split('-')[0]
    const agentClass =
      typeof data.agentClass === 'string' && data.agentClass.trim() ? data.agentClass.trim() : null
    const agentShortName = agentClass ? (agentClass.split('-')[0] ?? null) : null
    const slug =
      explicitSlug ??
      (gitBranch
        ? agentShortName
          ? `${gitBranch}:${uuidPrefix}:${agentShortName}`
          : `${gitBranch}:${uuidPrefix}`
        : null)
    if (slug) {
      await store.updateSessionSlug(sessionId, slug)
      broadcastToAll({ type: 'session_update', data: { id: sessionId, slug } as any })
    }

    if (LOG_LEVEL === 'debug') {
      console.log(
        `[CALLBACK] Session ${sessionId.slice(0, 8)} slug=${slug ?? '(unchanged)'} branch=${
          gitBranch ?? ''
        } repo=${gitRepo ?? ''}`,
      )
    }

    return c.json({ ok: true })
  } catch {
    return apiError(c, 400, 'Invalid request')
  }
})

interface SessionUsagePayload {
  input?: number
  output?: number
  cacheRead?: number
  cacheCreation?: number
  agentClass?: string | null
  cwd?: string | null
}

// POST /callbacks/session-usage/:sessionId
//
// Called by the hook after reading the transcript on SessionEnd.
// Patches the session's metadata with root agent token usage totals.
router.post('/callbacks/session-usage/:sessionId', async (c) => {
  const store = c.get('store')
  const broadcastToAll = c.get('broadcastToAll')

  try {
    const sessionId = decodeURIComponent(c.req.param('sessionId'))
    const data = (await c.req.json()) as SessionUsagePayload

    const input = typeof data.input === 'number' ? data.input : 0
    const output = typeof data.output === 'number' ? data.output : 0
    const cacheRead = typeof data.cacheRead === 'number' ? data.cacheRead : 0
    const cacheCreation = typeof data.cacheCreation === 'number' ? data.cacheCreation : 0

    if (input === 0 && output === 0) {
      return apiError(c, 400, 'No usage data provided')
    }

    await store.patchSessionMetadata(sessionId, {
      usage: { input, output, cacheRead, cacheCreation },
    })

    broadcastToAll({
      type: 'session_update',
      data: { id: sessionId, metadata: { usage: { input, output, cacheRead, cacheCreation } } },
    })

    if (LOG_LEVEL === 'debug') {
      console.log(
        `[CALLBACK] Session ${sessionId.slice(0, 8)} usage: in=${input} out=${output} cacheRead=${cacheRead} cacheCreation=${cacheCreation}`,
      )
    }

    return c.json({ ok: true })
  } catch {
    return apiError(c, 400, 'Invalid request')
  }
})

export default router
