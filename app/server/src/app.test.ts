import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { EventStore } from './storage/types'

const stubStore = {
  healthCheck: async () => ({ ok: true }),
} as unknown as EventStore
const noop = () => {}

describe('dev mode redirect', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('redirects unmatched GET requests to dev client', async () => {
    vi.doMock('./config', () => ({
      config: {
        clientDistPath: '',
        isDev: true,
        devClientPort: 5174,
      },
    }))

    const { createApp } = await import('./app')
    const app = createApp(stubStore, noop, noop)

    const res = await app.request('/', { method: 'GET' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:5174')
  })

  test('redirects arbitrary paths to dev client', async () => {
    vi.doMock('./config', () => ({
      config: {
        clientDistPath: '',
        isDev: true,
        devClientPort: 5174,
      },
    }))

    const { createApp } = await import('./app')
    const app = createApp(stubStore, noop, noop)

    const res = await app.request('/some/path', { method: 'GET' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:5174')
  })

  test('does not redirect API routes', async () => {
    vi.doMock('./config', () => ({
      config: {
        clientDistPath: '',
        isDev: true,
        devClientPort: 5174,
      },
    }))

    const { createApp } = await import('./app')
    const app = createApp(stubStore, noop, noop)

    const res = await app.request('/api/health', { method: 'GET' })
    expect(res.status).toBe(200)
  })

  test('does not redirect when runtime is not dev', async () => {
    vi.doMock('./config', () => ({
      config: {
        clientDistPath: '',
        isDev: false,
        devClientPort: 5174,
      },
    }))

    const { createApp } = await import('./app')
    const app = createApp(stubStore, noop, noop)

    const res = await app.request('/', { method: 'GET' })
    expect(res.status).toBe(404)
  })

  test('uses configured devClientPort', async () => {
    vi.doMock('./config', () => ({
      config: {
        clientDistPath: '',
        isDev: true,
        devClientPort: 9999,
      },
    }))

    const { createApp } = await import('./app')
    const app = createApp(stubStore, noop, noop)

    const res = await app.request('/', { method: 'GET' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:9999')
  })
})
