import { describe, test, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { writeFileSync, mkdtempSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventStore } from '../storage/types'

// Use vi.hoisted so the mocked config object is mutable across tests.
// dataDir is required for the pricing module's disk cache; share one
// tmp dir across the suite.
const sharedTmpDir = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs')
  const os = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-stats-route-'))
})
const transcriptConfig = vi.hoisted(() => ({
  enabled: true,
  bases: [] as Array<{ agentClass: string; host: string; container: string }>,
  maxFileBytes: 100 * 1024 * 1024,
}))
vi.mock('../config', () => ({
  config: { transcriptStats: transcriptConfig, dataDir: sharedTmpDir },
}))

// Import after the mock is set up.
import transcriptStatsRouter from './transcript-stats'

function makeApp(store: Partial<EventStore>) {
  const app = new Hono<{ Variables: { store: EventStore } }>()
  app.use('*', async (c, next) => {
    // Default getAgentsForSession to empty so non-200 paths still satisfy
    // the route's call signature when individual tests don't override it.
    const merged = {
      getAgentsForSession: async () => [] as any,
      ...store,
    } as EventStore
    c.set('store', merged)
    await next()
  })
  app.route('/api', transcriptStatsRouter)
  return app
}

const MINIMAL_FIXTURE = [
  {
    type: 'user',
    uuid: 'u1',
    parentUuid: null,
    promptId: 'p1',
    timestamp: '2026-05-22T00:00:00.000Z',
    message: { content: 'hi' },
  },
  {
    type: 'assistant',
    uuid: 'a1',
    parentUuid: 'u1',
    timestamp: '2026-05-22T00:00:01.000Z',
    isSidechain: false,
    message: {
      id: 'msg1',
      model: 'claude-opus-4-7',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 1,
        output_tokens: 10,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        service_tier: 'standard',
      },
      content: [{ type: 'text', text: 'hi' }],
    },
  },
]

function writeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'transcript-route-'))
  const p = join(dir, 'session.jsonl')
  writeFileSync(p, MINIMAL_FIXTURE.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return p
}

describe('GET /api/sessions/:sessionId/transcript-stats', () => {
  beforeEach(() => {
    transcriptConfig.enabled = true
    transcriptConfig.bases = []
    transcriptConfig.maxFileBytes = 100 * 1024 * 1024
    // Mock models.dev fetch so pricing resolves deterministically.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          anthropic: {
            models: {
              'claude-opus-4-7': {
                id: 'claude-opus-4-7',
                cost: { input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
              },
            },
          },
        }),
      }),
    )
  })

  test('returns 200 with parsed V2 stats when transcript exists', async () => {
    const path = writeFixture()
    const app = makeApp({
      getSessionTranscriptPath: async () => path,
      getAgentsForSession: async () => [{ id: 'sess1', agent_class: 'claude-code' }] as any,
    })
    const res = await app.request('/api/sessions/sess1/transcript-stats')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('jsonl')
    expect(body.summary.totalCalls).toBe(1)
    expect(body.byModel).toHaveLength(1)
    expect(body.byModel[0].model).toBe('claude-opus-4-7')
    expect(body.prompts).toBeInstanceOf(Array)
    expect(body.subagents).toBeInstanceOf(Array)
    expect(body.models).toBeDefined()
    expect(body.errors).toBeInstanceOf(Array)
  })

  test('returns 404 disabled when feature flag is off', async () => {
    transcriptConfig.enabled = false
    const app = makeApp({
      getSessionTranscriptPath: async () => '/never/reached.jsonl',
    })
    const res = await app.request('/api/sessions/sess1/transcript-stats')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('disabled')
  })

  test('returns 404 no_transcript when session has no transcript_path', async () => {
    const app = makeApp({
      getSessionTranscriptPath: async () => null,
    })
    const res = await app.request('/api/sessions/sess1/transcript-stats')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('no_transcript')
  })

  test('returns 404 file_not_found when transcript file does not exist', async () => {
    const app = makeApp({
      getSessionTranscriptPath: async () => '/nonexistent/foo.jsonl',
    })
    const res = await app.request('/api/sessions/sess1/transcript-stats')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('file_not_found')
  })

  test('returns 413 file_too_large when transcript exceeds cap', async () => {
    transcriptConfig.maxFileBytes = 10
    const path = writeFixture()
    const app = makeApp({
      getSessionTranscriptPath: async () => path,
    })
    const res = await app.request('/api/sessions/sess1/transcript-stats')
    expect(res.status).toBe(413)
    const body = await res.json()
    expect(body.error).toBe('file_too_large')
  })

  test('returns 403 file_unreadable when EACCES (best-effort, skipped if cannot chmod)', async () => {
    const path = writeFixture()
    try {
      chmodSync(path, 0o000)
    } catch {
      return
    }
    const app = makeApp({
      getSessionTranscriptPath: async () => path,
    })
    const res = await app.request('/api/sessions/sess1/transcript-stats')
    chmodSync(path, 0o600)
    expect([403, 404]).toContain(res.status)
    const body = await res.json()
    expect(['file_unreadable', 'file_not_found']).toContain(body.error)
  })

  test('returns 500 parse_error when the parser throws', async () => {
    const path = writeFixture()
    vi.doMock('../transcript-parser', () => ({
      parseSessionTranscripts: async () => {
        throw new Error('boom')
      },
    }))
    vi.resetModules()
    const reloaded = (await import('./transcript-stats')).default
    const app = new Hono<{ Variables: { store: EventStore } }>()
    app.use('*', async (c, next) => {
      c.set('store', {
        getSessionTranscriptPath: async () => path,
        getAgentsForSession: async () => [],
      } as unknown as EventStore)
      await next()
    })
    app.route('/api', reloaded)
    const res = await app.request('/api/sessions/sess1/transcript-stats')
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('parse_error')
    expect(body.message).toContain('boom')
    vi.doUnmock('../transcript-parser')
  })
})
