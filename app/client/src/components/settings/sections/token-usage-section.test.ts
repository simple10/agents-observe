import { describe, test, expect } from 'vitest'
import { buildAgentsTable, fmtMs } from './token-usage-section'
import type { TranscriptStatsData } from '@/lib/api-client'
import type { AgentTokenUsage } from '../session-modal'

// Minimal helpers for fixture construction. The Section under test only
// touches the fields below; everything else can be stub defaults.

function makeSubagent(overrides: Partial<AgentTokenUsage>): AgentTokenUsage {
  return {
    agentId: 'sub-a',
    agentType: 'Explore',
    description: 'sub',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 10,
    cacheCreationTokens: 5,
    totalDurationMs: 60_000,
    toolUseCount: 3,
    ...overrides,
  }
}

function makeTranscript(overrides: Partial<TranscriptStatsData> = {}): TranscriptStatsData {
  return {
    source: 'jsonl',
    summary: {
      totalCalls: 0,
      inputTotal: 0,
      outputTotal: 0,
      cacheHitRate: 0,
      costTotalCents: 0,
    },
    byModel: [],
    prompts: [],
    subagents: [],
    models: {},
    errors: [],
    ...overrides,
  }
}

describe('buildAgentsTable — events-only mode (no transcript)', () => {
  test('always returns a main agent row with session duration + tool count', () => {
    const { agentRows } = buildAgentsTable({
      mainAgentId: 'sess1',
      sessionDurationMs: 120_000,
      mainAgentToolCount: 7,
      eventSubagents: [],
      transcript: null,
    })
    expect(agentRows).toHaveLength(1)
    const main = agentRows[0]
    expect(main.isMain).toBe(true)
    expect(main.agentId).toBe('sess1')
    expect(main.durationMs).toBe(120_000)
    expect(main.toolCount).toBe(7)
    // Token / cost fields are null — events don't carry these for main.
    expect(main.inputTokens).toBeNull()
    expect(main.outputTokens).toBeNull()
    expect(main.requests).toBeNull()
    expect(main.model).toBeNull()
    expect(main.costCents).toBeNull()
  })

  test('subagents from events render with tokens but null requests/model/cost', () => {
    const sub = makeSubagent({
      agentId: 'sub-1',
      agentType: 'Explore',
      inputTokens: 1500,
      outputTokens: 300,
      cacheReadTokens: 200,
      cacheCreationTokens: 100,
      totalDurationMs: 45_000,
      toolUseCount: 4,
    })
    const { agentRows } = buildAgentsTable({
      mainAgentId: 'sess1',
      sessionDurationMs: 200_000,
      mainAgentToolCount: 2,
      eventSubagents: [sub],
      transcript: null,
    })
    expect(agentRows).toHaveLength(2)
    const subRow = agentRows.find((r) => r.agentId === 'sub-1')!
    expect(subRow.isMain).toBe(false)
    expect(subRow.agentType).toBe('Explore')
    expect(subRow.durationMs).toBe(45_000)
    expect(subRow.toolCount).toBe(4)
    expect(subRow.inputTokens).toBe(1500)
    expect(subRow.outputTokens).toBe(300)
    expect(subRow.cacheReadTokens).toBe(200)
    // Events lump cache_creation_input_tokens into the 5m bucket.
    expect(subRow.cacheCreate5mTokens).toBe(100)
    expect(subRow.cacheCreate1hTokens).toBe(0)
    // Events don't carry these.
    expect(subRow.requests).toBeNull()
    expect(subRow.model).toBeNull()
    expect(subRow.costCents).toBeNull()
  })
})

