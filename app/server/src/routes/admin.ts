// app/server/src/routes/admin.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

// DELETE /sessions/:id — delete session and all its data
router.delete('/sessions/:id', async (c) => {
  const store = c.get('store')
  const sessionId = c.req.param('id')
  await store.deleteSession(sessionId)
  return c.json({ ok: true })
})

// DELETE /sessions/:id/events — clear events for a specific session
router.delete('/sessions/:id/events', async (c) => {
  const store = c.get('store')
  const sessionId = c.req.param('id')
  await store.clearSessionEvents(sessionId)
  return c.json({ ok: true })
})

export default router
