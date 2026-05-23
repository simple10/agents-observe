import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCodexSession } from './codex'

// A minimal but realistic codex session: 2 turns, the second with a
// function call. Token-count snapshots include the "duplicate idle
// ping" that real codex emits before the second turn's API call lands.
const FIXTURE_LINES = [
  // ── session metadata ─────────────────────────────────────────
  {
    timestamp: '2026-06-01T00:00:00.000Z',
    type: 'session_meta',
    payload: { id: 'sess-1', cwd: '/x', originator: 'codex-tui', model_provider: 'openai' },
  },

  // ── turn 1: "hi" ─────────────────────────────────────────────
  {
    timestamp: '2026-06-01T00:00:01.000Z',
    type: 'event_msg',
    payload: { type: 'task_started', turn_id: 'turn-1', started_at: 0 },
  },
  {
    timestamp: '2026-06-01T00:00:01.100Z',
    type: 'turn_context',
    payload: { turn_id: 'turn-1', model: 'gpt-5.4', effort: 'high' },
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
          input_tokens: 100,
          cached_input_tokens: 50,
          output_tokens: 20,
          reasoning_output_tokens: 5,
          total_tokens: 125,
        },
        total_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 50,
          output_tokens: 20,
          reasoning_output_tokens: 5,
          total_tokens: 125,
        },
      },
    },
  },
  {
    timestamp: '2026-06-01T00:00:02.500Z',
    type: 'event_msg',
    payload: { type: 'task_complete', turn_id: 'turn-1', duration_ms: 1500 },
  },

  // ── turn 2: "what's my name" with a function call ────────────
  {
    timestamp: '2026-06-01T00:00:10.000Z',
    type: 'event_msg',
    payload: { type: 'task_started', turn_id: 'turn-2', started_at: 0 },
  },
  {
    timestamp: '2026-06-01T00:00:10.100Z',
    type: 'turn_context',
    payload: { turn_id: 'turn-2', model: 'gpt-5.4', effort: 'high' },
  },
  {
    timestamp: '2026-06-01T00:00:10.200Z',
    type: 'event_msg',
    payload: { type: 'user_message', message: "what's my name" },
  },
  // Idle / duplicate ping: same total_tokens as before — must NOT
  // create a new call.
  {
    timestamp: '2026-06-01T00:00:11.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 50,
          output_tokens: 20,
          reasoning_output_tokens: 5,
          total_tokens: 125,
        },
        total_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 50,
          output_tokens: 20,
          reasoning_output_tokens: 5,
          total_tokens: 125,
        },
      },
    },
  },
  {
    timestamp: '2026-06-01T00:00:11.500Z',
    type: 'response_item',
    payload: { type: 'function_call', name: 'exec_command', call_id: 'call_A' },
  },
  {
    timestamp: '2026-06-01T00:00:11.800Z',
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: 'call_A', output: 'ok' },
  },
  {
    timestamp: '2026-06-01T00:00:12.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: 200,
          cached_input_tokens: 50,
          output_tokens: 40,
          reasoning_output_tokens: 10,
          total_tokens: 250,
        },
        total_token_usage: {
          input_tokens: 300,
          cached_input_tokens: 100,
          output_tokens: 60,
          reasoning_output_tokens: 15,
          total_tokens: 375,
        },
      },
    },
  },
  {
    timestamp: '2026-06-01T00:00:13.000Z',
    type: 'event_msg',
    payload: { type: 'task_complete', turn_id: 'turn-2', duration_ms: 3000 },
  },
]

let TMP_DIR = ''
let FIXTURE_PATH = ''

beforeAll(() => {
  TMP_DIR = mkdtempSync(join(tmpdir(), 'codex-parser-'))
  FIXTURE_PATH = join(TMP_DIR, 'rollout.jsonl')
  writeFileSync(FIXTURE_PATH, FIXTURE_LINES.map((l) => JSON.stringify(l)).join('\n') + '\n')
})

afterAll(() => {
  try {
    rmSync(TMP_DIR, { recursive: true, force: true })
  } catch {}
})

describe('parseCodexSession', () => {
  test('emits one TranscriptCall per *new* token_count snapshot — duplicates are skipped', async () => {
    const result = await parseCodexSession(FIXTURE_PATH, [])
    expect(result.calls).toHaveLength(2)
    expect(result.calls[0].promptId).toBe('turn-1')
    expect(result.calls[1].promptId).toBe('turn-2')
  })

  test('reasoning_output_tokens rolls into the output bucket', async () => {
    const result = await parseCodexSession(FIXTURE_PATH, [])
    // turn-1: output=20, reasoning=5 → 25
    expect(result.calls[0].usage.outputTokens).toBe(25)
    // turn-2: output=40, reasoning=10 → 50
    expect(result.calls[1].usage.outputTokens).toBe(50)
  })

  test('cached_input_tokens maps to cacheReadTokens; cache_write fields are zero', async () => {
    const result = await parseCodexSession(FIXTURE_PATH, [])
    expect(result.calls[0].usage.cacheReadTokens).toBe(50)
    expect(result.calls[0].usage.cacheCreate5mTokens).toBe(0)
    expect(result.calls[0].usage.cacheCreate1hTokens).toBe(0)
    // OpenAI's input_tokens already includes the cached subset →
    // matches the parser's "bundled input" convention.
    expect(result.calls[0].usage.inputTokens).toBe(100)
  })

  test('model from turn_context attaches to the call', async () => {
    const result = await parseCodexSession(FIXTURE_PATH, [])
    expect(result.calls[0].model).toBe('gpt-5.4')
    expect(result.calls[1].model).toBe('gpt-5.4')
  })

  test('prompts indexed by turn_id with user_message text', async () => {
    const result = await parseCodexSession(FIXTURE_PATH, [])
    expect(result.prompts['turn-1']?.text).toBe('hi')
    expect(result.prompts['turn-2']?.text).toBe("what's my name")
  })

  test('function_call attribution: tool_use_id appended to the most recent call', async () => {
    const result = await parseCodexSession(FIXTURE_PATH, [])
    // turn-2 has one function_call landing between its first idle
    // token_count and the real one — should attach to turn-1's call
    // (the last one before the function_call line). That's fine for
    // per-prompt tool-count aggregation since we sum tool_use_ids
    // across the prompt's calls in aggregatePrompts.
    expect(result.calls.flatMap((c) => c.toolUseIds)).toContain('call_A')
  })

  test('lastTimestampByPromptId attributes lines to the active turn', async () => {
    const result = await parseCodexSession(FIXTURE_PATH, [])
    // turn-1's last activity = its task_complete at +2.5s
    expect(result.lastTimestampByPromptId['turn-1']).toBe(Date.parse('2026-06-01T00:00:02.500Z'))
    // turn-2's last activity = its task_complete at +13s
    expect(result.lastTimestampByPromptId['turn-2']).toBe(Date.parse('2026-06-01T00:00:13.000Z'))
  })

  test('subagents are always empty for codex', async () => {
    const result = await parseCodexSession(FIXTURE_PATH, ['some-id'])
    expect(result.subagents).toEqual([])
  })

  test('empty file (no turns / token counts) produces a parse_error in errors[]', async () => {
    const emptyPath = join(TMP_DIR, 'empty.jsonl')
    writeFileSync(emptyPath, '')
    const result = await parseCodexSession(emptyPath, [])
    expect(result.errors).toContainEqual(
      expect.objectContaining({ scope: 'main', code: 'parse_error' }),
    )
  })
})