describe('buildAgentsTable — transcript merge', () => {
  test('transcript fields overlay events fields when present', () => {
    const sub = makeSubagent({
      agentId: 'sub-1',
      inputTokens: 100, // will be overridden by transcript
      outputTokens: 50,
      totalDurationMs: 30_000,
      toolUseCount: 2,
    })
    const transcript = makeTranscript({
      subagents: [
        {
          agentId: 'sub-1',
          agentType: 'Explore',
          description: null,
          toolUseId: null,
          model: 'claude-haiku-4-5',
          requests: 3,
          inputTokens: 999,
          outputTokens: 555,
          cacheReadTokens: 77,
          cacheCreate5mTokens: 11,
          cacheCreate1hTokens: 22,
          durationMs: 60_000,
          toolCount: 5,
          costCents: 12,
        },
      ],
    })
    const { agentRows } = buildAgentsTable({
      mainAgentId: 'sess1',
      sessionDurationMs: 200_000,
      mainAgentToolCount: 0,
      eventSubagents: [sub],
      transcript,
    })
    const subRow = agentRows.find((r) => r.agentId === 'sub-1')!
    // Transcript values win when present.
    expect(subRow.model).toBe('claude-haiku-4-5')
    expect(subRow.requests).toBe(3)
    expect(subRow.inputTokens).toBe(999)
    expect(subRow.outputTokens).toBe(555)
    expect(subRow.costCents).toBe(12)
    expect(subRow.cacheCreate5mTokens).toBe(11)
    expect(subRow.cacheCreate1hTokens).toBe(22)
  })

  test('empty transcript fields do NOT clobber events data', () => {
    const sub = makeSubagent({
      agentId: 'sub-1',
      inputTokens: 100,
      outputTokens: 50,
      totalDurationMs: 30_000,
      toolUseCount: 2,
    })
    const transcript = makeTranscript({
      subagents: [
        {
          agentId: 'sub-1',
          agentType: 'Explore',
          description: null,
          toolUseId: null,
          model: '',
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreate5mTokens: 0,
          cacheCreate1hTokens: 0,
          durationMs: 0,
          toolCount: 0,
          costCents: null,
        },
      ],
    })
    const { agentRows } = buildAgentsTable({
      mainAgentId: 'sess1',
      sessionDurationMs: 200_000,
      mainAgentToolCount: 0,
      eventSubagents: [sub],
      transcript,
    })
    const subRow = agentRows.find((r) => r.agentId === 'sub-1')!
    // Events-derived values preserved because transcript fields are empty.
    expect(subRow.inputTokens).toBe(100)
    expect(subRow.outputTokens).toBe(50)
    expect(subRow.durationMs).toBe(30_000)
    expect(subRow.toolCount).toBe(2)
  })

  test('subagent in transcript but not in events gets added as a row', () => {
    const transcript = makeTranscript({
      subagents: [
        {
          agentId: 'sub-new',
          agentType: 'Plan',
          description: null,
          toolUseId: null,
          model: 'claude-opus-4-7',
          requests: 1,
          inputTokens: 50,
          outputTokens: 25,
          cacheReadTokens: 0,
          cacheCreate5mTokens: 0,
          cacheCreate1hTokens: 0,
          durationMs: 5_000,
          toolCount: 1,
          costCents: 3,
        },
      ],
    })
    const { agentRows } = buildAgentsTable({
      mainAgentId: 'sess1',
      sessionDurationMs: 100_000,
      mainAgentToolCount: 0,
      eventSubagents: [],
      transcript,
    })
    expect(agentRows).toHaveLength(2) // main + new sub
    const subRow = agentRows.find((r) => r.agentId === 'sub-new')!
    expect(subRow.model).toBe('claude-opus-4-7')
    expect(subRow.requests).toBe(1)
    expect(subRow.inputTokens).toBe(50)
  })

  test('main agent row gets tokens from byModel minus subagent contributions', () => {
    // byModel for opus-4-7: 5 calls, 10000 input. Subagent on opus-4-7
    // consumed 1 call, 1000 input. Main agent should be (5-1)=4 calls,
    // (10000-1000)=9000 input.
    const transcript = makeTranscript({
      byModel: [
        {
          model: 'claude-opus-4-7',
          calls: 5,
          inputTokens: 10_000,
          outputTokens: 2_000,
          cacheReadTokens: 0,
          cacheCreate5mTokens: 0,
          cacheCreate1hTokens: 0,
          costCents: 50,
        },
      ],
      subagents: [
        {
          agentId: 'sub-1',
          agentType: 'Explore',
          description: null,
          toolUseId: null,
          model: 'claude-opus-4-7',
          requests: 1,
          inputTokens: 1_000,
          outputTokens: 200,
          cacheReadTokens: 0,
          cacheCreate5mTokens: 0,
          cacheCreate1hTokens: 0,
          durationMs: 1_000,
          toolCount: 0,
          costCents: 10,
        },
      ],
    })
    const { agentRows } = buildAgentsTable({
      mainAgentId: 'sess1',
      sessionDurationMs: 100_000,
      mainAgentToolCount: 0,
      eventSubagents: [],
      transcript,
    })
    const main = agentRows.find((r) => r.isMain)!
    expect(main.requests).toBe(4)
    expect(main.inputTokens).toBe(9_000)
    expect(main.outputTokens).toBe(1_800)
    expect(main.model).toBe('claude-opus-4-7')
    expect(main.costCents).toBe(40)
  })

  test('agentTotals.requests is null when any row has null requests', () => {
    // Events-only mode → main has null requests → totals must be null.
    const { agentTotals } = buildAgentsTable({
      mainAgentId: 'sess1',
      sessionDurationMs: 100_000,
      mainAgentToolCount: 5,
      eventSubagents: [makeSubagent({ agentId: 'sub-1', inputTokens: 100, outputTokens: 50 })],
      transcript: null,
    })
    expect(agentTotals.requests).toBeNull()
    // Duration and toolCount are always populated; they sum normally.
    expect(agentTotals.durationMs).toBeGreaterThan(0)
    expect(agentTotals.toolCount).toBeGreaterThan(0)
  })
})

describe('fmtMs — duration formatting', () => {
  test.each([
    [500, '500ms'],
    [1_000, '1s'],
    [59_999, '60s'],
    [60_000, '1m 0s'],
    [3_599_999, '59m 59s'],
    [3_600_000, '1h 0m'],
    [86_399_999, '23h 59m'],
    // >= 24h: round to nearest hour, drop minutes.
    [86_400_000, '1d'], // exactly 24h → 1d
    [126_000_000, '1d 11h'], // 35h → 1d 11h
    [124_260_000, '1d 11h'], // 34h 31m → rounds up to 35h
    [124_140_000, '1d 10h'], // 34h 29m → rounds down to 34h
    // Carry: 23h 50m of "extra" within the day rounds up to 24h ⇒ +1d.
    [172_740_000, '2d'], // 1d 23h 59m → rounds to 48h = 2d
  ])('fmtMs(%i) → %s', (ms, expected) => {
    expect(fmtMs(ms)).toBe(expected)
  })
})
