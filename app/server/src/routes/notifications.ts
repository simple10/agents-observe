import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
  }
}

const router = new Hono<Env>()

// GET /notifications?since=<ts>
// Returns sessions that currently have a pending notification (i.e.
// `pending_notification_ts` is non-NULL). Transitions are driven by
// envelope flags at insert time; this endpoint just reads the cached
// state. `since` lets clients resume from their last-seen cursor.
router.get('/notifications', async (c) => {
  const store = c.get('store')
  const sinceParam = c.req.query('since')
  const since = sinceParam ? Number(sinceParam) : 0
  const safeSince = Number.isFinite(since) && since >= 0 ? since : 0

  const rows = await store.getSessionsWithPendingNotifications(safeSince)
  const notifications = rows.map((r: any) => ({
    sessionId: r.session_id,
    projectId: r.project_id,
    latestNotificationTs: r.pending_notification_ts,
  }))
  return c.json(notifications)
})

export default router
