import { describe, test, expect, beforeEach, vi } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventStore } from '../storage/types'

// Isolate the pricing module's disk cache to a fresh tmp dir for the
// whole suite. Without this, repeated test runs would share state via
// the file system.
const sharedDataDir = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs')
  const os = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-parser-index-'))
})
vi.mock('../config', () => ({
  config: { dataDir: sharedDataDir, transcriptStats: { enabled: true, bases: [] } },
}))

import { parseSessionTranscripts } from './index'
import { _testReset } from './models-pricing'

beforeEach(() => {
  // Reset in-memory cache; also wipe the disk cache file between tests
  // so the next fetch isn't served stale.
  _testReset()
  try {
    rmSync(join(sharedDataDir, 'models-dev.json'))
  } catch {}
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

const MAIN_FIXTURE_LINES = [
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
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        service_tier: 'standard',
      },
      content: [{ type: 'text', text: 'hi' }],
    },
  },
]

function writeMainFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'transcript-stats-v2-'))
  const p = join(dir, 'session.jsonl')
  writeFileSync(p, MAIN_FIXTURE_LINES.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return p
}

function makeStore(opts: { agents: Array<{ id: string; agent_class: string }> }): EventStore {
  return {
    getSessionTranscriptPath: async () => null,
    getAgentsForSession: async () => opts.agents as any,
  } as unknown as EventStore
}

