import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseClaudeSession } from './claude'

const FIXTURE_LINES = [
  {
    type: 'user',
    uuid: 'u1',
    parentUuid: null,
    promptId: 'p1',
    sessionId: 's',
    timestamp: '2026-05-22T00:00:00.000Z',
    message: { content: 'hello world' },
  },
  {
    type: 'attachment',
    uuid: 'a1',
    parentUuid: 'u1',
    sessionId: 's',
    timestamp: '2026-05-22T00:00:00.500Z',
  },
  {
    type: 'assistant',
    uuid: 'as1a',
    parentUuid: 'a1',
    sessionId: 's',
    timestamp: '2026-05-22T00:00:01.000Z',
    isSidechain: false,
    requestId: 'req_aaaa',
    message: {
      id: 'msg1',
      model: 'claude-opus-4-7',
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 10,
        output_tokens: 100,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 20,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 20 },
        service_tier: 'standard',
      },
      content: [{ type: 'thinking', thinking: '' }],
    },
  },
  {
    type: 'assistant',
    uuid: 'as1b',
    parentUuid: 'as1a',
    sessionId: 's',
    timestamp: '2026-05-22T00:00:01.500Z',
    isSidechain: false,
    requestId: 'req_aaaa',
    message: {
      id: 'msg1',
      model: 'claude-opus-4-7',
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 10,
        output_tokens: 100,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 20,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 20 },
        service_tier: 'standard',
      },
      content: [
        { type: 'tool_use', id: 'toolu_1', name: 'Read' },
        { type: 'tool_use', id: 'toolu_2', name: 'Bash' },
      ],
    },
  },
  {
    type: 'user',
    uuid: 'u2',
    parentUuid: 'as1b',
    promptId: 'p1',
    sessionId: 's',
    timestamp: '2026-05-22T00:00:02.000Z',
    message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
  },
]

const TMP_DIR = mkdtempSync(join(tmpdir(), 'claude-parser-'))
const FIXTURE_PATH = join(TMP_DIR, 'fixture.jsonl')

beforeAll(() => {
  writeFileSync(FIXTURE_PATH, FIXTURE_LINES.map((l) => JSON.stringify(l)).join('\n') + '\n')
})

afterAll(() => {
  try {
    rmSync(TMP_DIR, { recursive: true, force: true })
  } catch {}
})

describe('parseClaudeSession — main only', () => {
  test('returns deduped calls + prompts + empty subagents', async () => {
    const result = await parseClaudeSession(FIXTURE_PATH, [])
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0].messageId).toBe('msg1')
    expect(result.calls[0].toolUseIds).toEqual(['toolu_1', 'toolu_2'])
    expect(result.calls[0].promptId).toBe('p1')
    expect(result.calls[0].requestId).toBe('req_aaaa')
    expect(result.calls[0].serviceTier).toBe('standard')
    expect(result.calls[0].stopReason).toBe('tool_use')
    expect(result.calls[0].usage).toEqual({
      inputTokens: 10,
      outputTokens: 100,
      cacheReadTokens: 50,
      cacheCreate5mTokens: 0,
      cacheCreate1hTokens: 20,
    })
    expect(result.prompts.p1.text).toBe('hello world')
    expect(result.subagents).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })
})

function writeSubagent(
  mainTranscriptPath: string,
  agentId: string,
  meta: { agentType: string; description: string; toolUseId: string } | null,
  assistantLines: Array<{ model: string; usage: any; content: any[]; ts: string }>,
) {
  const dir = mainTranscriptPath.replace(/\.jsonl$/, '') + '/subagents'
  mkdirSync(dir, { recursive: true })
  const jsonl = dir + `/agent-${agentId}.jsonl`
  const lines = assistantLines.map((a, i) => ({
    type: 'assistant',
    uuid: `${agentId}-u${i}`,
    parentUuid: i === 0 ? null : `${agentId}-u${i - 1}`,
    timestamp: a.ts,
    isSidechain: true,
    message: {
      id: `${agentId}-msg${i}`,
      model: a.model,
      stop_reason: 'end_turn',
      usage: a.usage,
      content: a.content,
    },
  }))
  writeFileSync(jsonl, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  if (meta) {
    writeFileSync(dir + `/agent-${agentId}.meta.json`, JSON.stringify(meta))
  }
}

describe('parseClaudeSession — subagents', () => {
  test('discovers and parses subagent jsonls with meta', async () => {
    writeSubagent(
      FIXTURE_PATH,
      'abbbe04b48fa19be8',
      {
        agentType: 'Explore',
        description: 'Explore filter system architecture',
        toolUseId: 'toolu_01L9nccf5aK3cVFpa8VZnyYW',
      },
      [
        {
          model: 'claude-haiku-4-5-20251001',
          ts: '2026-05-22T00:00:10.000Z',
          usage: {
            input_tokens: 5,
            output_tokens: 40,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
            service_tier: 'standard',
          },
          content: [{ type: 'tool_use', id: 'toolu_sub1', name: 'Read' }],
        },
        {
          model: 'claude-haiku-4-5-20251001',
          ts: '2026-05-22T00:00:20.000Z',
          usage: {
            input_tokens: 3,
            output_tokens: 20,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
            service_tier: 'standard',
          },
          content: [{ type: 'text', text: 'done' }],
        },
      ],
    )
    const result = await parseClaudeSession(FIXTURE_PATH, ['abbbe04b48fa19be8'])
    expect(result.subagents).toHaveLength(1)
    const sub = result.subagents[0]
    expect(sub.agentId).toBe('abbbe04b48fa19be8')
    expect(sub.agentType).toBe('Explore')
    expect(sub.description).toBe('Explore filter system architecture')
    expect(sub.toolUseId).toBe('toolu_01L9nccf5aK3cVFpa8VZnyYW')
    expect(sub.model).toBe('claude-haiku-4-5-20251001')
    expect(sub.requests).toBe(2)
    expect(sub.inputTokens).toBe(8)
    expect(sub.outputTokens).toBe(60)
    expect(sub.toolCount).toBe(1)
    expect(sub.durationMs).toBe(10_000)
  })

  test('missing subagent jsonl pushes to errors[] and is filtered out of subagents[]', async () => {
    const result = await parseClaudeSession(FIXTURE_PATH, ['nonexistent-id'])
    // The load failure is surfaced for diagnostics…
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        scope: 'subagent',
        agentId: 'nonexistent-id',
        code: 'missing',
      }),
    )
    // …but the agent itself is skipped from the table since it has
    // zero LLM activity — these are typically cruft entries in the DB.
    expect(result.subagents.find((s) => s.agentId === 'nonexistent-id')).toBeUndefined()
  })

  test('subagent without .meta.json still parses with null meta fields', async () => {
    writeSubagent(FIXTURE_PATH, 'orphan', null, [
      {
        model: 'claude-opus-4-7',
        ts: '2026-05-22T00:00:30.000Z',
        usage: {
          input_tokens: 1,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
          service_tier: 'standard',
        },
        content: [{ type: 'text', text: 'ok' }],
      },
    ])
    const result = await parseClaudeSession(FIXTURE_PATH, ['orphan'])
    const sub = result.subagents.find((s) => s.agentId === 'orphan')
    expect(sub).toBeDefined()
    expect(sub!.agentType).toBeNull()
    expect(sub!.description).toBeNull()
    expect(sub!.toolUseId).toBeNull()
    expect(sub!.model).toBe('claude-opus-4-7')
  })
})
