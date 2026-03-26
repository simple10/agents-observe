// app/server/src/app.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { EventStore } from './storage/types'

import eventsRouter from './routes/events'
import projectsRouter from './routes/projects'
import sessionsRouter from './routes/sessions'
import agentsRouter from './routes/agents'
import adminRouter from './routes/admin'
import pollRouter from './routes/poll'

type Env = { Variables: { store: EventStore; broadcast: (msg: object) => void } }

export function createApp(store: EventStore, broadcast: (msg: object) => void) {
  const app = new Hono<Env>()

  app.use('*', cors())

  // Inject store and broadcast into all routes
  app.use('*', async (c, next) => {
    c.set('store', store)
    c.set('broadcast', broadcast)
    await next()
  })

  app.route('/api', eventsRouter)
  app.route('/api', projectsRouter)
  app.route('/api', sessionsRouter)
  app.route('/api', agentsRouter)
  app.route('/api', adminRouter)
  app.route('/api', pollRouter)

  return app
}
