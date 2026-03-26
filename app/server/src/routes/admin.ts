// app/server/src/routes/admin.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import { clearSessionRootAgents } from './events'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

// DELETE /data
router.delete('/data', async (c) => {
  const store = c.get('store')
  await store.clearAllData()
  clearSessionRootAgents()
  return c.json({ success: true })
})

export default router
