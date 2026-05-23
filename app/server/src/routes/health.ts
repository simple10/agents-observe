// app/server/src/routes/health.ts

import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import { config } from '../config'
import { getConsumerCount } from '../consumer-tracker'
import { getClientCount } from '../websocket'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

router.get('/health', async (c) => {
  const store = c.get('store')
  const result = await store.healthCheck()

  return c.json(
    {
      ok: result.ok,
      id: config.apiId,
      version: config.version,
      logLevel: config.logLevel,
      runtime: config.runtime,
      dbPath: config.dbPath,
      activeConsumers: getConsumerCount(),
      activeClients: getClientCount(),
      transcriptStatsEnabled: config.transcriptStats.enabled,
      ...(result.error ? { error: result.error } : {}),
    },
    result.ok ? 200 : 503,
  )
})

export default router
