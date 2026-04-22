import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

describe('admin routes — DELETE endpoints return counts', () => {
  let app: Hono<Env>
  const mockStore = {
    deleteSession: vi.fn(),
    clearSessionEvents: vi.fn(),
    deleteProject: vi.fn(),
    clearAllData: vi.fn(),
  }

  beforeEach(async () => {
    vi.resetModules()
    Object.values(mockStore).forEach((fn) => fn.mockReset())

    // Mock events module and config
    vi.doMock('./events', () => ({
      removeSessionRootAgent: vi.fn(),
      clearSessionRootAgents: vi.fn(),
    }))
    vi.doMock('../config', () => ({
      config: {
        allowDbReset: 'allow',
        dbPath: '/tmp/test.db',
      },
    }))

    const { default: adminRouter } = await import('./admin')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', mockStore as unknown as EventStore)
      c.set('broadcastToAll', vi.fn())
      c.set('broadcastToSession', vi.fn())
      await next()
    })
    app.route('/api', adminRouter)
  })

  test('DELETE /sessions/:id returns deleted counts', async () => {
    mockStore.deleteSession.mockResolvedValue({ events: 42, agents: 3 })

    const res = await app.request('/api/sessions/sess-1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, deleted: { events: 42, agents: 3 } })
  })

  test('DELETE /sessions/:id/events returns deleted counts', async () => {
    mockStore.clearSessionEvents.mockResolvedValue({ events: 100, agents: 5 })

    const res = await app.request('/api/sessions/sess-1/events', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, deleted: { events: 100, agents: 5 } })
  })

  test('DELETE /projects/:id returns deleted counts (without sessionIds)', async () => {
    mockStore.deleteProject.mockResolvedValue({
      sessionIds: ['s1', 's2'],
      sessions: 2,
      agents: 4,
      events: 200,
    })

    const res = await app.request('/api/projects/1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, deleted: { sessions: 2, agents: 4, events: 200 } })
    // sessionIds should NOT be in the response (internal detail)
    expect(body.deleted.sessionIds).toBeUndefined()
  })

  test('DELETE /data returns deleted counts', async () => {
    mockStore.clearAllData.mockResolvedValue({
      projects: 3,
      sessions: 10,
      agents: 20,
      events: 500,
    })

    const res = await app.request('/api/data', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      ok: true,
      deleted: { projects: 3, sessions: 10, agents: 20, events: 500 },
    })
  })

  test('DELETE /projects/:id returns 400 for non-numeric ID', async () => {
    const res = await app.request('/api/projects/abc', { method: 'DELETE' })
    expect(res.status).toBe(400)
  })
})

describe('admin routes — DELETE /data policy', () => {
  const mockStore = {
    clearAllData: vi.fn(),
  }

  async function buildApp(policy: string) {
    vi.resetModules()
    vi.doMock('./events', () => ({
      removeSessionRootAgent: vi.fn(),
      clearSessionRootAgents: vi.fn(),
    }))
    vi.doMock('../config', () => ({
      config: { allowDbReset: policy, dbPath: '/tmp/test.db' },
    }))

    const { default: adminRouter } = await import('./admin')
    const app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', mockStore as unknown as EventStore)
      c.set('broadcastToAll', vi.fn())
      c.set('broadcastToSession', vi.fn())
      await next()
    })
    app.route('/api', adminRouter)
    return app
  }

  test('denies reset when policy is deny', async () => {
    const app = await buildApp('deny')
    const res = await app.request('/api/data', { method: 'DELETE' })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.code).toBe('DB_RESET_DENIED')
    expect(mockStore.clearAllData).not.toHaveBeenCalled()
  })

  test('allows reset when policy is allow', async () => {
    mockStore.clearAllData.mockResolvedValue({ projects: 1, sessions: 2, agents: 3, events: 4 })
    const app = await buildApp('allow')
    const res = await app.request('/api/data', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(mockStore.clearAllData).toHaveBeenCalled()
  })
})

describe('admin routes — DB stats + bulk session delete', () => {
  let app: Hono<Env>
  const mockStore = {
    getDbStats: vi.fn(),
    deleteSessions: vi.fn(),
    vacuum: vi.fn(),
  }

  beforeEach(async () => {
    vi.resetModules()
    Object.values(mockStore).forEach((fn) => fn.mockReset())

    vi.doMock('./events', () => ({
      removeSessionRootAgent: vi.fn(),
      clearSessionRootAgents: vi.fn(),
    }))
    // Point config at a file that doesn't exist so statSync throws and
    // the route falls back to sizeBytes=0 — tests stay hermetic.
    vi.doMock('../config', () => ({
      config: { allowDbReset: 'allow', dbPath: '/tmp/does-not-exist-db-for-tests.db' },
    }))

    const { default: adminRouter } = await import('./admin')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', mockStore as unknown as EventStore)
      c.set('broadcastToAll', vi.fn())
      c.set('broadcastToSession', vi.fn())
      await next()
    })
    app.route('/api', adminRouter)
  })

  test('GET /db/stats returns dbPath, size, counts', async () => {
    mockStore.getDbStats.mockResolvedValue({ sessionCount: 12, eventCount: 34567 })
    const res = await app.request('/api/db/stats')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessionCount).toBe(12)
    expect(body.eventCount).toBe(34567)
    expect(body.dbPath).toBe('/tmp/does-not-exist-db-for-tests.db')
    expect(body.sizeBytes).toBe(0)
  })

  test('POST /sessions/bulk-delete deletes and vacuums', async () => {
    mockStore.deleteSessions.mockResolvedValue({ events: 100, agents: 5, sessions: 2 })
    mockStore.vacuum.mockResolvedValue(undefined)

    const res = await app.request('/api/sessions/bulk-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionIds: ['s1', 's2'] }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.deleted).toEqual({ events: 100, agents: 5, sessions: 2 })
    expect(mockStore.deleteSessions).toHaveBeenCalledWith(['s1', 's2'])
    expect(mockStore.vacuum).toHaveBeenCalledTimes(1)
  })

  test('POST /sessions/bulk-delete returns 400 when sessionIds missing', async () => {
    const res = await app.request('/api/sessions/bulk-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    expect(mockStore.deleteSessions).not.toHaveBeenCalled()
    expect(mockStore.vacuum).not.toHaveBeenCalled()
  })

  test('POST /sessions/bulk-delete returns 400 when sessionIds is not an array of strings', async () => {
    const res = await app.request('/api/sessions/bulk-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionIds: ['ok', 42] }),
    })
    expect(res.status).toBe(400)
    expect(mockStore.deleteSessions).not.toHaveBeenCalled()
  })

  test('POST /sessions/bulk-delete with empty array still vacuums', async () => {
    mockStore.deleteSessions.mockResolvedValue({ events: 0, agents: 0, sessions: 0 })
    mockStore.vacuum.mockResolvedValue(undefined)
    const res = await app.request('/api/sessions/bulk-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionIds: [] }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deleted).toEqual({ events: 0, agents: 0, sessions: 0 })
    expect(mockStore.vacuum).toHaveBeenCalled()
  })
})
