// app/server/src/index.ts
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createStore } from './storage'

const store = createStore()
const LOG_LEVEL = process.env.SERVER_LOG_LEVEL || 'info'
const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || '4001', 10)

// Placeholder broadcast (WebSocket added in Task 3)
let broadcast = (msg: object) => {}

const app = createApp(store, broadcast)

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`POST events: http://localhost:${PORT}/api/events`)
})
