import { describe, test, expect } from 'vitest'
import { formatModelLabel } from './model-badge'

describe('formatModelLabel', () => {
  test.each([
    // Claude: strip prefix, convert version dashes to dots.
    ['claude-opus-4-7', 'opus-4.7'],
    ['claude-sonnet-4-6', 'sonnet-4.6'],
    // Claude with trailing date suffix.
    ['claude-haiku-4-5-20251001', 'haiku-4.5'],
    // OpenAI / gpt: already-clean labels pass through.
    ['gpt-5.4', 'gpt-5.4'],
    ['gpt-4o', 'gpt-4o'],
    ['gpt-4o-mini', 'gpt-4o-mini'],
    // Unknown providers pass through.
    ['llama-3.3-70b', 'llama-3.3-70b'],
    ['mistral-large', 'mistral-large'],
    // Edge cases.
    ['', ''],
  ])('formatModelLabel(%s) → %s', (input, expected) => {
    expect(formatModelLabel(input)).toBe(expected)
  })
})
