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
    const result = await parseClaudeSession(FIXTURE_PATH)
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0].messageId).toBe('msg1')
    expect(result.calls[0].toolUseIds).toEqual(['toolu_1', 'toolu_2'])
    // promptId is now the canonical uuid of the user-prompt line
    // (was the JSONL's promptId field). See claude.ts: switching to
    // uuid sidesteps the resume-replay bug where promptId is re-minted.
    expect(result.calls[0].promptId).toBe('u1')
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
    // prompts index is now keyed by the user-prompt line's uuid.
    expect(result.prompts.u1.text).toBe('hello world')
    // Ordinary typed prompt — no slash command.
    expect(result.prompts.u1.command).toBeNull()
    expect(result.subagents).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  test('slash-command expansion gets a reconstructed `command` from the <command-name> inject', async () => {
    // A slash command lands as two user lines sharing one promptId: the
    // <command-name> inject (filtered from prompts) and the expanded skill
    // body (the registered prompt). The reconstructed `/name args` must
    // attach to the body prompt and match the hook event payload exactly.
    const lines = [
      {
        type: 'user',
        uuid: 'cmd-uuid',
        parentUuid: null,
        promptId: 'pc',
        timestamp: '2026-05-22T00:00:00.000Z',
        message: {
          content:
            "<command-message>deep-research</command-message>\n<command-name>/deep-research</command-name>\n<command-args>what's new</command-args>",
        },
      },
      {
        type: 'user',
        uuid: 'body-uuid',
        parentUuid: 'cmd-uuid',
        promptId: 'pc',
        timestamp: '2026-05-22T00:00:00.100Z',
        message: { content: 'Run the "deep-research" workflow. Deep research harness…' },
      },
      {
        type: 'assistant',
        uuid: 'as-cmd',
        parentUuid: 'body-uuid',
        timestamp: '2026-05-22T00:00:01.000Z',
        isSidechain: false,
        message: {
          id: 'mc',
          model: 'claude-opus-4-7',
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'text', text: 'ok' }],
        },
      },
    ]
    const path = join(TMP_DIR, 'slash.jsonl')
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')

    const result = await parseClaudeSession(path)
    // Only the expansion body is a registered prompt; the inject is filtered.
    expect(result.prompts['cmd-uuid']).toBeUndefined()
    const body = result.prompts['body-uuid']
    expect(body.text).toBe('Run the "deep-research" workflow. Deep research harness…')
    // Byte-identical to a UserPromptSubmit/Expansion `prompt` payload.
    expect(body.command).toBe("/deep-research what's new")
  })

  test('argless slash command reconstructs to just the command name', async () => {
    const lines = [
      {
        type: 'user',
        uuid: 'c2',
        parentUuid: null,
        promptId: 'p2',
        timestamp: '2026-05-22T00:00:00.000Z',
        message: {
          content:
            '<command-message>using-superpowers</command-message>\n<command-name>/superpowers:using-superpowers</command-name>',
        },
      },
      {
        type: 'user',
        uuid: 'b2',
        parentUuid: 'c2',
        promptId: 'p2',
        timestamp: '2026-05-22T00:00:00.100Z',
        message: { content: 'You are using superpowers…' },
      },
    ]
    const path = join(TMP_DIR, 'slash-argless.jsonl')
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')

    const result = await parseClaudeSession(path)
    expect(result.prompts['b2'].command).toBe('/superpowers:using-superpowers')
  })

  test('lastTimestampByPromptId records the latest line attributable to each prompt', async () => {
    const result = await parseClaudeSession(FIXTURE_PATH)
    // The fixture's last line for p1 is the tool_result user message at
    // 2026-05-22T00:00:02.000Z. parseClaudeSession should attribute that
    // (via parentUuid chain) back to p1.
    const expectedLastTs = Date.parse('2026-05-22T00:00:02.000Z')
    expect(result.lastTimestampByPromptId.u1).toBe(expectedLastTs)
  })

  test('lastTimestampByPromptId walks multi-hop parentUuid chains', async () => {
    // Fixture path: user(p1) → attachment → assistant(as1a) → assistant(as1b) → user(tool_result).
    // The deepest descendant must still attribute back to p1. The latest
    // descendant's timestamp must dominate over earlier ones.
    const result = await parseClaudeSession(FIXTURE_PATH)
    expect(result.lastTimestampByPromptId.u1).toBeGreaterThan(
      Date.parse('2026-05-22T00:00:01.500Z'), // beats the last assistant ts
    )
  })

  test('multi-prompt fixture: each prompt has its own last-timestamp, idle gaps do not bleed', async () => {
    // Build a fixture with two prompts: p1 finishes at T+10s, then a
    // 600s idle window, then p2 at T+610s with its own short activity.
    const lines = [
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        promptId: 'p1',
        sessionId: 's',
        timestamp: '2026-06-01T00:00:00.000Z',
        message: { content: 'first prompt' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        sessionId: 's',
        timestamp: '2026-06-01T00:00:10.000Z',
        isSidechain: false,
        message: {
          id: 'm1',
          model: 'claude-opus-4-7',
          stop_reason: 'end_turn',
          usage: {},
          content: [],
        },
      },
      // 10 minutes of idle time…
      {
        type: 'user',
        uuid: 'u2',
        parentUuid: null,
        promptId: 'p2',
        sessionId: 's',
        timestamp: '2026-06-01T00:10:10.000Z',
        message: { content: 'second prompt' },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        parentUuid: 'u2',
        sessionId: 's',
        timestamp: '2026-06-01T00:10:13.000Z',
        isSidechain: false,
        message: {
          id: 'm2',
          model: 'claude-opus-4-7',
          stop_reason: 'end_turn',
          usage: {},
          content: [],
        },
      },
    ]
    const path = join(TMP_DIR, 'multi.jsonl')
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')

    const result = await parseClaudeSession(path)

    // p1's last activity must be its OWN assistant call (T+10s), not
    // anything from p2's window — even though p2's lines exist later
    // in the same file.
    expect(result.lastTimestampByPromptId.u1).toBe(Date.parse('2026-06-01T00:00:10.000Z'))
    // p2's last activity is its own assistant call at T+613s, not the
    // session's tail. Keyed by uuid `u2` (the second user prompt line).
    expect(result.lastTimestampByPromptId.u2).toBe(Date.parse('2026-06-01T00:10:13.000Z'))

    // Sanity: the idle gap between prompts (600s) is NOT included in
    // p1's activity span.
    const p1Span = result.lastTimestampByPromptId.u1 - Date.parse('2026-06-01T00:00:00.000Z')
    expect(p1Span).toBe(10_000)
  })

  test('skips locally-synthesized <synthetic> assistant messages (API-error placeholders)', async () => {
    // Claude Code injects fake assistant lines with model "<synthetic>"
    // and zero-token usage when an API call fails (policy block, socket
    // drop, etc.). They aren't real LLM calls — including them poisons
    // cost aggregation because <synthetic> has no models.dev pricing.
    const lines = [
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        promptId: 'p1',
        sessionId: 's',
        timestamp: '2026-05-22T00:00:00.000Z',
        message: { content: 'hi' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        sessionId: 's',
        timestamp: '2026-05-22T00:00:01.000Z',
        isSidechain: false,
        message: {
          id: 'real-msg',
          model: 'claude-opus-4-7',
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 10 },
          content: [{ type: 'text', text: 'real reply' }],
        },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        parentUuid: 'a1',
        sessionId: 's',
        timestamp: '2026-05-22T00:00:02.000Z',
        isSidechain: false,
        isApiErrorMessage: true,
        message: {
          id: 'synth-msg',
          model: '<synthetic>',
          stop_reason: 'stop_sequence',
          usage: { input_tokens: 0, output_tokens: 0 },
          content: [{ type: 'text', text: 'API Error: …' }],
        },
      },
    ]
    const path = join(TMP_DIR, 'synthetic.jsonl')
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')

    const result = await parseClaudeSession(path)
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0].messageId).toBe('real-msg')
    expect(result.calls.find((c) => c.model === '<synthetic>')).toBeUndefined()
  })
})

