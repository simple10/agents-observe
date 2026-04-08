import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { API_BASE } from '@/config/api'
import type { WSMessage, WSClientMessage, ParsedEvent } from '@/types'

const WS_URL = `ws://${window.location.host}/api/events/stream`

// Fetch log level from server once on module load
let logLevel: 'debug' | 'trace' | 'none' = 'none'
fetch(`${API_BASE}/health`)
  .then((r) => r.json())
  .then((data) => {
    const level = (data.logLevel || '').toLowerCase()
    if (level === 'trace') logLevel = 'trace'
    else if (level === 'debug') logLevel = 'debug'
  })
  .catch(() => {})

export function useWebSocket(sessionId: string | null) {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  const sendMessage = useCallback((msg: WSClientMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }, [])

  // Send subscribe/unsubscribe when sessionId changes
  useEffect(() => {
    if (!connected) return
    if (sessionId) {
      sendMessage({ type: 'subscribe', sessionId })
      if (logLevel === 'debug' || logLevel === 'trace') {
        console.log(`[WS] Subscribing to session ${sessionId.slice(0, 8)}`)
      }
    } else {
      sendMessage({ type: 'unsubscribe' })
      if (logLevel === 'debug' || logLevel === 'trace') {
        console.log('[WS] Unsubscribed (no session selected)')
      }
    }
  }, [sessionId, connected, sendMessage])

  // Batch incoming events to avoid O(N) array copies per event.
  // Events accumulate in a buffer and flush to the cache every 100ms.
  const eventBufferRef = useRef<ParsedEvent[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const flushEventBuffer = useCallback(() => {
    const buffer = eventBufferRef.current
    if (buffer.length === 0) return
    eventBufferRef.current = []
    const currentSessionId = sessionIdRef.current
    if (!currentSessionId) return
    queryClient.setQueryData<ParsedEvent[]>(['events', currentSessionId], (old) =>
      old ? [...old, ...buffer] : [...buffer],
    )
    if (logLevel === 'trace') {
      console.debug(`[WS] Flushed ${buffer.length} events to cache`)
    }
  }, [queryClient])

  const handleMessage = useCallback(
    (msg: WSMessage) => {
      if (msg.type === 'event') {
        const event = msg.data as ParsedEvent
        const currentSessionId = sessionIdRef.current
        if (currentSessionId && event.sessionId === currentSessionId) {
          eventBufferRef.current.push(event)
          if (!flushTimerRef.current) {
            flushTimerRef.current = setTimeout(() => {
              flushTimerRef.current = undefined
              flushEventBuffer()
            }, 100)
          }
          if (logLevel === 'trace') {
            console.debug(
              `[WS] Event buffered: ${event.type}/${event.subtype}${event.toolName ? ` tool:${event.toolName}` : ''}`,
            )
          }
        }
      } else if (msg.type === 'session_update') {
        queryClient.invalidateQueries({ queryKey: ['sessions'] })
        queryClient.invalidateQueries({ queryKey: ['session'] })
        if (logLevel === 'trace') {
          console.debug('[WS] Session update → invalidating sessions + session caches')
        }
      } else if (msg.type === 'project_update') {
        queryClient.invalidateQueries({ queryKey: ['projects'] })
        queryClient.invalidateQueries({ queryKey: ['session'] })
        if (logLevel === 'trace') {
          console.debug('[WS] Project update → invalidating projects + session caches')
        }
      }
    },
    [queryClient],
  )

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
      return
    }

    function connectWs() {
      // Guard against duplicate connections (e.g. from StrictMode reconnect races)
      if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return

      try {
        const ws = new WebSocket(WS_URL)
        wsRef.current = ws

        ws.onopen = () => {
          setConnected(true)
          console.log('[WS] Connected')
          // Subscribe to current session on reconnect
          const sid = sessionIdRef.current
          if (sid) {
            ws.send(JSON.stringify({ type: 'subscribe', sessionId: sid }))
            if (logLevel === 'debug' || logLevel === 'trace') {
              console.log(`[WS] Subscribing to session ${sid.slice(0, 8)} (on connect)`)
            }
          }
        }

        ws.onmessage = (wsEvent) => {
          try {
            const msg: WSMessage = JSON.parse(wsEvent.data)
            handleMessage(msg)
          } catch {}
        }

        ws.onclose = () => {
          // Only handle if this is still the active connection — avoids
          // clobbering a newer connection during StrictMode remount races
          if (wsRef.current !== ws) return
          setConnected(false)
          wsRef.current = null
          console.log('[WS] Disconnected, retrying in 3s...')
          reconnectTimeoutRef.current = setTimeout(connectWs, 3000)
        }

        ws.onerror = () => {
          ws.close()
        }
      } catch {
        reconnectTimeoutRef.current = setTimeout(connectWs, 5000)
      }
    }

    connectWs()

    return () => {
      clearTimeout(reconnectTimeoutRef.current)
      clearTimeout(flushTimerRef.current)
      flushEventBuffer()
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [handleMessage])

  return { connected }
}
