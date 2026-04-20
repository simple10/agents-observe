import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = { Variables: { store: EventStore } }

describe('GET /api/notifications', () => {
  let app: Hono<Env>
  const getSessionsWithPendingNotifications = vi.fn()

  beforeEach(async () => {
    vi.resetModules()
    getSessionsWithPendingNotifications.mockReset()

    const { default: router } = await import('./notifications')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', { getSessionsWithPendingNotifications } as unknown as EventStore)
      await next()
    })
    app.route('/api', router)
  })

  test('maps storage rows to the client-facing shape', async () => {
    getSessionsWithPendingNotifications.mockResolvedValue([
      {
        session_id: 'sess-a',
        project_id: 42,
        pending_notification_ts: 1700000000000,
      },
    ])
    const res = await app.request('/api/notifications')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([
      {
        sessionId: 'sess-a',
        projectId: 42,
        latestNotificationTs: 1700000000000,
      },
    ])
    // Default since=0 when the query param is missing.
    expect(getSessionsWithPendingNotifications).toHaveBeenCalledWith(0)
  })

  test('passes ?since through to the storage method', async () => {
    getSessionsWithPendingNotifications.mockResolvedValue([])
    await app.request('/api/notifications?since=1234567890')
    expect(getSessionsWithPendingNotifications).toHaveBeenCalledWith(1234567890)
  })

  test('treats malformed ?since as 0 (defensive default)', async () => {
    getSessionsWithPendingNotifications.mockResolvedValue([])
    await app.request('/api/notifications?since=not-a-number')
    expect(getSessionsWithPendingNotifications).toHaveBeenCalledWith(0)
  })
})
