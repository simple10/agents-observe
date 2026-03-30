import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { WSMessage, WSClientMessage, ParsedEvent, Agent } from '@/types'

const WS_URL = `ws://${window.location.host}/api/events/stream`

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
    } else {
      sendMessage({ type: 'unsubscribe' })
    }
  }, [sessionId, connected, sendMessage])

  const handleMessage = useCallback((msg: WSMessage) => {
    if (msg.type === 'event') {
      // Append directly to the events cache for the current session
      const event = msg.data as ParsedEvent
      const currentSessionId = sessionIdRef.current
      if (currentSessionId && event.sessionId === currentSessionId) {
        queryClient.setQueryData<ParsedEvent[]>(
          ['events', currentSessionId],
          (old) => old ? [...old, event] : [event],
        )
      }
    } else if (msg.type === 'agent_update') {
      const agent = msg.data as Agent
      const currentSessionId = sessionIdRef.current
      if (currentSessionId && agent.sessionId === currentSessionId) {
        queryClient.setQueryData<Agent[]>(
          ['agents', currentSessionId],
          (old) => {
            if (!old) return [agent]
            const exists = old.some((a) => a.id === agent.id)
            if (exists) {
              return old.map((a) => a.id === agent.id ? agent : a)
            }
            return [...old, agent]
          },
        )
      }
    } else if (msg.type === 'session_update') {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    } else if (msg.type === 'project_update') {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  }, [queryClient])

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
      return
    }

    function connectWs() {
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
          }
        }

        ws.onmessage = (wsEvent) => {
          try {
            const msg: WSMessage = JSON.parse(wsEvent.data)
            handleMessage(msg)
          } catch {}
        }

        ws.onclose = () => {
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
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [handleMessage])

  return { connected }
}