describe('parseClaudeSession — tool stats', () => {
  // Build a fixture with three different tools plus a pair of tool_result
  // lines, so we exercise file aggregation, gitCommits matching, and the
  // tool_use ↔ tool_result duration pairing in one pass.
  const TOOL_FIXTURE_LINES = [
    {
      type: 'user',
      uuid: 'u1',
      parentUuid: null,
      promptId: 'p1',
      timestamp: '2026-07-01T00:00:00.000Z',
      message: { content: 'do stuff' },
    },
    // Assistant emits 4 tool_use blocks across two messages.
    {
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'u1',
      timestamp: '2026-07-01T00:00:01.000Z',
      isSidechain: false,
      message: {
        id: 'm1',
        model: 'claude-opus-4-7',
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [
          { type: 'tool_use', id: 'tu_read1', name: 'Read', input: { file_path: '/x/a.ts' } },
          { type: 'tool_use', id: 'tu_read2', name: 'Read', input: { file_path: '/x/a.ts' } }, // same path → dedup
          { type: 'tool_use', id: 'tu_edit', name: 'Edit', input: { file_path: '/x/b.ts' } },
        ],
      },
    },
    // tool_result for tu_read1 — 500ms after its tool_use.
    {
      type: 'user',
      uuid: 'r1',
      parentUuid: 'a1',
      timestamp: '2026-07-01T00:00:01.500Z',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu_read1', content: 'ok' }],
      },
    },
    // tool_result for tu_read2 — 2000ms (the slowest Read).
    {
      type: 'user',
      uuid: 'r2',
      parentUuid: 'r1',
      timestamp: '2026-07-01T00:00:03.000Z',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu_read2', content: 'ok' }],
      },
    },
    // Bash invocation that should match the git commit regex.
    {
      type: 'assistant',
      uuid: 'a2',
      parentUuid: 'r2',
      timestamp: '2026-07-01T00:00:04.000Z',
      isSidechain: false,
      message: {
        id: 'm2',
        model: 'claude-opus-4-7',
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [
          {
            type: 'tool_use',
            id: 'tu_bash',
            name: 'Bash',
            input: { command: 'git commit -m hi' },
          },
        ],
      },
    },
  ]

  test('aggregates filesRead/filesEdited/gitCommits/toolCalls + per-tool durations + longestToolUseId', async () => {
    const path = join(TMP_DIR, 'tools.jsonl')
    writeFileSync(path, TOOL_FIXTURE_LINES.map((l) => JSON.stringify(l)).join('\n') + '\n')

    const result = await parseClaudeSession(path)

    expect(result.toolCalls).toBe(4)
    expect(result.filesRead).toBe(1) // /x/a.ts appears twice → deduped
    expect(result.filesEdited).toBe(1) // /x/b.ts
    expect(result.gitCommits).toBe(1)

    // Per-tool stats: Read should appear with both invocations, Edit + Bash with one each.
    const byName = new Map(result.toolStats.map((t) => [t.name, t]))
    expect(byName.get('Read')!.count).toBe(2)
    expect(byName.get('Read')!.minMs).toBe(500)
    expect(byName.get('Read')!.maxMs).toBe(2_000)
    expect(byName.get('Read')!.longestToolUseId).toBe('tu_read2')
    // Edit has no paired tool_result in the fixture → null durations.
    expect(byName.get('Edit')!.count).toBe(1)
    expect(byName.get('Edit')!.minMs).toBeNull()
    expect(byName.get('Edit')!.longestToolUseId).toBeNull()
    expect(byName.get('Bash')!.count).toBe(1)

    // startedAt + durationMs from the main JSONL timestamps.
    expect(result.startedAt).toBe(Date.parse('2026-07-01T00:00:00.000Z'))
    expect(result.durationMs).toBe(4_000)
  })

  test('prompts table dedups resume-replays: same uuid + new promptId per replay collapses to one row', async () => {
    // Reproduces the prompts-table bug: a session resumed twice has the
    // same user-prompt line emitted three times with the same uuid +
    // text but three different promptIds. The OLD parser keyed prompts
    // by promptId → produced 3 separate rows of which 2 had zero calls
    // and got dropped. The NEW parser keys by uuid → one row, all
    // assistant calls correctly attribute to it.
    const lines = [
      {
        type: 'user',
        uuid: 'u-prompt',
        parentUuid: null,
        promptId: 'pid-replay1',
        timestamp: '2026-07-01T00:00:00.000Z',
        message: { content: 'do the thing' },
      },
      {
        type: 'user',
        uuid: 'u-prompt',
        parentUuid: null,
        promptId: 'pid-replay2',
        timestamp: '2026-07-01T00:00:00.000Z',
        message: { content: 'do the thing' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u-prompt',
        timestamp: '2026-07-01T00:00:01.000Z',
        isSidechain: false,
        message: {
          id: 'm1',
          model: 'claude-opus-4-7',
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'text', text: 'sure' }],
        },
      },
    ]
    const path = join(TMP_DIR, 'replay.jsonl')
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')

    const result = await parseClaudeSession(path)
    // One canonical entry keyed by uuid, even though two promptIds
    // appeared in the user lines.
    expect(Object.keys(result.prompts)).toEqual(['u-prompt'])
    // The assistant call attributes to the same uuid.
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0].promptId).toBe('u-prompt')
  })

  test('userPrompts dedups resume-replays by uuid and filters internal injects', async () => {
    // Simulate a session that was resumed twice: the same user-prompt
    // line appears three times in the JSONL (same uuid, same parent,
    // same text, same timestamp) but with three different promptIds —
    // one per replay. The real count is one.
    //
    // Plus: a second prompt that's a real user typed message, a
    // <command-name> slash command, a <local-command-stdout> capture,
    // and a [Request interrupted by user] auto-message. The first two
    // count; the last three are filtered.
    const lines = [
      // Replay 1 of "hello"
      {
        type: 'user',
        uuid: 'u-prompt1',
        parentUuid: null,
        promptId: 'pid-1a',
        timestamp: '2026-07-01T00:00:00.000Z',
        message: { content: 'hello' },
      },
      // Replay 2 of "hello" — same uuid, different promptId
      {
        type: 'user',
        uuid: 'u-prompt1',
        parentUuid: null,
        promptId: 'pid-1b',
        timestamp: '2026-07-01T00:00:00.000Z',
        message: { content: 'hello' },
      },
      // Replay 3 of "hello" — same uuid, different promptId
      {
        type: 'user',
        uuid: 'u-prompt1',
        parentUuid: null,
        promptId: 'pid-1c',
        timestamp: '2026-07-01T00:00:00.000Z',
        message: { content: 'hello' },
      },
      // A distinct real prompt
      {
        type: 'user',
        uuid: 'u-prompt2',
        parentUuid: null,
        promptId: 'pid-2',
        timestamp: '2026-07-01T00:01:00.000Z',
        message: { content: 'do the thing' },
      },
      // Slash command — filtered
      {
        type: 'user',
        uuid: 'u-slash',
        parentUuid: null,
        promptId: 'pid-slash',
        timestamp: '2026-07-01T00:02:00.000Z',
        message: { content: '<command-name>/clear</command-name>' },
      },
      // Captured bash output — filtered
      {
        type: 'user',
        uuid: 'u-stdout',
        parentUuid: null,
        promptId: 'pid-stdout',
        timestamp: '2026-07-01T00:03:00.000Z',
        message: { content: '<local-command-stdout>build output...</local-command-stdout>' },
      },
      // Interrupt — filtered
      {
        type: 'user',
        uuid: 'u-interrupt',
        parentUuid: null,
        promptId: 'pid-interrupt',
        timestamp: '2026-07-01T00:04:00.000Z',
        message: { content: '[Request interrupted by user]' },
      },
    ]
    const path = join(TMP_DIR, 'user-prompts.jsonl')
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')

    const result = await parseClaudeSession(path)
    expect(result.userPrompts).toBe(2)
  })

  test('tool stats merge across main + subagent jsonls', async () => {
    const path = join(TMP_DIR, 'merge.jsonl')
    writeFileSync(path, TOOL_FIXTURE_LINES.map((l) => JSON.stringify(l)).join('\n') + '\n')

    // Subagent that runs a Read of its own — should be added to the main
    // session's Read count and filesRead set.
    const dir = path.replace(/\.jsonl$/, '') + '/subagents'
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      dir + '/agent-sub1.jsonl',
      [
        {
          type: 'assistant',
          uuid: 'sub-a1',
          parentUuid: null,
          timestamp: '2026-07-01T00:00:05.000Z',
          isSidechain: true,
          message: {
            id: 'sub-m1',
            model: 'claude-haiku-4-5',
            usage: { input_tokens: 1, output_tokens: 1 },
            content: [
              {
                type: 'tool_use',
                id: 'tu_sub_read',
                name: 'Read',
                input: { file_path: '/sub/y.ts' },
              },
            ],
          },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n') + '\n',
    )
    writeFileSync(
      dir + '/agent-sub1.meta.json',
      JSON.stringify({ agentType: 'X', description: '', toolUseId: 'tu_x' }),
    )

    const result = await parseClaudeSession(path)
    expect(result.toolCalls).toBe(5) // 4 main + 1 sub
    expect(result.filesRead).toBe(2) // /x/a.ts + /sub/y.ts
    const read = result.toolStats.find((t) => t.name === 'Read')!
    expect(read.count).toBe(3) // 2 main Reads + 1 sub Read
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
    const result = await parseClaudeSession(FIXTURE_PATH)
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

  test('session with no subagents directory parses cleanly (no errors, empty subagents)', async () => {
    // Fresh fixture with no subagents/ dir alongside it.
    const path = join(TMP_DIR, 'no-subs.jsonl')
    writeFileSync(path, JSON.stringify(FIXTURE_LINES[0]) + '\n')
    const result = await parseClaudeSession(path)
    expect(result.subagents).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  test('stray .meta.json without a matching .jsonl is ignored (no error)', async () => {
    // Filesystem discovery filters by `agent-*.jsonl`, so an orphan
    // meta file shouldn't trip an error or show up in subagents[].
    const path = join(TMP_DIR, 'stray-meta.jsonl')
    writeFileSync(path, JSON.stringify(FIXTURE_LINES[0]) + '\n')
    const dir = path.replace(/\.jsonl$/, '') + '/subagents'
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      dir + '/agent-ghost.meta.json',
      JSON.stringify({ agentType: 'X', description: 'd', toolUseId: 't' }),
    )
    const result = await parseClaudeSession(path)
    expect(result.subagents).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  test('discovers subagents via filesystem scan, not via input list', async () => {
    // Write a subagent whose id is NOT recorded anywhere in the DB or
    // input. The dir-scan path must still find it. Regression guard
    // for resumed sessions where the plugin wasn't capturing when the
    // subagent ran.
    const path = join(TMP_DIR, 'dirscan.jsonl')
    writeFileSync(path, JSON.stringify(FIXTURE_LINES[0]) + '\n')
    writeSubagent(
      path,
      'pre-resume-subagent',
      { agentType: 'general-purpose', description: 'pre-resume', toolUseId: 'toolu_pre' },
      [
        {
          model: 'claude-haiku-4-5-20251001',
          ts: '2026-05-22T00:00:10.000Z',
          usage: {
            input_tokens: 2,
            output_tokens: 5,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
            service_tier: 'standard',
          },
          content: [{ type: 'text', text: 'ok' }],
        },
      ],
    )
    const result = await parseClaudeSession(path)
    const sub = result.subagents.find((s) => s.agentId === 'pre-resume-subagent')
    expect(sub).toBeDefined()
    expect(sub!.agentType).toBe('general-purpose')
    expect(sub!.toolUseId).toBe('toolu_pre')
  })

  test('discovers workflow subagents nested under subagents/workflows/wf_*/', async () => {
    // Claude's workflow feature stores subagent transcripts in a nested
    // dir (subagents/workflows/wf_<id>/) instead of flat in subagents/.
    // Discovery must recurse to find them.
    const path = join(TMP_DIR, 'workflow.jsonl')
    writeFileSync(path, JSON.stringify(FIXTURE_LINES[0]) + '\n')

    const wfDir = path.replace(/\.jsonl$/, '') + '/subagents/workflows/wf_abc123'
    mkdirSync(wfDir, { recursive: true })
    writeFileSync(
      wfDir + '/agent-wf1.jsonl',
      [
        {
          type: 'assistant',
          uuid: 'wf-a1',
          parentUuid: null,
          timestamp: '2026-05-22T00:00:10.000Z',
          isSidechain: true,
          message: {
            id: 'wf-m1',
            model: 'claude-haiku-4-5',
            usage: { input_tokens: 7, output_tokens: 11 },
            content: [
              {
                type: 'tool_use',
                id: 'tu_wf_read',
                name: 'Read',
                input: { file_path: '/wf/z.ts' },
              },
            ],
          },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n') + '\n',
    )
    writeFileSync(
      wfDir + '/agent-wf1.meta.json',
      JSON.stringify({ agentType: 'workflow-subagent' }),
    )

    const result = await parseClaudeSession(path)
    expect(result.errors).toHaveLength(0)
    const sub = result.subagents.find((s) => s.agentId === 'wf1')
    expect(sub).toBeDefined()
    expect(sub!.agentType).toBe('workflow-subagent')
    expect(sub!.inputTokens).toBe(7)
    expect(sub!.outputTokens).toBe(11)
  })

  test('discovers flat and nested subagents together', async () => {
    const path = join(TMP_DIR, 'mixed.jsonl')
    writeFileSync(path, JSON.stringify(FIXTURE_LINES[0]) + '\n')

    // Flat classic subagent.
    writeSubagent(path, 'flat1', { agentType: 'Explore', description: 'd', toolUseId: 't' }, [
      {
        model: 'claude-haiku-4-5',
        ts: '2026-05-22T00:00:10.000Z',
        usage: { input_tokens: 1, output_tokens: 2 },
        content: [{ type: 'text', text: 'ok' }],
      },
    ])

    // Nested workflow subagent.
    const wfDir = path.replace(/\.jsonl$/, '') + '/subagents/workflows/wf_xyz'
    mkdirSync(wfDir, { recursive: true })
    writeFileSync(
      wfDir + '/agent-nested1.jsonl',
      JSON.stringify({
        type: 'assistant',
        uuid: 'n-a1',
        parentUuid: null,
        timestamp: '2026-05-22T00:00:20.000Z',
        isSidechain: true,
        message: {
          id: 'n-m1',
          model: 'claude-haiku-4-5',
          usage: { input_tokens: 3, output_tokens: 4 },
          content: [{ type: 'text', text: 'ok' }],
        },
      }) + '\n',
    )

    const result = await parseClaudeSession(path)
    expect(result.errors).toHaveLength(0)
    expect(result.subagents.map((s) => s.agentId).sort()).toEqual(['flat1', 'nested1'])
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
    const result = await parseClaudeSession(FIXTURE_PATH)
    const sub = result.subagents.find((s) => s.agentId === 'orphan')
    expect(sub).toBeDefined()
    expect(sub!.agentType).toBeNull()
    expect(sub!.description).toBeNull()
    expect(sub!.toolUseId).toBeNull()
    expect(sub!.model).toBe('claude-opus-4-7')
  })
})
