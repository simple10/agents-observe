import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import type { WSClientMessage } from './types'

const LOG_LEVEL = (process.env.CLAUDE_OBSERVE_LOG_LEVEL || 'debug').toLowerCase()

// Track which session each client is subscribed to
const clientSessions = new Map<WebSocket, string>()
const allClients = new Set<WebSocket>()

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/api/events/stream' })

  wss.on('connection', (ws) => {
    allClients.add(ws)
    console.log(`[WS] Client connected (${allClients.size} total)`)

    ws.on('message', (raw) => {
      try {
        const msg: WSClientMessage = JSON.parse(raw.toString())
        if (msg.type === 'subscribe' && msg.sessionId) {
          const prev = clientSessions.get(ws)
          clientSessions.set(ws, msg.sessionId)
          if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace') {
            const prevInfo = prev ? ` (was: ${prev.slice(0, 8)})` : ''
            console.log(`[WS] Client subscribed to session ${msg.sessionId.slice(0, 8)}${prevInfo}`)
          }
        } else if (msg.type === 'unsubscribe') {
          const prev = clientSessions.get(ws)
          clientSessions.delete(ws)
          if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace') {
            console.log(`[WS] Client unsubscribed${prev ? ` from session ${prev.slice(0, 8)}` : ''}`)
          }
        }
      } catch {}
    })

    ws.on('close', () => {
      allClients.delete(ws)
      clientSessions.delete(ws)
      console.log(`[WS] Client disconnected (${allClients.size} remaining)`)
    })

    ws.on('error', () => {
      allClients.delete(ws)
      clientSessions.delete(ws)
    })
  })

  console.log('[WS] WebSocket enabled on /api/events/stream')
}

/** Send a message only to clients subscribed to a specific session */
export function broadcastToSession(sessionId: string, message: object): void {
  const json = JSON.stringify(message)
  for (const [client, subSessionId] of clientSessions) {
    if (subSessionId === sessionId && client.readyState === WebSocket.OPEN) {
      try {
        client.send(json)
      } catch {
        allClients.delete(client)
        clientSessions.delete(client)
      }
    }
  }
}

/** Send a message to ALL connected clients (for global updates) */
export function broadcastToAll(message: object): void {
  const json = JSON.stringify(message)
  for (const client of allClients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(json)
      } catch {
        allClients.delete(client)
        clientSessions.delete(client)
      }
    }
  }
}

export function getClientCount(): number {
  return allClients.size
}
