import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = { Variables: { store: EventStore } }

const stubStore = {
  healthCheck: async () => ({ ok: true }),
} as unknown as EventStore

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  test('exposes transcriptStatsEnabled: true when the flag is set', async () => {
    vi.doMock('../config', () => ({
      config: {
        apiId: 'test-api',
        version: '0.0.0',
        logLevel: 'info',
        runtime: 'node',
        dbPath: '/tmp/x.db',
        transcriptStats: { enabled: true },
      },
    }))
    vi.doMock('../consumer-tracker', () => ({ getConsumerCount: () => 0 }))
    vi.doMock('../websocket', () => ({ getClientCount: () => 0 }))

    const { default: router } = await import('./health')
    const app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', stubStore)
      await next()
    })
    app.route('/api', router)

    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.transcriptStatsEnabled).toBe(true)
  })

  test('exposes transcriptStatsEnabled: false when the flag is off', async () => {
    vi.doMock('../config', () => ({
      config: {
        apiId: 'test-api',
        version: '0.0.0',
        logLevel: 'info',
        runtime: 'node',
        dbPath: '/tmp/x.db',
        transcriptStats: { enabled: false },
      },
    }))
    vi.doMock('../consumer-tracker', () => ({ getConsumerCount: () => 0 }))
    vi.doMock('../websocket', () => ({ getClientCount: () => 0 }))

    const { default: router } = await import('./health')
    const app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', stubStore)
      await next()
    })
    app.route('/api', router)

    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.transcriptStatsEnabled).toBe(false)
  })
})
