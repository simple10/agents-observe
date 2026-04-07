// app/server/src/app.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import path from 'path'
import fs from 'fs'
import type { EventStore } from './storage/types'
import { config } from './config'

import eventsRouter from './routes/events'
import projectsRouter from './routes/projects'
import sessionsRouter from './routes/sessions'
import agentsRouter from './routes/agents'
import adminRouter from './routes/admin'
import healthRouter from './routes/health'
import consumerRouter from './routes/consumer'
import changelogRouter from './routes/changelog'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

export function createApp(
  store: EventStore,
  broadcastToSession: (sessionId: string, msg: object) => void,
  broadcastToAll: (msg: object) => void,
) {
  const app = new Hono<Env>()

  app.use('*', cors())

  // Inject store and broadcast into all routes
  app.use('*', async (c, next) => {
    c.set('store', store)
    c.set('broadcastToSession', broadcastToSession)
    c.set('broadcastToAll', broadcastToAll)
    await next()
  })

  app.route('/api', eventsRouter)
  app.route('/api', projectsRouter)
  app.route('/api', sessionsRouter)
  app.route('/api', agentsRouter)
  app.route('/api', adminRouter)
  app.route('/api', healthRouter)
  app.route('/api', consumerRouter)
  app.route('/api', changelogRouter)

  // Serve built client static files when clientDistPath is configured
  const clientDistPath = config.clientDistPath
  if (clientDistPath && fs.existsSync(clientDistPath)) {
    app.use('/*', serveStatic({ root: path.relative(process.cwd(), clientDistPath) }))

    // Return 404 for unmatched API routes before SPA fallback
    app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

    // SPA fallback: serve index.html for all non-API routes
    const indexHtml = fs.readFileSync(path.join(clientDistPath, 'index.html'), 'utf8')
    app.get('*', (c) => c.html(indexHtml))
  } else if (config.isDev) {
    // Dev mode: redirect unmatched GET requests to the Vite dev client
    const devClientUrl = `http://localhost:${config.devClientPort}`
    app.get('*', (c) => c.redirect(devClientUrl, 302))
  }

  return app
}
