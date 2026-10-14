import { describe, expect, test } from 'vitest'
import { slimToolOutput, slimValue } from './slim-tool-output'

const big = 'x'.repeat(5000)

describe('slimValue', () => {
  test('keeps scalars and short strings', () => {
    expect(slimValue({ agentId: 'a1b2', interrupted: false, code: 0, x: null })).toEqual({
      agentId: 'a1b2',
      interrupted: false,
      code: 0,
      x: null,
    })
  })

  test('long strings become a text placeholder with size', () => {
    expect(slimValue({ stdout: `${big}\nend` })).toEqual({
      stdout: '[omitted: 5004 bytes, 2 lines]',
    })
  })

  test('arrays and deep objects become placeholders', () => {
    const out = slimValue({
      structuredPatch: [1, 2, 3],
      file: { filePath: '/a/b.ts', numLines: 12, content: big, deep: { a: 1 } },
    }) as any
    expect(out.structuredPatch).toBe('[omitted: 7 bytes, 3 items]')
    expect(out.file.filePath).toBe('/a/b.ts')
    expect(out.file.numLines).toBe(12)
    expect(out.file.content).toMatch(/^\[omitted: 5000 bytes, 1 lines\]$/)
    expect(out.file.deep).toBe('[omitted: 7 bytes]')
  })

  test('usage is kept whole', () => {
    const usage = { input_tokens: 3, server_tool_use: { web_search_requests: 1 } }
    expect((slimValue({ usage }) as any).usage).toEqual(usage)
  })

  test('a top-level string or array response becomes a placeholder', () => {
    expect(slimValue(big)).toBe('[omitted: 5000 bytes, 1 lines]')
    expect(slimValue([{ type: 'text', text: 'hi' }])).toMatch(/^\[omitted: \d+ bytes, 1 items\]$/)
  })
})

describe('slimToolOutput', () => {
  test('PostToolUse: only tool_response changes', () => {
    const payload = { tool_name: 'Bash', tool_input: { command: big }, tool_response: { stdout: big } }
    const out = slimToolOutput('PostToolUse', payload) as any
    expect(out.tool_input.command).toBe(big)
    expect(out.tool_response.stdout).toMatch(/^\[omitted/)
    expect(payload.tool_response.stdout).toBe(big) // input not mutated
  })

  test('PostToolBatch: every call is slimmed', () => {
    const out = slimToolOutput('PostToolBatch', {
      tool_calls: [{ tool_name: 'Read', tool_response: big }, { tool_name: 'X' }],
    }) as any
    expect(out.tool_calls[0].tool_response).toMatch(/^\[omitted/)
    expect(out.tool_calls[1]).toEqual({ tool_name: 'X' })
  })

  test('other hooks pass through untouched', () => {
    const payload = { prompt: big }
    expect(slimToolOutput('UserPromptSubmit', payload)).toBe(payload)
  })
})
