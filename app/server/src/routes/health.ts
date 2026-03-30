// app/server/src/routes/health.ts

import { Hono } from 'hono'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { EventStore } from '../storage/types'

type Env = { Variables: { store: EventStore } }

const API_ID = 'claude-observe'

// Read version from VERSION file — works in both dev (../../..) and Docker (/app/..)
function readVersion(): string {
  const dir = dirname(fileURLToPath(import.meta.url))
  const paths = [
    resolve(dir, '../../../../VERSION'),  // dev: app/server/src/routes -> root
    resolve(dir, '../../../VERSION'),      // Docker: /app/server/src/routes -> /app
    '/app/VERSION',                        // Docker fallback
  ]
  for (const p of paths) {
    try {
      return readFileSync(p, 'utf8').trim()
    } catch {
      continue
    }
  }
  return 'unknown'
}

const VERSION = readVersion()
const LOG_LEVEL = (process.env.CLAUDE_OBSERVE_LOG_LEVEL || 'debug').toLowerCase()

const router = new Hono<Env>()

router.get('/health', async (c) => {
  const store = c.get('store')
  const result = await store.healthCheck()

  return c.json(
    {
      ok: result.ok,
      id: API_ID,
      version: VERSION,
      logLevel: LOG_LEVEL,
      ...(result.error ? { error: result.error } : {}),
    },
    result.ok ? 200 : 503,
  )
})

export default router
