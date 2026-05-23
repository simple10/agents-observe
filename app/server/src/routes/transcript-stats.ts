import { Hono } from 'hono'
import { promises as fs } from 'node:fs'
import type { EventStore } from '../storage/types'
import { config } from '../config'
import { resolveTranscriptPath } from '../services/transcript-path'
import { parseSessionTranscripts } from '../transcript-parser'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

router.get('/sessions/:sessionId/transcript-stats', async (c) => {
  if (!config.transcriptStats.enabled) {
    return c.json(
      {
        error: 'disabled',
        message:
          'Transcript parsing is disabled. Unset AGENTS_OBSERVE_TRANSCRIPT_STATS (or remove the =0 override) on the server to re-enable.',
      },
      404,
    )
  }

  const sessionId = c.req.param('sessionId')
  const store = c.get('store')
  const hostPath = await store.getSessionTranscriptPath(sessionId)
  if (!hostPath) {
    return c.json({ error: 'no_transcript', message: 'No transcript path found for session.' }, 404)
  }

  const resolved = resolveTranscriptPath(hostPath, config.transcriptStats.bases)

  let stat
  try {
    stat = await fs.stat(resolved)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return c.json({ error: 'file_not_found', message: 'Transcript file not found.' }, 404)
    }
    if (err?.code === 'EACCES') {
      return c.json(
        {
          error: 'file_unreadable',
          message: `Transcript file exists but is not readable by the server process: ${err.message}`,
        },
        403,
      )
    }
    throw err
  }

  if (stat.size > config.transcriptStats.maxFileBytes) {
    return c.json(
      {
        error: 'file_too_large',
        message: `Transcript file exceeds the ${Math.round(
          config.transcriptStats.maxFileBytes / 1024 / 1024,
        )} MB safety cap.`,
      },
      413,
    )
  }

  try {
    const stats = await parseSessionTranscripts(sessionId, store, resolved)
    return c.json(stats, 200)
  } catch (err: any) {
    if (err?.code === 'EACCES') {
      return c.json(
        {
          error: 'file_unreadable',
          message: `Transcript file exists but is not readable by the server process: ${err.message}`,
        },
        403,
      )
    }
    return c.json({ error: 'parse_error', message: err?.message ?? String(err) }, 500)
  }
})

export default router