describe('parseSessionTranscripts', () => {
  test('aggregates main-only when there are no subagents and attaches pricing', async () => {
    const path = writeMainFixture()
    const store = makeStore({ agents: [{ id: 'sess1', agent_class: 'claude-code' }] })
    const stats = await parseSessionTranscripts('sess1', store, path)
    expect(stats.source).toBe('jsonl')
    expect(stats.summary.totalCalls).toBe(1)
    expect(stats.byModel).toHaveLength(1)
    expect(stats.byModel[0].model).toBe('claude-opus-4-7')
    // 1000 input * $15/M + 500 output * $75/M = $0.015 + $0.0375 = $0.0525 → 5 cents
    expect(stats.byModel[0].costCents).toBe(5)
    expect(stats.summary.costTotalCents).toBe(5)
    expect(stats.models['claude-opus-4-7'].pricing).toMatchObject({ inputPerM: 15 })
  })

  test('costCents is null when pricing is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ anthropic: { models: {} } }),
      }),
    )
    _testReset()
    const path = writeMainFixture()
    const store = makeStore({ agents: [{ id: 'sess1', agent_class: 'claude-code' }] })
    const stats = await parseSessionTranscripts('sess1', store, path)
    expect(stats.byModel[0].costCents).toBeNull()
    expect(stats.summary.costTotalCents).toBeNull()
    expect(stats.models['claude-opus-4-7'].pricing).toBeNull()
  })

  test('prompt duration is self-contained: idle gap between prompts does not bleed in', async () => {
    // Two prompts: p1 has activity ending at +10s, then 10 minutes of
    // idle, then p2 starts at +610s with activity ending at +613s.
    // The old logic (next - this) would have given p1 a duration of
    // 610s — the entire gap. The fix should give p1 ~10s.
    const lines = [
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        promptId: 'p1',
        timestamp: '2026-06-01T00:00:00.000Z',
        message: { content: 'first' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        timestamp: '2026-06-01T00:00:10.000Z',
        isSidechain: false,
        message: {
          id: 'm1',
          model: 'claude-opus-4-7',
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'text', text: 'ok' }],
        },
      },
      {
        type: 'user',
        uuid: 'u2',
        parentUuid: null,
        promptId: 'p2',
        timestamp: '2026-06-01T00:10:10.000Z',
        message: { content: 'second' },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        parentUuid: 'u2',
        timestamp: '2026-06-01T00:10:13.000Z',
        isSidechain: false,
        message: {
          id: 'm2',
          model: 'claude-opus-4-7',
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'text', text: 'ok' }],
        },
      },
    ]
    const dir = mkdtempSync(join(tmpdir(), 'transcript-stats-multi-'))
    const path = join(dir, 'session.jsonl')
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')

    const store = makeStore({ agents: [{ id: 'sess1', agent_class: 'claude-code' }] })
    const stats = await parseSessionTranscripts('sess1', store, path)

    const p1 = stats.prompts.find((p) => p.promptId === 'p1')!
    const p2 = stats.prompts.find((p) => p.promptId === 'p2')!
    expect(p1.durationMs).toBe(10_000) // +10s from prompt to last activity
    expect(p2.durationMs).toBe(3_000) // +3s from prompt to last activity
    // The gap between prompts (600s) must NOT appear anywhere.
    expect(p1.durationMs).toBeLessThan(60_000)
  })

  test('last prompt has a non-null duration (was null under previous logic)', async () => {
    // Single-prompt fixture: the only prompt would have been the "last
    // prompt with no next" under the old logic and gotten null. With
    // the fix it should be ~1s (its assistant call timestamp - prompt
    // timestamp).
    const path = writeMainFixture()
    const store = makeStore({ agents: [{ id: 'sess1', agent_class: 'claude-code' }] })
    const stats = await parseSessionTranscripts('sess1', store, path)
    const prompt = stats.prompts.find((p) => p.promptId === 'p1')!
    expect(prompt.durationMs).not.toBeNull()
    expect(prompt.durationMs).toBe(1_000) // 1s between user line and assistant line
  })

  test('routes codex sessions to the codex parser and produces normalized stats', async () => {
    // Mock models.dev to include the gpt model used in the fixture so
    // cost math resolves cleanly.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          openai: {
            models: {
              'gpt-5.4': { id: 'gpt-5.4', cost: { input: 5, output: 15, cache_read: 0.5 } },
            },
          },
        }),
      }),
    )
    _testReset()

    const lines = [
      {
        timestamp: '2026-06-01T00:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'sess-codex', cwd: '/x', originator: 'codex-tui' },
      },
      {
        timestamp: '2026-06-01T00:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 't1', started_at: 0 },
      },
      {
        timestamp: '2026-06-01T00:00:01.100Z',
        type: 'turn_context',
        payload: { turn_id: 't1', model: 'gpt-5.4', effort: 'high' },
      },
      {
        timestamp: '2026-06-01T00:00:01.200Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'hi' },
      },
      {
        timestamp: '2026-06-01T00:00:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 200,
              output_tokens: 100,
              reasoning_output_tokens: 50,
              total_tokens: 1150,
            },
            total_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 200,
              output_tokens: 100,
              reasoning_output_tokens: 50,
              total_tokens: 1150,
            },
          },
        },
      },
      {
        timestamp: '2026-06-01T00:00:03.000Z',
        type: 'event_msg',
        payload: { type: 'task_complete', turn_id: 't1', duration_ms: 2000 },
      },
    ]
    const dir = mkdtempSync(join(tmpdir(), 'transcript-stats-codex-'))
    const path = join(dir, 'rollout.jsonl')
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')

    const store = makeStore({ agents: [{ id: 'sess-codex', agent_class: 'codex' }] })
    const stats = await parseSessionTranscripts('sess-codex', store, path)

    expect(stats.source).toBe('jsonl')
    expect(stats.byModel).toHaveLength(1)
    expect(stats.byModel[0].model).toBe('gpt-5.4')
    expect(stats.byModel[0].calls).toBe(1)
    // gpt-5.4 has cache_read=0.5, no cache_write → cacheCreate5m/1h = 0.
    expect(stats.models['gpt-5.4'].pricing).toMatchObject({
      inputPerM: 5,
      outputPerM: 15,
      cacheReadPerM: 0.5,
      cacheCreate5mPerM: 0,
      cacheCreate1hPerM: 0,
    })
    // Single prompt (turn t1), tokens flow through unchanged.
    expect(stats.prompts).toHaveLength(1)
    expect(stats.prompts[0].promptId).toBe('t1')
    expect(stats.prompts[0].text).toBe('hi')
    // No subagents.
    expect(stats.subagents).toEqual([])
    // Cost: fresh = 1000 - 200 = 800 input. 800*$5/M + 150*$15/M + 200*$0.5/M
    //   = $0.004 + $0.00225 + $0.0001 = $0.00635 → 1 cent.
    expect(stats.byModel[0].costCents).toBe(1)
  })

  test('unsupported main agent class records an error without failing', async () => {
    const path = writeMainFixture()
    const store = makeStore({
      // The session's main agent is of an unknown class.
      agents: [{ id: 'sess1', agent_class: 'some-future-runtime' }],
    })
    const stats = await parseSessionTranscripts('sess1', store, path)
    expect(stats.errors).toContainEqual(
      expect.objectContaining({
        scope: 'main',
        code: 'parse_error',
        message: expect.stringContaining('some-future-runtime'),
      }),
    )
    // No parser runs for the unknown class, so all aggregates are empty.
    expect(stats.byModel).toHaveLength(0)
    expect(stats.prompts).toHaveLength(0)
  })
})
