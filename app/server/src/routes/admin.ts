// app/server/src/routes/admin.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import { removeSessionRootAgent } from './events'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

// DELETE /sessions/:id — delete session and all its data
router.delete('/sessions/:id', async (c) => {
  const store = c.get('store')
  const sessionId = c.req.param('id')
  await store.deleteSession(sessionId)
  removeSessionRootAgent(sessionId)
  return c.json({ ok: true })
})

// DELETE /sessions/:id/events — clear events and agents for a specific session
router.delete('/sessions/:id/events', async (c) => {
  const store = c.get('store')
  const sessionId = c.req.param('id')
  await store.clearSessionEvents(sessionId)
  removeSessionRootAgent(sessionId)
  return c.json({ ok: true })
})

// DELETE /projects/:id — delete a project and all its sessions, agents, events
router.delete('/projects/:id', async (c) => {
  const store = c.get('store')
  const projectId = decodeURIComponent(c.req.param('id'))
  await store.deleteProject(projectId)
  return c.json({ ok: true })
})

// DELETE /data — delete all data (projects, sessions, agents, events)
router.delete('/data', async (c) => {
  const store = c.get('store')
  await store.clearAllData()
  return c.json({ ok: true })
})

export default router
